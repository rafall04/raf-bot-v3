/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository WiFi.
 * Caller: Jest test runner.
 * Deps: `../wifi.repository`.
 * MainFuncs: Memverifikasi repository WiFi mengekspos write-path log nama/password serta logging plan web berbasis device lewat adapter logger.
 * SideEffects: Tidak ada; adapter logger dimock in-memory.
 */
"use strict";

const { createWifiRepository } = require("../wifi.repository");

describe("wifi repository contract", () => {
    test("wifi repository exposes log write helpers", async () => {
        const logWifiChange = jest.fn().mockResolvedValue(undefined);
        const buildWebWifiLogPayload = jest.fn().mockReturnValue({
            shouldLog: true,
            logData: { action: "wifi_update" },
            metadata: { actor: "raf" }
        });
        const repository = createWifiRepository({ logWifiChange, buildWebWifiLogPayload });

        expect(repository.saveWifiNameChange).toEqual(expect.any(Function));
        expect(repository.saveWifiPasswordChange).toEqual(expect.any(Function));
        expect(repository.saveWebWifiChange).toEqual(expect.any(Function));
        expect(repository.saveWebWifiChangeByDevice).toEqual(expect.any(Function));

        await repository.saveWifiNameChange(
            { id: 1, device_id: "DEVICE-1", name: "Pelanggan", bulk: ["1", "2"] },
            "WiFi Baru",
            "6281@s.whatsapp.net",
            "bulk_auto"
        );

        await repository.saveWifiPasswordChange(
            { id: 1, device_id: "DEVICE-1", name: "Pelanggan", bulk: ["1", "2"] },
            "Password123",
            "6281@s.whatsapp.net",
            "single"
        );

        expect(logWifiChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
            changeType: "name",
            customerPhone: "6281",
            reason: expect.stringContaining("bulk_auto")
        }));
        expect(logWifiChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
            changeType: "password",
            customerPhone: "6281",
            reason: expect.stringContaining("single")
        }));

        const loggingPlan = await repository.saveWebWifiChange({
            customer: { id: 1, device_id: "DEVICE-1" },
            deviceId: "DEVICE-1",
            payload: { ssid: "Baru" },
            currentWifiInfo: { ssid: [{ name: "Lama" }] },
            staffUser: { username: "raf" },
            req: { ip: "127.0.0.1", headers: { "user-agent": "jest" } },
            fallbackReason: ""
        });

        expect(buildWebWifiLogPayload).toHaveBeenCalledWith(expect.objectContaining({
            deviceId: "DEVICE-1",
            payload: { ssid: "Baru" }
        }));
        expect(loggingPlan).toEqual(expect.objectContaining({ shouldLog: true }));
        expect(logWifiChange).toHaveBeenNthCalledWith(3, { action: "wifi_update" });

        const loggingPlanByDevice = await repository.saveWebWifiChangeByDevice({
            userRepository: {
                findByDeviceId: jest.fn(() => ({ id: 1, device_id: "DEVICE-1" }))
            },
            deviceId: "DEVICE-1",
            payload: { password: "Baru" },
            currentWifiInfo: null,
            staffUser: { username: "raf" },
            req: { ip: "127.0.0.1", headers: { "user-agent": "jest" } }
        });

        expect(loggingPlanByDevice).toEqual(expect.objectContaining({ shouldLog: true }));
        expect(logWifiChange).toHaveBeenNthCalledWith(4, { action: "wifi_update" });
    });
});
