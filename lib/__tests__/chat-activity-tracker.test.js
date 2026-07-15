/**
 * Header Doc
 * Purpose: Uji penanda aktivitas chat: jejak balasan manual admin, cooldown fallback, dan — sejak
 *          14-07 — DURABILITAS jejak itu lintas restart. Bagian durabilitas adalah inti perbaikan
 *          insiden bukti-bayar palsu: prod restart 7–13×/hari, dan foto koordinasi CCTV masuk 19
 *          detik sesudah restart saat Map masih kosong → gerbang "admin sedang menangani chat" buta.
 * Caller: jest.
 * Deps: `../chat-activity-tracker`.
 * MainFuncs: —
 * SideEffects: Tidak ada (state di-reset per test; persistensi di-mock).
 */
"use strict";

const {
    noteAdminOutbound,
    getAdminOutboundAgeMs,
    isAdminHandlingChat,
    noteFallbackReply,
    getFallbackReplyAgeMs,
    noteConnectivityComplaint,
    hasRecentComplaint,
    configureChatActivityPersistence,
    isChatSignalReady,
    hydrateChatActivity,
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

    describe("hasRecentComplaint", () => {
        const WINDOW = 15 * 60 * 1000;

        test("baru mengeluh → true; tanpa jejak → false", () => {
            noteConnectivityComplaint("62820@s.whatsapp.net");
            expect(hasRecentComplaint(["62820@s.whatsapp.net"], WINDOW)).toBe(true);
            expect(hasRecentComplaint(["62821@s.whatsapp.net"], WINDOW)).toBe(false);
        });

        test("mendukung multi-JID (@lid + kanonik) & argumen tak valid aman", () => {
            noteConnectivityComplaint("62822@s.whatsapp.net");
            expect(hasRecentComplaint(["99999@lid", "62822@s.whatsapp.net"], WINDOW)).toBe(true);
            expect(hasRecentComplaint(null, WINDOW)).toBe(false);
            expect(hasRecentComplaint(["62822@s.whatsapp.net"], 0)).toBe(false);
        });
    });

    // ── DURABILITAS: alasan insiden 14-07 ada di sini ──
    describe("persistensi jejak (bertahan lintas restart)", () => {
        test("tanpa persistensi → dianggap SIAP (perilaku in-memory seperti dulu, test tetap murni)", () => {
            expect(isChatSignalReady()).toBe(true);
        });

        test("noteAdminOutbound menulis ke adapter (fire-and-forget)", async () => {
            const saveAdminOutbound = jest.fn();
            const saveComplaint = jest.fn();
            await configureChatActivityPersistence({
                saveAdminOutbound,
                saveComplaint,
                loadRecent: async () => []
            });

            noteAdminOutbound("62830@s.whatsapp.net");
            noteConnectivityComplaint("62831@s.whatsapp.net");

            expect(saveAdminOutbound).toHaveBeenCalledWith("62830@s.whatsapp.net", expect.any(Number));
            expect(saveComplaint).toHaveBeenCalledWith("62831@s.whatsapp.net", expect.any(Number));
        });

        test("SIMULASI RESTART: jejak dipulihkan dari disk → gerbang admin-aktif langsung hidup", async () => {
            const CHAT = "6282233663334@s.whatsapp.net"; // Lapak RT 15
            const duaMenitLalu = Date.now() - (2 * 60 * 1000);

            // Proses baru: Map kosong. Tanpa pemulihan, inilah persis jendela buta 19 detik itu.
            expect(isAdminHandlingChat([CHAT], 15 * 60 * 1000)).toBe(false);

            await configureChatActivityPersistence({
                saveAdminOutbound: jest.fn(),
                saveComplaint: jest.fn(),
                loadRecent: async () => [{ chat_jid: CHAT, last_admin_outbound_at: duaMenitLalu, last_complaint_at: null }]
            });

            // Sesudah pulih: bot INGAT admin baru membalas 2 menit lalu → foto tidak akan ditangkap.
            expect(isChatSignalReady()).toBe(true);
            expect(isAdminHandlingChat([CHAT], 15 * 60 * 1000)).toBe(true);
        });

        test("pemulihan GAGAL → tetap 'ready' (jangan matikan intake selamanya karena DB ngambek)", async () => {
            const restored = await configureChatActivityPersistence({
                saveAdminOutbound: jest.fn(),
                saveComplaint: jest.fn(),
                loadRecent: async () => { throw new Error("db down"); }
            });

            expect(restored).toBe(0);
            expect(isChatSignalReady()).toBe(true); // obat tidak boleh lebih buruk dari penyakitnya
        });

        test("pemulihan MENGGANTUNG → menyerah setelah timeout, tidak pending selamanya", async () => {
            const restored = await configureChatActivityPersistence(
                {
                    saveAdminOutbound: jest.fn(),
                    saveComplaint: jest.fn(),
                    loadRecent: () => new Promise(() => {}) // tak pernah resolve
                },
                { timeoutMs: 50 }
            );

            expect(restored).toBe(0);
            expect(isChatSignalReady()).toBe(true);
        });

        test("hydrate tidak memundurkan jejak yang lahir SESUDAH boot", () => {
            const CHAT = "62840@s.whatsapp.net";
            noteAdminOutbound(CHAT); // jejak baru (sekarang)
            const umurSebelum = getAdminOutboundAgeMs(CHAT);

            hydrateChatActivity([{ chat_jid: CHAT, last_admin_outbound_at: Date.now() - (60 * 60 * 1000) }]);

            // Baris lama dari disk tidak boleh menimpa jejak yang lebih baru.
            expect(getAdminOutboundAgeMs(CHAT)).toBeLessThanOrEqual(umurSebelum + 1000);
            expect(getAdminOutboundAgeMs(CHAT)).toBeLessThan(60 * 1000);
        });

        test("hydrate aman terhadap baris rusak", () => {
            expect(() => hydrateChatActivity(null)).not.toThrow();
            expect(() => hydrateChatActivity([null, {}, { chat_jid: 123 }, { chat_jid: "x" }])).not.toThrow();
        });
    });
});
