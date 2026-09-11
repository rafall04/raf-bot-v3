/**
 * Header Doc
 * Purpose: Guard pemangkas payload /api/requests — applyRequestWindow: tanpa sinceMonths=semua;
 *   pending SELALU ikut (umur berapa pun); resolved lama dipangkas, resolved baru/tak-bertanggal
 *   ikut. countByStatus akurat atas himpunan penuh (untuk kartu statistik FE).
 * Caller: Jest.
 * Deps: ../request-window.
 * SideEffects: -
 */
"use strict";

const { applyRequestWindow, countByStatus } = require("../request-window");

const NOW = Date.parse("2026-09-11T00:00:00.000Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

const DATA = [
    { id: 1, status: "pending", created_at: daysAgo(400) }, // pending tua → tetap ikut
    { id: 2, status: "pending", created_at: daysAgo(2) },
    { id: 3, status: "approved", updated_at: daysAgo(20) }, // resolved baru
    { id: 4, status: "approved", updated_at: daysAgo(400) }, // resolved lama → dipangkas
    { id: 5, status: "rejected", updated_at: daysAgo(400) }, // resolved lama → dipangkas
    { id: 6, status: "approved" }, // tak bertanggal → fail-open (ikut)
];

test("tanpa sinceMonths → kembalikan semua (perilaku lama)", () => {
    expect(applyRequestWindow(DATA, undefined, NOW).length).toBe(6);
    expect(applyRequestWindow(DATA, 0, NOW).length).toBe(6);
    expect(applyRequestWindow(DATA, "abc", NOW).length).toBe(6);
});

test("sinceMonths=6 → pending semua ikut, resolved lama dipangkas, tak-bertanggal ikut", () => {
    const out = applyRequestWindow(DATA, 6, NOW).map((r) => r.id).sort();
    expect(out).toEqual([1, 2, 3, 6]); // 4 & 5 (resolved 400 hari) dipangkas; 1 (pending tua) tetap
});

test("countByStatus akurat atas SELURUH himpunan (bukan window)", () => {
    expect(countByStatus(DATA)).toEqual({ total: 6, pending: 2, approved: 3, rejected: 1 });
    expect(countByStatus([])).toEqual({ total: 0, pending: 0, approved: 0, rejected: 0 });
});

test("input non-array aman", () => {
    expect(applyRequestWindow(null, 6, NOW)).toEqual([]);
    expect(countByStatus(null)).toEqual({ total: 0, pending: 0, approved: 0, rejected: 0 });
});
