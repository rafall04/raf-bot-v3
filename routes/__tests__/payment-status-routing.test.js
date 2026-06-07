/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan payment status write-path hanya dimiliki payment router dan kontrak responsenya tetap sinkron dengan frontend.
 * Caller: Jest test runner.
 * Deps: `../admin.routes` dan `../payment-status`.
 * MainFuncs: Memverifikasi shadow route hilang dari admin router dan `bulk-update` payment router mengembalikan `results.success`.
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("../../controllers/admin.controller", () => ({
    createAdminController: jest.fn(() => ({
        reloadUsersCache: jest.fn(),
        listUsers: jest.fn(),
        listPackages: jest.fn(),
        requestPackageChange: jest.fn(),
        approvePackageChange: jest.fn(),
        listPackageChangeRequests: jest.fn()
    }))
}));
jest.mock("../admin-auth", () => ({
    ensureAuthenticatedStaff: (req, _res, next) => next()
}));
jest.mock("../../lib/security", () => ({
    rateLimit: () => (req, _res, next) => next()
}));

jest.mock("../../lib/approval-logic", () => ({
    handlePaidStatusChange: jest.fn()
}));

jest.mock("../../lib/payment-finance-service", () => ({
    applyPaymentStatusChange: jest.fn(),
    getEffectivePrice: jest.fn(),
    getPaymentDiagnostics: jest.fn(),
    getPaymentPositionForPeriod: jest.fn(),
    normalizeUserPaymentMethod: jest.fn()
}));

jest.mock("../../lib/technician-collection-settlement", () => ({
    getPeriodParts: jest.fn()
}));

const { createAdminRoutes } = require("../admin.routes");
const paymentStatusRouter = require("../payment-status");
const {
    applyPaymentStatusChange,
    getEffectivePrice,
    getPaymentDiagnostics,
    getPaymentPositionForPeriod: _getPaymentPositionForPeriod,
    normalizeUserPaymentMethod
} = require("../../lib/payment-finance-service");
const { getPeriodParts } = require("../../lib/technician-collection-settlement");

function createResponse() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        }
    };
}

describe("payment status routing", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.users = [];
    });

    test("admin router tidak lagi mengekspos shadow route payment-status dan requests bulk-approve", () => {
        const router = createAdminRoutes();
        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => layer.route.path);

        expect(paths).not.toContain("/api/payment-status/bulk-update");
        expect(paths).not.toContain("/api/requests/bulk-approve");
    });

    test("payment-status bulk-update mengembalikan results.success untuk frontend", async () => {
        global.users = [{ id: 1, name: "Mbah Uti", subscription: "12Mbps", send_invoice: 1 }];
        normalizeUserPaymentMethod.mockReturnValue("CASH");
        getEffectivePrice.mockReturnValue(150000);
        getPeriodParts.mockReturnValue({ periodMonth: 4, periodYear: 2026 });
        applyPaymentStatusChange.mockResolvedValue({ action: "paid" });

        const routeLayer = paymentStatusRouter.stack.find(
            (layer) => layer.route && layer.route.path === "/bulk-update"
        );
        const handler = routeLayer.route.stack[1].handle;
        const req = {
            body: {
                userIds: [1],
                paid: true,
                period_month: 4,
                period_year: 2026,
                paymentMethod: "CASH"
            },
            user: {
                username: "raf",
                role: "admin"
            },
            headers: {}
        };
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.payload.results.success).toEqual([1]);
        expect(res.payload.results.failed).toEqual([]);
    });

    test("payment-status diagnostics mengekspos hasil getPaymentDiagnostics", async () => {
        getPaymentDiagnostics.mockResolvedValue({ mismatched_paid_status: [] });
        const routeLayer = paymentStatusRouter.stack.find(
            (layer) => layer.route && layer.route.path === "/diagnostics"
        );
        const handler = routeLayer.route.stack[1].handle;
        const req = {
            query: {},
            user: {
                username: "raf",
                role: "admin"
            }
        };
        const res = createResponse();

        await handler(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.payload.data).toEqual({ mismatched_paid_status: [] });
    });
});
