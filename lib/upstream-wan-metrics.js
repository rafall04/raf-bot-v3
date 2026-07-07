/**
 * Header Doc
 * Purpose: Kalkulasi murni metrik WAN multi-ISP: delta counter interface → bps/error/drop per
 *          detik, deteksi flap tunnel (uptime mundur / link-downs naik), utilisasi vs kapasitas,
 *          dan KLASIFIKASI SEGMEN penyebab loss: JENUH (kongesti) / LINK_ISP (last-mile, loss
 *          sudah di gateway) / UPSTREAM_ISP (gateway bersih, jauh loss) / SEHAT / UNKNOWN.
 * Caller: `lib/upstream-quality-poller.js` (sampling & laporan status) dan test.
 * Deps: — (murni).
 * MainFuncs: `computeLinkDelta`, `detectFlap`, `computeUtilization`, `classifySegment`,
 *            `SEGMENT_LABELS`.
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

module.exports = {
    computeLinkDelta,
    detectFlap,
    computeUtilization,
    classifySegment,
    SEGMENT_LABELS
};
