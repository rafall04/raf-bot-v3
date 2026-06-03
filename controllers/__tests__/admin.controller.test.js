/**
 * Header Doc
 * Purpose: Guardrail test untuk kontrak response controller admin agar tetap tipis dan konsisten.
 * Caller: Jest test runner.
 * Deps: `../admin.controller`.
 * MainFuncs: Memverifikasi controller meneruskan actor context ke service dan mengembalikan payload JSON yang seragam.
 * SideEffects: Tidak ada.
 */
"use strict";

const mockAdminService = {
    reloadUsersCache: jest.fn(),
    getUsersList: jest.fn(),
    getPackagesList: jest.fn(),
    requestPackageChange: jest.fn(),
    approvePackageChange: jest.fn(),
    listPackageChangeRequests: jest.fn()
};
const mockBillingService = {
    bulkApprovePaymentRequests: jest.fn(),
    bulkUpdatePaymentStatus: jest.fn()
};
const mockBuildPaymentAuditContext = jest.fn((user, req) => ({
    id: user.id,
    username: user.username,
    role: user.role,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"]
}));

jest.mock("../../services/admin.service", () => ({
    createAdminService: jest.fn(() => mockAdminService)
}));
jest.mock("../../services/billing.service", () => ({
    createBillingService: jest.fn(() => mockBillingService),
    buildPaymentAuditContext: jest.fn((user, req) => mockBuildPaymentAuditContext(user, req))
}));

const { createAdminController } = require("../admin.controller");

function createResponse() {
    return {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
    };
}

describe("admin.controller", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("listPackageChangeRequests mengembalikan payload seragam dari service", async () => {
        mockAdminService.listPackageChangeRequests.mockResolvedValue({
            status: 200,
            message: "Package change requests fetched.",
            data: [{ id: "req-1" }]
        });
        const controller = createAdminController();
        const req = {
            user: { id: 7, username: "owner", role: "owner" },
            ip: "127.0.0.1",
            headers: { "user-agent": "jest" }
        };
        const res = createResponse();

        await controller.listPackageChangeRequests(req, res);

        expect(mockBuildPaymentAuditContext).toHaveBeenCalledWith(req.user, req);
        expect(mockAdminService.listPackageChangeRequests).toHaveBeenCalledWith({
            id: 7,
            username: "owner",
            role: "owner",
            ipAddress: "127.0.0.1",
            userAgent: "jest"
        });
        expect(res.json).toHaveBeenCalledWith({
            status: 200,
            message: "Package change requests fetched.",
            data: [{ id: "req-1" }]
        });
    });
});
