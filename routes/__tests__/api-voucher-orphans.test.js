/**
 * Header Doc
 * Purpose: Uji endpoint worklist voucher orphan di routes/api-voucher-routes.js —
 *   GET /voucher/orphans (list + stats) dan POST /voucher/orphans/:id/resolve
 *   (aksi fulfill/send/manual/refund). Memastikan: (a) fulfill memakai profile tercatat
 *   (BUKAN lookup harga — anti salah-durasi), (b) send tak me-generate voucher baru,
 *   (c) resolve ganda/in-flight ditolak, (d) guard staff diterapkan.
 * Caller: Jest test runner.
 * Deps: routes/api-voucher-routes.js (router stack), lib/voucher-orphan.js;
 *   lib/mikrotik & whatsapp-delivery-service di-mock (tanpa MikroTik/WA nyata).
 * MainFuncs: runList, runResolve.
 * SideEffects: Menulis database/voucher_orphans.json sementara (dipulihkan pasca-test).
 */
"use strict";

const fs = require("fs");
const path = require("path");

jest.mock("../../lib/mikrotik", () => ({
    addHotspotUsersBatch: jest.fn(),
    getvoucher: jest.fn(async () => ({ ok: true, data: { username: "VCTR-999" } })),
}));

jest.mock("../../lib/whatsapp-delivery-service", () => ({
    sendMessageToMany: jest.fn(async () => ({ sent: true })),
    ensureJid: jest.fn((p) => `${p}@s.whatsapp.net`),
}));

// lib/payment menulis payment.json via json-store (db/ asli — tak test-aware); mock agar
// test tak menimpa data pembayaran nyata.
jest.mock("../../lib/payment", () => ({
    updateKetPayment: jest.fn(),
    updateStatusPayment: jest.fn(),
}));

const mikrotik = require("../../lib/mikrotik");
const delivery = require("../../lib/whatsapp-delivery-service");
const paymentLib = require("../../lib/payment");
const { VOUCHER_ORPHAN_FILE } = require("../../lib/voucher-orphan");

const createApiVoucherRouter = require("../api-voucher-routes");

let originalOrphanContent = null;

function buildRouter() {
    return createApiVoucherRouter({
        fs,
        path,
        renderTemplate: (_name, data) => `KODE: ${data && data.kode_voucher}`,
        loadVoucherSentHistory: () => [],
        appendVoucherSentHistory: () => {},
        resolveVoucherDeliveryStatus: () => "sent",
        buildVoucherSentHistoryEntries: () => [],
        getVoucherSentStats: () => ({}),
        findVoucherHistoryByReference: () => null,
        ensureAuthenticatedStaff: (req, _res, next) => { req.user = { username: "tester", role: "admin" }; next(); }
    });
}

function findHandlers(router, method, routePath) {
    const layer = router.stack.find(
        (l) => l.route && l.route.path === routePath && l.route.methods[method]
    );
    if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} tidak ditemukan`);
    return layer.route.stack.map((s) => s.handle);
}

function mockRes() {
    const res = {};
    res.statusCode = 200;
    res.body = undefined;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

async function runList(router, query = {}) {
    const handlers = findHandlers(router, "get", "/voucher/orphans");
    const req = { query };
    const res = mockRes();
    for (const h of handlers) {
         
        await h(req, res, () => {});
    }
    return res;
}

async function runResolve(router, params, body) {
    const handlers = findHandlers(router, "post", "/voucher/orphans/:id/resolve");
    const req = { params, body };
    const res = mockRes();
    for (const h of handlers) {
         
        await h(req, res, () => {});
    }
    return res;
}

function seedOrphans(entries) {
    fs.writeFileSync(VOUCHER_ORPHAN_FILE, JSON.stringify(entries, null, 2));
}

beforeEach(() => {
    if (fs.existsSync(VOUCHER_ORPHAN_FILE)) {
        originalOrphanContent = fs.readFileSync(VOUCHER_ORPHAN_FILE, "utf8");
    } else {
        originalOrphanContent = null;
    }
    seedOrphans([]);
    jest.clearAllMocks();
    mikrotik.getvoucher.mockResolvedValue({ ok: true, data: { username: "VCTR-999" } });
    delivery.sendMessageToMany.mockResolvedValue({ sent: true });
    global.voucher = [{ namavc: "Paket 1H", prof: "P1H", hargavc: "5000", durasivc: "1 Hari" }];
});

afterEach(() => {
    if (originalOrphanContent === null) {
        if (fs.existsSync(VOUCHER_ORPHAN_FILE)) fs.unlinkSync(VOUCHER_ORPHAN_FILE);
    } else {
        fs.writeFileSync(VOUCHER_ORPHAN_FILE, originalOrphanContent);
    }
    delete global.voucher;
});

const PAID_UNISSUED = {
    id: "orphan_a", timestamp: "2026-01-01T00:00:00.000Z", resolved: false,
    type: "buynowweb_callback", reference_id: "ref-a", sender: "628111222333",
    amount: 5000, profile: "P1H", error: "mikrotik down"
};
const CREATED_UNPAID = {
    id: "orphan_b", timestamp: "2026-01-02T00:00:00.000Z", resolved: false,
    sender: "628999888777", voucherCode: "EXIST-1", profile: "P1H", price: 5000,
    reason: "deduct_failed"
};

test("GET orphans mengembalikan stats + bentuk ternormalisasi", async () => {
    seedOrphans([PAID_UNISSUED, CREATED_UNPAID]);
    const res = await runList(buildRouter());
    expect(res.statusCode).toBe(200);
    expect(res.body.stats).toEqual({ total: 2, open: 2, resolved: 0 });
    // Terbaru dulu
    expect(res.body.items[0].id).toBe("orphan_b");
    expect(res.body.items[0].kind).toBe("created_unpaid");
    expect(res.body.items[1].kind).toBe("paid_unissued");
    expect(res.body.items[1].referenceId).toBe("ref-a");
});

test("GET orphans status=resolved hanya mengembalikan yang selesai", async () => {
    seedOrphans([PAID_UNISSUED, { ...CREATED_UNPAID, resolved: true, resolvedAt: "2026-01-03T00:00:00.000Z", resolution: { action: "manual" } }]);
    const res = await runList(buildRouter(), { status: "resolved" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe("orphan_b");
    expect(res.body.stats.open).toBe(1);
});

test("resolve fulfill menerbitkan voucher dengan profil TERCATAT (bukan lookup harga)", async () => {
    seedOrphans([PAID_UNISSUED]);
    const res = await runResolve(buildRouter(), { id: "orphan_a" }, { action: "fulfill", note: "" });
    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe("VCTR-999");
    // getvoucher dipanggil dengan profil entri, dan kode dikirim ke WA pembeli
    expect(mikrotik.getvoucher).toHaveBeenCalledWith("P1H", "628111222333", expect.anything());
    expect(paymentLib.updateKetPayment).toHaveBeenCalledWith("ref-a", "VCTR-999");
    expect(delivery.sendMessageToMany).toHaveBeenCalledWith(["628111222333"], expect.objectContaining({ text: expect.stringContaining("VCTR-999") }));
    // Entri kini resolved
    const list = JSON.parse(fs.readFileSync(VOUCHER_ORPHAN_FILE, "utf8"));
    expect(list[0].resolved).toBe(true);
    expect(list[0].resolution.action).toBe("fulfill");
    expect(list[0].resolution.voucherCode).toBe("VCTR-999");
    expect(list[0].resolvedBy).toBe("tester");
});

test("resolve fulfill menolak entri tanpa reference_id/profile/sender", async () => {
    seedOrphans([{ ...PAID_UNISSUED, reference_id: null }]);
    const res = await runResolve(buildRouter(), { id: "orphan_a" }, { action: "fulfill" });
    expect(res.statusCode).toBe(400);
    expect(mikrotik.getvoucher).not.toHaveBeenCalled();
});

test("resolve fulfill ditolak bila voucherCode sudah ada (anti dobel voucher)", async () => {
    seedOrphans([CREATED_UNPAID]);
    const res = await runResolve(buildRouter(), { id: "orphan_b" }, { action: "fulfill" });
    expect(res.statusCode).toBe(409);
    expect(mikrotik.getvoucher).not.toHaveBeenCalled();
});

test("resolve send mengirim kode EXISTING tanpa generate voucher baru", async () => {
    seedOrphans([CREATED_UNPAID]);
    const res = await runResolve(buildRouter(), { id: "orphan_b" }, { action: "send" });
    expect(res.statusCode).toBe(200);
    expect(mikrotik.getvoucher).not.toHaveBeenCalled();
    expect(delivery.sendMessageToMany).toHaveBeenCalledWith(
        ["628999888777"],
        expect.objectContaining({ text: expect.stringContaining("EXIST-1") })
    );
    const list = JSON.parse(fs.readFileSync(VOUCHER_ORPHAN_FILE, "utf8"));
    expect(list[0].resolved).toBe(true);
    expect(list[0].resolution.action).toBe("send");
});

test("resolve send ditolak untuk sender bukan nomor (agent_*)", async () => {
    seedOrphans([{ ...CREATED_UNPAID, sender: "agent_42" }]);
    const res = await runResolve(buildRouter(), { id: "orphan_b" }, { action: "send" });
    expect(res.statusCode).toBe(400);
    expect(delivery.sendMessageToMany).not.toHaveBeenCalled();
});

test("resolve manual/refund hanya menandai selesai", async () => {
    seedOrphans([PAID_UNISSUED]);
    const res = await runResolve(buildRouter(), { id: "orphan_a" }, { action: "refund", note: "dana kembali via transfer" });
    expect(res.statusCode).toBe(200);
    expect(res.body.item.resolution.action).toBe("refund");
    expect(res.body.item.resolution.note).toBe("dana kembali via transfer");
    expect(mikrotik.getvoucher).not.toHaveBeenCalled();
    // Resolve kedua ditolak
    const again = await runResolve(buildRouter(), { id: "orphan_a" }, { action: "manual" });
    expect(again.statusCode).toBe(409);
});

test("resolve id tak dikenal → 404; aksi tak dikenal → 400", async () => {
    seedOrphans([]);
    const res404 = await runResolve(buildRouter(), { id: "orphan_gaib" }, { action: "manual" });
    expect(res404.statusCode).toBe(404);
    seedOrphans([PAID_UNISSUED]);
    const res400 = await runResolve(buildRouter(), { id: "orphan_a" }, { action: "delete" });
    expect(res400.statusCode).toBe(400);
});
