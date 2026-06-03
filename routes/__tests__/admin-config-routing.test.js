/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan owner route konfigurasi parameter GenieACS dan device MikroTik aktif di registrar config baru.
 * Caller: Jest test runner.
 * Deps: `express` dan `../admin-config-routes`.
 * MainFuncs: Memverifikasi endpoint CRUD `genieacs-parameters` dan `mikrotik-devices` terpasang di admin config registrar.
 * SideEffects: Tidak ada.
 */
"use strict";

const express = require("express");
const { registerAdminConfigRoutes } = require("../admin-config-routes");

describe("admin config routing", () => {
    test("registrar mengekspos owner route CRUD genieacs-parameters dan mikrotik-devices", () => {
        const router = express.Router();
        registerAdminConfigRoutes({
            router,
            ensureAuthenticatedStaff: (_req, _res, next) => next(),
            logActivity: jest.fn(),
            loadJSON: jest.fn().mockReturnValue([]),
            saveJSON: jest.fn()
        });

        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => `${Object.keys(layer.route.methods)[0]}:${layer.route.path}`);

        expect(paths).toContain("get:/api/genieacs-parameters");
        expect(paths).toContain("post:/api/genieacs-parameters");
        expect(paths).toContain("put:/api/genieacs-parameters/:id");
        expect(paths).toContain("delete:/api/genieacs-parameters/:id");
        expect(paths).toContain("get:/api/mikrotik-devices");
        expect(paths).toContain("get:/api/mikrotik-devices/:id");
        expect(paths).toContain("post:/api/mikrotik-devices");
        expect(paths).toContain("put:/api/mikrotik-devices/:id");
        expect(paths).toContain("post:/api/mikrotik-devices/set-active/:id");
    });
});
