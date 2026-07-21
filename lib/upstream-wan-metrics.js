/**
 * Header Doc
 * Purpose: Kalkulasi murni metrik WAN multi-ISP: delta counter interface → bps/error/drop per
 *          detik, deteksi flap tunnel (uptime mundur / link-downs naik), utilisasi vs kapasitas,
 *          dan KLASIFIKASI SEGMEN penyebab loss: JENUH (kongesti) / LINK_ISP (last-mile, loss
 *          sudah di gateway) / UPSTREAM_ISP (gateway bersih, jauh loss) / SEHAT / UNKNOWN.
 * Caller: `lib/upstream-quality-poller.js` (sampling & laporan status) dan test.
 * Deps: — (murni).
 *          Plus `detectBufferbloat`: jalur yang berstatus NORMAL sepanjang hari tapi terasa BERAT
 *          tiap jam sibuk — RTT membengkak hanya saat link padat; rata-rata harian menyembunyikannya.
 * MainFuncs: `computeLinkDelta`, `detectFlap`, `computeUtilization`, `classifySegment`,
 *            `detectBufferbloat`, `SEGMENT_LABELS`.
 * SideEffects: Tidak ada.
 */
"use strict";

const SEGMENT_LABELS = {
    SEHAT: "Sehat",
    JENUH: "Link penuh (kongesti)",
    LINK_ISP: "Masalah link ke ISP (last-mile)",
    UPSTREAM_ISP: "Masalah di sisi ISP (upstream)",
    UNKNOWN: "Belum ada data"
};

/**
 * Delta counter antara dua sampel → laju per detik. Counter reset (nilai turun, mis. router
 * reboot) → null utk delta itu (jangan hasilkan angka negatif/raksasa).
 */
function computeLinkDelta(prev, curr, elapsedMs) {
    if (!prev || !curr || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
    const dt = elapsedMs / 1000;
    const delta = (a, b) => {
        if (a == null || b == null) return null;
        const d = Number(b) - Number(a);
        return d >= 0 ? d : null; // counter reset
    };
    const rxBytes = delta(prev.rx_byte, curr.rx_byte);
    const txBytes = delta(prev.tx_byte, curr.tx_byte);
    return {
        rx_bps: rxBytes == null ? null : Math.round((rxBytes * 8) / dt),
        tx_bps: txBytes == null ? null : Math.round((txBytes * 8) / dt),
        rx_error_d: delta(prev.rx_error, curr.rx_error),
        tx_error_d: delta(prev.tx_error, curr.tx_error),
        rx_drop_d: delta(prev.rx_drop, curr.rx_drop),
        tx_drop_d: delta(prev.tx_drop, curr.tx_drop)
    };
}

/**
 * Flap = tunnel re-dial (uptime sekarang < uptime sebelumnya) ATAU link-downs bertambah.
 * Interval sampling ikut dipertimbangkan: uptime yang lebih kecil dari jarak sampel jelas re-dial.
 */
function detectFlap(prev, curr) {
    if (!curr) return false;
    if (prev && prev.link_downs != null && curr.link_downs != null && curr.link_downs > prev.link_downs) {
        return true;
    }
    if (prev && prev.tunnel_uptime_s != null && curr.tunnel_uptime_s != null &&
        curr.tunnel_uptime_s < prev.tunnel_uptime_s) {
        return true;
    }
    return false;
}

/** Utilisasi % terhadap kapasitas (Mbps) — null bila kapasitas tidak dikonfigurasi. */
function computeUtilization({ rx_bps, tx_bps }, capacity) {
    if (!capacity) return { down_pct: null, up_pct: null };
    const downMbps = Number(capacity.downMbps);
    const upMbps = Number(capacity.upMbps);
    return {
        down_pct: Number.isFinite(downMbps) && downMbps > 0 && rx_bps != null
            ? Math.round((rx_bps / (downMbps * 1e6)) * 1000) / 10
            : null,
        up_pct: Number.isFinite(upMbps) && upMbps > 0 && tx_bps != null
            ? Math.round((tx_bps / (upMbps * 1e6)) * 1000) / 10
            : null
    };
}

/**
 * Klasifikasi segmen penyebab untuk satu jalur pada jendela status:
 * @param {object} input
 *  - farLossPct  : loss rata-rata ke target jauh (null = belum ada data)
 *  - gwLossPct   : loss rata-rata ke gateway/next-hop ISP (null = tak terprobe)
 *  - utilMaxPct  : utilisasi tertinggi (down/up) % (null = kapasitas tak dikonfigurasi)
 *  - thresholds  : { lossWarnPct, saturationPct }
 */
function classifySegment({ farLossPct, gwLossPct, utilMaxPct, thresholds = {} }) {
    const warn = Number.isFinite(thresholds.lossWarnPct) ? thresholds.lossWarnPct : 5;
    const saturation = Number.isFinite(thresholds.saturationPct) ? thresholds.saturationPct : 85;
    if (farLossPct == null) return "UNKNOWN";
    if (farLossPct < warn) return "SEHAT";
    if (utilMaxPct != null && utilMaxPct >= saturation) return "JENUH";
    if (gwLossPct != null && gwLossPct >= warn) return "LINK_ISP";
    return "UPSTREAM_ISP";
}

/** Median — dipakai daripada rata-rata supaya satu lonjakan tak menggeser vonis. */
function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const DEFAULT_BUFFERBLOAT = {
    idleUtilPct: 30,      // sampel dianggap "santai" bila utilisasi <= ini
    busyUtilPct: 70,      // sampel dianggap "padat" bila utilisasi >= ini
    minSamplesPerBucket: 5,
    inflationFactor: 2    // RTT padat >= 2x RTT santai => bufferbloat
};

/**
 * Deteksi BUFFERBLOAT: latensi membengkak HANYA saat link padat.
 *
 * Kenapa perlu terpisah dari `classifySegment`: jalur bisa berstatus NORMAL sepanjang hari
 * (loss 0, RTT rata-rata wajar) tapi tetap terasa "berat" bagi pelanggan tiap jam sibuk, karena
 * antrean di buffer menggelembungkan RTT hanya saat trafik tinggi. Rata-rata harian menyembunyikan
 * ini; yang menyingkap adalah MEMBANDINGKAN RTT saat santai vs saat padat.
 *
 * Gagal-aman: kalau salah satu ember sampelnya kurang, kembalikan UNKNOWN — "tidak bisa diamati"
 * bukan "sehat" (lihat CLAUDE.md: jangan menyimpulkan dari ketiadaan bukti).
 *
 * @param {object} input
 *  - samples: Array<{ utilPct: number|null, rttMs: number|null }> satu jalur, satu jendela waktu
 *  - options: override ambang (idleUtilPct, busyUtilPct, minSamplesPerBucket, inflationFactor)
 * @returns {{verdict: 'BUFFERBLOAT'|'SEHAT'|'UNKNOWN', idleRttMs: number|null,
 *            busyRttMs: number|null, ratio: number|null, idleCount: number, busyCount: number}}
 */
function detectBufferbloat({ samples, options } = {}) {
    const cfg = { ...DEFAULT_BUFFERBLOAT, ...(options || {}) };
    const rows = Array.isArray(samples) ? samples : [];

    const idle = [];
    const busy = [];
    for (const row of rows) {
        if (!row) continue;
        // GOTCHA: `Number(null)` = 0 — tanpa penolakan eksplisit, utilisasi yang TIDAK TERBACA
        // akan dihitung sebagai "0% alias santai" dan mengotori ember idle.
        if (row.utilPct == null || row.rttMs == null) continue;
        const util = Number(row.utilPct);
        const rtt = Number(row.rttMs);
        if (!Number.isFinite(util) || !Number.isFinite(rtt) || rtt <= 0) continue;
        if (util <= cfg.idleUtilPct) idle.push(rtt);
        else if (util >= cfg.busyUtilPct) busy.push(rtt);
    }

    const base = {
        idleCount: idle.length,
        busyCount: busy.length,
        idleRttMs: null,
        busyRttMs: null,
        ratio: null
    };

    if (idle.length < cfg.minSamplesPerBucket || busy.length < cfg.minSamplesPerBucket) {
        return { ...base, verdict: "UNKNOWN" };
    }

    const idleRtt = median(idle);
    const busyRtt = median(busy);
    const ratio = idleRtt > 0 ? Math.round((busyRtt / idleRtt) * 100) / 100 : null;

    return {
        ...base,
        idleRttMs: Math.round(idleRtt * 10) / 10,
        busyRttMs: Math.round(busyRtt * 10) / 10,
        ratio,
        verdict: ratio != null && ratio >= cfg.inflationFactor ? "BUFFERBLOAT" : "SEHAT"
    };
}

module.exports = {
    computeLinkDelta,
    detectFlap,
    computeUtilization,
    classifySegment,
    detectBufferbloat,
    SEGMENT_LABELS,
    DEFAULT_BUFFERBLOAT
};
