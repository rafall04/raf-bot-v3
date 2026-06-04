/**
 * Header Doc
 * Purpose: Memverifikasi service WiFi menjadi owner orchestration rename/password pada flow bot aktif.
 * Caller: Jest test runner.
 * Deps: `../wifi-management.service`.
 * MainFuncs: Menguji single SSID name change memakai adapter WiFi dan repository log lewat dependency injection.
 * SideEffects: Tidak ada; seluruh dependency dimock in-memory.
 */
"use strict";

const { createWifiManagementService } = require("../wifi-management.service");

describe("wifi-management.service", () => {
    test("handleSingleSSIDNameChange uses injected wifi adapter and log owner", async () => {
        const setSSIDName = jest.fn().mockResolvedValue({ success: true });
        const saveWifiNameChange = jest.fn().mockResolvedValue(undefined);
        const setUserState = jest.fn();
        const deleteUserState = jest.fn();
        const reply = jest.fn().mockResolvedValue(undefined);
        const service = createWifiManagementService({
            setSSIDName,
            wifiRepository: {
                saveWifiNameChange,
                saveWifiPasswordChange: jest.fn()
            }
        });

        await service.handleSingleSSIDNameChange({
            stateKey: "6281@s.whatsapp.net",
            user: {
                id: 1,
                device_id: "DEVICE-1",
                ssid_id: "1",
                name: "Pelanggan"
            },
            newName: "WiFi Baru",
            reply,
            global: { config: { custom_wifi_modification: false } },
            rawSender: "6281@s.whatsapp.net",
            setUserState,
            deleteUserState,
            renderResponseTemplate: (_key, fallback) => fallback
        });

        expect(setSSIDName).toHaveBeenCalledWith("DEVICE-1", "1", "WiFi Baru");
        expect(saveWifiNameChange).toHaveBeenCalledWith(
            expect.objectContaining({ id: 1 }),
            "WiFi Baru",
            "6281@s.whatsapp.net",
            "single",
            null,
            null
        );
        expect(deleteUserState).toHaveBeenCalledWith("6281@s.whatsapp.net");
        expect(reply).toHaveBeenCalledWith(expect.stringContaining("WiFi Baru"));
    });
});
