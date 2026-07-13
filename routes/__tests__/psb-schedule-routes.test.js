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
    buildScheduleGroupNotif: jest.fn(() => "notif")
}));
jest.mock("../../message/handlers/psb-caption-parser", () => ({
    resolvePackage: jest.fn()
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
