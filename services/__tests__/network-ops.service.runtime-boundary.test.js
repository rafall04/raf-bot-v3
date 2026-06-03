/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service network-ops memakai repository user terinjeksi saat lookup customer device.
 * Caller: Jest test runner.
 * Deps: `../network-ops.service`.
 * MainFuncs: Memverifikasi logging/history WiFi mendelegasikan lookup customer ke `wifiRepository`.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createNetworkOpsService } = require("../network-ops.service");

describe("network-ops.service runtime boundary", () => {
    test("updateCustomerWifi resolves customer through injected user repository", async () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
        const userRepository = {
            findByDeviceId: jest.fn(() => ({ id: 1, name: "User 1", device_id: "ONT-1" }))
        };
        const saveWebWifiChangeByDevice = jest.fn(() => ({
            shouldLog: false,
            metadata: {},
            skipReason: "test"
        }));
        const service = createNetworkOpsService({
            userRepository,
            getWifiInfo: jest.fn().mockResolvedValue({ ok: false }),
            updateWifiSettings: jest.fn().mockResolvedValue({
                ok: true,
                message: "accepted",
                accepted: true,
                applied: false,
                errorCode: null,
                data: { updates: [] }
            }),
            wifiRepository: { saveWebWifiChangeByDevice }
        });

        await service.updateCustomerWifi({
            deviceId: "ONT-1",
            payload: { ssid: "Baru" },
            reqMeta: { ipAddress: "127.0.0.1", userAgent: "jest" },
            actorCtx: { id: 1, username: "raf", role: "admin" }
        }, { id: 1, username: "raf", role: "admin" });

        expect(saveWebWifiChangeByDevice).toHaveBeenCalledWith(expect.objectContaining({
            userRepository,
            deviceId: "ONT-1"
        }));
        expect(logSpy).not.toHaveBeenCalledWith("[WIFI_LOGGING]", expect.objectContaining({
            logged: false,
            skipReason: "test"
        }));
        logSpy.mockRestore();
    });
});
