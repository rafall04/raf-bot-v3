/**
 * Header Doc
 * Purpose: Mengunci catatan "layanan tertentu terganggu" (#b264) — hanya nama APLIKASI yang
 *          dikenal pelanggan, tak pernah IP / nama jalur / angka; dan layanan tanpa `namaAwam`
 *          (nama teknis) tak pernah disebut.
 * Caller: Jest test runner.
 * Deps: `database/response_templates.json`, sumber `connection-check-handler.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const repoRoot = path.join(__dirname, "..", "..");
const templates = require(path.join(repoRoot, "database", "response_templates.json"));
const { findCustomerTextLeaks } = require(path.join(repoRoot, "lib", "customer-text-guard"));
const src = fs.readFileSync(path.join(repoRoot, "message", "handlers", "connection-check-handler.js"), "utf8");
const KEY = "conncheck_layanan_terganggu";

describe("#b264 — nama layanan boleh, identitas jaringan tidak", () => {
    test("template ada dan bersih dari kebocoran", () => {
        expect(templates[KEY]).toBeDefined();
        const teks = String(templates[KEY].template).replace("${layanan}", "Facebook & Instagram");
        expect(findCustomerTextLeaks(teks) || []).toEqual([]);
    });

    test("template tidak memuat IP maupun slot angka", () => {
        const t = String(templates[KEY].template);
        expect(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(t)).toBe(false);
        const slot = t.match(/\$\{[^}]+\}/g) || [];
        expect(slot.filter((s) => /loss|jitter|rtt|persen|pct|jalur|path/i.test(s))).toEqual([]);
    });

    test("HANYA layanan ber-`namaAwam` yang boleh disebut", () => {
        // "Akamai CDN" / "Google DNS" bukan nama apa pun bagi pelanggan; menyebutnya sama saja
        // membocorkan istilah internal tanpa memberi informasi.
        const blok = src.slice(src.indexOf("async function resolveUpstreamHealth"));
        const potong = blok.slice(0, blok.indexOf("function classifyOnlineVerdict"));
        expect(potong).toMatch(/filter\(\(t\) => t && t\.namaAwam\)/);
        expect(potong).toMatch(/if \(nama\) kumpul\.add\(nama\)/);
    });

    test("catatan MENAMBAH, bukan menggantikan catatan kesehatan", () => {
        // Jalur boleh sehat sementara satu layanan bermasalah — keduanya benar sekaligus, jadi
        // catatan layanan DITAMBAHKAN ke catatan kesehatan, bukan menimpanya.
        expect(src).toMatch(/if \(catatanLayanan\) healthNote = /);
        expect(src).toContain("${healthNote}");
        expect(src).not.toMatch(/healthNote = catatanLayanan;/);
    });

    test("daftar kosong → tak ada catatan (diam saat tak ada yang perlu dikatakan)", () => {
        const blok = src.slice(src.indexOf("function buildLayananNote"));
        const potong = blok.slice(0, blok.indexOf("function buildHealthNote"));
        expect(potong).toMatch(/if \(!nama\.length\) return ''/);
    });

    test("beberapa layanan dirangkai dengan 'dan', bukan koma menggantung", () => {
        const blok = src.slice(src.indexOf("function buildLayananNote"));
        expect(blok).toMatch(/slice\(0, -1\)\.join\(', '\)\} dan \$\{nama\[nama\.length - 1\]\}/);
    });
});
