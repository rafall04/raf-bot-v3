/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan owner route admin-ops aktif untuk utility destruktif.
 * Caller: Jest test runner.
 * Deps: `express`, `../admin-ops-routes`, dan mock `services/admin-ops.service`.
 * MainFuncs: Memverifikasi path owner delete generic, delete-all-users, dan cleanup orphaned photos.
 * SideEffects: Tidak ada.
 */
"use strict";

const express = require("express");

jest.mock("../../services/admin-ops.service", () => ({
    createAdminOpsService: jest.fn(() => ({
        deleteEntityByCategory: jest.fn().mockResolvedValue({ status: 200, body: { message: "ok" } }),
        deleteAllUsers: jest.fn().mockResolvedValue({ status: 200, message: "ok", details: {} }),
        cleanupOrphanedPhotos: jest.fn().mockResolvedValue({ status: 200, message: "ok", deletedCount: 0 })
    }))
}));

const { registerAdminOpsRoutes } = require("../admin-ops-routes");

describe("admin ops routing", () => {
    test("registrar mengekspos owner route utility destruktif", () => {
        const router = express.Router();
        registerAdminOpsRoutes(router, {
            ensureAuthenticatedStaff: (_req, _res, next) => next(),
            logActivity: jest.fn()
        });

        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => `${Object.keys(layer.route.methods)[0]}:${layer.route.path}`);

        expect(paths).toContain("delete:/api/:category/:id");
        expect(paths).toContain("post:/api/admin/delete-all-users");
        expect(paths).toContain("post:/api/admin/cleanup-orphaned-photos");
    });
});
