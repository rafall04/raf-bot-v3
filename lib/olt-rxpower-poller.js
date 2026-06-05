/**
 * OLT rxPower Poller
 *
 * Background SNMP sampler — poll rxPower semua ONU dari OLT secara berkala,
 * simpan ke ring buffer (`lib/olt-rxpower-history.js`). Riwayat ini dipakai
 * untuk memperkuat klasifikasi DG vs LOS saat offline event tiba via syslog.
 *
 * PRINSIP JAM: setiap sample distempel `Date.now()` (jam server) saat SNMP read
 * selesai — BUKAN jam OLT. Lihat olt-rxpower-history.js untuk detail.
 *
 * Default OFF. Aktifkan via config.oltRxPowerHistory.enabled = true.
 * Interval default 60 detik (configurable). Tradeoff:
 *   - Lebih sering (mis. 30s) → resolusi korelasi lebih baik, beban SNMP lebih tinggi
 *   - Lebih jarang (mis. 120s) → ringan, tapi "last known rxPower" bisa lebih basi
 */

const oltManager = require('./olt-manager');
const oltHioso = require('./olt-hioso');
const rxHistory = require('./olt-rxpower-history');

const DEFAULT_INTERVAL_MS = 60_000;

let pollTimer = null;
let isRunning = false;
let isPolling = false; // guard supaya tidak overlap kalau satu siklus lambat

const stats = {
    started_at: null,
    poll_count: 0,
    last_poll_at: null,
    last_poll_duration_ms: null,
    last_sample_count: 0,
    last_error: null,
};

function getPollerConfig() {
    const cfg = global.config?.oltRxPowerHistory || {};
    return {
        enabled: cfg.enabled === true,
        intervalMs: Number.isInteger(cfg.intervalMs) && cfg.intervalMs >= 5000
            ? cfg.intervalMs
            : DEFAULT_INTERVAL_MS,
    };
}

/**
 * Bangun config SNMP untuk getOltData dari device entry olt-manager.
 */
function buildOltConfig(device) {
    return {
        host: device.host,
        port: device.snmpPort || device.port || 161,
        community: device.snmpCommunity || device.community || 'public',
        timeout: device.snmpTimeout || device.timeout || 15000,
        retries: device.snmpRetries || device.retries || 2,
    };
}

/**
 * Satu siklus poll: untuk tiap OLT enabled, ambil data ONU, record rxPower.
 * Semua ONU dalam satu siklus distempel dengan timestamp yang sama (waktu
 * siklus dimulai) supaya slope analysis konsisten.
 */
async function pollOnce() {
    if (isPolling) {
        // Siklus sebelumnya belum selesai — skip supaya tidak menumpuk.
        return;
    }
    isPolling = true;
    const startedAt = Date.now();
    let sampleCount = 0;

    try {
        const devices = oltManager.getOltDevices();
        for (const device of devices) {
            if (!device || !device.host || String(device.host).startsWith('ISI_')) {
                continue; // host belum dikonfigurasi
            }
            try {
                const result = await oltHioso.getOltData(buildOltConfig(device));
                if (result.status !== 'success' || !Array.isArray(result.onus)) {
                    continue;
                }
                // Stempel semua sample siklus ini dengan satu timestamp.
                const batch = result.onus
                    .filter((onu) => onu.macAddress && onu.macAddress !== 'N/A')
                    .map((onu) => ({ mac: onu.macAddress, rxPower: onu.rxPower }));
                rxHistory.recordBatch(batch, startedAt);
                sampleCount += batch.length;
            } catch (deviceErr) {
                console.error(`[OLT-rxPoller] Error polling device ${device.id || device.host}:`, deviceErr.message);
            }
        }

        stats.poll_count += 1;
        stats.last_poll_at = new Date(startedAt).toISOString();
        stats.last_poll_duration_ms = Date.now() - startedAt;
        stats.last_sample_count = sampleCount;
        stats.last_error = null;
    } catch (err) {
        stats.last_error = { at: new Date().toISOString(), message: err.message };
        console.error('[OLT-rxPoller] Poll cycle error:', err.message);
    } finally {
        isPolling = false;
    }
}

function startRxPowerPoller() {
    if (isRunning) {
        console.log('[OLT-rxPoller] Already running');
        return;
    }
    const config = getPollerConfig();
    if (!config.enabled) {
        console.log('[OLT-rxPoller] Disabled (set config.oltRxPowerHistory.enabled=true to enable)');
        return;
    }

    console.log(`[OLT-rxPoller] Starting (interval: ${Math.round(config.intervalMs / 1000)}s)`);
    stats.started_at = new Date().toISOString();
    isRunning = true;

    // Poll segera, lalu berkala.
    pollOnce();
    pollTimer = setInterval(pollOnce, config.intervalMs);
    if (pollTimer.unref) pollTimer.unref(); // jangan tahan process exit
}

function stopRxPowerPoller() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    isRunning = false;
    console.log('[OLT-rxPoller] Stopped');
}

function restartRxPowerPoller() {
    stopRxPowerPoller();
    setTimeout(startRxPowerPoller, 500);
}

function getStatus() {
    return {
        running: isRunning,
        config: getPollerConfig(),
        stats: { ...stats },
        history: rxHistory.getStats(),
    };
}

module.exports = {
    startRxPowerPoller,
    stopRxPowerPoller,
    restartRxPowerPoller,
    getStatus,
    // Internal — test.
    _pollOnceForTest: pollOnce,
    _buildOltConfig: buildOltConfig,
};
