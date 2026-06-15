/**
 * Header Doc
 * Purpose: API CRUD daftar CCTV publik + status monitor (start/stop/getStatus) + discovery
 *          (scan netwatch MikroTik untuk kandidat CCTV yang belum diadopsi) untuk dashboard.
 * Caller: lib/routes-registry.js mounts at /api/cctv.
 * Deps: ../lib/cctv-registry, ../lib/cctv-monitor, ../lib/mikrotik, ../lib/cctv-netwatch-discovery.
 */
const express = require('express');
const router = express.Router();
const registry = require('../lib/cctv-registry');
const monitor = require('../lib/cctv-monitor');
const mikrotik = require('../lib/mikrotik');
const discovery = require('../lib/cctv-netwatch-discovery');

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
        // Tak perlu restart monitor: poll membaca daftar device fresh tiap siklus
        // (devByHost→getDevices) → device baru otomatis terpantau ≤1 poll. Restart
        // dulu memanggil state.clear() → menghapus insiden in-flight (pending/active),
        // sehingga broadcast atau notif-pulih bisa hilang saat admin utak-atik daftar.
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
        // Tak perlu restart: poll hot-read device tiap siklus (lihat catatan di POST).
        res.json({ status: 200, message: 'OK', data: saved });
    } catch (e) {
        res.status(400).json({ status: 400, message: e.message });
    }
});

router.delete('/devices/:id', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    registry.remove(req.params.id);
    // Tak perlu restart: poll hot-read device; host yang hilang berhenti dipantau,
    // dan pending-nya dibatalkan otomatis di onConfirm (device tak ditemukan).
    res.json({ status: 200, message: 'OK' });
});

router.get('/status', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.json({ status: 200, data: monitor.getCctvMonitorStatus() });
});

// Discovery READ-ONLY: scan netwatch MikroTik, klasifikasi entri → kandidat CCTV,
// cross-check registry agar yang sudah diadopsi tidak ditawarkan lagi. Tidak menulis
// ke router. Hanya mengembalikan kandidat klass 'cctv' (infra & noise disaring).
router.get('/discovery', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
        const r = await mikrotik.getNetwatchFull({ caller: 'cctv.discovery' });
        if (!r || !r.ok) {
            return res.status(502).json({ status: 502, message: (r && r.message) || 'Gagal mengambil netwatch dari MikroTik.' });
        }
        const classified = discovery.classifyNetwatchEntries(Array.isArray(r.data) ? r.data : []);
        const cctv = classified.filter((c) => c.klass === 'cctv');
        const registeredHosts = registry.list().map((d) => d.host);
        res.json({ status: 200, data: discovery.markRegistered(cctv, registeredHosts) });
    } catch (e) {
        res.status(500).json({ status: 500, message: e.message });
    }
});

module.exports = router;
