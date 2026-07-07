/**
 * Header Doc
 * Purpose: Uji kalkulasi metrik WAN murni — delta counter → bps (termasuk reset counter),
 *          deteksi flap tunnel, utilisasi vs kapasitas, dan klasifikasi segmen penyebab
 *          (SEHAT/JENUH/LINK_ISP/UPSTREAM_ISP/UNKNOWN).
 * Caller: jest.
 * Deps: `../upstream-wan-metrics`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const {
    computeLinkDelta,
    detectFlap,
    computeUtilization,
    classifySegment,
    SEGMENT_LABELS
} = require("../upstream-wan-metrics");

describe("computeLinkDelta", () => {
    test("delta byte 60 dtk → bps benar", () => {
        const prev = { rx_byte: 1_000_000, tx_byte: 500_000, rx_error: 0, tx_error: 0, rx_drop: 0, tx_drop: 0 };
        const curr = { rx_byte: 76_000_000, tx_byte: 8_000_000, rx_error: 2, tx_error: 0, rx_drop: 1, tx_drop: 0 };
        const d = computeLinkDelta(prev, curr, 60_000);
        expect(d.rx_bps).toBe(10_000_000); // 75 MB dlm 60 dtk = 10 Mbps
        expect(d.tx_bps).toBe(1_000_000);
        expect(d.rx_error_d).toBe(2);
        expect(d.rx_drop_d).toBe(1);
    });

    test("counter reset (router reboot) → null, bukan angka raksasa", () => {
        const d = computeLinkDelta({ rx_byte: 9_000_000 }, { rx_byte: 100 }, 60_000);
        expect(d.rx_bps).toBeNull();
    });

    test("tanpa prev / elapsed nol → null", () => {
        expect(computeLinkDelta(null, { rx_byte: 1 }, 60000)).toBeNull();
        expect(computeLinkDelta({ rx_byte: 1 }, { rx_byte: 2 }, 0)).toBeNull();
    });
});

describe("detectFlap", () => {
    test("uptime tunnel mundur → flap", () => {
        expect(detectFlap({ tunnel_uptime_s: 5000 }, { tunnel_uptime_s: 40 })).toBe(true);
    });
    test("link-downs bertambah → flap", () => {
        expect(detectFlap({ link_downs: 3 }, { link_downs: 4 })).toBe(true);
    });
    test("normal (uptime naik, link-downs tetap) → bukan flap", () => {
        expect(detectFlap({ tunnel_uptime_s: 100, link_downs: 3 }, { tunnel_uptime_s: 160, link_downs: 3 })).toBe(false);
    });
    test("tanpa prev → bukan flap (siklus pertama jangan false alarm)", () => {
        expect(detectFlap(null, { tunnel_uptime_s: 10 })).toBe(false);
    });
});

describe("computeUtilization", () => {
    test("kapasitas terisi → persen benar", () => {
        const u = computeUtilization({ rx_bps: 85_000_000, tx_bps: 10_000_000 }, { downMbps: 100, upMbps: 50 });
        expect(u.down_pct).toBe(85);
        expect(u.up_pct).toBe(20);
    });
    test("kapasitas 0/absen → null (fitur belum dikonfigurasi)", () => {
        expect(computeUtilization({ rx_bps: 1e6, tx_bps: 1e6 }, { downMbps: 0, upMbps: 0 })).toEqual({ down_pct: null, up_pct: null });
        expect(computeUtilization({ rx_bps: 1e6, tx_bps: 1e6 }, null)).toEqual({ down_pct: null, up_pct: null });
    });
});

describe("classifySegment", () => {
    const t = { lossWarnPct: 5, saturationPct: 85 };

    test("tanpa data far → UNKNOWN", () => {
        expect(classifySegment({ farLossPct: null, gwLossPct: null, utilMaxPct: null, thresholds: t })).toBe("UNKNOWN");
    });
    test("loss rendah → SEHAT", () => {
        expect(classifySegment({ farLossPct: 1, gwLossPct: 0, utilMaxPct: 50, thresholds: t })).toBe("SEHAT");
    });
    test("loss + link penuh → JENUH (kongesti, bukan jalur rusak)", () => {
        expect(classifySegment({ farLossPct: 15, gwLossPct: 0, utilMaxPct: 92, thresholds: t })).toBe("JENUH");
    });
    test("loss sudah terjadi di gateway → LINK_ISP (last-mile)", () => {
        expect(classifySegment({ farLossPct: 30, gwLossPct: 25, utilMaxPct: 40, thresholds: t })).toBe("LINK_ISP");
    });
    test("gateway bersih tapi jauh loss → UPSTREAM_ISP", () => {
        expect(classifySegment({ farLossPct: 30, gwLossPct: 0, utilMaxPct: 40, thresholds: t })).toBe("UPSTREAM_ISP");
    });
    test("tanpa data gateway/util → tetap tervonis UPSTREAM_ISP (informasi terbaik)", () => {
        expect(classifySegment({ farLossPct: 30, gwLossPct: null, utilMaxPct: null, thresholds: t })).toBe("UPSTREAM_ISP");
    });
    test("semua segmen punya label Indonesia", () => {
        ["SEHAT", "JENUH", "LINK_ISP", "UPSTREAM_ISP", "UNKNOWN"].forEach((s) => {
            expect(typeof SEGMENT_LABELS[s]).toBe("string");
        });
    });
});
