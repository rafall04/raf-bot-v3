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
jest.mock("../../../services/redaman-diagnosis.service", () => ({
    getRedamanDiagnosisService: () => ({ diagnoseCustomer: mockDiagnose }),
    formatDetailLines: () => ["— Sisi Modem (ONU) —", "RX: 🟢 -24 dBm — BAIK", "", "— Sisi OLT —", "RX: 🟢 -25 dBm — BAIK (status ONU: Online)"],
}));

const { handleCekRedaman } = require("../redaman-check-handler");

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

beforeEach(() => mockDiagnose.mockClear());

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
