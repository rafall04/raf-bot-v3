/**
 * Header Doc
 * Purpose: Mengunci penyatuan jalur LEMOT (#b262) — pelanggan yang masuk lewat MENU bernomor
 *          mendapat kabar keadaan jaringan yang sama dengan yang MENGETIK keluhan, dan saran
 *          mandiri ("restart modem") TIDAK muncul bersamaan dengan catatan jaringan.
 * Caller: Jest test runner.
 * Deps: `database/response_templates.json`, sumber `smart-report-text-menu.js` &
 *       `connection-check-handler.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const repoRoot = path.join(__dirname, "..", "..");
const templates = require(path.join(repoRoot, "database", "response_templates.json"));
const KEY = "smart_report_text_lemot_troubleshoot_menu";
const srcMenu = fs.readFileSync(path.join(repoRoot, "message", "handlers", "smart-report-text-menu.js"), "utf8");
const srcCC = fs.readFileSync(path.join(repoRoot, "message", "handlers", "connection-check-handler.js"), "utf8");

describe("#b262 — slot baru WAJIB ada di template TERSIMPAN, bukan cuma fallback", () => {
    test("template produksi memuat kedua slot", () => {
        // Template tersimpan MENIMPA fallback. Menambah slot di fallback saja = catatan dihitung
        // lalu dibuang diam-diam — persis cara seksi jalur-upstream dulu tak terlihat pelanggan
        // berminggu-minggu.
        const t = String(templates[KEY].template);
        expect(t).toContain("${catatanJaringan}");
        expect(t).toContain("${saranMandiri}");
    });

    test("teks saran mandiri TIDAK lagi tertanam mati di template", () => {
        // Kalau ia tetap tertulis di template, ia akan muncul BERSAMAAN dengan catatan jaringan
        // dan pesannya membantah dirinya sendiri.
        expect(String(templates[KEY].template)).not.toMatch(/restart modem/i);
    });
});

describe("#b262 — saran mandiri & catatan jaringan saling menggantikan", () => {
    test("kode memilih salah satu, tidak pernah keduanya", () => {
        expect(srcMenu).toMatch(/const slotJaringan = catatanJaringan \?/);
        expect(srcMenu).toMatch(/const slotSaran = catatanJaringan \? '' :/);
    });

    test("menyuruh restart modem saat jaringan bermasalah adalah alamat yang salah", () => {
        // Guard makna, bukan gaya: kalau suatu saat keduanya dibuat muncul bersama, tes ini merah.
        const blok = srcMenu.slice(srcMenu.indexOf("const SARAN_MANDIRI"));
        const potong = blok.slice(0, blok.indexOf("return {"));
        expect(potong).toMatch(/catatanJaringan \? '' :/);
    });
});

describe("#b262 — resolveStabilitas aman dipanggil dari jalur mana pun", () => {
    test("menghangatkan cache PPP-aktifnya sendiri", () => {
        // Tanpa ini ia memulangkan TIDAK_TERPANTAU selamanya bila dipanggil di luar alur
        // cek-koneksi — fitur yang tampak terpasang tapi tak pernah bicara.
        const blok = srcCC.slice(srcCC.indexOf("async function resolveStabilitas"));
        const potong = blok.slice(0, blok.indexOf("function buildStabilitasNote"));
        expect(potong).toMatch(/if \(!activeCache\.addrByUser\)/);
        expect(potong).toMatch(/await getActiveUsernameSet\(await resolveRouterId\(user\)\)/);
    });

    test("router tak terbaca → TIDAK_TERPANTAU, bukan menebak sehat", () => {
        const blok = srcCC.slice(srcCC.indexOf("async function resolveStabilitas"));
        const potong = blok.slice(0, blok.indexOf("function buildStabilitasNote"));
        expect(potong).toMatch(/catch \(_e\) \{[\s\S]*?TIDAK_TERPANTAU/);
    });

    test("router-id punya SATU pemilik — tidak ada dua salinan logika", () => {
        expect(srcCC).toMatch(/async function resolveRouterId\(user\)/);
        // handleCekKoneksi memakai resolver yang sama, bukan menurunkan sendiri.
        expect(srcCC).toMatch(/const routerId = await resolveRouterId\(user\)/);
        // Pola LAMA yang menurunkan router-id sendiri di dalam handleCekKoneksi harus hilang;
        // itu yang membuat dua jalur bisa menyimpang diam-diam.
        expect(srcCC).not.toMatch(/let routerId = 'default'/);
    });

    test("keduanya diekspor supaya jalur lain tak perlu menyalin logika", () => {
        const h = require(path.join(repoRoot, "message", "handlers", "connection-check-handler"));
        expect(typeof h.resolveStabilitas).toBe("function");
        expect(typeof h.buildStabilitasNote).toBe("function");
    });
});
