/**
 * Header Doc
 * Purpose: API CRUD daftar CCTV publik + status monitor (start/stop/getStatus) + discovery
 *          (scan netwatch MikroTik untuk kandidat CCTV yang belum diadopsi) + pengaturan monitor
 *          (enabled/window/notifyRecovery + template + config netwatch/Telegram, persist config.json
 *          + hot start/stop) + provisioning netwatch (buat entri + script on-up/on-down CCTV baru)
 *          + riwayat insiden (GET /incidents) + kirim pesan tes per-CCTV (POST /test-broadcast).
 * Caller: lib/routes-registry.js mounts at /api/cctv.
 * Deps: ../lib/cctv-registry, ../lib/cctv-monitor, ../lib/cctv-monitor-config, ../lib/cctv-netwatch-script, ../lib/mikrotik, ../lib/cctv-netwatch-discovery, ../lib/cctv-area-registry, ../lib/whatsapp-gateway (daftar grup WA), fs/path.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const registry = require('../lib/cctv-registry');
const monitor = require('../lib/cctv-monitor');
const cctvConfig = require('../lib/cctv-monitor-config');
const mikrotik = require('../lib/mikrotik');
const discovery = require('../lib/cctv-netwatch-discovery');
const netscript = require('../lib/cctv-netwatch-script');
const uptime = require('../lib/cctv-uptime');
const areaRegistry = require('../lib/cctv-area-registry');
const gateway = require('../lib/whatsapp-gateway');

const MAIN_CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function ensureAdmin(req, res) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        res.status(403).json({ status: 403, message: 'Forbidden' });
        return false;
    }
    return true;
}

// CCTV butuh minimal 1 penerima: nomor WA pelanggan, ATAU koordinator aktif (nomor/grup) utk areanya.
function requireRecipient(body) {
    if (String((body || {}).phone || '').trim()) return;
    const coord = areaRegistry.getByName((body || {}).area);
    const coordHasTarget = coord && coord.enabled !== false &&
        (String(coord.coordinatorPhone || '').trim() || String(coord.coordinatorGroupId || '').trim());
    if (coordHasTarget) return;
    throw new Error('Nomor WA pelanggan wajib diisi (atau tetapkan koordinator/grup aktif untuk areanya).');
}

router.get('/devices', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.json({ status: 200, data: registry.list() });
});

router.post('/devices', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
        requireRecipient(req.body || {});
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
        requireRecipient({ ...existing, ...req.body });
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

// Pengaturan monitor esensial (enabled/window/notifyRecovery).
router.get('/config', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const cur = (global.config && global.config.cctvMonitor) || {};
    res.json({ status: 200, data: { ...cctvConfig.toPublicView(cur), running: monitor.getCctvMonitorStatus().running } });
});

// Update pengaturan: persist ke config.json + update runtime live + hot start/stop monitor.
router.post('/config', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    let next;
    try {
        next = cctvConfig.buildCctvConfigPatch((global.config && global.config.cctvMonitor) || {}, req.body || {});
    } catch (e) {
        return res.status(400).json({ status: 400, message: e.message });
    }
    try {
        const fileCfg = JSON.parse(fs.readFileSync(MAIN_CONFIG_PATH, 'utf8'));
        fileCfg.cctvMonitor = { ...(fileCfg.cctvMonitor || {}), ...next };
        fs.writeFileSync(MAIN_CONFIG_PATH, JSON.stringify(fileCfg, null, 4) + '\n', 'utf8');
        if (!global.config) global.config = {};
        global.config.cctvMonitor = next;
        // Hot-apply tanpa restart: monitor baca global.config.cctvMonitor live tiap poll.
        if (next.enabled === true) monitor.startCctvMonitor();
        else monitor.stopCctvMonitor();
        res.json({ status: 200, message: 'OK', data: { ...cctvConfig.toPublicView(next), running: monitor.getCctvMonitorStatus().running } });
    } catch (e) {
        res.status(500).json({ status: 500, message: e.message });
    }
});

// Provisioning netwatch untuk CCTV BARU: rakit script on-up/on-down dari config Telegram +
// nama/area CCTV (sanitasi anti-injeksi, satu baris), lalu tulis ke MikroTik. Host yang sudah
// ada di netwatch di-skip (tak ditimpa) oleh add_netwatch.php.
router.post('/provision-netwatch', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const body = req.body || {};
    const host = String(body.host || '').trim();
    const name = String(body.name || '').trim();
    const area = String(body.area || '').trim();
    if (!host || !name) {
        return res.status(400).json({ status: 400, message: 'Host & nama wajib diisi.' });
    }
    const nwCfg = (global.config && global.config.cctvMonitor && global.config.cctvMonitor.netwatch) || {};
    if (!netscript.isValidNetwatchConfig(nwCfg)) {
        return res.status(400).json({ status: 400, message: 'Bot token & chat ID Telegram belum diisi di tab Pengaturan.' });
    }
    try {
        const { upScript, downScript } = netscript.buildNetwatchScripts(nwCfg, { name, area, host });
        const r = await mikrotik.addNetwatch(
            { host, comment: name, interval: nwCfg.interval, timeout: nwCfg.timeout, upScript, downScript, disabled: false },
            { caller: 'cctv.provision-netwatch' }
        );
        if (!r || !r.ok) {
            return res.status(502).json({ status: 502, message: (r && r.message) || 'Gagal menulis netwatch ke MikroTik.' });
        }
        res.json({ status: 200, message: 'OK', data: r.data });
    } catch (e) {
        res.status(500).json({ status: 500, message: e.message });
    }
});

// Riwayat insiden (down/broadcast/recover/mass_suppressed) — data dari database/cctv-incidents.json.
router.get('/incidents', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    res.json({ status: 200, data: monitor.getCctvIncidents(limit) });
});

// Uptime/SLA per-CCTV (24h/7d/30d) dari riwayat insiden.
router.get('/uptime', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const incidents = monitor.getCctvIncidents(3000);
    const hosts = registry.list().map((d) => d.host);
    res.json({ status: 200, data: uptime.summarize(incidents, hosts, Date.now()) });
});

// Kirim pesan TES ke SEMUA penerima CCTV ini (pelanggan + koordinator + grup) sesuai pengaturan —
// verifikasi nomor/grup/template/koneksi WA tanpa nunggu mati. Routing identik dengan broadcast nyata
// (recipientsFor): jadi admin benar-benar tahu siapa yang akan menerima saat CCTV mati.
router.post('/test-broadcast', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const d = registry.get((req.body || {}).id);
    if (!d) return res.status(404).json({ status: 404, message: 'CCTV tidak ditemukan.' });
    const r = await monitor.runCctvTestBroadcast(d);
    if (r.total === 0) {
        return res.status(400).json({ status: 400, message: 'Tak ada penerima: isi nomor WA pelanggan, atau tetapkan koordinator/grup aktif untuk areanya.' });
    }
    res.json({ status: 200, message: 'OK', data: r });
});

// CRUD Area + Koordinator RT (dicocokkan ke field `area` tiap CCTV).
router.get('/areas', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.json({ status: 200, data: areaRegistry.list() });
});
router.post('/areas', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try { res.json({ status: 200, message: 'OK', data: areaRegistry.upsert(req.body || {}) }); }
    catch (e) { res.status(400).json({ status: 400, message: e.message }); }
});
router.put('/areas/:id', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const ex = areaRegistry.get(req.params.id);
    if (!ex) return res.status(404).json({ status: 404, message: 'Area tidak ditemukan' });
    try { res.json({ status: 200, message: 'OK', data: areaRegistry.upsert({ ...ex, ...req.body, id: req.params.id }) }); }
    catch (e) { res.status(400).json({ status: 400, message: e.message }); }
});
router.delete('/areas/:id', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    areaRegistry.remove(req.params.id);
    res.json({ status: 200, message: 'OK' });
});

// Kirim pesan TES langsung ke koordinator/grup sebuah area (tanpa perlu CCTV) — verifikasi nomor & grup RT.
router.post('/areas/:id/test', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const a = areaRegistry.get(req.params.id);
    if (!a) return res.status(404).json({ status: 404, message: 'Area tidak ditemukan.' });
    // Device sintetis: area cocok by-name + tanpa pelanggan → recipientsFor hasilkan koordinator + grup area ini.
    const device = { id: 'area-test', name: 'Tes Notifikasi', host: a.name, area: a.name, notifyCustomer: false };
    const r = await monitor.runCctvTestBroadcast(device);
    if (r.total === 0) {
        return res.status(400).json({ status: 400, message: 'Area belum punya nomor/grup koordinator aktif (atau area nonaktif).' });
    }
    res.json({ status: 200, message: 'OK', data: r });
});

// Daftar grup WA yang bot-nya jadi anggota — untuk picker "Grup WA RT" pada koordinator area.
// Bot HARUS anggota grup agar bisa kirim ke situ; itu pula sebabnya hanya grup terjoin yang muncul.
router.get('/groups', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const socket = gateway.getSocket();
    if (!socket || !gateway.isReady() || typeof socket.groupFetchAllParticipating !== 'function') {
        return res.status(503).json({ status: 503, message: 'WhatsApp belum terhubung — pastikan bot online di dashboard, lalu coba lagi.' });
    }
    try {
        const map = await socket.groupFetchAllParticipating();
        const groups = Object.values(map || {})
            .map((g) => ({ id: g.id, subject: g.subject || g.id, size: Array.isArray(g.participants) ? g.participants.length : undefined }))
            .sort((a, b) => String(a.subject).localeCompare(String(b.subject)));
        res.json({ status: 200, data: groups });
    } catch (e) {
        res.status(502).json({ status: 502, message: 'Gagal mengambil daftar grup: ' + e.message });
    }
});

module.exports = router;
