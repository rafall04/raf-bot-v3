/**
 * Header Doc
 * Purpose: Unit test route admin LOS broadcast — config get/save (normalisasi+clamp), incidents list+filter, runtime state, dan auth gating.
 * Caller: Jest targeted test LOS broadcast admin routes.
 * Deps: `routes/admin-los-broadcast-routes.js`, Express, HTTP server lokal ephemeral.
 * MainFuncs: Memverifikasi `registerAdminLosBroadcastRoutes` end-to-end dengan deps terinjeksi (tanpa fs/global).
 * SideEffects: Membuka HTTP server lokal hanya selama test.
 */
"use strict";

const express = require("express");
const http = require("http");
const { registerAdminLosBroadcastRoutes, normalizeLosConfig } = require("../admin-los-broadcast-routes");

function request(app, method, path, payload) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const body = payload ? JSON.stringify(payload) : "";
            const req = http.request({
                host: "127.0.0.1",
                port: address.port,
                method,
                path,
                headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
            }, (res) => {
                let data = "";
                res.on("data", (c) => { data += c; });
                res.on("end", () => server.close(() => {
                    let parsed = null;
                    try { parsed = data ? JSON.parse(data) : null; } catch (__e) { parsed = { raw: data }; }
                    resolve({ status: res.statusCode, body: parsed });
                }));
            });
            req.on("error", (e) => server.close(() => reject(e)));
            if (body) req.write(body);
            req.end();
        });
    });
}

function buildApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    if (overrides.user !== undefined) {
        app.use((req, _res, next) => { req.user = overrides.user; next(); });
    }
    const router = express.Router();
    registerAdminLosBroadcastRoutes(router, {
        ensureAuthenticatedStaff: (_req, _res, next) => next(),
        readConfig: overrides.readConfig || (() => ({})),
        writeConfig: overrides.writeConfig || (() => {}),
        setRuntimeConfig: overrides.setRuntimeConfig || (() => {}),
        listIncidents: overrides.listIncidents || (() => []),
        getState: overrides.getState || (() => ({ pendingCount: 0, pendingMacs: [], readyQueue: 0 })),
        logActivity: overrides.logActivity || (async () => {})
    });
    app.use(router);
    app.use((error, _req, res, _next) => {
        res.status(error.status || 500).json({ status: error.status || 500, message: error.message });
    });
    return app;
}

describe("admin-los-broadcast-routes", () => {
    test("GET /config returns merged defaults + human-friendly fields", async () => {
        const app = buildApp({ readConfig: () => ({ oltLosBroadcast: { enabled: true, confirmationWindowMs: 120000 } }) });
        const res = await request(app, "GET", "/api/admin/los-broadcast/config");
        expect(res.status).toBe(200);
        expect(res.body.data.enabled).toBe(true);
        expect(res.body.data.confirmationWindowMinutes).toBe(2); // 120000ms → 2 menit
        expect(res.body.data.confidenceThreshold).toBe(0.6);     // default terisi
    });

    test("POST /config menormalisasi menit→ms, persist, dan reload runtime", async () => {
        const writeConfig = jest.fn();
        const setRuntimeConfig = jest.fn();
        const app = buildApp({ readConfig: () => ({ existing: 1 }), writeConfig, setRuntimeConfig });
        const res = await request(app, "POST", "/api/admin/los-broadcast/config", {
            enabled: true, confidenceThreshold: 0.7, confirmationWindowMinutes: 5,
            clusterFlushSeconds: 30, clusterThreshold: 4, rebroadcastCooldownMinutes: 60
        });
        expect(res.status).toBe(200);
        const saved = writeConfig.mock.calls[0][0].oltLosBroadcast;
        expect(saved.confirmationWindowMs).toBe(300000); // 5 menit
        expect(saved.clusterFlushMs).toBe(30000);
        expect(saved.rebroadcastCooldownMs).toBe(3600000);
        expect(saved.existing).toBeUndefined(); // sub-key terpisah
        expect(writeConfig.mock.calls[0][0].existing).toBe(1); // field lain dipertahankan
        expect(setRuntimeConfig).toHaveBeenCalled();
    });

    test("POST /config meng-clamp nilai berbahaya (window 0 → min 1 menit)", async () => {
        const writeConfig = jest.fn();
        const app = buildApp({ writeConfig });
        await request(app, "POST", "/api/admin/los-broadcast/config", { enabled: true, confirmationWindowMinutes: 0, confidenceThreshold: 5 });
        const saved = writeConfig.mock.calls[0][0].oltLosBroadcast;
        expect(saved.confirmationWindowMs).toBe(60000); // di-clamp ke 1 menit
        expect(saved.confidenceThreshold).toBe(1);       // di-clamp ke max 1
    });

    test("GET /config menyertakan autoTicket shape lengkap (config lama partial)", async () => {
        const app = buildApp({ readConfig: () => ({ oltLosBroadcast: { autoTicket: { enabled: true } } }) });
        const res = await request(app, "GET", "/api/admin/los-broadcast/config");
        expect(res.status).toBe(200);
        expect(res.body.data.autoTicket).toMatchObject({ enabled: true, priority: "HIGH", assignTeknisi: "" });
    });

    test("POST /config MEMPERTAHANKAN autoTicket (regresi data-loss saat save)", async () => {
        const writeConfig = jest.fn();
        const app = buildApp({ writeConfig });
        await request(app, "POST", "/api/admin/los-broadcast/config", {
            enabled: true, autoTicketEnabled: true, autoTicketAssignTeknisi: "budi", autoTicketPriority: "MEDIUM"
        });
        const saved = writeConfig.mock.calls[0][0].oltLosBroadcast;
        expect(saved.autoTicket).toEqual({ enabled: true, assignTeknisi: "budi", priority: "MEDIUM" });
    });

    test("GET /incidents mengembalikan terbaru-dulu + filter status", async () => {
        const incidents = [
            { incidentId: "a", status: "recovered_before_broadcast", mac: "M1" },
            { incidentId: "b", status: "broadcasted", mac: "M2" },
            { incidentId: "c", status: "broadcasted", mac: "M3" }
        ];
        const app = buildApp({ listIncidents: () => incidents });

        const all = await request(app, "GET", "/api/admin/los-broadcast/incidents");
        expect(all.body.data.items[0].incidentId).toBe("c"); // reversed (newest first)

        const filtered = await request(app, "GET", "/api/admin/los-broadcast/incidents?status=broadcasted");
        expect(filtered.body.data.items).toHaveLength(2);
        expect(filtered.body.data.items.every((i) => i.status === "broadcasted")).toBe(true);
    });

    test("GET /state mengembalikan runtime state broadcaster", async () => {
        const app = buildApp({ getState: () => ({ pendingCount: 2, pendingMacs: ["X", "Y"], readyQueue: 1 }) });
        const res = await request(app, "GET", "/api/admin/los-broadcast/state");
        expect(res.status).toBe(200);
        expect(res.body.data.pendingCount).toBe(2);
        expect(res.body.data.pendingMacs).toEqual(["X", "Y"]);
    });

    test("POST /config oleh user non-privileged → 403", async () => {
        const writeConfig = jest.fn();
        const app = buildApp({ user: { role: "user" }, writeConfig });
        const res = await request(app, "POST", "/api/admin/los-broadcast/config", { enabled: true });
        expect(res.status).toBe(403);
        expect(writeConfig).not.toHaveBeenCalled();
    });

    test("POST /config oleh admin → diizinkan", async () => {
        const writeConfig = jest.fn();
        const app = buildApp({ user: { role: "admin", id: 1, username: "adm" }, writeConfig });
        const res = await request(app, "POST", "/api/admin/los-broadcast/config", { enabled: false });
        expect(res.status).toBe(200);
        expect(writeConfig).toHaveBeenCalled();
    });
});

describe("normalizeLosConfig", () => {
    test("nilai default saat input kosong", () => {
        const c = normalizeLosConfig({});
        expect(c.enabled).toBe(false);
        expect(c.confirmationWindowMs).toBe(180000); // 3 menit
        expect(c.clusterThreshold).toBe(3);
        expect(c.notifyCustomer).toMatchObject({ enabled: false, delayMs: 3600000, onlyIfStillDown: true });
    });
    test("enabled menerima string 'true'", () => {
        expect(normalizeLosConfig({ enabled: "true" }).enabled).toBe(true);
    });
    test("notifikasi pelanggan: menit→ms + template + onlyIfStillDown", () => {
        const c = normalizeLosConfig({
            notifyCustomerEnabled: "true",
            customerNotifyDelayMinutes: 90,
            customerMessageTemplate: "Halo {customer_name}",
            customerOnlyIfStillDown: "false",
        });
        expect(c.notifyCustomer.enabled).toBe(true);
        expect(c.notifyCustomer.delayMs).toBe(5400000); // 90 menit
        expect(c.notifyCustomer.messageTemplate).toBe("Halo {customer_name}");
        expect(c.notifyCustomer.onlyIfStillDown).toBe(false);
    });
    test("customerNotifyDelayMinutes di-clamp ke rentang aman (max 1440)", () => {
        expect(normalizeLosConfig({ customerNotifyDelayMinutes: 99999 }).notifyCustomer.delayMs).toBe(1440 * 60 * 1000);
        expect(normalizeLosConfig({ customerNotifyDelayMinutes: 0 }).notifyCustomer.delayMs).toBe(1 * 60 * 1000);
    });
    test("autoTicket: default OFF + shape lengkap saat input kosong", () => {
        expect(normalizeLosConfig({}).autoTicket).toEqual({ enabled: false, assignTeknisi: "", priority: "HIGH" });
    });
    test("autoTicket: field flat dari form (enabled/assign/priority) + trim + uppercase", () => {
        const c = normalizeLosConfig({ autoTicketEnabled: "true", autoTicketAssignTeknisi: " budi ", autoTicketPriority: "medium" });
        expect(c.autoTicket).toEqual({ enabled: true, assignTeknisi: "budi", priority: "MEDIUM" });
    });
    test("autoTicket: objek bersarang config lama tidak ke-drop saat re-normalisasi", () => {
        const c = normalizeLosConfig({ autoTicket: { enabled: true, assignTeknisi: "andi", priority: "HIGH" } });
        expect(c.autoTicket).toEqual({ enabled: true, assignTeknisi: "andi", priority: "HIGH" });
    });
    test("autoTicket: prioritas tak dikenal → fallback HIGH", () => {
        expect(normalizeLosConfig({ autoTicketPriority: "banana" }).autoTicket.priority).toBe("HIGH");
    });
    test("verifyViaScrape: default ON + shape lengkap saat input kosong", () => {
        expect(normalizeLosConfig({}).verifyViaScrape).toEqual({ enabled: true, maxPages: 20, timeWindowMinutes: 15 });
    });
    test("verifyViaScrape: field flat form (enabled/maxPages/window) + clamp", () => {
        const c = normalizeLosConfig({ verifyEnabled: "false", verifyMaxPages: 999, verifyTimeWindowMinutes: 1 });
        expect(c.verifyViaScrape).toEqual({ enabled: false, maxPages: 40, timeWindowMinutes: 3 });
    });
    test("verifyViaScrape: objek bersarang config lama tidak ke-drop saat re-normalisasi", () => {
        const c = normalizeLosConfig({ verifyViaScrape: { enabled: false, maxPages: 30, timeWindowMinutes: 20 } });
        expect(c.verifyViaScrape).toEqual({ enabled: false, maxPages: 30, timeWindowMinutes: 20 });
    });
});
