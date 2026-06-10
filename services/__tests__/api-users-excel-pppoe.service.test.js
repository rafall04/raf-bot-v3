/**
 * Header Doc
 * Purpose: Guardrail bahwa kolom `pppoe_username` terbawa utuh di pipeline Excel pelanggan —
 *   dikenali schema (header/normalisasi/export) dan diteruskan ke commit payload import (create),
 *   karena field ini kunci pencocokan rekonsiliasi/auto-outage/isolir ke MikroTik.
 * Caller: Jest test runner.
 * Deps: `../api-users/users-excel-schema`, `../api-users/import-users-excel`, package `xlsx`.
 * MainFuncs: Verifikasi getExcelColumnKeys/normalizeImportRow/mapUserToExportRow + preview import.
 * SideEffects: Tidak ada; buffer Excel dibuat in-memory.
 */
"use strict";

const XLSX = require("xlsx");
const {
    getExcelColumnKeys,
    normalizeImportRow,
    mapUserToExportRow
} = require("../api-users/users-excel-schema");
const { importUsersFromExcel } = require("../api-users/import-users-excel");

function buildWorkbookBuffer(aoa) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pelanggan");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("users excel schema: pppoe_username column", () => {
    test("pppoe_username terdaftar sebagai kolom import/export", () => {
        expect(getExcelColumnKeys()).toContain("pppoe_username");
    });

    test("normalizeImportRow membaca + trim pppoe_username dan menandai explicit", () => {
        const { data, explicitFields } = normalizeImportRow({
            name: "Budi",
            subscription: "PAKET-165K",
            pppoe_username: "  kacangan@abidin  "
        });
        expect(data.pppoe_username).toBe("kacangan@abidin");
        expect(explicitFields.pppoe_username).toBe(true);
    });

    test("mapUserToExportRow mengekspor pppoe_username", () => {
        expect(mapUserToExportRow({ pppoe_username: "area@x" }).pppoe_username).toBe("area@x");
    });
});

describe("import-users-excel: pppoe_username diteruskan ke commit payload", () => {
    const deps = {
        getPackages: () => [{ name: "PAKET-165K" }],
        repository: { findUserById: () => null },
        getDb: () => null,
        logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
    };

    test("preview create memuat pppoe_username di daftar field yang akan ditulis", async () => {
        const buffer = buildWorkbookBuffer([
            ["name", "subscription", "pppoe_username"],
            ["Budi Santoso", "PAKET-165K", "kacangan@abidin"]
        ]);

        const result = await importUsersFromExcel(deps, {}, { buffer, mode: "validate" });

        expect(result.status).toBe(200);
        expect(result.body.summary.validRows).toBe(1);
        expect(result.body.rows[0].action).toBe("create");
        expect(result.body.rows[0].status).toBe("valid");
        expect(result.body.rows[0].fields).toContain("pppoe_username");
    });
});
