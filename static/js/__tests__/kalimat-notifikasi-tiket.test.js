/**
 * Header Doc
 * Purpose: Mengunci #b254 di panel tiket teknisi — kalimat "pelanggan sudah dikabari" WAJIB
 *          dihitung dari bukti `customerNotified` yang dikirim server, bukan diketik.
 * Caller: Jest test runner.
 * Deps: Pemindaian sumber `static/js/teknisi-tiket.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada (hanya membaca berkas).
 *
 * KENAPA ADA: server menghitung `customerNotified` di ENAM endpoint alur tiket — dan endpoint
 * OTW bahkan sudah menyusun kalimat jujurnya di `message` — lalu panel MEMBUANG semuanya dan
 * mengetik "Pelanggan telah dinotifikasi." tanpa syarat. Enam penghasil bukti, nol penampil.
 * Akibatnya teknisi meninggalkan lokasi yakin pelanggan sudah dikabari padahal bot bisa saja
 * sedang putus dari WhatsApp.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const BERKAS = path.join(__dirname, "..", "teknisi-tiket.js");
const sumber = fs.readFileSync(BERKAS, "utf8");

// Buang komentar sebelum mencocokkan — komentar penjelas di berkas ini menyebut kalimat lamanya,
// dan pemindai yang lugu akan menuduh dirinya sendiri.
function bersih(kode) {
    return kode
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((b) => b.replace(/(^|[^:])\/\/.*$/, "$1"))
        .join("\n");
}
const kode = bersih(sumber);

// Reproduksi helper yang ada di berkas, untuk menguji ATURANNYA (berkas itu skrip browser
// tanpa export; menguji perilakunya lewat salinan aturan lebih jujur daripada mengeval DOM).
function rafKalimatNotif(data) {
    if (!data || typeof data.customerNotified === "undefined") return "";
    return data.customerNotified
        ? " Pelanggan sudah dikabari lewat WhatsApp."
        : " ⚠️ Pelanggan BELUM dikabari — sampaikan langsung ke pelanggannya.";
}

describe("#b254 — kalimat notifikasi tiket dihitung dari bukti", () => {
    test("tidak ada lagi klaim TANPA SYARAT 'Pelanggan telah dinotifikasi' di panel", () => {
        expect(kode).not.toMatch(/Pelanggan telah dinotifikasi/);
    });

    test("helper pembentuk kalimat memang ada dan dipakai", () => {
        expect(kode).toMatch(/function rafKalimatNotif/);
        // dipakai minimal di dua tempat (OTW + selesai)
        const dipakai = (kode.match(/rafKalimatNotif\(/g) || []).length;
        expect(dipakai).toBeGreaterThanOrEqual(3); // 1 definisi + >=2 pemakaian
    });

    test("bukti ADA & true → kalimat positif", () => {
        expect(rafKalimatNotif({ customerNotified: true })).toMatch(/sudah dikabari/i);
    });

    test("bukti ADA & false → kalimat NEGATIF, dan menyuruh sampaikan langsung", () => {
        const t = rafKalimatNotif({ customerNotified: false });
        expect(t).toMatch(/BELUM dikabari/);
        expect(t).toMatch(/sampaikan langsung/i);
    });

    test("`sent:false` TIDAK boleh disebut 'gagal' — bisa jadi cuma dilewati deduplikasi", () => {
        // Menyebutnya "gagal mengirim" akan mengirim teknisi mengejar masalah yang tak ada,
        // dan menutupi masalah sebenarnya (pelanggan memang belum tahu).
        expect(rafKalimatNotif({ customerNotified: false })).not.toMatch(/gagal/i);
    });

    test("bukti TIDAK ADA → tidak mengklaim apa pun (bukan mengarang positif)", () => {
        expect(rafKalimatNotif({})).toBe("");
        expect(rafKalimatNotif(null)).toBe("");
        expect(rafKalimatNotif(undefined)).toBe("");
    });
});
