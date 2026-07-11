/**
 * Header Doc
 * Purpose: Mengunci anti-spam bulk-approve: saat digest aktif, teknisi menerima SATU ringkasan
 *          (bukan N pesan per-item); saat digest mati, perilaku lama (per-item) dipertahankan.
 * Caller: jest.
 * Deps: `../payment-approval.service` dengan deps di-inject.
 * SideEffects: Menyetel global.* sementara.
 */
"use strict";

const { createPaymentApprovalService } = require("../payment-approval.service");

function makeDeps(overrides = {}) {
    return {
        loadJSON: jest.fn(),
        saveJSON: jest.fn(),
        applyPaymentStatusChange: jest.fn().mockResolvedValue({ action: "paid" }),
        handlePaidStatusChange: jest.fn().mockResolvedValue(),
        sendTechnicianNotification: jest.fn().mockResolvedValue(),
        sendTechnicianBulkSummary: jest.fn().mockResolvedValue(true),
        getPeriodParts: jest.fn().mockReturnValue({ periodMonth: 7, periodYear: 2026 }),
        getEffectivePrice: jest.fn().mockReturnValue(110000),
        normalizeUserPaymentMethod: jest.fn().mockReturnValue("CASH"),
        ...overrides
    };
}

function requestsFor(ids, teknisiId = 3) {
    return ids.map((id) => ({
        id, userId: id, status: "pending", newStatus: true,
        period_month: 7, period_year: 2026, amount_paid: 110000, amount_due: 110000,
        payment_method: "CASH", requested_by_teknisi_id: teknisiId
    }));
}

beforeEach(() => {
    global.users = [1, 2, 3].map((id) => ({ id, name: `User ${id}`, subscription: "PAKET-110K" }));
    global.accounts = [{ id: 3, name: "DAVIN", role: "teknisi", phone_number: "628999" }];
    global.db = {
        all: jest.fn((_s, cb) => cb(null, [{ name: "send_invoice" }])),
        run: jest.fn((_s, _p, cb) => cb(null))
    };
});
afterEach(() => { delete global.config; });

test("digest AKTIF: 3 approve → 1 ringkasan ke teknisi, NOL notif per-item", async () => {
    global.config = { paymentRequestDigest: { enabled: true } };
    const deps = makeDeps({ loadJSON: jest.fn().mockReturnValue(requestsFor([1, 2, 3])) });
    const service = createPaymentApprovalService(deps);

    await service.bulkApproveRequests({ requestIds: [1, 2, 3], actor: { username: "raf", role: "admin" } });

    expect(deps.sendTechnicianNotification).not.toHaveBeenCalled();
    expect(deps.sendTechnicianBulkSummary).toHaveBeenCalledTimes(1);
    const [teknisiId, items] = deps.sendTechnicianBulkSummary.mock.calls[0];
    expect(String(teknisiId)).toBe("3");
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.userName)).toEqual(["User 1", "User 2", "User 3"]);
});

test("digest MATI: perilaku lama — notif per-item, tanpa ringkasan", async () => {
    global.config = { paymentRequestDigest: { enabled: false } };
    const deps = makeDeps({ loadJSON: jest.fn().mockReturnValue(requestsFor([1, 2, 3])) });
    const service = createPaymentApprovalService(deps);

    await service.bulkApproveRequests({ requestIds: [1, 2, 3], actor: { username: "raf", role: "admin" } });

    expect(deps.sendTechnicianNotification).toHaveBeenCalledTimes(3);
    expect(deps.sendTechnicianBulkSummary).not.toHaveBeenCalled();
});

test("digest aktif, dua teknisi → satu ringkasan MASING-MASING", async () => {
    global.config = { paymentRequestDigest: { enabled: true } };
    global.accounts = [
        { id: 3, name: "DAVIN", role: "teknisi", phone_number: "628999" },
        { id: 4, name: "BUDI", role: "teknisi", phone_number: "628888" }
    ];
    const mixed = [...requestsFor([1, 2], 3), ...requestsFor([3], 4)];
    const deps = makeDeps({ loadJSON: jest.fn().mockReturnValue(mixed) });
    const service = createPaymentApprovalService(deps);

    await service.bulkApproveRequests({ requestIds: [1, 2, 3], actor: { username: "raf", role: "admin" } });

    expect(deps.sendTechnicianBulkSummary).toHaveBeenCalledTimes(2);
    const byTeknisi = Object.fromEntries(deps.sendTechnicianBulkSummary.mock.calls.map((c) => [String(c[0]), c[1].length]));
    expect(byTeknisi).toEqual({ "3": 2, "4": 1 });
});
