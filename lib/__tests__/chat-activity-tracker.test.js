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
    isAdminHandlingChat,
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

    describe("isAdminHandlingChat (gerbang admin-aktif utk fallback + intake bukti bayar)", () => {
        const QUIET = 15 * 60 * 1000;

        test("admin baru saja balas manual → true (bot menahan diri)", () => {
            noteAdminOutbound("62810@s.whatsapp.net");
            expect(isAdminHandlingChat(["62810@s.whatsapp.net"], QUIET)).toBe(true);
        });

        test("chat tanpa jejak admin → false (bot boleh merespons)", () => {
            expect(isAdminHandlingChat(["62811@s.whatsapp.net"], QUIET)).toBe(false);
        });

        test("beberapa kandidat JID (@lid + kanonik), salah satu aktif → true", () => {
            noteAdminOutbound("62812@s.whatsapp.net"); // key kanonik
            expect(isAdminHandlingChat(["99999@lid", "62812@s.whatsapp.net"], QUIET)).toBe(true);
        });

        test("argumen tak valid aman → false", () => {
            noteAdminOutbound("62813@s.whatsapp.net");
            expect(isAdminHandlingChat([], QUIET)).toBe(false);
            expect(isAdminHandlingChat(null, QUIET)).toBe(false);
            expect(isAdminHandlingChat(["62813@s.whatsapp.net"], 0)).toBe(false);
            expect(isAdminHandlingChat(["62813@s.whatsapp.net"], NaN)).toBe(false);
            expect(isAdminHandlingChat([null, undefined], QUIET)).toBe(false);
        });
    });
});
