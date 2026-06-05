/**
 * OLT SNMP LOS Poller (capability-driven)
 *
 * Untuk brand OLT yang melaporkan status ONU via SNMP native
 * (driver.capabilities.losViaSnmp === true, mis. ZTE C320/C300 GPON):
 * poll status semua ONU berkala, deteksi TRANSISI online→LOS (dan pemulihan→online),
 * lalu feed ke lib/olt-los-broadcaster.js (confirmation window, dedup, cluster, notif).
 *
 * HIOSO TIDAK lewat sini — EPON pakai web-scraper/syslog (losViaSnmp=false).
 *
 * Identitas GPON tanpa MAC: poller resolve pelanggan sendiri lewat
 * deskripsi ONU (= username PPPoE) atau serial, lalu kirim event.customer
 * pre-resolved ke broadcaster. Key dedup broadcaster = serial ONU (stabil).
 *
 * SEMENTIK STARTUP: cycle pertama hanya SEED state (tidak broadcast) supaya ONU
 * yang sudah LOS sejak sebelum bot start tidak memicu broadcast massal.
 *
 * Gating: aktif bila config.oltLosBroadcast.enabled === true DAN ada minimal satu
 * device ber-driver losViaSnmp. Interval: config.oltLosBroadcast.snmpPollIntervalMs
 * (default 90 detik). Murni-ish: semua dependency via injeksi untuk test.
 */
'use strict';

const DEFAULT_INTERVAL_MS = 90_000;
const MIN_INTERVAL_MS = 15_000;

function isUnconfiguredHost(host) {
    const h = String(host || '').trim();
    return h === '' || h.startsWith('ISI_');
}

/**
 * Buat poller dengan dependency injeksi (semua punya default runtime).
 * @param {object} deps
 */
function createSnmpLosPoller(deps = {}) {
    const getDevices = deps.getDevices || (() => require('./olt-manager').getOltDevices());
    const resolveDriver = deps.resolveDriver || ((device) => require('./olt-drivers').resolveDriver(device));
    const getUsers = deps.getUsers || (() => global.users || []);
    const handleOltEvent = deps.handleOltEvent || ((ev) => require('./olt-los-broadcaster').handleOltEvent(ev));
    const getConfig = deps.getConfig || (() => (global.config && global.config.oltLosBroadcast) || {});
    const buildConfig = deps.buildConfig || defaultBuildConfig;
    const now = deps.now || (() => Date.now());
    const logger = deps.logger || console;
    const setIntervalFn = deps.setIntervalFn || setInterval;
    const clearIntervalFn = deps.clearIntervalFn || clearInterval;

    // key (`${oltId}::${serial}`) → status terakhir ('Online'|'LOS'|'Dying Gasp'|'Offline').
    const lastStatus = new Map();
    let pollTimer = null;
    let isRunning = false;
    let isPolling = false;
    let seeded = false; // cycle pertama hanya seed
    const stats = { started_at: null, poll_count: 0, last_poll_at: null, last_los: 0, last_recovery: 0, last_error: null };

    function buildCustomerIndex() {
        const users = getUsers() || [];
        const byPppoe = new Map();
        const bySerial = new Map();
        for (const u of users) {
            if (!u) continue;
            if (u.pppoe_username) byPppoe.set(String(u.pppoe_username).trim().toLowerCase(), u);
            if (u.olt_serial) bySerial.set(String(u.olt_serial).trim().toLowerCase(), u);
        }
        return { byPppoe, bySerial };
    }

    function resolveCustomerForOnu(onu, idx) {
        if (onu.description && idx.byPppoe.has(String(onu.description).trim().toLowerCase())) {
            return idx.byPppoe.get(String(onu.description).trim().toLowerCase());
        }
        if (onu.serial && idx.bySerial.has(String(onu.serial).trim().toLowerCase())) {
            return idx.bySerial.get(String(onu.serial).trim().toLowerCase());
        }
        return null;
    }

    // Key HARUS unik & stabil per-ONU fisik. Posisi (ponIfIndex.onuId) dijamin unik
    // setelah dedup di getOltData; serial TIDAK dipakai sebagai key karena ONU yang
    // belum teregistrasi bisa berbagi serial placeholder → tabrakan key → transisi palsu.
    function onuKey(oltId, onu) {
        return `${oltId}::${onu.slotId}.${onu.id}`;
    }

    async function pollOnce() {
        if (isPolling) return;
        const conf = getConfig() || {};
        if (conf.enabled !== true) return; // broadcaster mati → tidak perlu poll
        isPolling = true;
        let losCount = 0;
        let recoveryCount = 0;
        try {
            const devices = (getDevices() || []).filter((d) => {
                if (!d || isUnconfiguredHost(d.host)) return false;
                const drv = resolveDriver(d);
                return drv && drv.capabilities && drv.capabilities.losViaSnmp === true;
            });
            if (devices.length === 0) { isPolling = false; return; }

            const custIdx = buildCustomerIndex();

            for (const device of devices) {
                const driver = resolveDriver(device);
                let result;
                try {
                    result = await driver.getOltData(buildConfig(device));
                } catch (e) {
                    logger.warn && logger.warn(`[OLT-SNMP-LOS] [${device.name}] poll error: ${e.message}`);
                    continue;
                }
                if (!result || result.status !== 'success' || !Array.isArray(result.onus)) continue;

                for (const onu of result.onus) {
                    const key = onuKey(device.id, onu);
                    const cur = onu.status;
                    const prev = lastStatus.get(key);
                    lastStatus.set(key, cur);

                    // Cycle pertama (atau ONU baru terlihat) → hanya seed, jangan broadcast.
                    if (prev === undefined) continue;

                    // Transisi → LOS (kemungkinan fiber putus). Dying Gasp & Offline-generik
                    // sengaja TIDAK memicu (DG=mati listrik; Offline-unknown=ragu, hindari false alarm).
                    if (cur === 'LOS' && prev !== 'LOS') {
                        const customer = resolveCustomerForOnu(onu, custIdx) || undefined;
                        handleOltEvent({
                            mac: key,                     // key dedup broadcaster = posisi unik ONU
                            serial: onu.serial || null,   // info tambahan (tampilan)
                            event_type: 'los',
                            slot: onu.ponName || onu.slotId,
                            onu: onu.id,
                            olt_id: device.id,
                            customer,                     // pre-resolved (by PPPoE/serial)
                            classification_confidence: 1, // ZTE klasifikasi LOS eksplisit via SNMP
                        });
                        losCount += 1;
                    } else if (cur === 'Online' && prev !== 'Online') {
                        // Pemulihan → batalkan pending/notif terjadwal di broadcaster.
                        handleOltEvent({ mac: key, event_type: 'discovery' });
                        recoveryCount += 1;
                    }
                }
            }

            if (!seeded) {
                seeded = true;
                logger.log && logger.log(`[OLT-SNMP-LOS] Seed awal: ${lastStatus.size} ONU dilacak (tidak broadcast cycle ini).`);
            } else if (losCount || recoveryCount) {
                logger.log && logger.log(`[OLT-SNMP-LOS] Transisi: ${losCount} LOS, ${recoveryCount} pulih.`);
            }

            stats.poll_count += 1;
            stats.last_poll_at = new Date(now()).toISOString();
            stats.last_los = losCount;
            stats.last_recovery = recoveryCount;
            stats.last_error = null;
        } catch (err) {
            stats.last_error = { at: new Date(now()).toISOString(), message: err.message };
            logger.error && logger.error('[OLT-SNMP-LOS] Poll cycle error:', err.message);
        } finally {
            isPolling = false;
        }
    }

    function getIntervalMs() {
        const conf = getConfig() || {};
        const v = parseInt(conf.snmpPollIntervalMs, 10);
        return Number.isFinite(v) && v >= MIN_INTERVAL_MS ? v : DEFAULT_INTERVAL_MS;
    }

    function start() {
        if (isRunning) { logger.log && logger.log('[OLT-SNMP-LOS] Already running'); return; }
        const conf = getConfig() || {};
        if (conf.enabled !== true) {
            logger.log && logger.log('[OLT-SNMP-LOS] Disabled (set config.oltLosBroadcast.enabled=true).');
            return;
        }
        // Hanya jalan kalau ada device SNMP-LOS (mis. ZTE). Hindari poller idle untuk HIOSO-only.
        const hasSnmpLos = (getDevices() || []).some((d) => {
            const drv = d && resolveDriver(d);
            return drv && drv.capabilities && drv.capabilities.losViaSnmp === true && !isUnconfiguredHost(d.host);
        });
        if (!hasSnmpLos) {
            logger.log && logger.log('[OLT-SNMP-LOS] Tidak ada OLT SNMP-LOS (mis. ZTE) — poller tidak distart.');
            return;
        }
        const intervalMs = getIntervalMs();
        logger.log && logger.log(`[OLT-SNMP-LOS] Starting (interval: ${Math.round(intervalMs / 1000)}s)`);
        stats.started_at = new Date(now()).toISOString();
        isRunning = true;
        seeded = false;
        pollOnce();
        pollTimer = setIntervalFn(pollOnce, intervalMs);
        if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();
    }

    function stop() {
        if (pollTimer) { clearIntervalFn(pollTimer); pollTimer = null; }
        isRunning = false;
        logger.log && logger.log('[OLT-SNMP-LOS] Stopped');
    }

    function restart() {
        stop();
        setTimeout(start, 500);
    }

    return {
        start, stop, restart,
        getStatus: () => ({ running: isRunning, tracked: lastStatus.size, stats: { ...stats } }),
        _pollOnceForTest: pollOnce,
        _state: () => ({ lastStatus: new Map(lastStatus), seeded }),
    };
}

function defaultBuildConfig(device) {
    return {
        host: device.host,
        port: device.snmpPort || device.port || 161,
        community: device.snmpCommunity || device.community || 'public',
        timeout: device.snmpTimeout || device.timeout || 15000,
        retries: device.snmpRetries != null ? device.snmpRetries : 1,
    };
}

// Singleton runtime.
let _singleton = null;
function getSnmpLosPoller() {
    if (!_singleton) _singleton = createSnmpLosPoller();
    return _singleton;
}

module.exports = {
    createSnmpLosPoller,
    startSnmpLosPoller: () => getSnmpLosPoller().start(),
    stopSnmpLosPoller: () => getSnmpLosPoller().stop(),
    restartSnmpLosPoller: () => getSnmpLosPoller().restart(),
    getSnmpLosPollerStatus: () => getSnmpLosPoller().getStatus(),
    DEFAULT_INTERVAL_MS,
};
