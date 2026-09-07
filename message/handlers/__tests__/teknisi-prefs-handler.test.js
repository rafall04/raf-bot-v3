/**
 * Header Doc
 * Purpose: Guard RONDE 6 Fase A — handler WA `setelan saya` (message/handlers/teknisi-prefs-handler).
 *   Invariant: (1) STAF-ONLY (pelanggan ditolak); (2) GATE config.teknisiPrefs.enabled OFF → pesan
 *   "belum diaktifkan", store TAK dibaca; (3) gate ON tapi TANPA akun ber-id → ditolak (store per-id);
 *   (4) gate ON + akun teknisi → ringkasan preferensi ditampilkan.
 * Caller: Jest.
 * Deps: ../teknisi-prefs-handler; repository di-mock.
 * SideEffects: -
 */
"use strict";

const mockGetPrefs = jest.fn(() => ({
    enabled: true,
    alerts: { los: true, redaman: true, ticket_new: false, post_repair: true },
    channel: "both", areas: [], quietHours: { enabled: false, start: "22:00", end: "06:00" },
    pantau: {}, snoozeUntil: null,
}));
jest.mock("../../../repositories/teknisi-prefs.repository", () => ({ getPrefs: (...a) => mockGetPrefs(...a) }));

const { handleSetelanSaya } = require("../teknisi-prefs-handler");

const mess = { teknisiOrOwnerOnly: "⛔ khusus teknisi" };
function mkP(over = {}) {
    return {
        isOwner: false,
        isTeknisi: { id: 5, role: "teknisi" },
        reply: jest.fn(async () => {}),
        global: { config: { teknisiPrefs: { enabled: true } } },
        mess,
        ...over,
    };
}
beforeEach(() => mockGetPrefs.mockClear());

describe("handleSetelanSaya", () => {
    test("STAF-ONLY: pelanggan ditolak, store TIDAK dibaca", async () => {
        const p = mkP({ isTeknisi: undefined, isOwner: false });
        await handleSetelanSaya(p);
        expect(p.reply).toHaveBeenCalledWith("⛔ khusus teknisi");
        expect(mockGetPrefs).not.toHaveBeenCalled();
    });

    test("gate OFF → pesan belum-aktif, store TIDAK dibaca", async () => {
        const p = mkP({ global: { config: { teknisiPrefs: { enabled: false } } } });
        await handleSetelanSaya(p);
        expect(mockGetPrefs).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/belum diaktifkan/i);
    });

    test("gate ON tapi tanpa akun ber-id → ditolak (store per-id)", async () => {
        const p = mkP({ isTeknisi: true }); // truthy tapi bukan objek akun ber-.id
        await handleSetelanSaya(p);
        expect(mockGetPrefs).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/belum terhubung/i);
    });

    test("gate ON + akun teknisi → ringkasan preferensi (dikunci by account.id)", async () => {
        const p = mkP();
        await handleSetelanSaya(p);
        expect(mockGetPrefs).toHaveBeenCalledWith(5);
        const out = p.reply.mock.calls[0][0];
        expect(out).toMatch(/Setelan Saya/);
        expect(out).toMatch(/SEMUA area/);
        expect(out).toMatch(/Tiket-baru ❌/); // ticket_new:false tercermin
    });
});
