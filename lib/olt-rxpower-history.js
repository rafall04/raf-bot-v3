/**
 * OLT rxPower History
 *
 * Ring buffer in-memory untuk menyimpan riwayat rxPower per ONU (by MAC).
 * Dipakai untuk memperkuat klasifikasi Dying Gasp vs LOS dengan sinyal optik:
 *
 *   - DG (adaptor mati / PLN outage): rxPower SEHAT sampai detik terakhir, lalu
 *     hilang mendadak. Sinyal optik fine — yang mati cuma power adaptor ONU.
 *   - LOS (fiber putus / degradasi): rxPower MENURUN (tren melemah) atau sudah
 *     lemah sebelum ONU offline. Sinyal optik memburuk.
 *
 * PRINSIP JAM (penting — jam OLT tidak sinkron):
 *   Setiap sample distempel `Date.now()` (jam server) SAAT SNMP read, BUKAN
 *   jam OLT. Korelasi dengan offline event juga pakai `event.server_time`
 *   (jam server saat syslog packet diterima). Seluruh pipeline timing
 *   independen dari jam OLT. Jam OLT TIDAK PERNAH dipakai untuk keputusan apa pun.
 *
 * Murni: tidak ada I/O, tidak baca config global langsung (threshold via opts),
 * tidak tulis file. Caller (poller) yang panggil recordSample; caller (syslog
 * receiver) yang panggil analyzeOfflineEvent.
 */

const DEFAULT_RETENTION_MS = 30 * 60 * 1000;  // simpan 30 menit terakhir
const DEFAULT_MAX_SAMPLES_PER_MAC = 240;       // cap memori (~30 min @ 7.5s, atau 4 jam @ 60s)
const DEFAULT_LOOKBACK_MS = 5 * 60 * 1000;     // window analisis 5 menit sebelum offline

// Threshold dBm (default — bisa override via opts ke analyzeOfflineEvent).
const DEFAULT_HEALTHY_RX = -25;   // >= ini = sinyal sehat
const DEFAULT_WEAK_RX = -27;      // <= ini = sinyal lemah/mengkhawatirkan
const DEFAULT_DECLINE_SLOPE = -0.5; // dBm/menit; <= ini = tren menurun signifikan

// Ring buffer: Map<macNormalized, Array<{ rx:number, at:number }>>
const buffers = new Map();

/**
 * Parse nilai rxPower dari berbagai format ke number dBm, atau null kalau invalid.
 * Hioso `getOltData` return string seperti "-24.50 dBm" atau "N/A".
 */
function parseRxValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const str = String(value).trim();
    if (str === '' || str.toUpperCase() === 'N/A') return null;
    const match = str.match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const num = parseFloat(match[0]);
    return Number.isFinite(num) ? num : null;
}

function normalizeMAC(mac) {
    if (!mac || typeof mac !== 'string') return '';
    return mac.replace(/[:\-\s]/g, '').toUpperCase();
}

/**
 * Catat satu sample rxPower untuk MAC. Stempel jam server.
 * rxPower invalid (N/A — ONU offline) di-skip; kita hanya simpan reading valid
 * supaya "last known good" akurat.
 */
function recordSample(mac, rxValue, atMs = Date.now(), opts = {}) {
    const key = normalizeMAC(mac);
    if (!key) return;
    const rx = parseRxValue(rxValue);
    if (rx === null) return; // skip N/A — ONU offline tidak punya rxPower

    const retentionMs = opts.retentionMs || DEFAULT_RETENTION_MS;
    const maxSamples = opts.maxSamplesPerMac || DEFAULT_MAX_SAMPLES_PER_MAC;

    let arr = buffers.get(key);
    if (!arr) {
        arr = [];
        buffers.set(key, arr);
    }
    arr.push({ rx, at: atMs });

    // Prune by retention + cap count.
    const cutoff = atMs - retentionMs;
    while (arr.length && arr[0].at < cutoff) {
        arr.shift();
    }
    if (arr.length > maxSamples) {
        arr.splice(0, arr.length - maxSamples);
    }
}

/**
 * Catat batch sample dari satu siklus poll. `samples` = [{ mac, rxPower }].
 * Semua di-stempel `atMs` yang sama (waktu siklus poll).
 */
function recordBatch(samples, atMs = Date.now(), opts = {}) {
    if (!Array.isArray(samples)) return;
    for (const s of samples) {
        recordSample(s.mac || s.macAddress, s.rxPower ?? s.rx, atMs, opts);
    }
}

/**
 * Ambil sample untuk MAC dalam window [sinceMs, +inf).
 */
function getHistory(mac, sinceMs = 0) {
    const arr = buffers.get(normalizeMAC(mac));
    if (!arr) return [];
    return arr.filter((s) => s.at >= sinceMs).map((s) => ({ ...s }));
}

/**
 * Linear regression slope (dBm per menit) dari array sample.
 * Return null kalau < 2 sample.
 */
function computeSlopePerMinute(samples) {
    const n = samples.length;
    if (n < 2) return null;
    // x = menit relatif terhadap sample pertama, y = rx
    const t0 = samples[0].at;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (const s of samples) {
        const x = (s.at - t0) / 60000; // menit
        const y = s.rx;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return 0; // semua sample di waktu sama
    return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Analisis riwayat rxPower untuk satu offline event.
 *
 * @param {string} mac
 * @param {number} eventServerTimeMs - jam server saat event offline diterima
 * @param {object} opts - threshold override (healthyRx, weakRx, declineSlope, lookbackMs)
 * @returns {object} signal:
 *   {
 *     source: 'rxpower',
 *     available: boolean,        // false kalau tidak ada history
 *     last_rx_before: number|null,
 *     samples_in_window: number,
 *     trend: 'stable'|'declining'|'rising'|'insufficient',
 *     trend_slope: number|null,  // dBm/menit
 *     hint: 'dying-gasp'|'los'|'neutral',
 *     weight: number,            // 0..0.3 — bobot untuk confidence scoring
 *     reason: string
 *   }
 */
function analyzeOfflineEvent(mac, eventServerTimeMs = Date.now(), opts = {}) {
    const healthyRx = opts.healthyRx ?? DEFAULT_HEALTHY_RX;
    const weakRx = opts.weakRx ?? DEFAULT_WEAK_RX;
    const declineSlope = opts.declineSlope ?? DEFAULT_DECLINE_SLOPE;
    const lookbackMs = opts.lookbackMs ?? DEFAULT_LOOKBACK_MS;

    const sinceMs = eventServerTimeMs - lookbackMs;
    // Hanya sample SEBELUM event (≤ eventServerTimeMs).
    const samples = getHistory(mac, sinceMs).filter((s) => s.at <= eventServerTimeMs);

    if (samples.length === 0) {
        return {
            source: 'rxpower',
            available: false,
            last_rx_before: null,
            samples_in_window: 0,
            trend: 'insufficient',
            trend_slope: null,
            hint: 'neutral',
            weight: 0,
            reason: 'Tidak ada riwayat rxPower sebelum event (ONU mungkin sudah offline sebelum poller mulai).',
        };
    }

    const lastRx = samples[samples.length - 1].rx;
    const slope = computeSlopePerMinute(samples);

    let trend = 'insufficient';
    if (slope !== null) {
        if (slope <= declineSlope) trend = 'declining';
        else if (slope >= -declineSlope) trend = 'rising';
        else trend = 'stable';
    }

    // Keputusan hint:
    //   declining trend → LOS (sinyal memburuk = fiber)
    //   last rx lemah   → LOS
    //   last rx sehat + stabil → DG (mati mendadak saat sinyal masih bagus)
    let hint = 'neutral';
    let weight = 0.05;
    let reason = '';

    if (trend === 'declining') {
        hint = 'los';
        weight = 0.25;
        reason = `rxPower menurun (${slope.toFixed(2)} dBm/menit) sebelum offline — konsisten dengan degradasi/putus fiber (LOS).`;
    } else if (lastRx <= weakRx) {
        hint = 'los';
        weight = 0.2;
        reason = `rxPower terakhir lemah (${lastRx.toFixed(2)} dBm ≤ ${weakRx}) — konsisten dengan masalah fiber (LOS).`;
    } else if (lastRx >= healthyRx && (trend === 'stable' || trend === 'rising')) {
        hint = 'dying-gasp';
        weight = 0.15;
        reason = `rxPower sehat & stabil (${lastRx.toFixed(2)} dBm) sampai sebelum offline — konsisten dengan kehilangan power adaptor (Dying Gasp).`;
    } else {
        hint = 'neutral';
        weight = 0.05;
        reason = `rxPower terakhir ${lastRx.toFixed(2)} dBm, tren ${trend} — tidak konklusif.`;
    }

    return {
        source: 'rxpower',
        available: true,
        last_rx_before: lastRx,
        samples_in_window: samples.length,
        trend,
        trend_slope: slope,
        hint,
        weight,
        reason,
    };
}

/**
 * Hapus seluruh buffer (test / reset manual).
 */
function clearAll() {
    buffers.clear();
}

function getStats() {
    let totalSamples = 0;
    for (const arr of buffers.values()) totalSamples += arr.length;
    return {
        tracked_macs: buffers.size,
        total_samples: totalSamples,
    };
}

module.exports = {
    recordSample,
    recordBatch,
    getHistory,
    analyzeOfflineEvent,
    computeSlopePerMinute,
    parseRxValue,
    normalizeMAC,
    clearAll,
    getStats,
    DEFAULT_RETENTION_MS,
    DEFAULT_LOOKBACK_MS,
};
