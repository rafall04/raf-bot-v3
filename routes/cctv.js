/**
 * Header Doc
 * Purpose: API CRUD daftar CCTV publik + status monitor (start/stop/getStatus) untuk dashboard.
 * Caller: lib/routes-registry.js mounts at /api/cctv.
 * Deps: ../lib/cctv-registry, ../lib/cctv-monitor.
 */
const express = require('express');
const router = express.Router();
const registry = require('../lib/cctv-registry');
const monitor = require('../lib/cctv-monitor');

function ensureAdmin(req, res) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        res.status(403).json({ status: 403, message: 'Forbidden' });
        return false;
    }
    return true;
}

router.get('/devices', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.json({ status: 200, data: registry.list() });
});

router.post('/devices', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
        const saved = registry.upsert(req.body || {});
        // hot-reload monitor agar device baru langsung dipantau
        try { monitor.restartCctvMonitor(); } catch (__e) { /* ignore */ }
        res.json({ status: 200, message: 'OK', data: saved });
    } catch (e) {
        res.status(400).json({ status: 400, message: e.message });
    }
});

router.put('/devices/:id', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const existing = registry.get(req.params.id);
    if (!existing) return res.status(404).json({ status: 404, message: 'CCTV tidak ditemukan' });
    try {
        const saved = registry.upsert({ ...existing, ...req.body, id: req.params.id });
        try { monitor.restartCctvMonitor(); } catch (__e) { /* ignore */ }
        res.json({ status: 200, message: 'OK', data: saved });
    } catch (e) {
        res.status(400).json({ status: 400, message: e.message });
    }
});

router.delete('/devices/:id', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    registry.remove(req.params.id);
    try { monitor.restartCctvMonitor(); } catch (__e) { /* ignore */ }
    res.json({ status: 200, message: 'OK' });
});

router.get('/status', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.json({ status: 200, data: monitor.getCctvMonitorStatus() });
});

module.exports = router;
