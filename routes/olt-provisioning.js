/**
 * Header Doc
 * Purpose: API provisioning & backup OLT ZTE (SSH) — scan ONU uncfg, okupansi ONU ID,
 *          preview + eksekusi registrasi ONU per tipe modem, hapus ONU (rollback),
 *          status/optik ONU, CRUD profil tipe modem, dan konfigurasi/eksekusi backup OLT.
 * Caller: lib/routes-registry.js (mount di /api/olt, berdampingan dengan routes/olt.js),
 *         UI views/sb-admin/admin-olt-provision.php (static/js/admin-olt-provision.js).
 * Deps: lib/olt-manager (devices), lib/olt-zte-provision (operasi SSH), lib/olt-provision-store
 *       (profil tipe modem), lib/olt-backup (backup), lib/cron/jobs/olt-backup (restart jadwal),
 *       lib/activity-logger (audit), lib/error-handler (asyncHandler).
 * MainFuncs: registerOltProvisioningRoutes (DI, dipakai test), module.exports.router (wired).
 * SideEffects: eksekusi perintah konfigurasi di OLT via SSH, tulis file backup, tulis
 *              config.json (setting backup), tulis activity log.
 *
 * Aturan akses: operasi provisioning (scan/preview/register/status/hapus) untuk staf
 * (admin/owner/superadmin/teknisi — teknisi memang meregistrasi ONU di lapangan);
 * CRUD profil, setting backup, dan download backup khusus admin/owner/superadmin.
 */

'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/error-handler');

const STAFF_ROLES = ['admin', 'owner', 'superadmin', 'teknisi'];
const ADMIN_ROLES = ['admin', 'owner', 'superadmin'];

/**
 * Registrasi route dengan dependensi ter-injeksi (unit test tanpa SSH/fs).
 * @param {import('express').Router} router
 * @param {object} deps
 */
function registerOltProvisioningRoutes(router, deps) {
    const {
        getOltDevice,           // (id) => device | null
        getOltDevices,          // () => device[]
        provision,              // lib/olt-zte-provision
        store,                  // lib/olt-provision-store
        backup,                 // lib/olt-backup
        restartOltBackupTask,   // () => void
        logActivity,            // async (data) => void
    } = deps;

    const requireRole = (roles) => (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }
        next();
    };
    const requireStaff = requireRole(STAFF_ROLES);
    const requireAdmin = requireRole(ADMIN_ROLES);

    /** Audit log yang tidak pernah melempar (kegagalan log tak boleh membatalkan operasi). */
    async function audit(req, data) {
        try {
            await logActivity({
                userId: req.user && req.user.id,
                username: req.user && req.user.username,
                role: req.user && req.user.role,
                ipAddress: req.ip || (req.connection && req.connection.remoteAddress),
                userAgent: req.headers && req.headers['user-agent'],
                ...data,
            });
        } catch (e) {
            console.error('[OLT-PROVISION] activity log error:', e.message);
        }
    }

    /** Ambil device + validasi SSH siap pakai. Lempar error 4xx-style bila tidak. */
    function deviceOr404(req, res) {
        const device = getOltDevice(req.params.id);
        if (!device) {
            res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
            return null;
        }
        return device;
    }

    function requireSsh(device, res) {
        if (!device.sshUsername || !device.sshPassword) {
            res.status(400).json({
                status: 400,
                message: `Kredensial SSH OLT "${device.name}" belum dikonfigurasi. Isi di Konfigurasi → OLT → Edit perangkat.`,
            });
            return false;
        }
        return true;
    }

    // ── Devices & koneksi ────────────────────────────────────────────────────

    // Daftar OLT untuk UI provisioning (tanpa kredensial; cukup flag kesiapan SSH).
    router.get('/provision/devices', requireStaff, asyncHandler(async (_req, res) => {
        const devices = getOltDevices().map((d) => ({
            id: d.id,
            name: d.name,
            host: d.host,
            brand: d.brand || 'auto',
            sshReady: !!(d.sshUsername && d.sshPassword),
            sshPort: d.sshPort || 22,
        }));
        res.json({ status: 200, data: devices });
    }));

    router.post('/provision/devices/:id/test-ssh', requireAdmin, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const result = await provision.testSshConnection(device);
        res.status(result.ok ? 200 : 502).json({
            status: result.ok ? 200 : 502,
            message: result.message,
            data: result.ok ? { prompt: result.prompt } : null,
        });
    }));

    // ── Scan & okupansi ──────────────────────────────────────────────────────

    router.get('/provision/devices/:id/uncfg', requireStaff, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const { onus, raw } = await provision.listUncfgOnus(device);
        res.json({ status: 200, message: `${onus.length} ONU belum teregistrasi`, data: onus, raw });
    }));

    router.get('/provision/devices/:id/occupancy', requireStaff, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const ponPort = String(req.query.ponPort || '');
        const occ = await provision.getPonOccupancy(device, ponPort);
        res.json({
            status: 200,
            data: { ponPort, used: occ.used, usedIds: occ.usedIds, suggestedId: occ.suggestedId },
        });
    }));

    // Fakta OLT (port PON, tipe ONU, profil tcont/traffic, VLAN) untuk dropdown form
    // + validasi pra-eksekusi. Di-cache per device (TTL 10 menit); ?force=true refresh.
    const factsCache = new Map(); // deviceId → { data, ts }
    const FACTS_TTL_MS = 10 * 60 * 1000;

    async function getFactsCached(device, force) {
        const cached = factsCache.get(device.id);
        if (!force && cached && Date.now() - cached.ts < FACTS_TTL_MS) {
            return { data: cached.data, cached: true };
        }
        const data = await provision.getOltFacts(device);
        factsCache.set(device.id, { data, ts: Date.now() });
        return { data, cached: false };
    }

    /**
     * Cocokkan nilai form dengan fakta OLT — kunci "tidak ada miss": profil/VLAN/port
     * yang tidak ada di OLT ditolak SEBELUM script dieksekusi (mencegah konfigurasi
     * setengah-jadi karena gagal di tengah script). Hanya memeriksa placeholder yang
     * benar-benar dipakai template.
     */
    function checkVarsAgainstFacts(vars, template, facts) {
        const issues = [];
        if (!facts) return issues;
        const used = new Set(provision.listPlaceholders(template));
        const has = (k) => used.has(k) && vars[k] !== undefined && vars[k] !== '';

        if (has('ponPort') && Array.isArray(facts.ponPorts) && facts.ponPorts.length
            && !facts.ponPorts.includes(String(vars.ponPort))) {
            issues.push(`Port PON ${vars.ponPort} tidak ada di OLT ini (tersedia: ${facts.ponPorts[0]} … ${facts.ponPorts[facts.ponPorts.length - 1]})`);
        }
        if (has('onuType') && Array.isArray(facts.onuTypes) && facts.onuTypes.length
            && !facts.onuTypes.some((t) => t.name === String(vars.onuType))) {
            const names = facts.onuTypes.map((t) => t.name);
            issues.push(`Tipe ONU "${vars.onuType}" tidak terdaftar di OLT (tersedia: ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''})`);
        }
        if (has('tcontProfile') && Array.isArray(facts.tcontProfiles) && facts.tcontProfiles.length
            && !facts.tcontProfiles.includes(String(vars.tcontProfile))) {
            issues.push(`Profil T-CONT "${vars.tcontProfile}" tidak ada di OLT (tersedia: ${facts.tcontProfiles.join(', ')})`);
        }
        if (has('downProfile') && Array.isArray(facts.trafficProfiles) && facts.trafficProfiles.length
            && !facts.trafficProfiles.includes(String(vars.downProfile))) {
            issues.push(`Profil traffic "${vars.downProfile}" tidak ada di OLT (tersedia: ${facts.trafficProfiles.join(', ')})`);
        }
        if (Array.isArray(facts.vlans) && facts.vlans.length) {
            for (const k of Object.keys(vars)) {
                if (/Vlan$/.test(k) && used.has(k) && !facts.vlans.includes(String(vars[k]))) {
                    issues.push(`VLAN ${vars[k]} (${k}) belum dibuat di OLT (tersedia: ${facts.vlans.join(', ')})`);
                }
            }
        }
        return issues;
    }

    router.get('/provision/devices/:id/facts', requireStaff, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const result = await getFactsCached(device, req.query.force === 'true');
        res.json({ status: 200, data: result.data, cached: result.cached });
    }));

    // Viewer konfigurasi lengkap satu ONU (interface + pon-onu-mng) — audit/cek pelanggan.
    router.get('/provision/devices/:id/onu-config', requireStaff, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const cfg = await provision.getOnuFullConfig(device, String(req.query.ponPort || ''), req.query.onuId);
        res.json({ status: 200, data: cfg });
    }));

    // ── Preview & registrasi ─────────────────────────────────────────────────

    /** Gabungkan vars profil + vars form lalu validasi; bentuk respons error seragam. */
    function buildVarsOrRespond(req, res) {
        const onuTypeId = req.body && req.body.onuTypeId;
        const profile = store.getOnuType(String(onuTypeId || ''));
        if (!profile) {
            res.status(400).json({ status: 400, message: 'Tipe modem tidak ditemukan. Pilih tipe modem yang valid.' });
            return null;
        }
        const merged = { ...(profile.vars || {}), ...((req.body && req.body.vars) || {}) };
        const validated = provision.validateVars(merged);
        if (!validated.ok) {
            res.status(400).json({ status: 400, message: 'Input tidak valid', errors: validated.errors });
            return null;
        }
        return { profile, vars: validated.values };
    }

    router.post('/provision/devices/:id/preview', requireStaff, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device) return;
        const built = buildVarsOrRespond(req, res);
        if (!built) return;
        const { script, missing } = provision.renderScript(built.profile.scriptTemplate, built.vars);

        // Validasi terhadap fakta OLT (best-effort: fakta gagal dibaca ≠ preview gagal).
        let factIssues = [];
        let factsChecked = false;
        if (device.sshUsername && device.sshPassword) {
            try {
                const facts = (await getFactsCached(device, false)).data;
                factIssues = checkVarsAgainstFacts(built.vars, built.profile.scriptTemplate, facts);
                factsChecked = true;
            } catch (e) {
                console.warn(`[OLT-PROVISION] facts tidak terbaca utk preview ${device.id}: ${e.message}`);
            }
        }

        res.json({
            status: 200,
            data: {
                script,
                missing,
                factIssues,
                factsChecked,
                profileName: built.profile.name,
                ready: missing.length === 0 && factIssues.length === 0,
            },
        });
    }));

    router.post('/provision/devices/:id/register', requireStaff, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const built = buildVarsOrRespond(req, res);
        if (!built) return;
        const force = req.body && req.body.force === true;

        // ── Guard pra-eksekusi (mencegah konfigurasi setengah-jadi) ──
        // 1) Nilai vs fakta OLT (profil/VLAN/port harus ada). Bisa dilewati force=true
        //    (mis. fakta basi setelah operator baru membuat profil di OLT).
        if (!force) {
            try {
                const facts = (await getFactsCached(device, false)).data;
                const factIssues = checkVarsAgainstFacts(built.vars, built.profile.scriptTemplate, facts);
                if (factIssues.length) {
                    return res.status(409).json({
                        status: 409,
                        message: 'Nilai tidak cocok dengan kondisi OLT — perbaiki dulu (atau centang force bila yakin fakta OLT basi).',
                        errors: factIssues,
                    });
                }
            } catch (e) {
                console.warn(`[OLT-PROVISION] facts tidak terbaca utk register ${device.id}: ${e.message}`);
            }
        }
        // 2) Okupansi: ONU ID & SN tidak boleh sudah terpakai di port itu (hard block —
        //    eksekusi pasti gagal/menabrak pelanggan lain).
        try {
            const occ = await provision.getPonOccupancy(device, String(built.vars.ponPort));
            const idTaken = occ.used.find((u) => u.onuId === parseInt(built.vars.onuId, 10));
            if (idTaken) {
                return res.status(409).json({
                    status: 409,
                    message: `ONU ID ${built.vars.onuId} di port ${built.vars.ponPort} sudah terpakai (SN ${idTaken.sn}, tipe ${idTaken.type}). Saran ID kosong: ${occ.suggestedId}.`,
                });
            }
            const snTaken = occ.used.find((u) => u.sn === String(built.vars.sn).toUpperCase());
            if (snTaken) {
                return res.status(409).json({
                    status: 409,
                    message: `SN ${built.vars.sn} sudah teregistrasi di port ${built.vars.ponPort} sebagai ONU ${snTaken.onuId}.`,
                });
            }
        } catch (e) {
            console.warn(`[OLT-PROVISION] cek okupansi gagal utk ${device.id}: ${e.message} — lanjut (OLT akan menolak sendiri bila konflik)`);
        }

        let result;
        try {
            result = await provision.registerOnu(device, built.profile.scriptTemplate, built.vars, {
                saveConfig: req.body && req.body.saveConfig === true,
            });
        } catch (e) {
            // Error pra-eksekusi (placeholder kurang / validasi) → 400, bukan 500.
            if (e.missingVars || e.validationErrors) {
                return res.status(400).json({ status: 400, message: e.message, errors: e.validationErrors || e.missingVars });
            }
            throw e;
        }

        const summary = `Registrasi ONU ${built.vars.sn || '?'} → gpon-onu_${built.vars.ponPort}:${built.vars.onuId} (${built.profile.name}) di ${device.name}: ${result.ok ? 'BERHASIL' : 'GAGAL'}`;
        await audit(req, {
            actionType: 'CREATE',
            resourceType: 'olt-onu',
            resourceId: `${device.id}:${built.vars.ponPort}:${built.vars.onuId}`,
            resourceName: built.vars.name || built.vars.sn,
            description: summary,
            newValue: { sn: built.vars.sn, ponPort: built.vars.ponPort, onuId: built.vars.onuId, profile: built.profile.id, ok: result.ok },
        });

        res.status(result.ok ? 200 : 502).json({
            status: result.ok ? 200 : 502,
            message: result.ok
                ? 'Registrasi ONU berhasil dieksekusi'
                : `Registrasi GAGAL di perintah ke-${(result.failedIndex || 0) + 1}: "${result.results[result.failedIndex] ? result.results[result.failedIndex].command : '?'}"`,
            data: result,
        });
    }));

    router.post('/provision/devices/:id/delete-onu', requireStaff, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const ponPort = String((req.body && req.body.ponPort) || '');
        const onuId = (req.body && req.body.onuId);
        const result = await provision.deleteOnu(device, ponPort, onuId, {
            saveConfig: req.body && req.body.saveConfig === true,
        });

        await audit(req, {
            actionType: 'DELETE',
            resourceType: 'olt-onu',
            resourceId: `${device.id}:${ponPort}:${onuId}`,
            resourceName: `gpon-onu_${ponPort}:${onuId}`,
            description: `Hapus ONU gpon-onu_${ponPort}:${onuId} di ${device.name}: ${result.ok ? 'BERHASIL' : 'GAGAL'}`,
        });

        res.status(result.ok ? 200 : 502).json({
            status: result.ok ? 200 : 502,
            message: result.ok ? 'ONU dihapus dari OLT' : 'Gagal menghapus ONU (lihat detail)',
            data: result,
        });
    }));

    router.get('/provision/devices/:id/onu-status', requireStaff, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const status = await provision.getOnuStatus(device, String(req.query.ponPort || ''), req.query.onuId);
        res.json({ status: 200, data: status });
    }));

    // ── Profil tipe modem ────────────────────────────────────────────────────

    router.get('/provision/onu-types', requireStaff, asyncHandler(async (_req, res) => {
        res.json({ status: 200, data: store.listOnuTypes(), placeholders: store.PLACEHOLDER_DOC });
    }));

    router.post('/provision/onu-types', requireAdmin, asyncHandler(async (req, res) => {
        const body = req.body || {};
        if (!body.name || !body.scriptTemplate) {
            return res.status(400).json({ status: 400, message: 'Nama dan template script wajib diisi' });
        }
        const saved = store.saveOnuType({
            id: body.id,
            name: body.name,
            brand: body.brand,
            notes: body.notes,
            vars: body.vars,
            scriptTemplate: body.scriptTemplate,
        });
        await audit(req, {
            actionType: body.id ? 'UPDATE' : 'CREATE',
            resourceType: 'olt-onu-type',
            resourceId: saved.id,
            resourceName: saved.name,
            description: `${body.id ? 'Update' : 'Tambah'} profil tipe modem "${saved.name}"`,
        });
        res.json({ status: 200, message: 'Profil tipe modem tersimpan', data: saved });
    }));

    router.delete('/provision/onu-types/:typeId', requireAdmin, asyncHandler(async (req, res) => {
        const ok = store.deleteOnuType(req.params.typeId);
        if (!ok) return res.status(404).json({ status: 404, message: 'Profil tidak ditemukan' });
        await audit(req, {
            actionType: 'DELETE',
            resourceType: 'olt-onu-type',
            resourceId: req.params.typeId,
            resourceName: req.params.typeId,
            description: `Hapus profil tipe modem "${req.params.typeId}"`,
        });
        res.json({ status: 200, message: 'Profil dihapus' });
    }));

    router.post('/provision/onu-types/restore-builtin', requireAdmin, asyncHandler(async (_req, res) => {
        const added = store.restoreBuiltinTypes();
        res.json({ status: 200, message: added > 0 ? `${added} profil bawaan dipulihkan` : 'Semua profil bawaan sudah ada' });
    }));

    // ── Backup ───────────────────────────────────────────────────────────────

    router.get('/provision/backup/config', requireAdmin, asyncHandler(async (_req, res) => {
        res.json({ status: 200, data: backup.getBackupSettings() });
    }));

    router.post('/provision/backup/config', requireAdmin, asyncHandler(async (req, res) => {
        const saved = backup.saveBackupSettings(req.body || {});
        restartOltBackupTask();
        await audit(req, {
            actionType: 'UPDATE',
            resourceType: 'config',
            resourceId: 'olt-backup',
            resourceName: 'Auto-backup OLT',
            description: `Update setting auto-backup OLT (enabled: ${saved.enabled}, jadwal: ${saved.schedule}, keep: ${saved.keep})`,
            newValue: saved,
        });
        res.json({ status: 200, message: 'Setting backup OLT tersimpan', data: saved });
    }));

    router.post('/provision/devices/:id/backup', requireAdmin, asyncHandler(async (req, res) => {
        const device = deviceOr404(req, res);
        if (!device || !requireSsh(device, res)) return;
        const result = await backup.runBackupForDevice(device, {
            sendTelegram: req.body && req.body.sendTelegram === true,
        });
        await audit(req, {
            actionType: 'CREATE',
            resourceType: 'olt-backup',
            resourceId: device.id,
            resourceName: device.name,
            description: `Backup manual OLT ${device.name}: ${result.ok ? `OK (${result.file})` : `GAGAL (${result.error})`}`,
        });
        res.status(result.ok ? 200 : 502).json({
            status: result.ok ? 200 : 502,
            message: result.ok ? `Backup tersimpan: ${result.file}` : `Backup gagal: ${result.error}`,
            data: result,
        });
    }));

    router.post('/provision/backup/run-all', requireAdmin, asyncHandler(async (req, res) => {
        const summary = await backup.runBackupAll({ notifySummary: false });
        await audit(req, {
            actionType: 'CREATE',
            resourceType: 'olt-backup',
            resourceId: 'all',
            resourceName: 'Semua OLT',
            description: `Backup manual semua OLT: ✅ ${summary.okCount} • ❌ ${summary.failCount}`,
        });
        res.json({ status: 200, message: `Backup selesai: ${summary.okCount} berhasil, ${summary.failCount} gagal`, data: summary });
    }));

    router.get('/provision/backups', requireAdmin, asyncHandler(async (req, res) => {
        const deviceId = req.query.deviceId ? String(req.query.deviceId) : null;
        res.json({ status: 200, data: backup.listBackups(deviceId) });
    }));

    router.get('/provision/backups/download', requireAdmin, asyncHandler(async (req, res) => {
        let filePath;
        try {
            filePath = backup.resolveBackupFile(String(req.query.deviceId || ''), String(req.query.file || ''));
        } catch (e) {
            return res.status(400).json({ status: 400, message: e.message });
        }
        res.download(filePath);
    }));
}

// ── Wiring default (produksi) ────────────────────────────────────────────────

const oltManager = require('../lib/olt-manager');
const provision = require('../lib/olt-zte-provision');
const store = require('../lib/olt-provision-store');
const backup = require('../lib/olt-backup');
const { restartOltBackupTask } = require('../lib/cron/jobs/olt-backup');
const { logActivity } = require('../lib/activity-logger');

const router = express.Router();
registerOltProvisioningRoutes(router, {
    getOltDevice: (id) => oltManager.getOltDevice(id),
    getOltDevices: () => oltManager.getOltDevices(),
    provision,
    store,
    backup,
    restartOltBackupTask,
    logActivity,
});

module.exports = router;
module.exports.registerOltProvisioningRoutes = registerOltProvisioningRoutes;
