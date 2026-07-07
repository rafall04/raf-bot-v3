/**
 * Header Doc
 * Purpose: Unit test pemetaan hasil `getIntentFromKeywords` (objek match) ke string identifier
 *          intent pada skrip ekspor log pesan — regresi bug "[object Object]" di kolom
 *          keyword_intent JSON/CSV (ekspor prod 2026-07-07).
 * Caller: Jest (`npx jest scripts/__tests__/export-message-logs.test.js`).
 * Deps: `scripts/export-message-logs.js` (aman di-require: guard `require.main`),
 *       mock `lib/wifi_template_handler`.
 * MainFuncs: -
 * SideEffects: Tidak ada — fungsi murni + wrapper dengan handler ter-mock.
 */
"use strict";

jest.mock("../../lib/wifi_template_handler", () => ({
    getIntentFromKeywords: jest.fn()
}));

const { getIntentFromKeywords } = require("../../lib/wifi_template_handler");
const { intentLabelFromMatch, tryKeywordIntent } = require("../export-message-logs");

describe("intentLabelFromMatch", () => {
    test("objek match handler dipetakan ke nama intent (string)", () => {
        const match = { intent: "MENU_UTAMA", matchedKeywordLength: 1, matchedKeyword: "menu" };
        expect(intentLabelFromMatch(match)).toBe("MENU_UTAMA");
    });

    test("tanpa match tetap null (perilaku best-effort dipertahankan)", () => {
        expect(intentLabelFromMatch(null)).toBeNull();
        expect(intentLabelFromMatch(undefined)).toBeNull();
    });

    test("bentuk tak terduga tidak bocor jadi \"[object Object]\"", () => {
        expect(intentLabelFromMatch({})).toBeNull();
        expect(intentLabelFromMatch({ intent: 42 })).toBeNull();
        expect(intentLabelFromMatch({ intent: "   " })).toBeNull();
    });

    test("kompatibel bila handler kelak mengembalikan string langsung", () => {
        expect(intentLabelFromMatch("BANTUAN")).toBe("BANTUAN");
        expect(intentLabelFromMatch("")).toBeNull();
    });
});

describe("tryKeywordIntent", () => {
    beforeEach(() => {
        getIntentFromKeywords.mockReset();
    });

    test("closure klasifikasi mengembalikan string intent, bukan objek", () => {
        getIntentFromKeywords.mockReturnValue({
            intent: "LIST_TIKET",
            matchedKeywordLength: 2,
            matchedKeyword: "list tiket"
        });
        const classify = tryKeywordIntent();
        expect(typeof classify).toBe("function");
        expect(classify("list tiket saya")).toBe("LIST_TIKET");
    });

    test("teks tanpa match menghasilkan null", () => {
        getIntentFromKeywords.mockReturnValue(null);
        const classify = tryKeywordIntent();
        expect(classify("halo min")).toBeNull();
    });

    test("handler melempar error → null, ekspor tidak boleh gagal", () => {
        getIntentFromKeywords.mockImplementation(() => {
            throw new Error("boom");
        });
        const classify = tryKeywordIntent();
        expect(classify("apa saja")).toBeNull();
    });
});
