/**
 * Header Doc
 * Purpose: Router admin legacy fallback yang hanya mempertahankan stub `410` untuk endpoint yang sudah dipindah ke bounded context baru.
 * Caller: `routes/admin-router.js`, test route admin, dan registry route HTTP.
 * Deps: `express`, `../lib/security`, dan `./admin-auth`.
 * MainFuncs: Mendaftarkan stub route legacy agar caller lama menerima respons disabled yang konsisten.
 * SideEffects: Mengirim respons HTTP `410` untuk route legacy yang sudah tidak menjadi owner.
 */
const express = require('express');
const { rateLimit } = require('../lib/security');
const { ensureAuthenticatedStaff } = require('./admin-auth');

const router = express.Router();

// --- Admin API Routes ---

// All routes here are implicitly protected by the admin auth middleware in index.js

// API routes for populating form dropdowns
// Debug endpoint to inspect database (accessible via web interface)
router.get('/api/debug/database', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy debug database dinonaktifkan. Gunakan endpoint owner baru /api/debug/database di admin-database-routes."
    });
});

// Note: Delete all users endpoint is available at /api/admin/delete-all-users
// This endpoint is already integrated with the users.php page (Delete All Users button)
// The endpoint includes: delete from DB, reset sequence, clear memory, verify deletion

// Reload users from database endpoint (via web interface)
router.post('/api/users/reload', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy reload users dinonaktifkan. Gunakan endpoint owner baru /api/users/reload di admin.routes."
    });
});

router.get('/api/list/users', ensureAuthenticatedStaff, rateLimit('list-users', 30, 60000), (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy list users dinonaktifkan. Gunakan endpoint owner baru /api/list/users di admin.routes."
    });
});

router.get('/api/list/packages', ensureAuthenticatedStaff, rateLimit('list-packages', 30, 60000), (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy list packages dinonaktifkan. Gunakan endpoint owner baru /api/list/packages di admin.routes."
    });
});

// Legacy route dinonaktifkan agar approval payment hanya dimiliki `routes/requests.js`.
router.post('/api/requests/bulk-approve-legacy-disabled', async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy bulk approve dinonaktifkan. Gunakan endpoint /api/requests/bulk-approve."
    });
});

router.post('/api/request-package-change', ensureAuthenticatedStaff, rateLimit('request-package-change', 5, 60000), async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy request package change dinonaktifkan. Gunakan endpoint owner baru /api/request-package-change di admin.routes.js."
    });
});

router.post('/api/approve-package-change', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy approve package change dinonaktifkan. Gunakan endpoint owner baru /api/approve-package-change di admin.routes.js."
    });
});

router.get('/api/package-change-requests', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy package change requests dinonaktifkan. Gunakan endpoint owner baru /api/package-change-requests di admin.routes.js."
    });
});

router.get('/api/status/genieacs', ensureAuthenticatedStaff, async (_req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy status genieacs dinonaktifkan. Gunakan endpoint owner baru /api/status/genieacs di admin-wifi-ops-routes."
    });
});

router.get('/api/get_ppp_stats', ensureAuthenticatedStaff, async (_req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy PPP stats dinonaktifkan. Gunakan endpoint owner baru /api/get_ppp_stats di admin-wifi-ops-routes."
    });
});

router.get('/api/get_hotspot_stats', ensureAuthenticatedStaff, async (_req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy hotspot stats dinonaktifkan. Gunakan endpoint owner baru /api/get_hotspot_stats di admin-wifi-ops-routes."
    });
});

router.get('/api/status/mikrotik', ensureAuthenticatedStaff, async (_req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy status mikrotik dinonaktifkan. Gunakan endpoint owner baru /api/status/mikrotik di admin-wifi-ops-routes."
    });
});

router.get('/api/customer-wifi-info/:deviceId', ensureAuthenticatedStaff, async (_req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy customer wifi info dinonaktifkan. Gunakan endpoint owner baru /api/customer-wifi-info/:deviceId di admin-wifi-ops-routes."
    });
});

router.post('/api/ssid/:deviceId', ensureAuthenticatedStaff, async (_req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy SSID update dinonaktifkan. Gunakan endpoint owner baru /api/ssid/:deviceId di admin-wifi-ops-routes."
    });
});

// Removed duplicate /api/me endpoint - already defined in routes/stats.js

router.post('/api/action', async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy action dinonaktifkan. Gunakan owner endpoint yang sesuai untuk operasi admin."
    });
});

router.post('/api/broadcast', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy broadcast dinonaktifkan. Gunakan endpoint owner baru /api/broadcast di admin-content-routes."
    });
});

router.delete('/api/:category/:id', async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy admin delete dinonaktifkan. Gunakan endpoint owner baru /api/:category/:id di admin-ops-routes."
    });
});

router.get('/api/mikrotik/ppp-active-users', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy PPP active users dinonaktifkan. Gunakan endpoint owner baru /api/mikrotik/ppp-active-users di admin-wifi-ops-routes."
    });
});

// GET /api/mikrotik/ppp-profiles - Get all PPP profiles from MikroTik
router.get('/api/mikrotik/ppp-profiles', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy PPP profiles dinonaktifkan. Gunakan endpoint owner baru /api/mikrotik/ppp-profiles di admin-wifi-ops-routes."
    });
});

router.post('/api/migrate-users', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy migrate users dinonaktifkan. Gunakan endpoint owner baru /api/migrate-users di admin-database-routes."
    });
});

// Note: POST /api/users/update endpoint has been moved to routes/api.js to avoid duplication

// Note: GET /api/users endpoint has been moved to routes/api.js to avoid duplication

// Note: POST /api/users endpoint has been moved to routes/api.js to avoid duplication

// Note: POST /api/users/:id endpoint has been moved to routes/api.js to avoid duplication

// Note: DELETE /api/users/:id endpoint has been moved to routes/api.js to avoid duplication

// POST /api/admin/delete-all-users - Delete all users (moved here to avoid routing conflicts)
router.post('/api/admin/delete-all-users', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy delete-all-users dinonaktifkan. Gunakan endpoint owner baru /api/admin/delete-all-users di admin-ops-routes."
    });
});

// POST /api/admin/cleanup-orphaned-photos - Cleanup photos from deleted tickets
router.post('/api/admin/cleanup-orphaned-photos', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy cleanup orphaned photos dinonaktifkan. Gunakan endpoint owner baru /api/admin/cleanup-orphaned-photos di admin-ops-routes."
    });
});

// --- Mikrotik Devices CRUD ---

router.get('/api/mikrotik-devices', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy mikrotik devices list dinonaktifkan. Gunakan endpoint owner baru /api/mikrotik-devices di admin-config-routes."
    });
});

router.get('/api/mikrotik-devices/:id', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy mikrotik device detail dinonaktifkan. Gunakan endpoint owner baru /api/mikrotik-devices/:id di admin-config-routes."
    });
});

router.post('/api/mikrotik-devices', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy mikrotik device create dinonaktifkan. Gunakan endpoint owner baru /api/mikrotik-devices di admin-config-routes."
    });
});

router.put('/api/mikrotik-devices/:id', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy mikrotik device update dinonaktifkan. Gunakan endpoint owner baru /api/mikrotik-devices/:id di admin-config-routes."
    });
});

router.post('/api/mikrotik-devices/set-active/:id', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy mikrotik device activate dinonaktifkan. Gunakan endpoint owner baru /api/mikrotik-devices/set-active/:id di admin-config-routes."
    });
});

// --- WiFi Templates Management API ---

router.get('/api/wifi-templates', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy wifi templates list dinonaktifkan. Gunakan endpoint owner baru /api/wifi-templates di admin-content-routes."
    });
});

router.post('/api/wifi-templates', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy wifi templates create dinonaktifkan. Gunakan endpoint owner baru /api/wifi-templates di admin-content-routes."
    });
});

router.put('/api/wifi-templates/:intent', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy wifi templates update dinonaktifkan. Gunakan endpoint owner baru /api/wifi-templates/:intent di admin-content-routes."
    });
});

router.delete('/api/wifi-templates/:intent', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy wifi templates delete dinonaktifkan. Gunakan endpoint owner baru /api/wifi-templates/:intent di admin-content-routes."
    });
});

// Batch customer metrics endpoint
router.post('/api/customer-metrics-batch', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy customer metrics batch dinonaktifkan. Gunakan endpoint owner baru /api/customer-metrics-batch di admin-wifi-ops-routes."
    });
});

// Single device details endpoint - proxy to batch metrics
router.get('/api/device-details/:deviceId', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy device details dinonaktifkan. Gunakan endpoint owner baru /api/device-details/:deviceId di admin-wifi-ops-routes."
    });
});

// Single device redaman endpoint - proxy to batch metrics
router.get('/api/customer-redaman/:deviceId', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy customer redaman dinonaktifkan. Gunakan endpoint owner baru /api/customer-redaman/:deviceId di admin-wifi-ops-routes."
    });
});

// GenieACS Parameters Management APIs
router.get('/api/genieacs-parameters', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy GenieACS parameters dinonaktifkan. Gunakan endpoint owner baru /api/genieacs-parameters di admin-config-routes."
    });
});

router.post('/api/genieacs-parameters', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy GenieACS parameters create dinonaktifkan. Gunakan endpoint owner baru /api/genieacs-parameters di admin-config-routes."
    });
});

router.put('/api/genieacs-parameters/:id', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy GenieACS parameters update dinonaktifkan. Gunakan endpoint owner baru /api/genieacs-parameters/:id di admin-config-routes."
    });
});

router.delete('/api/genieacs-parameters/:id', ensureAuthenticatedStaff, (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy GenieACS parameters delete dinonaktifkan. Gunakan endpoint owner baru /api/genieacs-parameters/:id di admin-config-routes."
    });
});

// Test parameter endpoint
router.post('/api/test-parameter', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy test parameter dinonaktifkan. Gunakan endpoint owner baru /api/test-parameter di admin-wifi-ops-routes."
    });
});

// Test custom parameter endpoint (not registered - direct path testing)
router.post('/api/test-parameter-custom', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy test parameter custom dinonaktifkan. Gunakan endpoint owner baru /api/test-parameter-custom di admin-wifi-ops-routes."
    });
});

// Bulk update payment status endpoint - Using SQLite database
router.post('/api/payment-status/bulk-update', ensureAuthenticatedStaff, async (req, res) => {
    return res.status(410).json({
        status: 410,
        message: "Legacy bulk payment status dinonaktifkan. Gunakan endpoint owner baru /api/payment-status/bulk-update."
    });
});

module.exports = router;
