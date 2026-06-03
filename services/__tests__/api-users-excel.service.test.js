/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan composer `api-users.service` mendelegasikan method Excel pelanggan ke modul owner yang benar tanpa merusak kontrak service existing.
 * Caller: Jest test runner.
 * Deps: `../api-users.service`, mock modul Excel owner pada `../api-users/*`.
 * MainFuncs: Verifikasi delegasi `buildUsersExcelTemplate`, `exportUsersToExcel`, dan `importUsersFromExcel`.
 * SideEffects: Tidak ada; seluruh dependency dimock.
 */
"use strict";

const mockBuildUsersExcelTemplate = jest.fn(() => ({
    filename: "template.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("template")
}));
const mockExportUsersToExcel = jest.fn(() => ({
    filename: "export.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("export")
}));
const mockImportUsersFromExcel = jest.fn(async (deps, service, args) => ({
    status: 200,
    body: {
        status: 200,
        depsPassed: Boolean(deps),
        serviceHasUpsert: typeof service.upsertUserFromAdminPanel === "function",
        args
    }
}));

jest.mock("../api-users/users-excel-template", () => ({
    buildUsersExcelTemplate: mockBuildUsersExcelTemplate
}));

jest.mock("../api-users/export-users-excel", () => ({
    exportUsersToExcel: mockExportUsersToExcel
}));

jest.mock("../api-users/import-users-excel", () => ({
    importUsersFromExcel: mockImportUsersFromExcel
}));

const { createApiUsersService } = require("../api-users.service");

describe("api-users service excel delegation", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("buildUsersExcelTemplate delegates to the template module", async () => {
        const service = createApiUsersService({
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.buildUsersExcelTemplate();

        expect(mockBuildUsersExcelTemplate).toHaveBeenCalledTimes(1);
        expect(result.filename).toBe("template.xlsx");
    });

    test("exportUsersToExcel delegates using merged deps", async () => {
        const service = createApiUsersService({
            repository: { getUsersSnapshot: jest.fn(() => []) },
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });

        const result = await service.exportUsersToExcel();

        expect(mockExportUsersToExcel).toHaveBeenCalledWith(expect.objectContaining({
            repository: expect.any(Object)
        }));
        expect(result.filename).toBe("export.xlsx");
    });

    test("importUsersFromExcel delegates with the service self reference", async () => {
        const service = createApiUsersService({
            repository: { getUsersSnapshot: jest.fn(() => []) },
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() }
        });
        const args = {
            buffer: Buffer.from("excel"),
            mode: "validate",
            actor: { id: 1, username: "admin", role: "admin" }
        };

        const result = await service.importUsersFromExcel(args);

        expect(mockImportUsersFromExcel).toHaveBeenCalledWith(
            expect.objectContaining({ repository: expect.any(Object) }),
            expect.objectContaining({
                upsertUserFromAdminPanel: expect.any(Function),
                updateUserById: expect.any(Function)
            }),
            args
        );
        expect(result.body.serviceHasUpsert).toBe(true);
        expect(result.body.args).toEqual(args);
    });
});
