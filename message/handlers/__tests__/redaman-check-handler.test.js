/**
 * Header Doc
 * Purpose: Guard Fase 1 ronde 5 (#b351) — intent WA teknisi "cek redaman": STAF-ONLY (pelanggan
 *   ditolak), resolve pelanggan via katakunci ATAU #idtiket, panggil service fondasi #b350, balas
 *   RX dua-sisi. Service di-mock (logikanya diuji terpisah).
 * Caller: Jest.
 * Deps: ../redaman-check-handler; service di-mock; customer-lookup MURNI (pakai users asli).
 * SideEffects: -
 */
"use strict";

const mockDiagnose = jest.fn(async () => ({
    nama: "Budi", pppoe: "budi@isp",
    modem: { hasDevice: true, reachable: true, rxRaw: -24, verdict: { label: "BAIK", emoji: "🟢", value: -24 } },
    olt: { matched: true, status: "Online", rxPowerValid: true, rxPower: -25 },
    oltVerdict: { label: "BAIK", emoji: "🟢" }, combined: { terburuk: -25 },
    kesimpulan: "Kesimpulan: redaman dalam batas wajar. ✅",
    sources: { modem: true, olt: true },
}));
const mockAffected = jest.fn(async () => ({
    total: 2, truncated: false, rows: [
        { label: "los@isp", oltName: "OLT-A", pon: "PON1", onuId: 3, status: "LOS", rxValid: false, rx: null, verdict: null, isLos: true, isDyingGasp: false, bad: true },
        { label: "budi@isp", oltName: "OLT-A", pon: "PON1", onuId: 4, status: "Online", rxValid: true, rx: -27, verdict: { label: "BURUK", emoji: "🔴" }, isLos: false, isDyingGasp: false, bad: true },
    ],
}));
jest.mock("../../../services/redaman-diagnosis.service", () => ({
    getRedamanDiagnosisService: () => ({ diagnoseCustomer: mockDiagnose, getAffectedRedaman: mockAffected }),
    formatDetailLines: () => ["— Sisi Modem (ONU) —", "RX: 🟢 -24 dBm — BAIK", "", "— Sisi OLT —", "RX: 🟢 -25 dBm — BAIK (status ONU: Online)"],
}));

const mockCountActive = jest.fn(() => 0);
const mockAddWatch = jest.fn((w) => ({ id: "RW-1", ...w }));
const mockRemoveByRequester = jest.fn(() => 2);
jest.mock("../../../lib/redaman-watch-store", () => ({
    countActive: (...a) => mockCountActive(...a),
    addWatch: (...a) => mockAddWatch(...a),
    removeByRequester: (...a) => mockRemoveByRequester(...a),
}));
jest.mock("../../../lib/jid-utils", () => ({ normalizeJidForMessage: async (jid) => jid }));

const { handleCekRedaman, handleRedamanTerdampak, handlePantauRedaman, handleStopPantau } = require("../redaman-check-handler");

const USERS = [
    { id: 5, name: "Budi Santoso", pppoe_username: "budi@isp", device_id: "DEV-5" },
    { id: 6, name: "Budiman", pppoe_username: "budiman@isp", device_id: "DEV-6" },
];
const mess = { teknisiOrOwnerOnly: "⛔ khusus teknisi" };

function mkP(over = {}) {
    return {
        qAfterKeyword: "", args: [], matchedKeywordLength: 2,
        isOwner: false, isTeknisi: { role: "teknisi" }, users: USERS,
        reply: jest.fn(async () => {}), global: { reports: [] }, mess, msg: {}, raf: {},
        ...over,
    };
}

beforeEach(() => { mockDiagnose.mockClear(); mockAffected.mockClear(); mockCountActive.mockClear(); mockAddWatch.mockClear(); mockRemoveByRequester.mockClear(); mockCountActive.mockReturnValue(0); });

describe("handleCekRedaman (#b351 Fase 1)", () => {
    test("STAF-ONLY: pelanggan (bukan teknisi/owner) ditolak, service TIDAK dipanggil", async () => {
        const p = mkP({ isTeknisi: undefined, isOwner: false, qAfterKeyword: "budi" });
        await handleCekRedaman(p);
        expect(p.reply).toHaveBeenCalledWith("⛔ khusus teknisi");
        expect(mockDiagnose).not.toHaveBeenCalled();
    });

    test("arg kosong → bantuan (help), service tak dipanggil", async () => {
        const p = mkP({ qAfterKeyword: "" });
        await handleCekRedaman(p);
        expect(mockDiagnose).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/cek redaman/i);
    });

    test("katakunci unik → diagnose + balas RX dua-sisi + kesimpulan", async () => {
        const p = mkP({ qAfterKeyword: "budi santoso" });
        await handleCekRedaman(p);
        expect(mockDiagnose).toHaveBeenCalledTimes(1);
        expect(mockDiagnose.mock.calls[0][0].id).toBe(5);
        const last = p.reply.mock.calls[p.reply.mock.calls.length - 1][0];
        expect(last).toMatch(/REDAMAN — Budi/);
        expect(last).toMatch(/Sisi Modem/);
        expect(last).toMatch(/Sisi OLT/);
        expect(last).toMatch(/batas wajar/);
    });

    test("katakunci ambigu → daftar kandidat, service tak dipanggil", async () => {
        const p = mkP({ qAfterKeyword: "budi" }); // cocok Budi Santoso + Budiman (substring)
        await handleCekRedaman(p);
        expect(mockDiagnose).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/beberapa pelanggan|Perjelas/i);
    });

    test("#idtiket → resolve user dari tiket lalu diagnose", async () => {
        const p = mkP({ qAfterKeyword: "#T-100", global: { reports: [{ ticketId: "T-100", pelangganUserId: 6 }] } });
        await handleCekRedaman(p);
        expect(mockDiagnose).toHaveBeenCalledTimes(1);
        expect(mockDiagnose.mock.calls[0][0].id).toBe(6);
    });

    test("#idtiket tak ada → pesan tiket tak ditemukan", async () => {
        const p = mkP({ qAfterKeyword: "#NOPE", global: { reports: [] } });
        await handleCekRedaman(p);
        expect(mockDiagnose).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/Tiket #NOPE tidak ditemukan/);
    });

    test("katakunci tak ketemu → pelanggan tak ditemukan", async () => {
        const p = mkP({ qAfterKeyword: "zzzznotexist" });
        await handleCekRedaman(p);
        expect(mockDiagnose).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/tidak ditemukan/i);
    });
});

describe("handleRedamanTerdampak (#b352 Fase 3, gated)", () => {
    test("STAF-ONLY: pelanggan ditolak", async () => {
        const p = mkP({ isTeknisi: undefined, isOwner: false });
        await handleRedamanTerdampak(p);
        expect(p.reply).toHaveBeenCalledWith("⛔ khusus teknisi");
        expect(mockAffected).not.toHaveBeenCalled();
    });

    test("gate OFF (config.redamanTerdampak.enabled != true) → pesan belum aktif, service tak dipanggil", async () => {
        const p = mkP({ global: { config: {} } });
        await handleRedamanTerdampak(p);
        expect(mockAffected).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/belum diaktifkan|redamanTerdampak/i);
    });

    test("gate ON, arg kosong → onlyBad true, daftar terdampak berperingkat", async () => {
        const p = mkP({ qAfterKeyword: "", global: { config: { redamanTerdampak: { enabled: true } } } });
        await handleRedamanTerdampak(p);
        expect(mockAffected).toHaveBeenCalledWith(expect.objectContaining({ onlyBad: true }));
        const last = p.reply.mock.calls[p.reply.mock.calls.length - 1][0];
        expect(last).toMatch(/Terdampak/i);
        expect(last).toMatch(/los@isp/);       // LOS di atas
        expect(last).toMatch(/budi@isp/);
        expect(last).toMatch(/RX belum valid/); // ONU non-Online ditandai
    });

    test("gate ON, arg OLT nama → filter oltName, onlyBad false", async () => {
        const p = mkP({ qAfterKeyword: "OLT-A", global: { config: { redamanTerdampak: { enabled: true } } } });
        await handleRedamanTerdampak(p);
        expect(mockAffected).toHaveBeenCalledWith(expect.objectContaining({ oltName: "OLT-A", onlyBad: false }));
    });
});

describe("handlePantauRedaman + handleStopPantau (#b353 Fase 4, gated)", () => {
    const on = { config: { redamanWatch: { enabled: true } } };
    const withSender = (over = {}) => mkP({ sender: "628@s.whatsapp.net", msg: {}, raf: {}, ...over });

    test("STAF-ONLY: pelanggan ditolak", async () => {
        const p = withSender({ isTeknisi: undefined, isOwner: false, qAfterKeyword: "budi", global: on });
        await handlePantauRedaman(p);
        expect(p.reply).toHaveBeenCalledWith("⛔ khusus teknisi");
        expect(mockAddWatch).not.toHaveBeenCalled();
    });

    test("gate OFF → belum aktif, addWatch tak dipanggil", async () => {
        const p = withSender({ qAfterKeyword: "budi", global: { config: {} } });
        await handlePantauRedaman(p);
        expect(mockAddWatch).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[0][0]).toMatch(/belum diaktifkan|redamanWatch/i);
    });

    test("gate ON + katakunci unik → baseline diagnose + addWatch + konfirmasi", async () => {
        const p = withSender({ qAfterKeyword: "budi santoso", global: on });
        await handlePantauRedaman(p);
        expect(mockDiagnose).toHaveBeenCalledTimes(1);   // baseline
        expect(mockAddWatch).toHaveBeenCalledTimes(1);
        expect(mockAddWatch.mock.calls[0][0]).toMatchObject({ requesterJid: "628@s.whatsapp.net", userId: 5 });
        const last = p.reply.mock.calls[p.reply.mock.calls.length - 1][0];
        expect(last).toMatch(/Mulai pantau redaman/);
    });

    test("cap tercapai → pesan penuh, addWatch tak dipanggil", async () => {
        mockCountActive.mockReturnValue(10);
        const p = withSender({ qAfterKeyword: "budi santoso", global: { config: { redamanWatch: { enabled: true, maxActive: 10 } } } });
        await handlePantauRedaman(p);
        expect(mockAddWatch).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[p.reply.mock.calls.length - 1][0]).toMatch(/Batas 10 pemantauan/);
    });

    test("requester @lid → ditolak (invarian JID), addWatch tak dipanggil", async () => {
        const p = withSender({ sender: "12345@lid", qAfterKeyword: "budi santoso", global: on });
        await handlePantauRedaman(p);
        expect(mockAddWatch).not.toHaveBeenCalled();
        expect(p.reply.mock.calls[p.reply.mock.calls.length - 1][0]).toMatch(/@lid/);
    });

    test("stop pantau → removeByRequester + konfirmasi jumlah", async () => {
        const p = withSender({});
        await handleStopPantau(p);
        expect(mockRemoveByRequester).toHaveBeenCalledWith("628@s.whatsapp.net");
        expect(p.reply.mock.calls[0][0]).toMatch(/dihentikan \(2\)/);
    });
});
