const { getActivePPPoEUsers } = require('./mikrotik');

const COLLECT_INTERVAL_MS = 2 * 60 * 1000;
const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const HISTORY_LIMIT_DAYS = 30;

const LIVE_SAMPLE_INTERVAL_MS = 5 * 1000;
const LIVE_DEMAND_WINDOW_MS = 60 * 1000;
const LIVE_FRESH_THRESHOLD_MS = 10 * 1000;
const LIVE_STALE_FALLBACK_MS = 30 * 1000;

let collectorInterval = null;
let collectorInFlight = null;

let liveSamplerInterval = null;
let liveSamplerInFlight = null;
let liveDemandUntil = 0;
let currentLiveSnapshot = null;
let previousLiveSnapshot = null;
let lastLiveSampleFailedAt = null;
let lastLiveSampleError = null;

function waitForDb() {
    if (global.__dbInitPromise) {
        return global.__dbInitPromise;
    }
    return Promise.resolve();
}

function runDb(sql, params = []) {
    return waitForDb().then(() => new Promise((resolve, reject) => {
        if (!global.db) {
            return reject(new Error('Database not initialized'));
        }
        global.db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve(this);
        });
    }));
}

function getDb(sql, params = []) {
    return waitForDb().then(() => new Promise((resolve, reject) => {
        if (!global.db) {
            return reject(new Error('Database not initialized'));
        }
        global.db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    }));
}

function allDb(sql, params = []) {
    return waitForDb().then(() => new Promise((resolve, reject) => {
        if (!global.db) {
            return reject(new Error('Database not initialized'));
        }
        global.db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    }));
}

function getJakartaParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        year: lookup.year,
        month: lookup.month,
        day: lookup.day,
        date: `${lookup.year}-${lookup.month}-${lookup.day}`,
        yearMonth: `${lookup.year}-${lookup.month}`,
    };
}

function zeroUsage() {
    return {
        downloadBytes: 0,
        uploadBytes: 0,
        totalBytes: 0,
    };
}

function zeroLivePayload(overrides = {}) {
    return {
        hasPppoe: true,
        pppoeUsername: null,
        online: false,
        downloadBps: 0,
        uploadBps: 0,
        downloadHuman: '0 bps',
        uploadHuman: '0 bps',
        interfaceName: null,
        lastSampleAt: null,
        sampleIntervalMs: null,
        stale: false,
        warmup: false,
        ...overrides,
    };
}

function formatBitsPerSecond(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return '0 bps';
    }

    const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
    let rate = value;
    let unitIndex = 0;

    while (rate >= 1000 && unitIndex < units.length - 1) {
        rate /= 1000;
        unitIndex += 1;
    }

    const decimals = rate >= 100 ? 0 : rate >= 10 ? 1 : 2;
    return `${rate.toFixed(decimals)} ${units[unitIndex]}`;
}

function buildLiveSnapshot(sessions, collectedAtMs) {
    const normalizedSessions = new Map();

    for (const session of sessions) {
        const pppoeUsername = String(session?.name || '').trim();
        if (!pppoeUsername) {
            continue;
        }

        const downloadBytes = Number(session.rx_bytes);
        const uploadBytes = Number(session.tx_bytes);
        if (!Number.isFinite(downloadBytes) || !Number.isFinite(uploadBytes)) {
            continue;
        }

        normalizedSessions.set(pppoeUsername, {
            pppoeUsername,
            interfaceName: session.interface_name || null,
            downloadBytes,
            uploadBytes,
            uptime: session.uptime || null,
        });
    }

    return {
        collectedAtMs,
        collectedAt: new Date(collectedAtMs).toISOString(),
        sessions: normalizedSessions,
    };
}

function resolveLiveRate(currentValue, previousValue, sampleIntervalMs) {
    if (
        !Number.isFinite(currentValue) ||
        !Number.isFinite(previousValue) ||
        !Number.isFinite(sampleIntervalMs) ||
        sampleIntervalMs <= 0
    ) {
        return 0;
    }

    if (currentValue < previousValue) {
        return 0;
    }

    const bytesDelta = currentValue - previousValue;
    return Math.max(0, Math.round((bytesDelta * 8 * 1000) / sampleIntervalMs));
}

function shouldTreatAsStale(snapshot) {
    if (!snapshot) {
        return false;
    }
    return (Date.now() - snapshot.collectedAtMs) > LIVE_FRESH_THRESHOLD_MS;
}

class CustomerTrafficUsageService {
    static isFeatureEnabled() {
        return this.isUsageFeatureEnabled();
    }

    static isUsageFeatureEnabled() {
        return global.config?.customerTrafficUsageEnabled === true;
    }

    static isLiveFeatureEnabled() {
        return global.config?.customerTrafficLiveEnabled === true;
    }

    static getFeatureStatus() {
        const usageEnabled = this.isUsageFeatureEnabled();
        const liveEnabled = usageEnabled && this.isLiveFeatureEnabled();
        return {
            enabled: usageEnabled,
            usageEnabled,
            liveEnabled,
        };
    }

    static async ensureTables() {
        await runDb(`
            CREATE TABLE IF NOT EXISTS customer_traffic_state (
                pppoe_username TEXT PRIMARY KEY,
                last_rx_bytes INTEGER NOT NULL DEFAULT 0,
                last_tx_bytes INTEGER NOT NULL DEFAULT 0,
                last_seen_at TEXT,
                last_interface_name TEXT
            )
        `);

        await runDb(`
            CREATE TABLE IF NOT EXISTS customer_traffic_daily_usage (
                pppoe_username TEXT NOT NULL,
                usage_date TEXT NOT NULL,
                download_bytes INTEGER NOT NULL DEFAULT 0,
                upload_bytes INTEGER NOT NULL DEFAULT 0,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                last_collected_at TEXT,
                PRIMARY KEY (pppoe_username, usage_date)
            )
        `);
    }

    static async collectUsageSnapshot(context = {}) {
        if (!this.isUsageFeatureEnabled()) {
            return { skipped: true, reason: 'feature_disabled' };
        }

        await this.ensureTables();

        const result = await getActivePPPoEUsers({
            caller: context.caller || 'customer-traffic.collector',
        });

        if (!result.ok) {
            return {
                skipped: true,
                reason: result.errorCode || 'mikrotik_error',
                result,
            };
        }

        const sessions = Array.isArray(result.data) ? result.data : [];
        const now = new Date();
        const nowIso = now.toISOString();
        const today = getJakartaParts(now).date;

        for (const session of sessions) {
            const pppoeUsername = String(session.name || '').trim();
            if (!pppoeUsername) continue;

            const currentDownload = Number(session.rx_bytes);
            const currentUpload = Number(session.tx_bytes);
            if (!Number.isFinite(currentDownload) || !Number.isFinite(currentUpload)) {
                continue;
            }

            const currentState = await getDb(
                `SELECT last_rx_bytes, last_tx_bytes FROM customer_traffic_state WHERE pppoe_username = ?`,
                [pppoeUsername]
            );

            const hasPreviousState = currentState !== null;
            const previousDownload = Number(currentState?.last_rx_bytes || 0);
            const previousUpload = Number(currentState?.last_tx_bytes || 0);

            const downloadDelta = !hasPreviousState
                ? 0
                : currentDownload >= previousDownload
                    ? currentDownload - previousDownload
                    : currentDownload;
            const uploadDelta = !hasPreviousState
                ? 0
                : currentUpload >= previousUpload
                    ? currentUpload - previousUpload
                    : currentUpload;
            const totalDelta = downloadDelta + uploadDelta;

            await runDb(`
                INSERT INTO customer_traffic_state (
                    pppoe_username,
                    last_rx_bytes,
                    last_tx_bytes,
                    last_seen_at,
                    last_interface_name
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(pppoe_username) DO UPDATE SET
                    last_rx_bytes = excluded.last_rx_bytes,
                    last_tx_bytes = excluded.last_tx_bytes,
                    last_seen_at = excluded.last_seen_at,
                    last_interface_name = excluded.last_interface_name
            `, [
                pppoeUsername,
                currentDownload,
                currentUpload,
                nowIso,
                session.interface_name || null,
            ]);

            await runDb(`
                INSERT INTO customer_traffic_daily_usage (
                    pppoe_username,
                    usage_date,
                    download_bytes,
                    upload_bytes,
                    total_bytes,
                    last_collected_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(pppoe_username, usage_date) DO UPDATE SET
                    download_bytes = customer_traffic_daily_usage.download_bytes + excluded.download_bytes,
                    upload_bytes = customer_traffic_daily_usage.upload_bytes + excluded.upload_bytes,
                    total_bytes = customer_traffic_daily_usage.total_bytes + excluded.total_bytes,
                    last_collected_at = excluded.last_collected_at
            `, [
                pppoeUsername,
                today,
                downloadDelta,
                uploadDelta,
                totalDelta,
                nowIso,
            ]);
        }

        return {
            skipped: false,
            sessionsProcessed: sessions.length,
            collectedAt: nowIso,
        };
    }

    static async getCustomerUsage(customer) {
        await this.ensureTables();

        const pppoeUsername = String(customer?.pppoe_username || '').trim();
        if (!pppoeUsername) {
            return {
                hasPppoe: false,
                pppoeUsername: null,
                today: zeroUsage(),
                currentMonth: zeroUsage(),
                dailyHistory: [],
                lastCollectedAt: null,
                stale: false,
            };
        }

        const todayParts = getJakartaParts();
        const todayRow = await getDb(`
            SELECT download_bytes, upload_bytes, total_bytes, last_collected_at
            FROM customer_traffic_daily_usage
            WHERE pppoe_username = ? AND usage_date = ?
        `, [pppoeUsername, todayParts.date]);

        const monthRows = await allDb(`
            SELECT usage_date, download_bytes, upload_bytes, total_bytes, last_collected_at
            FROM customer_traffic_daily_usage
            WHERE pppoe_username = ? AND substr(usage_date, 1, 7) = ?
            ORDER BY usage_date DESC
        `, [pppoeUsername, todayParts.yearMonth]);

        const historyRows = await allDb(`
            SELECT usage_date, download_bytes, upload_bytes, total_bytes, last_collected_at
            FROM customer_traffic_daily_usage
            WHERE pppoe_username = ?
            ORDER BY usage_date DESC
            LIMIT ?
        `, [pppoeUsername, HISTORY_LIMIT_DAYS]);

        const lastState = await getDb(`
            SELECT last_seen_at FROM customer_traffic_state WHERE pppoe_username = ?
        `, [pppoeUsername]);

        const currentMonth = monthRows.reduce((acc, row) => ({
            downloadBytes: acc.downloadBytes + Number(row.download_bytes || 0),
            uploadBytes: acc.uploadBytes + Number(row.upload_bytes || 0),
            totalBytes: acc.totalBytes + Number(row.total_bytes || 0),
        }), zeroUsage());

        const lastCollectedAt = todayRow?.last_collected_at || lastState?.last_seen_at || null;
        const stale = Boolean(
            lastCollectedAt &&
            (Date.now() - new Date(lastCollectedAt).getTime()) > STALE_THRESHOLD_MS
        );

        return {
            hasPppoe: true,
            pppoeUsername,
            today: {
                downloadBytes: Number(todayRow?.download_bytes || 0),
                uploadBytes: Number(todayRow?.upload_bytes || 0),
                totalBytes: Number(todayRow?.total_bytes || 0),
            },
            currentMonth,
            dailyHistory: historyRows.map((row) => ({
                date: row.usage_date,
                downloadBytes: Number(row.download_bytes || 0),
                uploadBytes: Number(row.upload_bytes || 0),
                totalBytes: Number(row.total_bytes || 0),
                lastCollectedAt: row.last_collected_at || null,
            })),
            lastCollectedAt,
            stale,
        };
    }

    static markLiveDemand() {
        liveDemandUntil = Date.now() + LIVE_DEMAND_WINDOW_MS;
    }

    static shouldKeepLiveSamplerRunning() {
        return liveDemandUntil > Date.now();
    }

    static clearLiveSampler() {
        if (liveSamplerInterval) {
            clearInterval(liveSamplerInterval);
            liveSamplerInterval = null;
        }
    }

    static ensureLiveSamplerRunning() {
        if (liveSamplerInterval || !this.isLiveFeatureEnabled()) {
            return;
        }

        liveSamplerInterval = setInterval(() => {
            if (!this.shouldKeepLiveSamplerRunning()) {
                this.clearLiveSampler();
                return;
            }

            void this.collectLiveSnapshot({
                caller: 'customer-traffic.live.loop',
            });
        }, LIVE_SAMPLE_INTERVAL_MS);
    }

    static async collectLiveSnapshot(context = {}) {
        if (!this.isLiveFeatureEnabled()) {
            return {
                ok: false,
                errorCode: 'FEATURE_DISABLED',
                message: 'Live traffic tidak aktif.',
            };
        }

        if (liveSamplerInFlight) {
            return liveSamplerInFlight;
        }

        liveSamplerInFlight = (async () => {
            const result = await getActivePPPoEUsers({
                caller: context.caller || 'customer-traffic.live.sample',
            });

            if (!result.ok) {
                lastLiveSampleFailedAt = Date.now();
                lastLiveSampleError = result;
                return result;
            }

            const sessions = Array.isArray(result.data) ? result.data : [];
            const collectedAtMs = Date.now();
            const nextSnapshot = buildLiveSnapshot(sessions, collectedAtMs);

            previousLiveSnapshot = currentLiveSnapshot;
            currentLiveSnapshot = nextSnapshot;
            lastLiveSampleFailedAt = null;
            lastLiveSampleError = null;

            return {
                ok: true,
                timingMs: result.timingMs,
                message: result.message || 'Live traffic sampled.',
                sessionsProcessed: nextSnapshot.sessions.size,
                collectedAt: nextSnapshot.collectedAt,
            };
        })().finally(() => {
            liveSamplerInFlight = null;
        });

        return liveSamplerInFlight;
    }

    static getPreviousLiveSession(pppoeUsername) {
        if (!previousLiveSnapshot) {
            return null;
        }
        return previousLiveSnapshot.sessions.get(pppoeUsername) || null;
    }

    static getCurrentLiveSession(pppoeUsername) {
        if (!currentLiveSnapshot) {
            return null;
        }
        return currentLiveSnapshot.sessions.get(pppoeUsername) || null;
    }

    static shouldRefreshLiveSnapshot() {
        if (!currentLiveSnapshot) {
            return true;
        }

        const age = Date.now() - currentLiveSnapshot.collectedAtMs;
        if (age > LIVE_FRESH_THRESHOLD_MS) {
            return true;
        }

        if (!previousLiveSnapshot && age >= LIVE_SAMPLE_INTERVAL_MS) {
            return true;
        }

        return false;
    }

    static hasUsableStaleLiveSnapshot() {
        if (!currentLiveSnapshot) {
            return false;
        }

        return (Date.now() - currentLiveSnapshot.collectedAtMs) <= LIVE_STALE_FALLBACK_MS;
    }

    static async ensureFreshLiveSnapshot() {
        this.markLiveDemand();
        this.ensureLiveSamplerRunning();

        if (!this.shouldRefreshLiveSnapshot()) {
            return {
                ok: true,
                fromCache: true,
                stale: false,
            };
        }

        const sampleResult = await this.collectLiveSnapshot({
            caller: 'customer-traffic.live.request',
        });

        if (sampleResult.ok) {
            return {
                ok: true,
                fromCache: false,
                stale: false,
            };
        }

        if (this.hasUsableStaleLiveSnapshot()) {
            return {
                ok: true,
                fromCache: true,
                stale: true,
            };
        }

        return {
            ok: false,
            fromCache: false,
            stale: false,
            error: sampleResult,
        };
    }

    static async getCustomerLiveUsage(customer) {
        const pppoeUsername = String(customer?.pppoe_username || '').trim();
        if (!pppoeUsername) {
            return zeroLivePayload({
                hasPppoe: false,
                pppoeUsername: null,
            });
        }

        if (!this.isLiveFeatureEnabled()) {
            const error = new Error('Live traffic tidak tersedia saat ini.');
            error.code = 'FEATURE_DISABLED';
            throw error;
        }

        const freshness = await this.ensureFreshLiveSnapshot();
        if (!freshness.ok) {
            const error = new Error(freshness.error?.message || 'Live traffic tidak tersedia saat ini.');
            error.code = freshness.error?.errorCode || 'LIVE_SAMPLER_ERROR';
            error.result = freshness.error || null;
            throw error;
        }

        const currentSession = this.getCurrentLiveSession(pppoeUsername);
        const previousSession = this.getPreviousLiveSession(pppoeUsername);
        const sampleIntervalMs = currentLiveSnapshot && previousLiveSnapshot
            ? Math.max(0, currentLiveSnapshot.collectedAtMs - previousLiveSnapshot.collectedAtMs)
            : null;

        if (!currentSession) {
            return zeroLivePayload({
                pppoeUsername,
                online: false,
                lastSampleAt: currentLiveSnapshot?.collectedAt || null,
                sampleIntervalMs,
                stale: freshness.stale || shouldTreatAsStale(currentLiveSnapshot),
            });
        }

        const downloadBps = previousSession
            ? resolveLiveRate(currentSession.downloadBytes, previousSession.downloadBytes, sampleIntervalMs)
            : 0;
        const uploadBps = previousSession
            ? resolveLiveRate(currentSession.uploadBytes, previousSession.uploadBytes, sampleIntervalMs)
            : 0;

        return zeroLivePayload({
            pppoeUsername,
            online: true,
            downloadBps,
            uploadBps,
            downloadHuman: formatBitsPerSecond(downloadBps),
            uploadHuman: formatBitsPerSecond(uploadBps),
            interfaceName: currentSession.interfaceName || null,
            lastSampleAt: currentLiveSnapshot?.collectedAt || null,
            sampleIntervalMs,
            stale: freshness.stale || shouldTreatAsStale(currentLiveSnapshot),
            warmup: !previousSession || !sampleIntervalMs,
        });
    }

    static async startCollector() {
        await this.ensureTables();

        if (collectorInterval) {
            clearInterval(collectorInterval);
            collectorInterval = null;
        }

        const runCycle = async () => {
            if (collectorInFlight) {
                return collectorInFlight;
            }

            collectorInFlight = this.collectUsageSnapshot({
                caller: 'customer-traffic.collector.loop',
            })
                .catch((error) => {
                    console.error('[CUSTOMER_TRAFFIC_COLLECTOR_ERROR]', error.message);
                })
                .finally(() => {
                    collectorInFlight = null;
                });

            return collectorInFlight;
        };

        await runCycle();
        collectorInterval = setInterval(() => {
            void runCycle();
        }, COLLECT_INTERVAL_MS);
    }

    static stopCollector() {
        if (collectorInterval) {
            clearInterval(collectorInterval);
            collectorInterval = null;
        }

        this.clearLiveSampler();
        liveSamplerInFlight = null;
        liveDemandUntil = 0;
        currentLiveSnapshot = null;
        previousLiveSnapshot = null;
        lastLiveSampleFailedAt = null;
        lastLiveSampleError = null;
    }
}

module.exports = CustomerTrafficUsageService;
