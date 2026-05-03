/**
 * Header Doc
 * Purpose: Unit test route admin auto outage untuk health, manual scan, state list, dan scan log read model.
 * Caller: Jest targeted test Task 5 auto outage admin routes.
 * Deps: `routes/admin-auto-outage-routes.js`, Express, dan HTTP server lokal ephemeral.
 * MainFuncs: Memverifikasi `registerAdminAutoOutageRoutes` memasang endpoint Phase 1A.
 * SideEffects: Membuka HTTP server lokal hanya selama test.
 */
"use strict";

const express = require("express");
const http = require("http");
const { registerAdminAutoOutageRoutes } = require("../admin-auto-outage-routes");

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
                headers: {
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(body)
                }
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    server.close(() => {
                        let parsed = null;
                        try {
                            parsed = data ? JSON.parse(data) : null;
                        } catch (_error) {
                            parsed = { raw: data };
                        }
                        resolve({
                            status: res.statusCode,
                            body: parsed
                        });
                    });
                });
            });
            req.on("error", (error) => {
                server.close(() => reject(error));
            });
            if (body) req.write(body);
            req.end();
        });
    });
}

function buildApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerAdminAutoOutageRoutes(router, {
        ensureAuthenticatedStaff: (_req, _res, next) => next(),
        detectionService: overrides.detectionService,
        repository: overrides.repository
    });
    app.use(router);
    app.use((error, _req, res, _next) => {
        res.status(error.status || 500).json({ status: error.status || 500, message: error.message });
    });
    return app;
}

describe("admin-auto-outage-routes", () => {
    test("GET /api/admin/auto-outage/health returns route status", async () => {
        const app = buildApp();
        const res = await request(app, "GET", "/api/admin/auto-outage/health");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Auto outage route registered.");
    });

    test("POST /api/admin/auto-outage/scan runs manual scan", async () => {
        const detectionService = {
            runManualScan: jest.fn().mockResolvedValue({ status: 200, summary: { total_db_users: 2 } })
        };
        const app = buildApp({ detectionService });
        const res = await request(app, "POST", "/api/admin/auto-outage/scan", { router_id: "main-router" });
        expect(res.status).toBe(200);
        expect(res.body.data.summary.total_db_users).toBe(2);
        expect(detectionService.runManualScan).toHaveBeenCalledWith({ router_id: "main-router" });
    });

    test("GET /api/admin/auto-outage/states returns repository states", async () => {
        const repository = {
            listStates: jest.fn().mockResolvedValue({ items: [{ user_id: "1", status: "offline" }] }),
            listScanLogs: jest.fn()
        };
        const app = buildApp({ repository });
        const res = await request(app, "GET", "/api/admin/auto-outage/states?status=offline&limit=10");
        expect(res.status).toBe(200);
        expect(res.body.data.items).toHaveLength(1);
        expect(repository.listStates).toHaveBeenCalledWith({ status: "offline", limit: 10, offset: 0 });
    });

    test("GET /api/admin/auto-outage/scan-logs returns scan logs", async () => {
        const repository = {
            listStates: jest.fn(),
            listScanLogs: jest.fn().mockResolvedValue({ items: [{ id: "log-1" }] })
        };
        const app = buildApp({ repository });
        const res = await request(app, "GET", "/api/admin/auto-outage/scan-logs?limit=5");
        expect(res.status).toBe(200);
        expect(res.body.data.items).toHaveLength(1);
        expect(repository.listScanLogs).toHaveBeenCalledWith({ limit: 5, offset: 0 });
    });
});
