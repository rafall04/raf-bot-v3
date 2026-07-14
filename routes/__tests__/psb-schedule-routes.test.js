/**
 * Header Doc
 * Purpose: Guardrail test router API papan PSB (`/api/psb-schedule`) — kontrak WEB harus SAMA
 *          dengan WA `#jadwal`: identitas + 3 BUKTI wajib (foto KTP, foto rumah, koordinat).
 *          Menjaga validasi & guard staf (ensureStaff) tak longgar diam-diam.
 * Caller: Jest test runner.
 * Deps: `../psb-schedule-routes`, mock `../../lib/psb-schedule-service` + `../../message/handlers/psb-caption-parser`.
 * MainFuncs: create (201) + tolak bukti kurang (400) + guard non-staf (403) + summary/list read-model.
 * SideEffects: Tidak ada (service di-mock; notif grup di-skip krn global.config kosong).
 */
"use strict";

jest.mock("../../lib/psb-schedule-service", () => ({
    createRequest: jest.fn(),
    getScheduleSummary: jest.fn(),
    listSchedules: jest.fn(),
    buildScheduleGroupNotif: jest.fn(() => "notif"),
    assignSchedule: jest.fn(),
    buildAssignmentDm: jest.fn(() => "dm"),
    buildAssignmentGroupNotif: jest.fn(() => "gnotif"),
    setMarketing: jest.fn(),
    payMarketingExternal: jest.fn(),
    getMarketingReport: jest.fn()
}));
jest.mock("../../lib/expense-manager", () => ({ createExpense: jest.fn(async () => ({ id: 1 })) }));
jest.mock("../../message/handlers/psb-caption-parser", () => ({
    resolvePackage: jest.fn()
}));
jest.mock("../../lib/jid-utils", () => ({
    normalizePhoneToJid: jest.fn((p) => (p ? `${p}@s.whatsapp.net` : null))
}));
jest.mock("../../message/handlers/reply-runtime", () => ({
    sendReply: jest.fn(async () => {})
}));

const express = require("express");
const http = require("http");
const scheduleService = require("../../lib/psb-schedule-service");
const { resolvePackage } = require("../../message/handlers/psb-caption-parser");
const createPsbScheduleRouter = require("../psb-schedule-routes");

function createApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use(createPsbScheduleRouter());
    return app;
}

async function startServer(app) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}
async function stopServer(server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

const ADMIN = { id: 7, username: "raf", name: "Raf", role: "admin" };
const VALID_BODY = {
    nama: "Budi",
    hp: "081234567890",
    dusun: "Krajan",
    paket: "110rb",
    latitude: -7.12,
    longitude: 111.45,
    ktp_photo_path: "/uploads/psb/2026/07/x/ktp_photo.jpg",
    house_photo_path: "/uploads/psb/2026/07/x/house_photo.jpg"
};

async function post(baseUrl, body) {
    const r = await fetch(`${baseUrl}/psb-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    return { status: r.status, payload: await r.json() };
}

describe("psb-schedule routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resolvePackage.mockImplementation((p) => (p === "110rb" ? "PAKET-110K" : null));
        global.packages = [{ name: "PAKET-110K" }];
        delete global.config; // matikan notif grup — isolasi dari reply-runtime
    });
    afterAll(() => {
        delete global.packages;
    });

    test("POST valid (identitas + 3 bukti) → 201, createRequest dgn paket ter-resolve + koordinat", async () => {
        scheduleService.createRequest.mockResolvedValue({ id: 1, ref: "PSB-1", name: "Budi", dusun: "Krajan", paket: "PAKET-110K", status: "menunggu" });
        const app = createApp(ADMIN);
        const { server, baseUrl } = await startServer(app);
        try {
            const { status, payload } = await post(baseUrl, VALID_BODY);
            expect(status).toBe(201);
            expect(payload.data.ref).toBe("PSB-1");
            const arg = scheduleService.createRequest.mock.calls[0][0];
            expect(arg.paket).toBe("PAKET-110K");
            expect(arg.latitude).toBe(-7.12);
            expect(arg.longitude).toBe(111.45);
            expect(arg.ktpPhotoPath).toBe(VALID_BODY.ktp_photo_path);
            expect(arg.housePhotoPath).toBe(VALID_BODY.house_photo_path);
        } finally {
            await stopServer(server);
        }
    });

    test("POST tanpa foto KTP → 400 dan createRequest tak dipanggil", async () => {
        const app = createApp(ADMIN);
        const { server, baseUrl } = await startServer(app);
        try {
            const { status, payload } = await post(baseUrl, { ...VALID_BODY, ktp_photo_path: undefined });
            expect(status).toBe(400);
            expect(payload.message).toMatch(/KTP/i);
            expect(scheduleService.createRequest).not.toHaveBeenCalled();
        } finally {
            await stopServer(server);
        }
    });

    test("POST tanpa koordinat → 400 (share lokasi wajib)", async () => {
        const app = createApp(ADMIN);
        const { server, baseUrl } = await startServer(app);
        try {
            const { status, payload } = await post(baseUrl, { ...VALID_BODY, latitude: undefined, longitude: undefined });
            expect(status).toBe(400);
            expect(payload.message).toMatch(/lokasi/i);
        } finally {
            await stopServer(server);
        }
    });

    test("POST paket tak dikenal → 400", async () => {
        const app = createApp(ADMIN);
        const { server, baseUrl } = await startServer(app);
        try {
            const { status } = await post(baseUrl, { ...VALID_BODY, paket: "ngawur" });
            expect(status).toBe(400);
            expect(scheduleService.createRequest).not.toHaveBeenCalled();
        } finally {
            await stopServer(server);
        }
    });

    test("POST oleh non-staf (customer) → 403", async () => {
        const app = createApp({ id: 9, role: "customer" });
        const { server, baseUrl } = await startServer(app);
        try {
            const { status } = await post(baseUrl, VALID_BODY);
            expect(status).toBe(403);
            expect(scheduleService.createRequest).not.toHaveBeenCalled();
        } finally {
            await stopServer(server);
        }
    });

    test("GET /psb-schedule/summary → payload service", async () => {
        scheduleService.getScheduleSummary.mockResolvedValue({ menunggu: 2, ditugaskan: 1, belum_kepasang: 3, terpasang_bulan_ini: 5 });
        const app = createApp(ADMIN);
        const { server, baseUrl } = await startServer(app);
        try {
            const r = await fetch(`${baseUrl}/psb-schedule/summary`);
            const payload = await r.json();
            expect(r.status).toBe(200);
            expect(payload.data.belum_kepasang).toBe(3);
            expect(payload.data.terpasang_bulan_ini).toBe(5);
        } finally {
            await stopServer(server);
        }
    });

    test("GET /psb-schedule → list dari service (teruskan filter status)", async () => {
        scheduleService.listSchedules.mockResolvedValue([{ id: 1, ref: "PSB-1", status: "menunggu" }]);
        const app = createApp(ADMIN);
        const { server, baseUrl } = await startServer(app);
        try {
            const r = await fetch(`${baseUrl}/psb-schedule?status=menunggu`);
            const payload = await r.json();
            expect(r.status).toBe(200);
            expect(payload.data).toHaveLength(1);
            expect(scheduleService.listSchedules).toHaveBeenCalledWith({ status: "menunggu" });
        } finally {
            await stopServer(server);
        }
    });
});

const TEKNISI = { id: 3, username: "davin", name: "DAVIN", role: "teknisi" };
const { sendReply } = require("../../message/handlers/reply-runtime");

describe("psb-schedule assignment routes (Fase B)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.accounts = [
            { id: 3, name: "DAVIN", username: "davin", role: "teknisi", phone_number: "628111" },
            { id: 4, name: "IVAN", username: "ivan", role: "teknisi", phone_number: "628222" },
            { id: 1, name: "Aldi", username: "aldi", role: "admin", phone_number: "628999" }
        ];
        global.config = { psbIntake: { summaryGroupId: "group@g.us" } };
    });
    afterAll(() => { delete global.accounts; delete global.config; });

    async function postJson(baseUrl, pathname, body) {
        const r = await fetch(`${baseUrl}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
        return { status: r.status, payload: await r.json() };
    }

    test("GET /psb-schedule/teknisi → hanya akun role teknisi (id+name)", async () => {
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const r = await fetch(`${baseUrl}/psb-schedule/teknisi`);
            const payload = await r.json();
            expect(r.status).toBe(200);
            expect(payload.data).toEqual([{ id: 3, name: "DAVIN" }, { id: 4, name: "IVAN" }]);
        } finally { await stopServer(server); }
    });

    test("POST /:id/assign oleh admin → 200, assignSchedule mode=assign + DM teknisi + notif grup", async () => {
        scheduleService.assignSchedule.mockResolvedValue({ ok: true, mode: "assign", record: { id: 5, ref: "PSB-5", assigned_teknisi_name: "IVAN", phone_number: "628222" } });
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const { status, payload } = await postJson(baseUrl, "/psb-schedule/5/assign", { teknisiId: 4 });
            expect(status).toBe(200);
            expect(payload.data.ref).toBe("PSB-5");
            const arg = scheduleService.assignSchedule.mock.calls[0][0];
            expect(arg.teknisiId).toBe(4);
            expect(arg.teknisiName).toBe("IVAN");
            expect(arg.mode).toBe("assign");
            expect(sendReply).toHaveBeenCalledTimes(2); // DM teknisi + notif grup
        } finally { await stopServer(server); }
    });

    test("POST /:id/assign oleh TEKNISI → 403 (hanya admin yang menugaskan)", async () => {
        const { server, baseUrl } = await startServer(createApp(TEKNISI));
        try {
            const { status } = await postJson(baseUrl, "/psb-schedule/5/assign", { teknisiId: 4 });
            expect(status).toBe(403);
            expect(scheduleService.assignSchedule).not.toHaveBeenCalled();
        } finally { await stopServer(server); }
    });

    test("POST /:id/assign teknisiId tak dikenal → 400", async () => {
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const { status } = await postJson(baseUrl, "/psb-schedule/5/assign", { teknisiId: 99 });
            expect(status).toBe(400);
            expect(scheduleService.assignSchedule).not.toHaveBeenCalled();
        } finally { await stopServer(server); }
    });

    test("POST /:id/assign service not_found → 404; already_installed → 409", async () => {
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            scheduleService.assignSchedule.mockResolvedValueOnce({ ok: false, reason: "not_found" });
            expect((await postJson(baseUrl, "/psb-schedule/9/assign", { teknisiId: 4 })).status).toBe(404);
            scheduleService.assignSchedule.mockResolvedValueOnce({ ok: false, reason: "already_installed" });
            expect((await postJson(baseUrl, "/psb-schedule/9/assign", { teknisiId: 4 })).status).toBe(409);
        } finally { await stopServer(server); }
    });

    test("POST /:id/claim oleh teknisi → 200, mode=claim (self) + notif", async () => {
        scheduleService.assignSchedule.mockResolvedValue({ ok: true, mode: "claim", record: { id: 6, ref: "PSB-6", assigned_teknisi_name: "DAVIN" } });
        const { server, baseUrl } = await startServer(createApp(TEKNISI));
        try {
            const { status, payload } = await postJson(baseUrl, "/psb-schedule/6/claim", {});
            expect(status).toBe(200);
            expect(payload.data.ref).toBe("PSB-6");
            const arg = scheduleService.assignSchedule.mock.calls[0][0];
            expect(arg.teknisiId).toBe(3);
            expect(arg.mode).toBe("claim");
            expect(sendReply).toHaveBeenCalled(); // minimal notif grup (DM ke diri sendiri bila punya nomor)
        } finally { await stopServer(server); }
    });

    test("POST /:id/claim jadwal sudah dipegang teknisi lain → 409 (anti-serobot)", async () => {
        scheduleService.assignSchedule.mockResolvedValue({ ok: false, reason: "already_assigned" });
        const { server, baseUrl } = await startServer(createApp(TEKNISI));
        try {
            const { status, payload } = await postJson(baseUrl, "/psb-schedule/6/claim", {});
            expect(status).toBe(409);
            expect(payload.message).toMatch(/teknisi lain/i);
        } finally { await stopServer(server); }
    });
});

describe("psb-schedule marketing routes (Fase 1 komisi)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.accounts = [
            { id: 3, name: "DAVIN", username: "davin", role: "teknisi", phone_number: "628111" },
            { id: 1, name: "Aldi", username: "aldi", role: "admin", phone_number: "628999" }
        ];
        global.config = { psbIntake: {} };
    });
    afterAll(() => { delete global.accounts; delete global.config; });

    async function postJson(baseUrl, pathname, body) {
        const r = await fetch(`${baseUrl}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
        return { status: r.status, payload: await r.json() };
    }

    test("admin set type=luar + fee → 200, setMarketing dgn payload ternormalisasi", async () => {
        scheduleService.setMarketing.mockResolvedValue({ ok: true, record: { id: 5, ref: "PSB-5", marketing_type: "luar", marketing_fee: 50000, marketing_status: "pending" } });
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const { status, payload } = await postJson(baseUrl, "/psb-schedule/5/marketing", { marketing_type: "luar", marketing_ref_name: "Makelar A", marketing_ref_phone: "0811", marketing_fee: 50000 });
            expect(status).toBe(200);
            expect(payload.data.marketing_status).toBe("pending");
            const arg = scheduleService.setMarketing.mock.calls[0];
            expect(arg[0]).toBe("5");
            expect(arg[1]).toMatchObject({ type: "luar", refName: "Makelar A", fee: 50000 });
        } finally { await stopServer(server); }
    });

    test("admin set type=teknisi → nama & HP di-resolve dari akun teknisi", async () => {
        scheduleService.setMarketing.mockResolvedValue({ ok: true, record: { id: 6, ref: "PSB-6" } });
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const { status } = await postJson(baseUrl, "/psb-schedule/6/marketing", { marketing_type: "teknisi", marketing_ref_id: 3, marketing_fee: 20000 });
            expect(status).toBe(200);
            const payload = scheduleService.setMarketing.mock.calls[0][1];
            expect(payload.type).toBe("teknisi");
            expect(payload.refName).toBe("DAVIN");        // di-resolve dari akun
            expect(payload.refPhone).toBe("628111");
        } finally { await stopServer(server); }
    });

    test("non-admin (teknisi) → 403 (komisi = uang, admin saja)", async () => {
        const { server, baseUrl } = await startServer(createApp(TEKNISI));
        try {
            const { status } = await postJson(baseUrl, "/psb-schedule/5/marketing", { marketing_type: "luar", marketing_ref_name: "X", marketing_fee: 1000 });
            expect(status).toBe(403);
            expect(scheduleService.setMarketing).not.toHaveBeenCalled();
        } finally { await stopServer(server); }
    });

    test("type tak valid → 400; type=luar tanpa nama → 400; type=teknisi id ngawur → 400", async () => {
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            expect((await postJson(baseUrl, "/psb-schedule/5/marketing", { marketing_type: "ngawur" })).status).toBe(400);
            expect((await postJson(baseUrl, "/psb-schedule/5/marketing", { marketing_type: "luar", marketing_fee: 1000 })).status).toBe(400);
            expect((await postJson(baseUrl, "/psb-schedule/5/marketing", { marketing_type: "teknisi", marketing_ref_id: 999 })).status).toBe(400);
            expect(scheduleService.setMarketing).not.toHaveBeenCalled();
        } finally { await stopServer(server); }
    });

    test("fee bukan angka ≥ 0 → 400", async () => {
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const { status } = await postJson(baseUrl, "/psb-schedule/5/marketing", { marketing_type: "luar", marketing_ref_name: "X", marketing_fee: -5 });
            expect(status).toBe(400);
        } finally { await stopServer(server); }
    });

    // ── Fase 3: laporan komisi per pemberi lead ──
    test("GET /marketing-report (admin) → 200 + data; teruskan month/year", async () => {
        scheduleService.getMarketingReport.mockResolvedValue({ summary: [{ name: "Rudi", total_fee: 50000 }], entries: [], totals: { total_fee: 50000, count: 2 } });
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const r = await fetch(`${baseUrl}/psb-schedule/marketing-report?month=7&year=2026`, { credentials: "include" });
            const payload = await r.json();
            expect(r.status).toBe(200);
            expect(payload.data.totals.total_fee).toBe(50000);
            expect(scheduleService.getMarketingReport).toHaveBeenCalledWith({ month: 7, year: 2026 });
        } finally { await stopServer(server); }
    });

    test("GET /marketing-report non-admin (teknisi) → 403", async () => {
        const { server, baseUrl } = await startServer(createApp(TEKNISI));
        try {
            const r = await fetch(`${baseUrl}/psb-schedule/marketing-report`, { credentials: "include" });
            expect(r.status).toBe(403);
            expect(scheduleService.getMarketingReport).not.toHaveBeenCalled();
        } finally { await stopServer(server); }
    });

    test("service already_paid → 409 (terkunci); not_found → 404", async () => {
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            scheduleService.setMarketing.mockResolvedValueOnce({ ok: false, reason: "already_paid" });
            expect((await postJson(baseUrl, "/psb-schedule/5/marketing", { marketing_type: "none" })).status).toBe(409);
            scheduleService.setMarketing.mockResolvedValueOnce({ ok: false, reason: "not_found" });
            expect((await postJson(baseUrl, "/psb-schedule/9/marketing", { marketing_type: "none" })).status).toBe(404);
        } finally { await stopServer(server); }
    });

    test("create teruskan pemberi lead (marketing_ref_name) ke createRequest", async () => {
        scheduleService.createRequest.mockResolvedValue({ id: 1, ref: "PSB-1", name: "Budi", status: "menunggu" });
        resolvePackage.mockImplementation((p) => (p === "110rb" ? "PAKET-110K" : null));
        global.packages = [{ name: "PAKET-110K" }];
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const r = await fetch(`${baseUrl}/psb-schedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...VALID_BODY, marketing_ref_name: "Pak Broker" }) });
            expect(r.status).toBe(201);
            const arg = scheduleService.createRequest.mock.calls[0][0];
            expect(arg.marketing).toMatchObject({ refName: "Pak Broker" });
        } finally { await stopServer(server); delete global.packages; }
    });

    // ── Fase 2a: POST /:id/marketing/pay (bayar komisi luar via kas) ──
    test("admin bayar komisi luar → 200, payMarketingExternal dipanggil dgn createExpense di-inject", async () => {
        scheduleService.payMarketingExternal.mockResolvedValue({ ok: true, expenseId: "1", record: { id: 5, ref: "PSB-5", marketing_status: "paid" } });
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            const { status, payload } = await postJson(baseUrl, "/psb-schedule/5/marketing/pay", {});
            expect(status).toBe(200);
            expect(payload.data.marketing_status).toBe("paid");
            const arg = scheduleService.payMarketingExternal.mock.calls[0];
            expect(arg[0]).toBe("5");
            expect(typeof arg[1].createExpense).toBe("function"); // createExpense di-inject dari expense-manager
        } finally { await stopServer(server); }
    });

    test("non-admin → 403; payMarketingExternal tak dipanggil", async () => {
        const { server, baseUrl } = await startServer(createApp(TEKNISI));
        try {
            const { status } = await postJson(baseUrl, "/psb-schedule/5/marketing/pay", {});
            expect(status).toBe(403);
            expect(scheduleService.payMarketingExternal).not.toHaveBeenCalled();
        } finally { await stopServer(server); }
    });

    test("mapping alasan: not_external→400, already_paid→409, no_fee→400", async () => {
        const { server, baseUrl } = await startServer(createApp(ADMIN));
        try {
            scheduleService.payMarketingExternal.mockResolvedValueOnce({ ok: false, reason: "not_external" });
            expect((await postJson(baseUrl, "/psb-schedule/5/marketing/pay", {})).status).toBe(400);
            scheduleService.payMarketingExternal.mockResolvedValueOnce({ ok: false, reason: "already_paid" });
            expect((await postJson(baseUrl, "/psb-schedule/5/marketing/pay", {})).status).toBe(409);
            scheduleService.payMarketingExternal.mockResolvedValueOnce({ ok: false, reason: "no_fee" });
            expect((await postJson(baseUrl, "/psb-schedule/5/marketing/pay", {})).status).toBe(400);
        } finally { await stopServer(server); }
    });
});
