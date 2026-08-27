/**
 * Header Doc
 * Purpose: Perekam berkala rxPower semua ONU ke ring buffer (`lib/olt-rxpower-history.js`).
 *          Riwayat ini dipakai DUA hal: memperkuat klasifikasi DG vs LOS saat offline event
 *          tiba via syslog, DAN menjadi pembanding "redaman sebelum gangguan" pada laporan
 *          verifikasi pasca-perbaikan (vonis REDAMAN MEMBURUK).
 *
 *          !! SUMBERNYA BUKAN SNMP LAGI (#b277). Dulu modul ini menembak SNMP per perangkat
 *          tiap 60 detik — 1.440 walk/hari, dan hanya menyala di Dander, bot yang OLT-nya
 *          kini tak terjangkau. Sekarang SATU tarikan lewat pintu tunggal `ambilDataOlt`
 *          (config.olt.sumberOptik, bawaan WEB): ~780 ms untuk 99 ONU.
 *
 *          !! HANYA ONU berstatus Online yang direkam. OLT tetap memamerkan redaman TERAKHIR
 *          milik ONU yang sudah mati; merekamnya berarti menanam pembanding palsu yang
 *          membuat vonis REDAMAN MEMBURUK salah justru saat paling dibutuhkan.
 *
 *          PRINSIP JAM: tiap sample distempel `Date.now()` (jam server), BUKAN jam OLT.
 * Caller: `lib/app-runtime.js` (start saat boot bila gate menyala).
 * Deps: `./olt-manager` (daftar perangkat), `./olt-optical-resolver` (ambilDataOlt),
 *       `./olt-rxpower-history` (ring buffer).
 * MainFuncs: `startRxPowerPoller`, `stopRxPowerPoller`, `restartRxPowerPoller`, `getStatus`.
 * SideEffects: HTTP GET read-only ke web OLT tiap interval; menulis ring buffer in-memory.
 * Gate config: `oltRxPowerHistory.enabled` (default OFF), `.intervalMs` (bawaan 5 mnt),
 *       `.retentionMs` (bawaan 12 jam — HARUS melebihi durasi gangguan biasa, 1-3 jam),
 *       `.maxSamplesPerMac` (bawaan 200).
 */

const oltManager = require('./olt-manager');
const { ambilDataOlt } = require('./olt-optical-resolver');
const rxHistory = require('./olt-rxpower-history');

// Interval 5 menit, BUKAN 60 detik. Sumbernya kini web (satu tarikan untuk semua OLT,
// terukur ~780 ms untuk 99 ONU), jadi bukan soal beban — melainkan soal apa yang perlu:
// pembandingan "redaman sebelum gangguan" butuh JANGKAUAN JAM, bukan resolusi detik.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

// !! Retensi bawaan penyimpan riwayat cuma 30 MENIT, sementara `post-repair-verification`
// mencari sampel 6 JAM ke belakang dan gangguan nyata di lapangan berdurasi 1-3 jam.
// Akibatnya vonis "REDAMAN MEMBURUK" nyaris tak pernah punya pembanding. Poller ini
// menitipkan retensi yang cukup panjang saat merekam.
const DEFAULT_RETENTION_MS = 12 * 60 * 60 * 1000;   // 12 jam — menutup gangguan semalaman
const DEFAULT_MAX_SAMPLES = 200;                     // 12 jam @ 5 mnt = 144 sampel/ONU

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
        retentionMs: Number.isInteger(cfg.retentionMs) && cfg.retentionMs >= 60000
            ? cfg.retentionMs
            : DEFAULT_RETENTION_MS,
        maxSamplesPerMac: Number.isInteger(cfg.maxSamplesPerMac) && cfg.maxSamplesPerMac >= 10
            ? cfg.maxSamplesPerMac
            : DEFAULT_MAX_SAMPLES,
    };
}

/**
 * Satu siklus poll: SATU tarikan untuk semua OLT (pintu tunggal, sumber WEB), record rxPower.
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
        const cfg = getPollerConfig();
        const devices = (oltManager.getOltDevices() || [])
            .filter((d) => d && d.host && !String(d.host).startsWith('ISI_'));
        if (!devices.length) return;

        // SATU tarikan untuk semua OLT lewat pintu tunggal (`ambilDataOlt`) — sumbernya
        // mengikuti config.olt.sumberOptik, bawaan WEB. Dulu di sini SNMP per perangkat:
        // 1.440 walk/hari yang diduga kuat membuat OLT hang (#b274/#b275).
        const result = await ambilDataOlt(devices);
        if (!result || result.status !== 'success' || !Array.isArray(result.onus)) return;

        // !! HANYA ONU yang benar-benar Online. OLT tetap memamerkan redaman TERAKHIR milik
        // ONU yang sudah mati — merekamnya berarti menanam pembanding palsu yang membuat
        // vonis "REDAMAN MEMBURUK" salah justru saat paling dibutuhkan.
        const batch = result.onus
            .filter((onu) => onu
                && onu.macAddress && onu.macAddress !== 'N/A'
                && onu.status === 'Online'
                && Number.isFinite(parseFloat(onu.rxPower)))
            .map((onu) => ({ mac: onu.macAddress, rxPower: onu.rxPower }));

        // Stempel semua sample siklus ini dengan satu timestamp.
        rxHistory.recordBatch(batch, startedAt, {
            retentionMs: cfg.retentionMs,
            maxSamplesPerMac: cfg.maxSamplesPerMac,
        });
        sampleCount += batch.length;
        if (Array.isArray(result.failedOlts) && result.failedOlts.length) {
            console.warn('[OLT-rxPoller] ' + result.failedOlts.length + ' OLT tak terbaca siklus ini: '
                + result.failedOlts.map((o) => o.oltName || o.oltHost).join(', '));
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
    _getPollerConfigForTest: getPollerConfig,
    _pollOnceForTest: pollOnce,
};
