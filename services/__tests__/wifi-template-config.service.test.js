/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service WiFi template mempertahankan validasi, persistence, dan reload cache legacy.
 * Caller: Jest test runner.
 * Deps: `../wifi-template-config.service`.
 * MainFuncs: Memverifikasi create/update/delete dan fallback reload cache.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createWifiTemplateConfigService } = require("../wifi-template-config.service");

describe("wifi-template-config.service", () => {
    test("create/update/delete template tetap menyimpan dan reload cache", () => {
        let stored = [{ intent: "wifi", keywords: ["wifi"], category: "other", description: "", icon: "[]" }];
        const loadWifiTemplates = jest.fn();
        const service = createWifiTemplateConfigService({
            loadJSON: jest.fn(() => stored),
            saveJSON: jest.fn((_fileName, nextValue) => {
                stored = nextValue;
            }),
            loadWifiTemplates
        });

        const created = service.createWifiTemplate({
            intent: "speedtest",
            keywords: ["speed", "test"],
            category: "tools",
            description: "cek speed"
        }, { username: "raf" });
        expect(created.status).toBe(201);
        expect(stored).toEqual(expect.arrayContaining([expect.objectContaining({ intent: "speedtest" })]));

        const updated = service.updateWifiTemplate("speedtest", {
            keywords: ["speedtest"],
            newIntent: "speed-check",
            category: "support",
            description: "baru"
        }, { username: "raf" });
        expect(updated.data.intent).toBe("speed-check");

        const deleted = service.deleteWifiTemplate("speed-check", { username: "raf" });
        expect(deleted.status).toBe(200);
        expect(stored.find((item) => item.intent === "speed-check")).toBeUndefined();
        expect(loadWifiTemplates).toHaveBeenCalledTimes(3);
    });

    test("reload cache gagal tidak membatalkan persistence", () => {
        let stored = [];
        const service = createWifiTemplateConfigService({
            loadJSON: jest.fn(() => stored),
            saveJSON: jest.fn((_fileName, nextValue) => {
                stored = nextValue;
            }),
            loadWifiTemplates: jest.fn(() => {
                throw new Error("cache down");
            })
        });

        const created = service.createWifiTemplate({
            intent: "diagnose",
            keywords: ["diag"]
        }, { username: "raf" });

        expect(created.status).toBe(201);
        expect(stored).toEqual([expect.objectContaining({ intent: "diagnose" })]);
    });
});
