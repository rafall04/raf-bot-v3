/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan route legacy admin yang sudah punya owner baru hanya menjadi stub `410`.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan `../admin.routes`.
 * MainFuncs: Memverifikasi owner endpoint admin baru aktif di router baru dan legacy admin mengembalikan kontrak disabled.
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");

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

const { createAdminRoutes } = require("../admin.routes");

describe("admin legacy routing", () => {
    test("admin.routes tetap menjadi owner endpoint package change", () => {
        const router = createAdminRoutes();
        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => layer.route.path);

        expect(paths).toContain("/api/users/reload");
        expect(paths).toContain("/api/list/users");
        expect(paths).toContain("/api/list/packages");
        expect(paths).toContain("/api/request-package-change");
        expect(paths).toContain("/api/approve-package-change");
        expect(paths).toContain("/api/package-change-requests");
    });

    test("routes/admin.js mengunci shadow route package change dan payment legacy dengan 410", () => {
        const adminLegacySource = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");

        expect(adminLegacySource).toContain("router.post('/api/request-package-change'");
        expect(adminLegacySource).toContain("Legacy request package change dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/approve-package-change'");
        expect(adminLegacySource).toContain("Legacy approve package change dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/package-change-requests'");
        expect(adminLegacySource).toContain("Legacy package change requests dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/payment-status/bulk-update'");
        expect(adminLegacySource).toContain("Legacy bulk payment status dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/debug/database'");
        expect(adminLegacySource).toContain("Legacy debug database dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/users/reload'");
        expect(adminLegacySource).toContain("Legacy reload users dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/list/users'");
        expect(adminLegacySource).toContain("Legacy list users dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/list/packages'");
        expect(adminLegacySource).toContain("Legacy list packages dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/migrate-users'");
        expect(adminLegacySource).toContain("Legacy migrate users dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/status/genieacs'");
        expect(adminLegacySource).toContain("Legacy status genieacs dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/status/mikrotik'");
        expect(adminLegacySource).toContain("Legacy status mikrotik dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/get_ppp_stats'");
        expect(adminLegacySource).toContain("Legacy PPP stats dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/get_hotspot_stats'");
        expect(adminLegacySource).toContain("Legacy hotspot stats dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/customer-wifi-info/:deviceId'");
        expect(adminLegacySource).toContain("Legacy customer wifi info dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/ssid/:deviceId'");
        expect(adminLegacySource).toContain("Legacy SSID update dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/mikrotik/ppp-active-users'");
        expect(adminLegacySource).toContain("Legacy PPP active users dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/mikrotik/ppp-profiles'");
        expect(adminLegacySource).toContain("Legacy PPP profiles dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/customer-metrics-batch'");
        expect(adminLegacySource).toContain("Legacy customer metrics batch dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/device-details/:deviceId'");
        expect(adminLegacySource).toContain("Legacy device details dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/customer-redaman/:deviceId'");
        expect(adminLegacySource).toContain("Legacy customer redaman dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/test-parameter'");
        expect(adminLegacySource).toContain("Legacy test parameter dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/test-parameter-custom'");
        expect(adminLegacySource).toContain("Legacy test parameter custom dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/genieacs-parameters'");
        expect(adminLegacySource).toContain("Legacy GenieACS parameters dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/genieacs-parameters'");
        expect(adminLegacySource).toContain("Legacy GenieACS parameters create dinonaktifkan.");
        expect(adminLegacySource).toContain("router.put('/api/genieacs-parameters/:id'");
        expect(adminLegacySource).toContain("Legacy GenieACS parameters update dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/wifi-templates'");
        expect(adminLegacySource).toContain("Legacy wifi templates list dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/wifi-templates'");
        expect(adminLegacySource).toContain("Legacy wifi templates create dinonaktifkan.");
        expect(adminLegacySource).toContain("router.put('/api/wifi-templates/:intent'");
        expect(adminLegacySource).toContain("Legacy wifi templates update dinonaktifkan.");
        expect(adminLegacySource).toContain("router.delete('/api/wifi-templates/:intent'");
        expect(adminLegacySource).toContain("Legacy wifi templates delete dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/broadcast'");
        expect(adminLegacySource).toContain("Legacy broadcast dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/action'");
        expect(adminLegacySource).toContain("Legacy action dinonaktifkan.");
        expect(adminLegacySource).toContain("router.delete('/api/:category/:id'");
        expect(adminLegacySource).toContain("Legacy admin delete dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/admin/delete-all-users'");
        expect(adminLegacySource).toContain("Legacy delete-all-users dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/admin/cleanup-orphaned-photos'");
        expect(adminLegacySource).toContain("Legacy cleanup orphaned photos dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/mikrotik-devices'");
        expect(adminLegacySource).toContain("Legacy mikrotik devices list dinonaktifkan.");
        expect(adminLegacySource).toContain("router.get('/api/mikrotik-devices/:id'");
        expect(adminLegacySource).toContain("Legacy mikrotik device detail dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/mikrotik-devices'");
        expect(adminLegacySource).toContain("Legacy mikrotik device create dinonaktifkan.");
        expect(adminLegacySource).toContain("router.put('/api/mikrotik-devices/:id'");
        expect(adminLegacySource).toContain("Legacy mikrotik device update dinonaktifkan.");
        expect(adminLegacySource).toContain("router.post('/api/mikrotik-devices/set-active/:id'");
        expect(adminLegacySource).toContain("Legacy mikrotik device activate dinonaktifkan.");
        expect(adminLegacySource).toContain("router.delete('/api/genieacs-parameters/:id'");
        expect(adminLegacySource).toContain("Legacy GenieACS parameters delete dinonaktifkan.");
        expect(adminLegacySource).not.toContain("function readMikrotikDevices");
        expect(adminLegacySource).not.toContain("function writeMikrotikDevices");
        expect(adminLegacySource).not.toContain("function updateEnvFile");
        expect(adminLegacySource).not.toContain("async function broadcast");
        expect(adminLegacySource).not.toContain("const wifiTemplatesPath");
    });
});
