/**
 * Header Doc
 * Purpose: Mengunci Gelombang B ronde 4 — (#3) confirmProof (bukti bayar) dibungkus withLock
 *   per-user 'payment-status-<id>' + re-baca record DI DALAM kunci (anti kredit dobel klik-ganda
 *   web / web+WA); (#5) handlePaidStatusChange (jalur 'Tandai Lunas' manual) MENGALARMI admin
 *   (alertReaktivasiGagal) saat reaktivasi gagal ATAU profil live tak terbaca — bukan cuma
 *   console.error (pelanggan bayar tapi tetap terisolir senyap).
 * Caller: Jest.
 * Deps: fs, path (baca sumber, tidak eksekusi).
 * SideEffects: -
 */
"use strict";
const fs = require("fs");
const path = require("path");
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8");

describe("confirmProof terkunci per-user (#b346 / temuan #3)", () => {
    const src = read("services/payment-proof.service.js");
    test("dibungkus withLock namespace 'payment-status-<userId>' (saling-eksklusi dgn jalur uang lain)", () => {
        expect(src).toMatch(/withLock\(\s*`payment-status-\$\{[^}]+\}`/);
    });
    test("re-baca record DI DALAM kunci (getById dipanggil >1x: pra-kunci + di dalam)", () => {
        const hits = src.match(/deps\.repository\.getById\(id\)/g) || [];
        expect(hits.length).toBeGreaterThanOrEqual(2);
    });
    test("withLock ada SEBELUM pemanggilan settle di confirmProof (kunci membungkus settlement)", () => {
        const iLock = src.indexOf("withLock(`payment-status-");
        expect(iLock).toBeGreaterThan(-1);
        // Panggilan settle DI DALAM confirmProof = occurrence PERTAMA setelah iLock (baris 61
        // 'impl.settleTagihanPayment' adalah wrapper lazy, di ATAS confirmProof — abaikan).
        const iSettleInLock = src.indexOf("settleTagihanPayment({", iLock);
        expect(iSettleInLock).toBeGreaterThan(iLock);
    });
});

describe("handlePaidStatusChange alarm reaktivasi (#b346 / temuan #5)", () => {
    const src = read("lib/approval-logic.js");
    test("memakai alertReaktivasiGagal dari reactivation-outcome (sumber tunggal)", () => {
        expect(src).toMatch(/require\(['"]\.\/services\/reactivation-outcome['"]\)/);
    });
    test("dialarmi di DUA titik: catch reaktivasi gagal + cabang profil tak terbaca (blind read)", () => {
        const hits = src.match(/alertReaktivasiGagal\(/g) || [];
        expect(hits.length).toBeGreaterThanOrEqual(2);
    });
    test("cabang blind-read menyaring 'tak terbaca'/'gagal membaca profil live' (bukan alasan benign)", () => {
        expect(src).toMatch(/tak terbaca\|gagal membaca profil live/);
    });
});
