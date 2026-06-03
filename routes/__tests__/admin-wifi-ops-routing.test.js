/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan owner route wifi/network ops aktif di registrar baru dan tidak lagi dimiliki route legacy.
 * Caller: Jest test runner.
 * Deps: `express`, `../admin-wifi-ops-routes`, dan mock `services/network-ops.service`.
 * MainFuncs: Memverifikasi path owner terekspos dan mutasi WiFi memakai service baru.
 * SideEffects: Tidak ada.
 */
"use strict";

const express = require("express");

jest.mock("../../services/network-ops.service", () => ({
    createNetworkOpsService: jest.fn(() => ({
        getGenieAcsStatus: jest.fn().mockResolvedValue({ status: 200, message: "ok", connected: true }),
        getMikrotikStatus: jest.fn().mockResolvedValue({ status: 200, message: "ok", connected: true }),
        getPppStats: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: {} }),
        getHotspotStats: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: {} }),
        getActivePppoeUsers: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: [], ok: true }),
        getPppProfiles: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: [] }),
        getCustomerMetricsBatch: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: [] }),
        getDeviceDetails: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: null }),
        getCustomerRedaman: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: { redaman: null } }),
        testConfiguredParameter: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: { value: null } }),
        testCustomParameter: jest.fn().mockResolvedValue({ status: 200, message: "ok", data: { value: null } }),
        getCustomerWifiInfo: jest.fn().mockResolvedValue({
            status: 200,
            message: "wifi ok",
            data: { ssid: [] },
            accepted: true,
            applied: true,
            refreshed: true
        }),
        updateCustomerWifi: jest.fn().mockResolvedValue({
            status: 202,
            message: "accepted",
            accepted: true,
            applied: false,
            errorCode: null,
            result: { updates: [] }
        })
    }))
}));

const { createNetworkOpsService } = require("../../services/network-ops.service");
const { registerAdminWifiOpsRoutes } = require("../admin-wifi-ops-routes");

function createResponse() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        }
    };
}

describe("admin wifi ops routing", () => {
    function createRouter() {
        const router = express.Router();
        registerAdminWifiOpsRoutes(router, {
            ensureAuthenticatedStaff: (_req, _res, next) => next(),
            rateLimit: () => (_req, _res, next) => next(),
            runtime: { config: {}, setConfig: jest.fn() },
            getWifiChangeLogs: jest.fn(),
            getWifiChangeStats: jest.fn(),
            isWithinWorkingHours: jest.fn().mockReturnValue({ isWithinHours: true, dayType: "weekday", message: "ok" }),
            getNextAvailableMessage: jest.fn().mockReturnValue("ok"),
            fs: { writeFileSync: jest.fn() },
            path: { join: jest.fn().mockReturnValue("config.json") }
        });
        return router;
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("registrar mengekspos owner route network ops baru", () => {
        const router = createRouter();
        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => layer.route.path);

        expect(paths).toContain("/api/status/genieacs");
        expect(paths).toContain("/api/status/mikrotik");
        expect(paths).toContain("/api/get_ppp_stats");
        expect(paths).toContain("/api/get_hotspot_stats");
        expect(paths).toContain("/api/mikrotik/ppp-active-users");
        expect(paths).toContain("/api/mikrotik/ppp-profiles");
        expect(paths).toContain("/api/customer-metrics-batch");
        expect(paths).toContain("/api/device-details/:deviceId");
        expect(paths).toContain("/api/customer-redaman/:deviceId");
        expect(paths).toContain("/api/test-parameter");
        expect(paths).toContain("/api/test-parameter-custom");
        expect(paths).toContain("/api/customer-wifi-info/:deviceId");
        expect(paths).toContain("/api/ssid/:deviceId");
    });

    test("mutasi ssid memakai network ops service dan mempertahankan status 202", async () => {
        const router = createRouter();
        const service = createNetworkOpsService.mock.results[0].value;
        const layer = router.stack.find((entry) => entry.route && entry.route.path === "/api/ssid/:deviceId");
        const handler = layer.route.stack[layer.route.stack.length - 1].handle;
        const req = {
            params: { deviceId: "ONT-1" },
            body: { ssid: "Baru" },
            ip: "127.0.0.1",
            connection: { remoteAddress: "127.0.0.1" },
            headers: { "user-agent": "jest" },
            user: { id: 1, username: "raf", role: "admin" }
        };
        const res = createResponse();

        await handler(req, res, jest.fn());

        expect(service.updateCustomerWifi).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: "ONT-1",
            payload: { ssid: "Baru" },
            reqMeta: expect.objectContaining({ ipAddress: "127.0.0.1", userAgent: "jest" })
        }), expect.objectContaining({ username: "raf", role: "admin" }));
        expect(res.statusCode).toBe(202);
        expect(res.payload.applied).toBe(false);
    });
});
