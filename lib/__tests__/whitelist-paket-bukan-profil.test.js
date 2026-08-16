/**
 * Header Doc
 * Purpose: Mengunci bahwa "paket kebal billing" dikunci pada NAMA PAKET, bukan pada PROFIL
 *          MikroTik — sehingga paket berbayar yang berbagi profil dengan paket gratis TIDAK
 *          ikut kebal.
 * Caller: Jest test runner.
 * Deps: `lib/account-classification.js`, pemindaian sumber 6 cron billing.
 * MainFuncs: —
 * SideEffects: Menyetel & membersihkan `global.packages` selama tes.
 *
 * KENAPA ADA — `whitelist` adalah properti PAKET, tapi enam cron billing dulu menghitung
 * `packages.filter(p=>p.whitelist).map(p=>p.profile)` lalu mencocokkan profil pelanggan.
 * Profil adalah setelan bandwidth MikroTik yang WAJAR dipakai bersama beberapa paket.
 *
 * Terukur di produksi Tanjungharjo 2026-08-16 — data di bawah adalah data NYATA:
 *   PAKET-125K        profil 22Mbps  Rp125.000  (berbayar)
 *   PAKET-KHUSUS-50K  profil 22Mbps  Rp0        (whitelist)
 * Akibatnya 49 pelanggan berbayar (nilai langganan Rp6.125.000/bulan) tak pernah menerima
 * pengingat, tak pernah masuk masa tenggang, dan tak pernah jadi kandidat isolir.
 * Dander bersih karena paket gratisnya memakai profil khusus sendiri (`FREE-*`).
 */
"use strict";

const {
    getWhitelistedPackageNames,
    isPaketWhitelist,
} = require("../account-classification");

// Persis daftar paket produksi Tanjungharjo saat cacat ini ditemukan.
const PAKET_PRODUKSI = [
    { name: "PAKET-110K", profile: "16Mbps", price: 110000 },
    { name: "PAKET-125K", profile: "22Mbps", price: 125000 },
    { name: "PAKET-150K", profile: "27Mbps", price: 150000 },
    { name: "PAKET-220K", profile: "70Mbps", price: 220000 },
    { name: "PAKET-VOUCHER", profile: "PPP-Monitor", price: 0, whitelist: true },
    { name: "PAKET-KHUSUS-10Mbps", profile: "FREE-10Mbps", price: 0, whitelist: true },
    { name: "PAKET-KHUSUS-50K", profile: "22Mbps", price: 0, whitelist: true },
];

afterEach(() => {
    delete global.packages;
});

describe("kunci whitelist = nama paket", () => {
    test("hanya paket ber-whitelist yang masuk daftar", () => {
        const nama = getWhitelistedPackageNames(PAKET_PRODUKSI);
        expect([...nama].sort()).toEqual(["PAKET-KHUSUS-10Mbps", "PAKET-KHUSUS-50K", "PAKET-VOUCHER"]);
        expect(nama.has("PAKET-125K")).toBe(false);
    });

    test("membaca global.packages bila argumen tak diberikan", () => {
        global.packages = PAKET_PRODUKSI;
        expect(getWhitelistedPackageNames().has("PAKET-KHUSUS-50K")).toBe(true);
    });

    test("daftar kosong/undefined tidak meledak", () => {
        expect(getWhitelistedPackageNames([]).size).toBe(0);
        expect(getWhitelistedPackageNames(null).size).toBe(0);
        expect(getWhitelistedPackageNames(undefined).size).toBe(0);
    });
});

describe("TABRAKAN PROFIL: pelanggan berbayar tidak ikut kebal", () => {
    test("PAKET-125K (Rp125.000, profil 22Mbps) TIDAK whitelist", () => {
        // Inilah 49 pelanggan Tanjungharjo yang dulu lolos dari mesin penagihan.
        const user = { id: 1, name: "Pak Ade", subscription: "PAKET-125K" };
        expect(isPaketWhitelist(user, PAKET_PRODUKSI)).toBe(false);
    });

    test("PAKET-KHUSUS-50K (Rp0, profil 22Mbps SAMA) TETAP whitelist", () => {
        const user = { id: 2, name: "Pelanggan Gratis", subscription: "PAKET-KHUSUS-50K" };
        expect(isPaketWhitelist(user, PAKET_PRODUKSI)).toBe(true);
    });

    test("cara LAMA (lewat profil) memang keliru — dibuktikan, bukan diasumsikan", () => {
        // Reproduksi persis logika lama; ia menganggap pelanggan BERBAYAR sebagai gratis.
        const profilWhitelist = PAKET_PRODUKSI.filter((p) => p.whitelist).map((p) => p.profile);
        const profilUser = PAKET_PRODUKSI.find((p) => p.name === "PAKET-125K").profile;
        expect(profilWhitelist.includes(profilUser)).toBe(true);   // <- cacatnya
        // Cara baru menolaknya.
        expect(isPaketWhitelist({ subscription: "PAKET-125K" }, PAKET_PRODUKSI)).toBe(false);
    });

    test("paket tak dikenal / user tanpa paket → tidak kebal (fail-closed ke arah menagih)", () => {
        expect(isPaketWhitelist({ subscription: "PAKET-HANTU" }, PAKET_PRODUKSI)).toBe(false);
        expect(isPaketWhitelist({}, PAKET_PRODUKSI)).toBe(false);
        expect(isPaketWhitelist(null, PAKET_PRODUKSI)).toBe(false);
    });

    test("menerima Set yang sudah dihitung (untuk loop besar)", () => {
        const nama = getWhitelistedPackageNames(PAKET_PRODUKSI);
        expect(isPaketWhitelist({ subscription: "PAKET-KHUSUS-50K" }, nama)).toBe(true);
        expect(isPaketWhitelist({ subscription: "PAKET-125K" }, nama)).toBe(false);
    });
});

describe("tak ada cron yang kembali mengunci pada profil", () => {
    const fs = require("fs");
    const path = require("path");
    const CRON = [
        "reminder.js",
        "grace-reminder.js",
        "isolir.js",
        "isolir-notification.js",
        "rating-survey.js",
        "set-unpaid.js",
    ];

    test.each(CRON)("%s memakai nama paket, bukan profil", (nama) => {
        const src = fs.readFileSync(path.join(__dirname, "..", "cron", "jobs", nama), "utf8");
        // Pola lama: membangun daftar PROFIL dari paket whitelist.
        expect(src).not.toMatch(/\.filter\([^)]*whitelist[^)]*\)\s*\.map\([^)]*profile/);
        expect(src).not.toMatch(/whitelistedProfile/);
        // Pola baru: pemilik tunggal.
        expect(src).toMatch(/getWhitelistedPackageNames/);
    });
});
