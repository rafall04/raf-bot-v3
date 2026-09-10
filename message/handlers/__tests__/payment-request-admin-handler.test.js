/**
 * Header Doc
 * Purpose: Guard BAGIAN 2 — otorisasi pembayaran via WA. parsePayreqCommand (list/approve/reject/
 *   nomor/kode RPQ/quote/approve_all) + handler flow (gate admin, approve single via bulkApproveRequests,
 *   reject set 'rejected', approve_all → prompt; job latar aktif → enqueue).
 * Caller: Jest.
 * Deps: ../payment-request-admin-handler (deps di-inject via ctx).
 * SideEffects: -
 */
"use strict";

const H = require("../payment-request-admin-handler");

describe("parsePayreqCommand", () => {
    test("daftar & borongan", () => {
        expect(H.parsePayreqCommand("otorisasi")).toEqual({ action: "list" });
        expect(H.parsePayreqCommand("pengagajuan")).toBeNull();
        expect(H.parsePayreqCommand("setujui semua")).toEqual({ action: "approve_all" });
    });
    test("kode RPQ + nomor + reject alasan", () => {
        expect(H.parsePayreqCommand("setujui RPQ-1789")).toEqual({ action: "approve", id: "1789" });
        expect(H.parsePayreqCommand("tolak RPQ-1789 nominal kurang")).toEqual({ action: "reject", id: "1789", reason: "nominal kurang" });
        expect(H.parsePayreqCommand("setujui 2")).toEqual({ action: "approve", index: 2 });
        expect(H.parsePayreqCommand("tolak 3 salah orang")).toEqual({ action: "reject", index: 3, reason: "salah orang" });
    });
    test("balasan ter-quote (RPQ di quoted) → sasaran pasti", () => {
        expect(H.parsePayreqCommand("ok", "ID Request: #RPQ-555 ...")).toEqual({ action: "approve", id: "555" });
        expect(H.parsePayreqCommand("tolak salah", "RPQ-555")).toEqual({ action: "reject", id: "555", reason: "salah" });
    });
    test("bukan perintah → null", () => {
        expect(H.parsePayreqCommand("halo bot")).toBeNull();
        expect(H.parsePayreqCommand("")).toBeNull();
    });
});

function mkCtx(over = {}) {
    return {
        chats: "",
        msg: {},
        reply: jest.fn(async () => {}),
        resolveStaffRole: () => "admin",
        setUserState: jest.fn(),
        stateSender: "62811@s.whatsapp.net",
        db: { loadJSON: jest.fn(() => []), saveJSON: jest.fn() },
        ...over,
    };
}

describe("handlePaymentRequestAdminDecision — gate & flow", () => {
    test("non-admin → handled:false (fitur tak bocor)", async () => {
        const ctx = mkCtx({ chats: "otorisasi", resolveStaffRole: () => "teknisi" });
        const r = await H.handlePaymentRequestAdminDecision(ctx);
        expect(r.handled).toBe(false);
        expect(ctx.reply).not.toHaveBeenCalled();
    });

    test("otorisasi + antrian kosong → pesan bersih", async () => {
        const ctx = mkCtx({ chats: "otorisasi", db: { loadJSON: () => [], saveJSON: jest.fn() } });
        const r = await H.handlePaymentRequestAdminDecision(ctx);
        expect(r.handled).toBe(true);
        expect(ctx.reply.mock.calls[0][0]).toMatch(/Bersih|Tidak ada/i);
    });

    test("setujui RPQ-<id> → bulkApproveRequests([id]) dipanggil, balas OK", async () => {
        const bulk = jest.fn(async () => ({ results: { approved: [{ id: "1789", userName: "Budi" }], failed: [], notFound: [] } }));
        const ctx = mkCtx({
            chats: "setujui RPQ-1789",
            approvalService: { bulkApproveRequests: bulk },
            db: { loadJSON: () => [], saveJSON: jest.fn() },
        });
        const r = await H.handlePaymentRequestAdminDecision(ctx);
        expect(r.handled).toBe(true);
        expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ requestIds: ["1789"] }));
        expect(ctx.reply.mock.calls[0][0]).toMatch(/disetujui.*LUNAS|RPQ-1789/i);
    });

    test("tolak RPQ-<id> → set status 'rejected' di store (tanpa ledger)", async () => {
        const store = [{ id: 1789, userName: "Budi", status: "pending" }];
        const saveJSON = jest.fn();
        const ctx = mkCtx({
            chats: "tolak RPQ-1789 nominal kurang",
            db: { loadJSON: () => store.map((x) => ({ ...x })), saveJSON },
        });
        const r = await H.handlePaymentRequestAdminDecision(ctx);
        expect(r.handled).toBe(true);
        expect(saveJSON).toHaveBeenCalled();
        const written = saveJSON.mock.calls[0][1];
        expect(written.find((x) => String(x.id) === "1789").status).toBe("rejected");
    });

    test("setujui semua → prompt penegasan (state PAYREQ_CONFIRM_ALL), belum eksekusi", async () => {
        const bulk = jest.fn();
        const ctx = mkCtx({
            chats: "setujui semua",
            approvalService: { bulkApproveRequests: bulk },
            db: { loadJSON: () => [{ id: 1, userName: "A", status: "pending", period_month: 9, period_year: 2026 }], saveJSON: jest.fn() },
        });
        const r = await H.handlePaymentRequestAdminDecision(ctx);
        expect(r.handled).toBe(true);
        expect(ctx.setUserState).toHaveBeenCalledWith("62811@s.whatsapp.net", expect.objectContaining({ step: "PAYREQ_CONFIRM_ALL" }));
        expect(bulk).not.toHaveBeenCalled(); // belum dieksekusi sebelum `ya`
    });
});

describe("approveAll — job latar vs sinkron", () => {
    test("job latar aktif → enqueue (tak loop sinkron)", async () => {
        const enqueue = jest.fn(async () => ({ ok: true, antre: 3 }));
        const ctx = mkCtx({
            approvalService: { bulkApproveRequests: jest.fn() },
            jobService: { aktif: () => true, enqueueBulkApproval: enqueue },
            db: { loadJSON: () => [{ id: 1, status: "pending" }, { id: 2, status: "pending" }], saveJSON: jest.fn() },
        });
        await H.approveAll(ctx);
        expect(enqueue).toHaveBeenCalled();
        expect(ctx.reply.mock.calls[0][0]).toMatch(/latar|menyusul/i);
    });
});
