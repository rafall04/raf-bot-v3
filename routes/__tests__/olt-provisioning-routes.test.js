/**
 * Header Doc
 * Purpose: Unit test route provisioning OLT — gating role (staff vs admin), preview render,
 *          eksekusi registrasi (sukses/gagal/validasi), CRUD profil tipe modem, setting
 *          backup (restart cron terpanggil), dan guard download backup. Semua deps mock.
 * Caller: Jest targeted test.
 * Deps: routes/olt-provisioning.js (registerOltProvisioningRoutes), Express, HTTP lokal.
 * MainFuncs: -
 * SideEffects: buka server HTTP lokal ephemeral selama test.
 */

'use strict';

const express = require('express');
const http = require('http');
const { registerOltProvisioningRoutes } = require('../olt-provisioning');

function request(app, method, path, payload) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const body = payload ? JSON.stringify(payload) : '';
            const req = http.request({
                host: '127.0.0.1',
                port: address.port,
                method,
                path,
                headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
            }, (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => server.close(() => {
                    let parsed = null;
                    try { parsed = data ? JSON.parse(data) : null; } catch (_e) { parsed = { raw: data }; }
                    resolve({ status: res.statusCode, body: parsed });
                }));
            });
            req.on('error', (e) => server.close(() => reject(e)));
            if (body) req.write(body);
            req.end();
        });
    });
}

const DEVICE = { id: 'olt1', name: 'OLT Pusat', host: '10.0.0.2', brand: 'zte', sshUsername: 'zte', sshPassword: 'pw', sshPort: 22 };
const TYPE = {
    id: 'zte-router-pppoe',
    name: 'ZTE Router',
    vars: { onuType: 'ALL', pppoeVlan: '3010', tcontProfile: 'UP1G', downProfile: 'DOWN1G' },
    scriptTemplate: 'conf t\nint gpon-olt_{{ponPort}}\nonu {{onuId}} type {{onuType}} sn {{sn}}\nend',
};

// validateVars & renderScript asli dipakai supaya perilaku route = produksi.
const realProvision = require('../../lib/olt-zte-provision');

function buildApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = overrides.user !== undefined ? overrides.user : { id: 1, username: 'admin', role: 'admin' }; next(); });

    const deps = {
        getOltDevice: overrides.getOltDevice || ((id) => (id === 'olt1' ? { ...DEVICE } : null)),
        getOltDevices: overrides.getOltDevices || (() => [{ ...DEVICE }]),
        provision: {
            validateVars: realProvision.validateVars,
            renderScript: realProvision.renderScript,
            testSshConnection: jest.fn().mockResolvedValue({ ok: true, prompt: 'ZXAN#', message: 'Terhubung. Prompt: ZXAN#' }),
            listUncfgOnus: jest.fn().mockResolvedValue({ onus: [{ ponPort: '1/3/16', sn: 'ZTEGCCA16805', state: 'unknown' }], raw: '' }),
            getPonOccupancy: jest.fn().mockResolvedValue({ used: [], usedIds: [1, 2], suggestedId: 3, raw: '' }),
            registerOnu: jest.fn().mockResolvedValue({ ok: true, script: 's', commands: ['c'], results: [{ command: 'c', ok: true }], failedIndex: null }),
            deleteOnu: jest.fn().mockResolvedValue({ ok: true, results: [], failedIndex: null }),
            getOnuStatus: jest.fn().mockResolvedValue({ detail: { phaseState: 'working' }, power: null, rawDetail: '', rawPower: '' }),
            ...(overrides.provision || {}),
        },
        store: {
            listOnuTypes: jest.fn().mockReturnValue([TYPE]),
            getOnuType: jest.fn((id) => (id === TYPE.id ? TYPE : null)),
            saveOnuType: jest.fn((p) => ({ ...p, id: p.id || 'baru' })),
            deleteOnuType: jest.fn().mockReturnValue(true),
            restoreBuiltinTypes: jest.fn().mockReturnValue(0),
            PLACEHOLDER_DOC: [],
            ...(overrides.store || {}),
        },
        backup: {
            getBackupSettings: jest.fn().mockReturnValue({ enabled: false, schedule: '30 2 * * *', keep: 30, sendTelegram: false }),
            saveBackupSettings: jest.fn((s) => ({ enabled: !!s.enabled, schedule: s.schedule || '30 2 * * *', keep: 30, sendTelegram: false })),
            runBackupForDevice: jest.fn().mockResolvedValue({ ok: true, deviceId: 'olt1', file: 'olt1_x.cfg', sizeBytes: 10, lines: 5, telegram: null, error: null }),
            runBackupAll: jest.fn().mockResolvedValue({ results: [], okCount: 1, failCount: 0 }),
            listBackups: jest.fn().mockReturnValue([]),
            resolveBackupFile: jest.fn(() => { throw new Error('Nama file backup tidak valid'); }),
            ...(overrides.backup || {}),
        },
        restartOltBackupTask: overrides.restartOltBackupTask || jest.fn(),
        logActivity: overrides.logActivity || jest.fn().mockResolvedValue(undefined),
    };

    const router = express.Router();
    registerOltProvisioningRoutes(router, deps);
    app.use('/api/olt', router);
    app.use((error, _req, res, _next) => {
        res.status(error.status || 500).json({ status: error.status || 500, message: error.message });
    });
    return { app, deps };
}

describe('olt-provisioning routes — akses', () => {
    test('tanpa user → 403', async () => {
        const { app } = buildApp({ user: null });
        const res = await request(app, 'GET', '/api/olt/provision/devices');
        expect(res.status).toBe(403);
    });

    test('teknisi boleh akses operasi provisioning', async () => {
        const { app } = buildApp({ user: { id: 2, username: 'tek', role: 'teknisi' } });
        const res = await request(app, 'GET', '/api/olt/provision/devices');
        expect(res.status).toBe(200);
        expect(res.body.data[0].sshReady).toBe(true);
        // Kredensial tidak boleh bocor ke klien.
        expect(res.body.data[0].sshPassword).toBeUndefined();
    });

    test('teknisi DITOLAK pada setting backup (khusus admin)', async () => {
        const { app } = buildApp({ user: { id: 2, username: 'tek', role: 'teknisi' } });
        const res = await request(app, 'POST', '/api/olt/provision/backup/config', { enabled: true });
        expect(res.status).toBe(403);
    });

    test('device tidak dikenal → 404', async () => {
        const { app } = buildApp();
        const res = await request(app, 'GET', '/api/olt/provision/devices/ghost/uncfg');
        expect(res.status).toBe(404);
    });

    test('device tanpa kredensial SSH → 400 dengan petunjuk', async () => {
        const { app } = buildApp({ getOltDevice: () => ({ ...DEVICE, sshUsername: '', sshPassword: '' }) });
        const res = await request(app, 'GET', '/api/olt/provision/devices/olt1/uncfg');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/SSH/);
    });
});

describe('olt-provisioning routes — preview & register', () => {
    test('preview merender template dengan vars profil + form', async () => {
        const { app } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/preview', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '1/3/16', onuId: '8', sn: 'ZTEGCCA16805' },
        });
        expect(res.status).toBe(200);
        expect(res.body.data.ready).toBe(true);
        expect(res.body.data.script).toContain('onu 8 type ALL sn ZTEGCCA16805'); // onuType dari vars profil
        expect(res.body.data.script).toContain('int gpon-olt_1/3/16');
    });

    test('preview menandai placeholder yang belum terisi (ready=false)', async () => {
        const { app } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/preview', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '1/3/16', onuId: '8' }, // sn sengaja kosong
        });
        expect(res.status).toBe(200);
        expect(res.body.data.ready).toBe(false);
        expect(res.body.data.missing).toContain('sn');
    });

    test('vars berbahaya (newline/?) ditolak 400 sebelum SSH', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/register', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '1/3/16', onuId: '8', sn: 'ZTEGCCA16805', name: 'jahat\nreboot' },
        });
        expect(res.status).toBe(400);
        expect(deps.provision.registerOnu).not.toHaveBeenCalled();
    });

    test('tipe modem tak dikenal → 400', async () => {
        const { app } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/register', {
            onuTypeId: 'ghost', vars: {},
        });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Tipe modem/);
    });

    test('register sukses → 200 + audit log terpanggil', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/register', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '1/3/16', onuId: '8', sn: 'ZTEGCCA16805' },
        });
        expect(res.status).toBe(200);
        expect(deps.provision.registerOnu).toHaveBeenCalled();
        expect(deps.logActivity).toHaveBeenCalledWith(expect.objectContaining({
            actionType: 'CREATE',
            resourceType: 'olt-onu',
            resourceId: 'olt1:1/3/16:8',
        }));
    });

    test('register gagal di OLT → 502 dengan failedIndex', async () => {
        const { app } = buildApp({
            provision: {
                registerOnu: jest.fn().mockResolvedValue({
                    ok: false, script: 's', commands: ['a', 'b'],
                    results: [{ command: 'a', ok: true }, { command: 'b', ok: false, error: '%Error 326' }],
                    failedIndex: 1,
                }),
            },
        });
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/register', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '1/3/16', onuId: '8', sn: 'ZTEGCCA16805' },
        });
        expect(res.status).toBe(502);
        expect(res.body.message).toMatch(/perintah ke-2/);
    });

    test('delete-onu memanggil service + audit DELETE', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/delete-onu', { ponPort: '1/3/16', onuId: 8 });
        expect(res.status).toBe(200);
        expect(deps.provision.deleteOnu).toHaveBeenCalledWith(expect.objectContaining({ id: 'olt1' }), '1/3/16', 8);
        expect(deps.logActivity).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'DELETE' }));
    });
});

describe('olt-provisioning routes — tipe modem & backup', () => {
    test('POST onu-types tanpa nama/template → 400', async () => {
        const { app } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/onu-types', { name: 'X' });
        expect(res.status).toBe(400);
    });

    test('POST onu-types valid → simpan via store', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/onu-types', {
            name: 'Profil Baru', scriptTemplate: 'conf t\nend', vars: { pppoeVlan: '3010' },
        });
        expect(res.status).toBe(200);
        expect(deps.store.saveOnuType).toHaveBeenCalledWith(expect.objectContaining({ name: 'Profil Baru' }));
    });

    test('CRUD onu-types khusus admin — teknisi 403', async () => {
        const { app } = buildApp({ user: { id: 2, username: 'tek', role: 'teknisi' } });
        const res = await request(app, 'POST', '/api/olt/provision/onu-types', { name: 'X', scriptTemplate: 'y' });
        expect(res.status).toBe(403);
        // GET daftar tetap boleh (dipakai form registrasi teknisi).
        const list = await request(app, 'GET', '/api/olt/provision/onu-types');
        expect(list.status).toBe(200);
    });

    test('simpan setting backup → restart cron terpanggil', async () => {
        const restartOltBackupTask = jest.fn();
        const { app, deps } = buildApp({ restartOltBackupTask });
        const res = await request(app, 'POST', '/api/olt/provision/backup/config', { enabled: true, schedule: '0 3 * * *' });
        expect(res.status).toBe(200);
        expect(deps.backup.saveBackupSettings).toHaveBeenCalled();
        expect(restartOltBackupTask).toHaveBeenCalled();
    });

    test('download backup dengan nama tidak aman → 400', async () => {
        const { app } = buildApp();
        const res = await request(app, 'GET', '/api/olt/provision/backups/download?deviceId=olt1&file=..%2F..%2Fconfig.json');
        expect(res.status).toBe(400);
    });
});
