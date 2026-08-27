/**
 * Header Doc
 * Purpose: Mengunci perbaikan sanitasi halaman pembayaran teknisi (#b287) — pesan dirender
 *          sebagai TEKS, tanpa pustaka CDN, dan tanpa jalur innerHTML yang menampung data
 *          server. Sekaligus penjaga repo: tak ada lagi <script> dari host di luar CSP.
 * Caller  : jest
 * Deps    : pemindaian sumber (tanpa DOM) + lib/http-security (daftar izin CSP).
 * MainFuncs: -
 * SideEffects: tidak ada
 *
 * KENAPA ADA: DOMPurify dimuat dari `cdnjs.cloudflare.com` yang TIDAK ada di `scriptSrc`,
 * jadi browser memblokirnya. Penjaganya ditulis `DOMPurify ? ... : fallback` — dan variabel
 * yang TIDAK TERDEKLARASI melempar ReferenceError, bukan bernilai falsy. Jadi fallback-nya
 * kode mati dan SELURUH `showMessageModal` gagal: teknisi tak pernah melihat konfirmasi
 * "Pengajuan Terkirim" maupun pesan galatnya.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");
const JS = "static/js/pembayaran-teknisi.js";
const PHP = "views/sb-admin/pembayaran/teknisi.php";

describe("#b287 — pesan dirender sebagai teks, bukan HTML", () => {
    const js = baca(JS);

    test("!! tak ada lagi pemakaian DOMPurify (hanya boleh disebut di komentar)", () => {
        for (const b of js.split("\n")) {
            const t = b.trim();
            if (t.startsWith("//") || t.startsWith("*")) continue;
            expect(t).not.toContain("DOMPurify");
        }
    });

    test("!! penjaga bergaya `X ? ... :` pada global yang mungkin tak ada DILARANG", () => {
        // Inilah bug aslinya: variabel tak terdeklarasi MELEMPAR, tidak jatuh ke fallback.
        // Pola aman satu-satunya adalah `typeof X !== "undefined"`.
        expect(js).not.toMatch(/=\s*DOMPurify\s*\?/);
    });

    test("showMessageModal memakai .text(), bukan .html()", () => {
        const i = js.indexOf("function showMessageModal");
        const j = js.indexOf("function showConfirmationModal");
        expect(i).toBeGreaterThan(-1);
        const blok = js.slice(i, j > i ? j : undefined);
        expect(blok).toContain("$('#messageModalText').text(");
        expect(blok).not.toContain("$('#messageModalText').html(");
    });

    test("!! displayGlobalTechnicianMessage TIDAK menyusun pesan lewat innerHTML", () => {
        const i = js.indexOf("function displayGlobalTechnicianMessage");
        const j = js.indexOf("function showMessageModal");
        const blok = js.slice(i, j);
        expect(i).toBeGreaterThan(-1);
        // Pesan wajib lewat textContent; innerHTML hanya boleh untuk entitas tetap (&times;).
        expect(blok).toMatch(/kotak\.textContent\s*=/);
        for (const m of blok.match(/innerHTML\s*=\s*[^;]+;/g) || []) {
            expect(m).toContain("&times;");
        }
        expect(blok).not.toMatch(/innerHTML\s*=\s*`[^`]*\$\{message\}/);
    });

    test("kelas alert dibatasi daftar tetap (type tak langsung ditempel)", () => {
        expect(js).toMatch(/TIPE_ALERT\s*=\s*\[/);
        expect(js).toMatch(/TIPE_ALERT\.includes\(type\)/);
    });
});

describe("#b287 — penjaga repo: script eksternal harus lolos CSP", () => {
    // Daftar izin diambil dari sumbernya, bukan disalin — kalau CSP berubah, tes ikut.
    const csp = baca("lib/http-security.js");
    const barisScriptSrc = csp.split("\n").find((b) => b.includes("const scriptSrc = ["));
    const diizinkan = [...(barisScriptSrc || "").matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]);

    test("daftar izin CSP terbaca (bukan tes hijau palsu)", () => {
        expect(diizinkan.length).toBeGreaterThanOrEqual(2);
        expect(diizinkan).toContain("https://cdn.jsdelivr.net");
    });

    test("!! tak ada <script src> dari host yang TIDAK ada di scriptSrc", () => {
        const nakal = [];
        const telusur = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (e.name === "node_modules") continue;
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { telusur(p); continue; }
                if (!e.name.endsWith(".php") && !e.name.endsWith(".html")) continue;
                const src = fs.readFileSync(p, "utf8");
                for (const m of src.match(/<script[^>]+src="https:\/\/[^"]+"/g) || []) {
                    const host = (m.match(/https:\/\/[a-z0-9.-]+/) || [])[0];
                    if (host && !diizinkan.includes(host)) {
                        nakal.push(path.relative(AKAR, p) + " -> " + host);
                    }
                }
            }
        };
        telusur(path.join(AKAR, "views"));
        // Kalau ini merah: HOST LOKAL pustakanya (static/vendor + rafAssetUrl), JANGAN
        // melonggarkan CSP portal admin.
        expect(nakal).toEqual([]);
    });

    test("halaman pembayaran teknisi tak lagi memuat skrip dari cdnjs", () => {
        expect(baca(PHP)).not.toContain("cdnjs.cloudflare.com/ajax/libs/dompurify");
    });
});
