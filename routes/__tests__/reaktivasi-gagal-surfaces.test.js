/**
 * Header Doc
 * Purpose: Mengunci #b333 — SEMUA permukaan settlement tagihan menyuarakan "pelanggan bayar tapi
 *   reaktivasi gagal/tak terbaca" lewat logika BERSAMA (lib/services/reactivation-outcome), bukan
 *   masing-masing menilai sendiri lalu menyimpang (DRIFT JALUR SAUDARA). Dulu: WA surface penuh,
 *   iPaymu cuma attempted&&!ok, Tripay/Mayar cuma catatan, web hardcoded "diaktifkan".
 * Caller: Jest.
 * Deps: baca sumber routes/public.js, routes/bill-payment.js, routes/admin-konfirmasi-bayar-routes.js,
 *   message/handlers/payment-proof-admin-handler.js.
 * SideEffects: -
 */
"use strict";
const fs = require("fs");
const path = require("path");
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");

describe("reaktivasi gagal disuarakan seragam lintas permukaan (#b333)", () => {
    test("iPaymu (public.js) memicu alarm lewat reactivationNeedsAttention, bukan attempted&&!ok", () => {
        const src = baca("routes/public.js");
        expect(src).toMatch(/reactivationNeedsAttention\(react\)/);
        // Pola lama yang meloloskan profile_read_failed tak boleh lagi jadi gerbang alarm.
        expect(src).not.toMatch(/if \(react\.attempted && !react\.ok\)/);
    });

    test("Tripay & Mayar (bill-payment.js) mengirim alertReaktivasiGagal saat perlu perhatian", () => {
        const src = baca("routes/bill-payment.js");
        const hits = src.match(/reactivationNeedsAttention\(react\)/g) || [];
        expect(hits.length).toBeGreaterThanOrEqual(2); // Tripay + Mayar
        expect(src).toMatch(/alertReaktivasiGagal\(/);
    });

    test("web konfirmasi-bayar tak lagi klaim buta 'diaktifkan'; baca reactivation + alarm", () => {
        const src = baca("routes/admin-konfirmasi-bayar-routes.js");
        expect(src).toMatch(/reactivationNeedsAttention\(/);
        expect(src).toMatch(/alertReaktivasiGagal\(/);
        // Pesan sukses tak boleh lagi TANPA-SYARAT "Pelanggan diaktifkan".
        expect(src).toMatch(/perluCekReaktivasi/);
    });

    test("WA handler memakai logika BERSAMA (bukan salinan lokal)", () => {
        const src = baca("message/handlers/payment-proof-admin-handler.js");
        expect(src).toMatch(/require\(["'][^"']*reactivation-outcome["']\)/);
        // Tak ada lagi definisi lokal reactivationNeedsAttention.
        expect(src).not.toMatch(/function reactivationNeedsAttention\(/);
    });
});
