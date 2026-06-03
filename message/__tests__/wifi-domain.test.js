/**
 * Header Doc
 * Purpose: Guardrail test untuk facade domain WiFi.
 * Caller: Jest test runner.
 * Deps: `../handlers/domains/wifi.domain`.
 * MainFuncs: Memverifikasi facade WiFi menjadi owner intent perubahan WiFi.
 * SideEffects: Tidak ada.
 */
"use strict";

const mockHandleGantiNamaWifi = jest.fn();
const mockHandleGantiSandiWifi = jest.fn();

jest.mock("../handlers/wifi-management-handler", () => ({
    handleGantiNamaWifi: (...args) => mockHandleGantiNamaWifi(...args),
    handleGantiSandiWifi: (...args) => mockHandleGantiSandiWifi(...args)
}));

const { handleWifiIntent } = require("../handlers/domains/wifi.domain");

describe("wifi domain", () => {
    beforeEach(() => {
        mockHandleGantiNamaWifi.mockReset();
        mockHandleGantiSandiWifi.mockReset();
    });

    test("wifi domain owns GANTI_NAMA_WIFI intent", async () => {
        mockHandleGantiNamaWifi.mockResolvedValue({ success: true });

        const result = await handleWifiIntent({
            intent: "GANTI_NAMA_WIFI",
            sender: "6281@s.whatsapp.net",
            reply: jest.fn()
        });

        expect(result).toEqual(expect.objectContaining({ handled: true }));
        expect(mockHandleGantiNamaWifi).toHaveBeenCalled();
    });
});
