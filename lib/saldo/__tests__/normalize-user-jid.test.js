/**
 * Header Doc
 * Purpose: Characterization + hardening guard untuk normalizeUserJid (jalur SALDO/uang). Kunci:
 *   JID normal utuh, `:0` di-strip, digit polos utuh, @lid ter-peta → JID kanonik (defense-in-depth),
 *   @lid TAK ter-peta → LOLOS apa adanya (sengaja: guard fail-closed hilir yang menolak). Plus guard
 *   pemindai-sumber bahwa ketiga jalur tulis (add/deduct/transfer) MENOLAK @lid (proteksi tak boleh regres).
 * Caller: Jest.
 * Deps: ../shared (normalizeUserJid) dgn ../../jid-utils di-mock; fs (scan sumber).
 * SideEffects: -
 */
"use strict";

jest.mock("../../jid-utils", () => ({ getStoredMappingByLid: jest.fn() }));

const fs = require("fs");
const path = require("path");
const { getStoredMappingByLid } = require("../../jid-utils");
const { normalizeUserJid } = require("../shared");

afterEach(() => jest.clearAllMocks());

test("JID kanonik normal → utuh", () => {
    expect(normalizeUserJid("628123@s.whatsapp.net")).toBe("628123@s.whatsapp.net");
});

test("format `:0` → di-strip jadi JID kanonik", () => {
    expect(normalizeUserJid("628123:0@s.whatsapp.net")).toBe("628123@s.whatsapp.net");
    expect(normalizeUserJid("628123:12")).toBe("628123@s.whatsapp.net");
});

test("digit polos tanpa ':' → utuh (perilaku lama dipertahankan)", () => {
    expect(normalizeUserJid("628123")).toBe("628123");
});

test("@lid TER-PETA → di-resolve ke JID kanonik (defense-in-depth)", () => {
    getStoredMappingByLid.mockReturnValueOnce({ phoneNumber: "628999", pnJid: "628999@s.whatsapp.net" });
    expect(normalizeUserJid("12345@lid")).toBe("628999@s.whatsapp.net");
    expect(getStoredMappingByLid).toHaveBeenCalledWith("12345@lid");
});

test("@lid TAK ter-peta → LOLOS apa adanya (hilir fail-closed yang menolak)", () => {
    getStoredMappingByLid.mockReturnValueOnce(null);
    expect(normalizeUserJid("12345@lid")).toBe("12345@lid");
});

test("resolve @lid tak boleh melempar walau peta error", () => {
    getStoredMappingByLid.mockImplementationOnce(() => { throw new Error("map rusak"); });
    expect(normalizeUserJid("12345@lid")).toBe("12345@lid");
});

test("GUARD: ketiga jalur tulis saldo menolak @lid (fail-closed) — proteksi tak boleh regres", () => {
    const bal = fs.readFileSync(path.join(__dirname, "..", "balance-operations.js"), "utf8");
    const trf = fs.readFileSync(path.join(__dirname, "..", "transfer-operations.js"), "utf8");
    // addSaldo + deductSaldo
    expect((bal.match(/endsWith\('@lid'\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(bal).toMatch(/TOLAK addSaldo/);
    expect(bal).toMatch(/TOLAK deductSaldo/);
    // transfer (from/to)
    expect(trf).toMatch(/endsWith\('@lid'\)/);
});
