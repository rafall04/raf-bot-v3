/**
 * Header Doc
 * Purpose: API CRUD daftar CCTV publik (area baru saat simpan/edit otomatis tercatat ke tab
 *          Area/Lokasi via autoRegisterArea → registry = 1 sumber area) + status monitor
 *          (start/stop/getStatus) + discovery
 *          (scan netwatch MikroTik untuk kandidat CCTV yang belum diadopsi) + pengaturan monitor
 *          (enabled/window/notifyRecovery + template + config netwatch/Telegram, persist config.json
 *          + hot start/stop) + provisioning netwatch (buat entri + script on-up/on-down CCTV baru)
 *          + riwayat insiden (GET /incidents) + kirim pesan tes per-CCTV (POST /test-broadcast).
 * Caller: lib/routes-registry.js mounts at /api/cctv.
 * Deps: ../lib/cctv-registry, ../lib/cctv-monitor, ../lib/cctv-monitor-config, ../lib/cctv-netwatch-script, ../lib/mikrotik, ../lib/cctv-netwatch-discovery, ../lib/cctv-area-registry, ../lib/whatsapp-gateway (daftar grup WA), fs/path.
 */
const express = require('express');
const fs = require('fs');
const { writeFileAtomicSync } = require('../lib/atomic-file'); // config.json ATOMIK (#b343)
const path = require('path');
const router = express.Router();
const registry = require('../lib/cctv-registry');
const monitor = require('../lib/cctv-monitor');
const cctvConfig = require('../lib/cctv-monitor-config');
const mikrotik = require('../lib/mikrotik');
const discovery = require('../lib/cctv-netwatch-discovery');
const uptime = require('../lib/cctv-uptime');
const areaRegistry = require('../lib/cctv-area-registry');
const gateway = require('../lib/whatsapp-gateway');
const nwsync = require('../lib/cctv-netwatch-sync');

const MAIN_CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function ensureAdmin(req, res) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        res.status(403).json({ status: 403, message: 'Forbidden' });
        return false;
    }
    return true;
}

// Gate auto-sync netwatch (deploy gelap: default OFF di config.example, ON per-instance yg dipakai).
function autoNetwatchEnabled() {
    return !!(global.config && global.config.cctvMonitor && global.config.cctvMonitor.autoNetwatch === true);
}

// Catat .id netwatch hasil sync ke registry → set/hapus berikutnya menyasar entri PERSIS by-id.
function persistNetwatchId(device, netwatchId) {
    if (device && device.id && netwatchId && netwatchId !== device.netwatchId) {
        try { return registry.upsert({ ...device, netwatchId, id: device.id }); } catch (_e) { /* best-effort */ }
    }
    return device;
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

// Area yang diketik admin di form CCTV = otoritatif SATU tempat: tab Area / Lokasi. Bila nama area
// belum tercatat di registry, daftarkan diam-diam sebagai label (tanpa koordinator) supaya daftar
// area selalu lengkap & tak ada area "hantu" yang cuma nempel di device. Best-effort: kegagalan di
// sini TIDAK menggagalkan simpan CCTV (device tetap otoritatif; area cuma metadata pendamping).
function autoRegisterArea(device) {
    const name = String((device || {}).area || '').trim();
    if (!name) return;
    try {
        if (!areaRegistry.getByName(name)) areaRegistry.upsert({ name });
    } catch (_e) { /* jangan ganggu alur simpan CCTV */ }
}

router.get('/devices', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.json({ status: 200, data: registry.list() });
});

router.post('/devices', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    try {
        requireRecipient(req.body || {});
        let saved = registry.upsert(req.body || {});
        autoRegisterArea(saved); // area baru → langsung tercatat di tab Area / Lokasi
        // Auto-sync netwatch (gated): add di admin sekaligus buat entri + script on-up/on-down di
        // MikroTik → tak perlu utak-atik Winbox. Registry TETAP otoritatif; kegagalan netwatch
        // DISURFACE (bukan diam) supaya admin bisa "Sinkron ulang". Poll monitor hot-read device.
        let netwatch = { skipped: 'autoNetwatch off' };
        if (autoNetwatchEnabled()) {
            netwatch = await nwsync.syncDevice(saved);
            if (netwatch.ok) saved = persistNetwatchId(saved, netwatch.netwatchId);
        }
        res.json({ status: 200, message: 'OK', data: saved, netwatch });
    } catch (e) {
        res.status(400).json({ status: 400, message: e.message });
    }
});

router.put('/devices/:id', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const existing = registry.get(req.params.id);
    if (!existing) return res.status(404).json({ status: 404, message: 'CCTV tidak ditemukan' });
    try {
        requireRecipient({ ...existing, ...req.body });
        let saved = registry.upsert({ ...existing, ...req.body, id: req.params.id });
        autoRegisterArea(saved); // area baru saat edit → ikut tercatat di tab Area / Lokasi
        // Edit sekaligus sinkron netwatch: rename → comment+script diperbarui; ganti IP → entri host
        // BARU dibuat dulu, baru entri lama dihapus (urutan aman, tak pernah nol coverage).
        let netwatch = { skipped: 'autoNetwatch off' };
        if (autoNetwatchEnabled()) {
            // forceScript hanya bila admin memang meng-ganti nama/area → pesan Telegram ikut diperbarui.
            // Tanpa perubahan itu, entri conformant yang sudah jalan TAK ditulis ulang.
            const nameOrAreaChanged = existing.name !== saved.name || String(existing.area || '') !== String(saved.area || '');
            netwatch = await nwsync.syncDevice(saved, { oldHost: existing.host, oldNetwatchId: existing.netwatchId, forceScript: nameOrAreaChanged });
            if (netwatch.ok) saved = persistNetwatchId(saved, netwatch.netwatchId);
        }
        res.json({ status: 200, message: 'OK', data: saved, netwatch });
    } catch (e) {
        res.status(400).json({ status: 400, message: e.message });
    }
});

router.delete('/devices/:id', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const device = registry.get(req.params.id);
    if (!device) return res.json({ status: 200, message: 'OK' }); // idempoten
    let netwatch = { skipped: 'autoNetwatch off' };
    if (autoNetwatchEnabled()) {
        // Hapus netwatch DULU (hanya entri milik-CCTV; entri OLT/infra sehost DIBIARKAN). Bila router
        // gagal → JANGAN yatimkan: pertahankan device supaya bisa retry via "Sinkron ulang".
        netwatch = await nwsync.removeForDevice(device);
        if (!netwatch.ok) {
            return res.status(502).json({ status: 502, message: 'CCTV belum dihapus — gagal hapus netwatch di MikroTik: ' + netwatch.message, netwatch });
        }
    }
    registry.remove(req.params.id);
    res.json({ status: 200, message: 'OK', netwatch });
});

// Sinkron ulang netwatch satu CCTV (retry manual bila auto-sync tadi gagal / entri di-utak-atik).
router.post('/devices/:id/resync-netwatch', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const device = registry.get(req.params.id);
    if (!device) return res.status(404).json({ status: 404, message: 'CCTV tidak ditemukan.' });
    // Resync manual = sengaja terapkan template terbaru (token/pesan) → forceScript.
    const netwatch = await nwsync.syncDevice(device, { forceScript: true });
    if (netwatch.ok) persistNetwatchId(device, netwatch.netwatchId);
    res.json({ status: netwatch.ok ? 200 : (netwatch.mode === 'conflict' ? 409 : 502), message: netwatch.message, data: netwatch });
});

// Sinkronkan SEMUA CCTV ke netwatch sekaligus (backfill; perbaiki yang badge-nya "tidak di netwatch").
router.post('/resync-netwatch', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const devices = registry.list();
    const results = [];
    for (const d of devices) {
        const r = await nwsync.syncDevice(d, { forceScript: true }); // "Sinkronkan semua" = terapkan template
        if (r.ok) persistNetwatchId(d, r.netwatchId);
        results.push({ id: d.id, name: d.name, host: d.host, ok: r.ok, mode: r.mode, message: r.message, warnings: r.warnings || [] });
    }
    const okCount = results.filter((r) => r.ok).length;
    res.json({ status: 200, message: `Sinkron ${okCount}/${results.length} CCTV ke netwatch.`, data: results });
});

// Status netwatch per-CCTV untuk kolom kesehatan di UI (READ-ONLY, 1 fetch).
router.get('/netwatch-health', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const r = await nwsync.netwatchHealth(registry.list());
    res.json({ status: r.ok ? 200 : 502, message: r.message, data: r });
});

router.get('/status', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    res.json({ status: 200, data: monitor.getCctvMonitorStatus() });
});

// Snooze/maintenance: bisukan alert satu CCTV sementara (auto-aktif lagi saat kedaluwarsa).
// minutes>0 → snooze sekian menit; minutes=0 → batalkan snooze. Tak perlu restart (poll baca device fresh).
router.post('/devices/:id/snooze', (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const d = registry.get(req.params.id);
    if (!d) return res.status(404).json({ status: 404, message: 'CCTV tidak ditemukan.' });
    const minutes = parseInt((req.body || {}).minutes, 10);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 7 * 24 * 60) {
        return res.status(400).json({ status: 400, message: 'Durasi snooze harus 0–10080 menit (0 = batalkan).' });
    }
    const snoozeUntil = minutes > 0 ? Date.now() + minutes * 60000 : null;
    const saved = registry.upsert({ ...d, snoozeUntil, id: d.id });
    res.json({ status: 200, message: 'OK', data: { snoozeUntil: saved.snoozeUntil } });
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
        writeFileAtomicSync(MAIN_CONFIG_PATH, JSON.stringify(fileCfg, null, 4) + '\n');
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

// Provision netwatch CCTV — kini DELEGASI ke owner tunggal cctv-netwatch-sync (anti shadow-ownership
// CLAUDE.md: satu penulis netwatch). Alur admin baru memakai auto-sync di POST/PUT/DELETE + /resync;
// endpoint ini dipertahankan utk kompat (mis. tombol lama) tapi lewat jalur aman yang sama.
router.post('/provision-netwatch', async (req, res) => {
    if (!ensureAdmin(req, res)) return;
    const body = req.body || {};
    const host = String(body.host || '').trim();
    const name = String(body.name || '').trim();
    if (!host || !name) return res.status(400).json({ status: 400, message: 'Host & nama wajib diisi.' });
    const device = registry.getByHost(host) || { name, host, area: String(body.area || '').trim(), enabled: true };
    const netwatch = await nwsync.syncDevice(device);
    if (netwatch.ok) persistNetwatchId(device, netwatch.netwatchId);
    res.json({ status: netwatch.ok ? 200 : (netwatch.mode === 'conflict' ? 409 : 502), message: netwatch.message, data: netwatch });
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
