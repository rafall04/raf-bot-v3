/**
 * Header Doc
 * Purpose: Guard BAGIAN 3 — `setoran saya` rekap penarikan teknisi via WA. Kunci: gate teknisi + akun
 *   ber-id; fee OFF → pesan fitur nonaktif; fee ON → reuse getSettlementReport, Sisa Setor = tertagih − fee.
 * Caller: Jest.
 * Deps: ../gaji-teknisi-intents (handleSetoranSayaIntent); technician-collection-settlement di-mock.
 * SideEffects: -
 */
"use strict";

const mockReport = jest.fn();
const mockCfg = jest.fn(() => ({ enabled: true, amount: 5000 }));
jest.mock("../../../../lib/technician-collection-settlement", () => ({
    getCommissionConfig: (...a) => mockCfg(...a),
    getSettlementReport: (...a) => mockReport(...a),
}));

const { handleSetoranSayaIntent } = require("../gaji-teknisi-intents");

function mkCtx(over = {}) {
    return {
        isTeknisi: { id: "t1", name: "Budi" },
        reply: jest.fn(),
        renderResponseTemplate: (_k, fb) => fb, // uji isi fallback yang dihitung
        qAfterKeyword: "",
        ...over,
    };
}
beforeEach(() => { mockReport.mockReset(); mockCfg.mockReturnValue({ enabled: true, amount: 5000 }); });

test("bukan teknisi → ditolak", async () => {
    const ctx = mkCtx({ isTeknisi: false });
    await handleSetoranSayaIntent(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/khusus.*teknisi/i);
    expect(mockReport).not.toHaveBeenCalled();
});

test("akun tanpa id → tak dikenali", async () => {
    const ctx = mkCtx({ isTeknisi: true });
    await handleSetoranSayaIntent(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/belum bisa dikenali/i);
    expect(mockReport).not.toHaveBeenCalled();
});

test("fee OFF → pesan fitur nonaktif, tak query", async () => {
    mockCfg.mockReturnValue({ enabled: false, amount: 0 });
    const ctx = mkCtx();
    await handleSetoranSayaIntent(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/belum diaktifkan/i);
    expect(mockReport).not.toHaveBeenCalled();
});

test("fee ON → Sisa Setor = tertagih − fee, tampilkan jumlah tarikan", async () => {
    mockReport.mockResolvedValue({
        commission_per_customer: 5000,
        totals: { total_collected: 1000000, net_total: 50000 },
        summary: [{ collected_count: 10, unique_paid_customers: 10 }],
    });
    const ctx = mkCtx();
    await handleSetoranSayaIntent(ctx);
    expect(mockReport).toHaveBeenCalledWith(expect.objectContaining({ teknisiId: "t1" }));
    const out = ctx.reply.mock.calls[0][0];
    expect(out).toMatch(/Rp1\.000\.000/);   // tertagih
    expect(out).toMatch(/Rp50\.000/);        // fee
    expect(out).toMatch(/Rp950\.000/);       // sisa setor = 1.000.000 − 50.000
    expect(out).toMatch(/10 tarikan/);
});

test("varian 'hari ini' → query pakai dateFrom/dateTo (bukan month/year)", async () => {
    mockReport.mockResolvedValue({ totals: { total_collected: 0, net_total: 0 }, summary: [] });
    const ctx = mkCtx({ qAfterKeyword: "hari ini" });
    await handleSetoranSayaIntent(ctx);
    const q = mockReport.mock.calls[0][0];
    expect(q.dateFrom).toBeDefined();
    expect(q.dateTo).toBeDefined();
    expect(q.month).toBeUndefined();
});
