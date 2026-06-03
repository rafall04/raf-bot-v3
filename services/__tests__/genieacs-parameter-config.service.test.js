/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service konfigurasi parameter GenieACS mempertahankan CRUD dan audit field legacy.
 * Caller: Jest test runner.
 * Deps: `../genieacs-parameter-config.service`.
 * MainFuncs: Memverifikasi create/update/delete dan field `createdBy`/`updatedBy`.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createGenieAcsParameterConfigService } = require("../genieacs-parameter-config.service");

describe("genieacs-parameter-config.service", () => {
    test("create/update/delete parameter mempertahankan audit field", () => {
        let stored = [];
        const service = createGenieAcsParameterConfigService({
            loadJSON: jest.fn(() => stored),
            saveJSON: jest.fn((_file, nextValue) => {
                stored = nextValue;
            })
        });

        const created = service.createParameter({
            type: "redaman",
            name: "Redaman",
            description: "desc",
            paths: [" InternetGatewayDevice.X "]
        }, { username: "raf" });

        expect(created.createdBy).toBe("raf");
        expect(stored[0].paths).toEqual(["InternetGatewayDevice.X"]);

        const updated = service.updateParameter(created.id, {
            type: "redaman",
            name: "Redaman Baru",
            description: "",
            paths: ["Path.A", "Path.B"]
        }, { username: "admin2" });

        expect(updated.updatedBy).toBe("admin2");
        expect(updated.name).toBe("Redaman Baru");

        service.deleteParameter(created.id);
        expect(stored).toEqual([]);
    });
});
