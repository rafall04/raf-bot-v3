"use strict";

const {
    createAdvancePaymentService,
    addMonths,
    formatPeriodLabel
} = require("../advance-payment-service");

function baseUser(overrides = {}) {
    return {
        id: 101,
        name: "Customer A",
        subscription: "Paket 150K",
        phone_number: "081234567890",
        ...overrides
    };
}

function makeDeps(overrides = {}) {
    return {
        getCurrentBillingPeriod: () => ({ periodMonth: 11, periodYear: 2026 }),
        getEffectivePrice: () => 150000,
        getPaymentPositionForPeriod: jest.fn(async () => ({ is_fully_paid: true })),
        applyPaymentStatusChange: jest.fn(async () => ({ action: "paid" })),
        renderTemplate: jest.fn(() => "STRUK"),
        sendMessage: jest.fn(async () => ({ sent: true })),
        isReady: () => true,
        normalizePhoneNumber: (n) => String(n).replace(/\D/g, "").replace(/^0/, "62"),
        logger: { error: jest.fn(), log: jest.fn() },
        ...overrides
    };
}

describe("addMonths helper", () => {
    test("menggeser bulan dengan benar di tahun yang sama", () => {
        expect(addMonths(1, 2026, 3)).toEqual({ periodMonth: 4, periodYear: 2026 });
    });

    test("melintasi batas tahun", () => {
        expect(addMonths(11, 2026, 3)).toEqual({ periodMonth: 2, periodYear: 2027 });
        expect(addMonths(12, 2026, 1)).toEqual({ periodMonth: 1, periodYear: 2027 });
    });

    test("formatPeriodLabel memberi label Indonesia", () => {
        expect(formatPeriodLabel(7, 2026)).toBe("Juli 2026");
    });
});

describe("recordAdvancePayment", () => {
    test("menolak bila tagihan periode berjalan belum lunas", async () => {
        const deps = makeDeps({
            getPaymentPositionForPeriod: jest.fn(async () => ({ is_fully_paid: false }))
        });
        const svc = createAdvancePaymentService(deps);

        const result = await svc.recordAdvancePayment({ user: baseUser(), months: 3 });

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("current_unpaid");
        expect(deps.applyPaymentStatusChange).not.toHaveBeenCalled();
    });

    test("mencatat N periode ke depan dengan rollover tahun yang benar", async () => {
        const deps = makeDeps();
        const svc = createAdvancePaymentService(deps);

        const result = await svc.recordAdvancePayment({ user: baseUser(), months: 3, createdBy: "owner" });

        expect(result.ok).toBe(true);
        expect(result.recorded).toHaveLength(3);
        expect(result.totalAmount).toBe(450000);
        // Current = Nov 2026 → Des 2026, Jan 2027, Feb 2027
        expect(result.recorded.map((p) => p.label)).toEqual([
            "Desember 2026", "Januari 2027", "Februari 2027"
        ]);
        expect(result.coverageUntil).toEqual({ periodMonth: 2, periodYear: 2027 });

        // Pelunasan dicatat sebagai CASH, tanpa onFinalPaid (tak ada revert isolir).
        const firstCall = deps.applyPaymentStatusChange.mock.calls[0][0];
        expect(firstCall.paymentMethod).toBe("CASH");
        expect(firstCall.onFinalPaid).toBeUndefined();
        expect(firstCall.periodMonth).toBe(12);
        expect(firstCall.periodYear).toBe(2026);
    });

    test("idempoten: periode yang sudah lunas masuk skipped, bukan recorded", async () => {
        const deps = makeDeps({
            applyPaymentStatusChange: jest.fn()
                .mockResolvedValueOnce({ action: "paid" })
                .mockResolvedValueOnce({ action: "no_change", reason: "already_fully_paid" })
        });
        const svc = createAdvancePaymentService(deps);

        const result = await svc.recordAdvancePayment({ user: baseUser(), months: 2 });

        expect(result.recorded).toHaveLength(1);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].reason).toBe("already_fully_paid");
        expect(result.totalAmount).toBe(150000);
    });

    test("validasi months di luar 1..12 melempar", async () => {
        const svc = createAdvancePaymentService(makeDeps());
        await expect(svc.recordAdvancePayment({ user: baseUser(), months: 0 })).rejects.toThrow();
        await expect(svc.recordAdvancePayment({ user: baseUser(), months: 13 })).rejects.toThrow();
    });
});

describe("sendAdvanceReceipt", () => {
    test("tidak mengirim bila tak ada periode yang baru tercatat", async () => {
        const deps = makeDeps();
        const svc = createAdvancePaymentService(deps);

        const res = await svc.sendAdvanceReceipt({
            user: baseUser(),
            summary: { recorded: [], skipped: [], totalAmount: 0, coverageUntil: { periodMonth: 12, periodYear: 2026 } }
        });

        expect(res.sent).toBe(false);
        expect(deps.sendMessage).not.toHaveBeenCalled();
    });

    test("mengirim satu struk ke nomor pelanggan (best-effort)", async () => {
        const deps = makeDeps();
        const svc = createAdvancePaymentService(deps);

        const res = await svc.sendAdvanceReceipt({
            user: baseUser(),
            summary: {
                recorded: [{ periodMonth: 12, periodYear: 2026, label: "Desember 2026", amount: 150000 }],
                skipped: [],
                totalAmount: 150000,
                coverageUntil: { periodMonth: 12, periodYear: 2026 }
            }
        });

        expect(res.sent).toBe(true);
        expect(deps.renderTemplate).toHaveBeenCalledWith("tagihan_prabayar_struk", expect.objectContaining({
            jumlah_bulan: 1,
            bebas_sampai: "Desember 2026"
        }));
        expect(deps.sendMessage).toHaveBeenCalledTimes(1);
        expect(deps.sendMessage.mock.calls[0][0]).toBe("6281234567890@s.whatsapp.net");
    });

    test("tidak melempar saat WA gagal — kembalikan sent:false", async () => {
        const deps = makeDeps({
            sendMessage: jest.fn(async () => { throw new Error("WA down"); })
        });
        const svc = createAdvancePaymentService(deps);

        const res = await svc.sendAdvanceReceipt({
            user: baseUser(),
            summary: {
                recorded: [{ periodMonth: 12, periodYear: 2026, label: "Desember 2026", amount: 150000 }],
                skipped: [],
                totalAmount: 150000,
                coverageUntil: { periodMonth: 12, periodYear: 2026 }
            }
        });

        expect(res.sent).toBe(false);
        expect(res.reason).toBe("send_error");
    });
});
