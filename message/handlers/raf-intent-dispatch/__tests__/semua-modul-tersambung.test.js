/**
 * Header Doc
 * Purpose: Menjamin SETIAP modul yang terdaftar di `INTENT_DISPATCH_MODULES` benar-benar
 *          ikut ter-spread ke `getIntentDispatchMap()`, dan setiap intent yang punya kata
 *          kunci juga punya handler.
 * Caller: Jest test runner.
 * Deps: `../index`, `database/wifi_templates.json`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: modul `gajiTeknisi` terdaftar di INTENT_DISPATCH_MODULES tapi tak pernah
 * di-spread ke peta. Bot mencetak "Final intent: GAJI_SAYA" lalu DIAM karena handler-nya
 * tak ditemukan. Tes lama tetap hijau karena hanya mencocokkan string di berkas sumber.
 * Penjaga ini menembak peta runtime, jadi modul berikutnya yang lupa di-spread langsung merah.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { INTENT_DISPATCH_MODULES, getIntentDispatchMap } = require("../index");

describe("seluruh modul intent tersambung ke peta dispatch", () => {
    const peta = getIntentDispatchMap();

    test.each(Object.keys(INTENT_DISPATCH_MODULES))(
        "modul %s: semua intent-nya ada di peta",
        (namaModul) => {
            const modul = INTENT_DISPATCH_MODULES[namaModul] || {};
            const hilang = Object.keys(modul).filter((intent) => typeof peta[intent] !== "function");

            expect(hilang).toEqual([]);
        }
    );

    test("peta tidak kosong (penjaga terhadap perubahan bentuk ekspor)", () => {
        expect(Object.keys(peta).length).toBeGreaterThan(50);
    });
});

describe("intent berkata-kunci wajib punya handler", () => {
    // Intent hanya lahir dari kata kunci (lihat getIntentFromKeywords). Kata kunci tanpa
    // handler = bot diam total saat perintahnya diketik — gejala yang sama persis dengan
    // GAJI_SAYA, dan tak terlihat dari mana pun kecuali dicoba langsung.
    test("tidak ada intent di wifi_templates.json yang handler-nya tak ada", () => {
        const berkas = path.join(__dirname, "..", "..", "..", "..", "database", "wifi_templates.json");
        const daftar = JSON.parse(fs.readFileSync(berkas, "utf8"));
        const peta = getIntentDispatchMap();

        const tanpaHandler = daftar
            .filter((x) => x && x.intent && Array.isArray(x.keywords) && x.keywords.length)
            .map((x) => x.intent)
            .filter((intent) => typeof peta[intent] !== "function");

        // Terukur 2026-08-14 sesudah `gajiTeknisi` di-spread: 86 intent berkata-kunci, NOL di
        // antaranya tanpa handler. Karena itu penjaganya nol mutlak, bukan baseline longgar —
        // menambah kata kunci tanpa handler berarti bot diam total saat perintahnya diketik.
        expect(tanpaHandler).toEqual([]);
    });
});
