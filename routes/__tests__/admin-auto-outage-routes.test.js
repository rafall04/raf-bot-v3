/**
 * Header Doc
 * Purpose: Smoke test kontrak route admin auto outage sebelum endpoint aktif ditulis.
 * Caller: Jest targeted test Task 1 auto outage skeleton.
 * Deps: `routes/admin-auto-outage-routes.js` dan Express router stub ringan.
 * MainFuncs: Memverifikasi export `registerAdminAutoOutageRoutes` dan registrasi health route.
 * SideEffects: Tidak ada; tidak membuka HTTP server.
 */
"use strict";

const { registerAdminAutoOutageRoutes } = require("../admin-auto-outage-routes");

describe("admin-auto-outage-routes skeleton", () => {
    test("registers health route and returns service contracts", () => {
        const router = { get: jest.fn() };
        const services = registerAdminAutoOutageRoutes(router, {
            ensureAuthenticatedStaff: jest.fn(),
            detectionService: {},
            ruleService: {},
            conversationService: {}
        });
        expect(router.get).toHaveBeenCalledWith(
            "/api/admin/auto-outage/health",
            expect.any(Function),
            expect.any(Function)
        );
        expect(services).toEqual({
            detectionService: {},
            ruleService: {},
            conversationService: {}
        });
    });
});
