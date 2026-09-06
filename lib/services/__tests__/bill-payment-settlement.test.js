/**
 * Test settlement bayar tagihan — fokus: catat lunas (ledger) + reaktivasi HANYA bila
 * terisolir, dan reaktivasi gagal TIDAK menggagalkan lunas (fail-closed yang benar).
 */
"use strict";

const { createBillPaymentSettlement } = require("../bill-payment-settlement");

function makeDeps(overrides = {}) {
    return {
        applyPaymentStatusChange: jest.fn().mockResolvedValue({ action: "marked_paid" }),
        executeProfileAction: jest.fn().mockResolvedValue({ ok: true }),
        getPPPoEUserProfile: jest.fn().mockResolvedValue({ ok: true, data: { profile: "ISOLIR" } }),
        getProfileBySubscription: jest.fn().mockReturnValue("10MBPS"),
        logger: { error: jest.fn() },
        ...overrides,
    };
}

const user = { id: 5, name: "Budi", subscription: "10 Mbps", pppoe_username: "budi01" };

beforeEach(() => {
    global.config = { isolir_profile: "ISOLIR" };
});

describe("settleTagihanPayment", () => {
    test("catat lunas ke ledger dengan param benar", async () => {
        const deps = makeDeps();
        const svc = createBillPaymentSettlement(deps);
        await svc.settleTagihanPayment({ user, amountPaid: 150000, periodMonth: 6, periodYear: 2026, paymentMethod: "VA", reffId: "r1" });
        expect(deps.applyPaymentStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            user, paid: true, periodMonth: 6, periodYear: 2026, amountPaid: 150000,
            paymentMethod: "VA", createdBy: "ipaymu.tagihan"
        }));
    });

    test("terisolir → reaktivasi ke profil subscription + disconnect", async () => {
        const deps = makeDeps();
        const svc = createBillPaymentSettlement(deps);
        const r = await svc.settleTagihanPayment({ user, amountPaid: 150000, periodMonth: 6, periodYear: 2026 });
        expect(deps.executeProfileAction).toHaveBeenCalledWith(user, expect.objectContaining({ targetProfile: "10MBPS", disconnect: true }));
        expect(r.reactivation).toMatchObject({ attempted: true, ok: true, targetProfile: "10MBPS" });
    });

    test("TIDAK terisolir (profil bukan isolir) → TIDAK reaktivasi (jangan putus pelanggan aktif)", async () => {
        const deps = makeDeps({ getPPPoEUserProfile: jest.fn().mockResolvedValue({ ok: true, data: { profile: "10MBPS" } }) });
        const svc = createBillPaymentSettlement(deps);
        const r = await svc.settleTagihanPayment({ user, amountPaid: 150000, periodMonth: 6, periodYear: 2026 });
        expect(deps.executeProfileAction).not.toHaveBeenCalled();
        expect(r.reactivation).toMatchObject({ attempted: false, reason: "not_isolated" });
    });

    test("reaktivasi gagal → lunas TETAP (tidak throw), reactivation.ok=false", async () => {
        const deps = makeDeps({ executeProfileAction: jest.fn().mockRejectedValue(new Error("MikroTik down")) });
        const svc = createBillPaymentSettlement(deps);
        const r = await svc.settleTagihanPayment({ user, amountPaid: 150000, periodMonth: 6, periodYear: 2026 });
        expect(r.ok).toBe(true);
        expect(deps.applyPaymentStatusChange).toHaveBeenCalled();
        expect(r.reactivation).toMatchObject({ attempted: true, ok: false, error: "MikroTik down" });
    });

    test("profil tak terbaca → tidak reaktivasi (aman), tandai perlu cek", async () => {
        const deps = makeDeps({ getPPPoEUserProfile: jest.fn().mockResolvedValue({ ok: false, message: "not found" }) });
        const svc = createBillPaymentSettlement(deps);
        const r = await svc.settleTagihanPayment({ user, amountPaid: 150000, periodMonth: 6, periodYear: 2026 });
        expect(deps.executeProfileAction).not.toHaveBeenCalled();
        expect(r.reactivation).toMatchObject({ attempted: false, reason: "profile_read_failed" });
    });

    test("tanpa pppoe_username → skip reaktivasi, lunas tetap tercatat", async () => {
        const deps = makeDeps();
        const svc = createBillPaymentSettlement(deps);
        const r = await svc.settleTagihanPayment({ user: { ...user, pppoe_username: null }, amountPaid: 150000, periodMonth: 6, periodYear: 2026 });
        expect(deps.applyPaymentStatusChange).toHaveBeenCalled();
        expect(deps.executeProfileAction).not.toHaveBeenCalled();
        expect(r.reactivation).toMatchObject({ attempted: false, reason: "no_pppoe" });
    });

    test("user tanpa id → throw (validasi)", async () => {
        const svc = createBillPaymentSettlement(makeDeps());
        await expect(svc.settleTagihanPayment({ user: {}, amountPaid: 1000 })).rejects.toThrow(/user wajib/);
    });

    // #b344 — markPaid menutup race retry webhook Tripay/Mayar (lock cleanup 30s < reaktivasi >30s).
    describe("markPaid (#b344)", () => {
        test("dipanggil SETELAH ledger & SEBELUM reaktivasi lambat", async () => {
            const order = [];
            const deps = makeDeps({
                applyPaymentStatusChange: jest.fn(async () => { order.push("ledger"); return { action: "marked_paid" }; }),
                executeProfileAction: jest.fn(async () => { order.push("reactivate"); return { ok: true }; }),
            });
            const svc = createBillPaymentSettlement(deps);
            const markPaid = jest.fn(() => order.push("markPaid"));
            await svc.settleTagihanPayment({ user, amountPaid: 150000, periodMonth: 6, periodYear: 2026, reffId: "r1", markPaid });
            expect(markPaid).toHaveBeenCalledTimes(1);
            expect(order).toEqual(["ledger", "markPaid", "reactivate"]);
        });

        test("markPaid melempar → settle TETAP sukses (best-effort)", async () => {
            const svc = createBillPaymentSettlement(makeDeps());
            const r = await svc.settleTagihanPayment({
                user, amountPaid: 150000, periodMonth: 6, periodYear: 2026,
                markPaid: () => { throw new Error("boom"); },
            });
            expect(r.ok).toBe(true);
        });

        test("ledger GAGAL → markPaid TIDAK dipanggil (lunas belum tercatat)", async () => {
            const deps = makeDeps({ applyPaymentStatusChange: jest.fn(async () => { throw new Error("ledger down"); }) });
            const svc = createBillPaymentSettlement(deps);
            const markPaid = jest.fn();
            await expect(svc.settleTagihanPayment({ user, amountPaid: 1, periodMonth: 6, periodYear: 2026, markPaid })).rejects.toThrow("ledger down");
            expect(markPaid).not.toHaveBeenCalled();
        });
    });
});
