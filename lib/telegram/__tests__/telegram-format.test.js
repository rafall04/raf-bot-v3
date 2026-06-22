/**
 * Test telegram-format — escape HTML, parse & vonis redaman (rxVerdict), badge status.
 */
"use strict";

const { escapeHtml, statusBadge, parseRedaman, rxVerdict, buildUnregisteredMessage } = require("../telegram-format");

describe("escapeHtml", () => {
    test("escape & < > untuk parse_mode HTML", () => {
        expect(escapeHtml('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; "d"');
    });
    test("null/undefined → string kosong", () => {
        expect(escapeHtml(null)).toBe("");
        expect(escapeHtml(undefined)).toBe("");
    });
});

describe("parseRedaman", () => {
    test.each([
        ["-25", -25],
        ["-24.5 dBm", -24.5],
        [-26, -26],
        ["rxPower: -23.10", -23.1],
    ])("'%s' → %s", (input, expected) => {
        expect(parseRedaman(input)).toBe(expected);
    });
    test("tak ada angka → null", () => {
        expect(parseRedaman("N/A")).toBeNull();
        expect(parseRedaman(null)).toBeNull();
    });
});

describe("rxVerdict (toleransi -25)", () => {
    test("lebih negatif dari toleransi → BURUK 🔴", () => {
        expect(rxVerdict("-27", -25)).toMatchObject({ label: "BURUK", emoji: "🔴" });
    });
    test("dalam 3 dB dari toleransi → WASPADA 🟡", () => {
        expect(rxVerdict("-24", -25)).toMatchObject({ label: "WASPADA", emoji: "🟡" });
    });
    test("jauh lebih baik → BAIK 🟢", () => {
        expect(rxVerdict("-20", -25)).toMatchObject({ label: "BAIK", emoji: "🟢" });
    });
    test("tak ada data → ⚪", () => {
        expect(rxVerdict("N/A", -25)).toMatchObject({ label: "tidak ada data", emoji: "⚪", value: null });
    });
});

describe("statusBadge", () => {
    test.each([
        ["Online", "🟢"],
        ["LOS", "🔴"],
        ["Dying Gasp", "🟠"],
        ["Offline", "⚫"],
        ["unknown", "⚪"],
    ])("%s → %s", (status, emoji) => {
        expect(statusBadge(status)).toBe(emoji);
    });
});

describe("buildUnregisteredMessage", () => {
    test("memuat chat_id dalam tag <code>", () => {
        const msg = buildUnregisteredMessage(12345);
        expect(msg).toContain("belum terdaftar");
        expect(msg).toContain("<code>12345</code>");
    });
});
