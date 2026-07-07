/**
 * Header Doc
 * Purpose: Uji integrasi resolveKeywordIntent dua lapis: matcher ketat tetap prioritas, lapis
 *          longgar hanya saat ketat gagal + gate enabled, dan KUNCI KESELAMATAN: match longgar
 *          selalu mengosongkan qAfterKeyword (parameter tidak pernah diambil dari kalimat bebas).
 * Caller: jest.
 * Deps: `../handlers/raf-state-routing`, `../../lib/wifi_template_handler`, `../../lib/loose-intent-matcher`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const { resolveKeywordIntent } = require("../handlers/raf-state-routing");
const { getIntentFromKeywords } = require("../../lib/wifi_template_handler");
const { getLooseIntentFromKeywords } = require("../../lib/loose-intent-matcher");

function resolve(chats, { looseIntentEnabled = true, command = "" } = {}) {
    const args = chats.trim().split(/\s+/);
    return resolveKeywordIntent({
        chats,
        isAgent: false,
        getIntentFromKeywords,
        args,
        q: chats,
        command: command || args[0].toLowerCase(),
        getLooseIntentFromKeywords,
        looseIntentEnabled
    });
}

describe("resolveKeywordIntent — lapis ketat + longgar", () => {
    test("matcher ketat tetap menang (cek tagihan)", () => {
        const result = resolve("cek tagihan");
        expect(result.intent).toBe("CEK_TAGIHAN");
        expect(result.isLooseMatch).toBe(false);
        expect(result.matchedKeywordLength).toBe(2);
    });

    test("kalimat bebas korpus → lapis longgar CEK_KONEKSI, seluruh kalimat = keyword", () => {
        const result = resolve("Jaringannya ko lemot ya kak");
        expect(result.intent).toBe("CEK_KONEKSI");
        expect(result.isLooseMatch).toBe(true);
        expect(result.matchedKeywordLength).toBe(5);
        expect(result.qAfterKeyword).toBe("");
    });

    test("KUNCI KESELAMATAN: loose GANTI_SANDI_WIFI tidak membawa kalimat sebagai password", () => {
        const result = resolve("Kata sandi ganti misnadin916");
        expect(result.intent).toBe("GANTI_SANDI_WIFI");
        expect(result.isLooseMatch).toBe(true);
        // qAfterKeyword WAJIB kosong → handler masuk wizard tanya-sandi, bukan memakai
        // "sandi ganti misnadin916" (atau potongannya) sebagai password baru.
        expect(result.qAfterKeyword).toBe("");
        expect(result.matchedKeywordLength).toBe(4);
    });

    test("gate mati → kalimat bebas tetap tanpa intent (perilaku lama)", () => {
        const result = resolve("Jaringannya ko lemot ya kak", { looseIntentEnabled: false });
        expect(result.intent).toBeUndefined();
        expect(result.isLooseMatch).toBe(false);
        expect(result.qAfterKeyword).toBe("Jaringannya ko lemot ya kak");
    });

    test("aturan lama LAPOR_GANGGUAN_MATI (butuh command 'lapor') tidak berubah", () => {
        const hasil = resolve("lapor mati", { command: "lapor" });
        expect(hasil.intent).toBe("LAPOR_GANGGUAN_MATI");

        // bila command bukan 'lapor', intent dibatalkan; lapis longgar tidak boleh
        // menghidupkannya kembali (loose tidak memetakan ke intent LAPOR_*)
        const dibatalkan = resolve("lapor mati", { command: "bukan-lapor" });
        expect(dibatalkan.intent).toBeUndefined();
    });
});
