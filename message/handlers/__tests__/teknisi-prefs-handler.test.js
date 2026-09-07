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
const FULL = () => ({
    enabled: true, alerts: { los: true, redaman: true, ticket_new: true, post_repair: true },
    channel: "both", areas: [], quietHours: { enabled: false, start: "22:00", end: "06:00" }, pantau: {}, snoozeUntil: null,
});
const mockSetPrefs = jest.fn((id, patch) => {
    const p = FULL();
    Object.assign(p, patch);
    if (patch.alerts) p.alerts = { ...FULL().alerts, ...patch.alerts };
    return p;
});
jest.mock("../../../repositories/teknisi-prefs.repository", () => ({
    getPrefs: (...a) => mockGetPrefs(...a),
    setPrefs: (...a) => mockSetPrefs(...a),
}));

const { handleSetelanSaya, handleAlertPref } = require("../teknisi-prefs-handler");

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
beforeEach(() => { mockGetPrefs.mockClear(); mockSetPrefs.mockClear(); });

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

describe("handleAlertPref", () => {
    test("STAF-ONLY & gate dihormati (pelanggan → tolak, tak menulis)", async () => {
        const p = mkP({ isTeknisi: undefined, qAfterKeyword: "off" });
        await handleAlertPref(p);
        expect(mockSetPrefs).not.toHaveBeenCalled();
    });

    test("bare `alert` → bantuan, tak menulis", async () => {
        const p = mkP({ qAfterKeyword: "" });
        await handleAlertPref(p);
        expect(mockSetPrefs).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/Atur Alert/i);
    });

    test("`off` → enabled:false", async () => {
        const p = mkP({ qAfterKeyword: "off" });
        await handleAlertPref(p);
        expect(mockSetPrefs).toHaveBeenCalledWith(5, { enabled: false });
    });

    test("`los off` → alerts.los:false (alias kelas)", async () => {
        const p = mkP({ qAfterKeyword: "los off" });
        await handleAlertPref(p);
        expect(mockSetPrefs).toHaveBeenCalledWith(5, { alerts: { los: false } });
    });

    test("`tiket on` → ticket_new:true (alias tiket)", async () => {
        const p = mkP({ qAfterKeyword: "tiket on" });
        await handleAlertPref(p);
        expect(mockSetPrefs).toHaveBeenCalledWith(5, { alerts: { ticket_new: true } });
    });

    test("`area Krajan, ODP-01` → areas terpangkas", async () => {
        const p = mkP({ qAfterKeyword: "area Krajan, ODP-01" });
        await handleAlertPref(p);
        expect(mockSetPrefs).toHaveBeenCalledWith(5, { areas: ["Krajan", "ODP-01"] });
    });

    test("`area semua` → areas dikosongkan (terima semua area)", async () => {
        const p = mkP({ qAfterKeyword: "area semua" });
        await handleAlertPref(p);
        expect(mockSetPrefs).toHaveBeenCalledWith(5, { areas: [] });
    });

    test("`kanal grup` → channel:'group'", async () => {
        const p = mkP({ qAfterKeyword: "kanal grup" });
        await handleAlertPref(p);
        expect(mockSetPrefs).toHaveBeenCalledWith(5, { channel: "group" });
    });

    test("kelas tanpa on/off → minta format, tak menulis", async () => {
        const p = mkP({ qAfterKeyword: "redaman" });
        await handleAlertPref(p);
        expect(mockSetPrefs).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/on.*atau.*off/i);
    });
});
