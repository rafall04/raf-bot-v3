/**
 * Header Doc
 * Purpose: Uji penanda aktivitas chat in-memory (jejak balasan manual admin + cooldown fallback).
 * Caller: jest.
 * Deps: `../chat-activity-tracker`.
 * MainFuncs: —
 * SideEffects: Tidak ada (state di-reset per test).
 */
"use strict";

const {
    noteAdminOutbound,
    getAdminOutboundAgeMs,
    noteFallbackReply,
    getFallbackReplyAgeMs,
    resetChatActivityForTest
} = require("../chat-activity-tracker");

describe("chat-activity-tracker", () => {
    beforeEach(() => {
        resetChatActivityForTest();
    });

    test("chat tanpa catatan → Infinity", () => {
        expect(getAdminOutboundAgeMs("62800@s.whatsapp.net")).toBe(Infinity);
        expect(getFallbackReplyAgeMs("62800@s.whatsapp.net")).toBe(Infinity);
    });

    test("setelah dicatat, umur kecil dan terpisah per jenis", () => {
        noteAdminOutbound("62801@s.whatsapp.net");
        expect(getAdminOutboundAgeMs("62801@s.whatsapp.net")).toBeLessThan(5000);
        // jenis lain tidak ikut tercatat
        expect(getFallbackReplyAgeMs("62801@s.whatsapp.net")).toBe(Infinity);

        noteFallbackReply("62802@s.whatsapp.net");
        expect(getFallbackReplyAgeMs("62802@s.whatsapp.net")).toBeLessThan(5000);
    });

    test("jid kosong / non-string aman", () => {
        expect(() => noteAdminOutbound(null)).not.toThrow();
        expect(() => noteAdminOutbound(undefined)).not.toThrow();
        expect(getAdminOutboundAgeMs(null)).toBe(Infinity);
    });

    test("reset membersihkan seluruh catatan", () => {
        noteAdminOutbound("62803@s.whatsapp.net");
        resetChatActivityForTest();
        expect(getAdminOutboundAgeMs("62803@s.whatsapp.net")).toBe(Infinity);
    });
});
