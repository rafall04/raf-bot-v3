/**
 * Header Doc
 * Purpose: Smoke test kontrak service deteksi auto outage sebelum logic scan PPPoE ditulis.
 * Caller: Jest targeted test Task 1 auto outage skeleton.
 * Deps: `services/auto-outage-detection.service.js`.
 * MainFuncs: Memverifikasi export `createAutoOutageDetectionService` dan method skeleton.
 * SideEffects: Tidak ada; dependency MikroTik direplace stub.
 */
"use strict";

const { createAutoOutageDetectionService } = require("../auto-outage-detection.service");

describe("auto-outage-detection.service skeleton", () => {
    test("exports detection service contract", async () => {
        const service = createAutoOutageDetectionService({
            repository: {},
            getActivePPPoEUsers: jest.fn(),
            getAllPPPoESecrets: jest.fn()
        });
        expect(typeof service.runManualScan).toBe("function");
        expect(typeof service.buildDetectionSnapshot).toBe("function");
        await expect(service.runManualScan()).rejects.toThrow("AUTO_OUTAGE_DETECTION_NOT_IMPLEMENTED");
    });
});
