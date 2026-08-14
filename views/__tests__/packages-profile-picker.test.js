/**
 * Header Doc
 * Purpose: Mengunci "Profil MikroTik" di halaman Paket agar tetap DIPILIH dari router, bukan
 *          diketik bebas. Field ini dulu `<input type="text">`: salah ketik satu huruf membuat
 *          paket menunjuk profil yang tak ada di router, dan kegagalannya SENYAP — paket
 *          tersimpan rapi tapi sinkronisasi profil pelanggan tak pernah cocok.
 * Caller: Jest.
 * Deps: `fs` (pemindaian sumber halaman + JS-nya).
 * SideEffects: tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");
const PHP = baca("views", "sb-admin", "packages.php");
const JS1 = baca("static", "js", "packages-1.js");
const JS2 = baca("static", "js", "packages-2.js");

describe("halaman Paket — pemilih profil MikroTik", () => {
    test("kedua form memakai <select>, bukan input teks bebas", () => {
        // Dua form: tambah (#create-profile) dan edit (#profile).
        expect(PHP).toMatch(/<select[^>]*id="create-profile"[^>]*name="profile"/);
        expect(PHP).toMatch(/<select[^>]*id="profile"[^>]*name="profile"/);
        expect(PHP).not.toMatch(/<input[^>]*id="create-profile"[^>]*type="text"/);
        expect(PHP).not.toMatch(/<input[^>]*id="profile"[^>]*name="profile"[^>]*type="text"/);
    });

    test("tetap menyediakan jalan ketik manual (profil baru / router tak terbaca)", () => {
        expect(PHP).toMatch(/id="create-profile-manual"[^>]*data-profil-manual/);
        expect(PHP).toMatch(/id="profile-manual"[^>]*data-profil-manual/);
        expect(JS1).toContain("PROFIL_MANUAL");
    });

    test("daftar diambil dari endpoint owner yang sudah ada, bukan endpoint baru", () => {
        // Owner: routes/admin-wifi-ops-routes.js. routes/admin.js sudah jadi stub 410.
        expect(JS1).toContain("/api/mikrotik/ppp-profiles");
        expect(baca("routes", "admin-wifi-ops-routes.js")).toContain('"/api/mikrotik/ppp-profiles"');
    });

    test("nilai form dibaca lewat ambilProfil (satu sumber: dropdown ATAU manual)", () => {
        // Selector lama `input[name="profile"]` tak boleh tersisa — ia tak akan menangkap <select>.
        expect(JS1).not.toMatch(/input\[name="profile"\]/);
        expect(JS1).toContain("ambilProfil('#create-profile')");
        expect(JS1).toContain("ambilProfil('#profile')");
    });

    // "Router tak terbaca" tak boleh terlihat sama dengan "tak ada profil" — pelajaran yang sama
    // dengan alat Sisa PPPoE.
    test("gagal baca router → jatuh ke isian manual, bukan dropdown kosong", () => {
        expect(JS1).toMatch(/window\.profilRouter = null/);
        expect(JS1).toMatch(/tak terbaca/i);
    });

    test("profil tersimpan yang tak ada di router tetap dipertahankan & ditandai", () => {
        expect(JS1).toMatch(/indexOf\(nilaiTersimpan\) === -1/);
        expect(JS1).toMatch(/tidak ada di router/);
    });

    // DataTables menyimpan hasil render tiap sel: `draw()` sendirian menggambar ulang baris TANPA
    // memanggil ulang render, jadi penanda tak pernah muncul (terukur 0 vs 1).
    test("tabel digambar ulang dengan invalidate() setelah daftar profil tiba", () => {
        expect(JS2).toContain("profil-router-siap");
        expect(JS2).toContain("rows().invalidate().draw(false)");
        expect(JS1).toContain("$(document).trigger('profil-router-siap')");
    });
});
