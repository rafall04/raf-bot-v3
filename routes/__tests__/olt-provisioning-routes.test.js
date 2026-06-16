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

// validateVars/renderScript/listPlaceholders asli dipakai supaya perilaku route = produksi.
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
            listPlaceholders: realProvision.listPlaceholders,
            testSshConnection: jest.fn().mockResolvedValue({ ok: true, prompt: 'ZXAN#', message: 'Terhubung. Prompt: ZXAN#' }),
            listUncfgOnus: jest.fn().mockResolvedValue({ onus: [{ ponPort: '1/3/16', sn: 'ZTEGCCA16805', state: 'unknown' }], raw: '' }),
            getPonOccupancy: jest.fn().mockResolvedValue({ used: [], usedIds: [1, 2], suggestedId: 3, raw: '' }),
            registerOnu: jest.fn().mockResolvedValue({ ok: true, script: 's', commands: ['c'], results: [{ command: 'c', ok: true }], failedIndex: null, persist: null }),
            deleteOnu: jest.fn().mockResolvedValue({ ok: true, results: [], failedIndex: null, persist: null }),
            getOnuStatus: jest.fn().mockResolvedValue({ detail: { phaseState: 'working' }, power: null, rawDetail: '', rawPower: '' }),
            // Fakta mock berisi port & tipe ONU yang dipakai test (1/3/16, ALL) agar guard lolos.
            getOltFacts: jest.fn().mockResolvedValue({ cards: [], ponPorts: ['1/2/1', '1/3/16'], onuTypes: [{ name: 'ALL', description: '' }], tcontProfiles: ['1G', 'UP1G'], trafficProfiles: ['1G', 'DOWN1G'], vlans: ['300', '3010'] }),
            getOnuFullConfig: jest.fn().mockResolvedValue({ interfaceConfig: 'interface gpon-onu_1/2/1:1', onuMngConfig: 'pon-onu-mng gpon-onu_1/2/1:1' }),
            // ACS/TR069 — classifyVendorTier asli (uji guard & aksi adaptif = perilaku produksi).
            classifyVendorTier: realProvision.classifyVendorTier,
            vendorTierTable: realProvision.vendorTierTable,
            applyTr069Addon: jest.fn().mockResolvedValue({ ok: true, script: 's', commands: ['c'], results: [{ command: 'c', ok: true }], failedIndex: null, persist: null }),
            applyTr069AddonBulk: jest.fn().mockResolvedValue({ results: [{ id: '1/2/1:2', ok: true }], okCount: 1, failCount: 0, persist: null }),
            removeTr069Addon: jest.fn().mockResolvedValue({ ok: true, results: [], persist: null }),
            listAllOnus: jest.fn().mockResolvedValue([
                { id: '1/2/1:1', ponPort: '1/2/1', onuId: 1, type: 'F609', sn: 'ZTEGAAA00001' },
                { id: '1/2/1:2', ponPort: '1/2/1', onuId: 2, type: 'F609', sn: 'ZTEGAAA00002' },
                { id: '1/2/1:3', ponPort: '1/2/1', onuId: 3, type: 'ALL', sn: 'RTEGBBB00003' },
            ]),
            listPortOnus: jest.fn().mockResolvedValue([
                { onuId: 1, type: 'F609', sn: 'ZTEGAAA00001', name: 'home@vans' },
                { onuId: 3, type: 'ALL', sn: 'RTEGBBB00003', name: 'budi@vans' },
            ]),
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
            getBackupSettings: jest.fn().mockReturnValue({ enabled: false, schedule: '30 2 * * *', keep: 30, sendTelegram: false, method: 'ftp', ftpSelfHost: '', ftpPort: 21 }),
            saveBackupSettings: jest.fn((s) => ({ enabled: !!s.enabled, schedule: s.schedule || '30 2 * * *', keep: 30, sendTelegram: false, method: s.method || 'ftp', ftpSelfHost: s.ftpSelfHost || '', ftpPort: s.ftpPort || 21 })),
            runBackupForDevice: jest.fn().mockResolvedValue({ ok: true, deviceId: 'olt1', file: 'olt1_x.cfg', sizeBytes: 10, lines: 5, telegram: null, error: null }),
            runBackupAll: jest.fn().mockResolvedValue({ results: [], okCount: 1, failCount: 0 }),
            listBackups: jest.fn().mockReturnValue([]),
            resolveBackupFile: jest.fn(() => { throw new Error('Nama file backup tidak valid'); }),
            ...(overrides.backup || {}),
        },
        restartOltBackupTask: overrides.restartOltBackupTask || jest.fn(),
        logActivity: overrides.logActivity || jest.fn().mockResolvedValue(undefined),
        genieacs: overrides.genieacs || {
            queryDevices: jest.fn().mockResolvedValue({
                ok: true,
                data: [{ _deviceId: { _SerialNumber: 'ZTEGAAA00001' }, _lastInform: '2026-06-16T07:00:00.000Z' }],
            }),
        },
        saveDeviceAcs: overrides.saveDeviceAcs || jest.fn((id, acs) => acs),
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

    test('preview menandai factIssues bila port tak ada di OLT (validasi kondisi nyata)', async () => {
        const { app } = buildApp({
            provision: { getOltFacts: jest.fn().mockResolvedValue({ ponPorts: ['1/2/1'], onuTypes: [{ name: 'ALL' }], tcontProfiles: [], trafficProfiles: [], vlans: [] }) },
        });
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/preview', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '9/9/9', onuId: '8', sn: 'ZTEGCCA16805' }, // port tak ada
        });
        expect(res.status).toBe(200);
        expect(res.body.data.ready).toBe(false);
        expect(res.body.data.factIssues.join(' ')).toMatch(/Port PON 9\/9\/9 tidak ada/);
    });

    test('register DITOLAK 409 bila nilai tak cocok fakta OLT (mencegah konfig setengah-jadi)', async () => {
        const { app, deps } = buildApp({
            provision: { getOltFacts: jest.fn().mockResolvedValue({ ponPorts: ['1/2/1'], onuTypes: [{ name: 'ALL' }], tcontProfiles: [], trafficProfiles: [], vlans: [] }) },
        });
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/register', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '9/9/9', onuId: '8', sn: 'ZTEGCCA16805' },
        });
        expect(res.status).toBe(409);
        expect(deps.provision.registerOnu).not.toHaveBeenCalled();
    });

    test('register force=true melewati guard fakta OLT (fakta basi)', async () => {
        const { app, deps } = buildApp({
            provision: { getOltFacts: jest.fn().mockResolvedValue({ ponPorts: ['1/2/1'], onuTypes: [{ name: 'ALL' }], tcontProfiles: [], trafficProfiles: [], vlans: [] }) },
        });
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/register', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '9/9/9', onuId: '8', sn: 'ZTEGCCA16805' },
            force: true,
        });
        expect(res.status).toBe(200);
        expect(deps.provision.registerOnu).toHaveBeenCalled();
    });

    test('register DITOLAK 409 bila ONU ID sudah terpakai di port (okupansi)', async () => {
        const { app, deps } = buildApp({
            provision: {
                getPonOccupancy: jest.fn().mockResolvedValue({
                    used: [{ onuId: 8, type: 'F609', sn: 'ZTEGAAAA1111' }], usedIds: [8], suggestedId: 9, raw: '',
                }),
            },
        });
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/register', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '1/3/16', onuId: '8', sn: 'ZTEGCCA16805' },
        });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/sudah terpakai/);
        expect(deps.provision.registerOnu).not.toHaveBeenCalled();
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
        expect(deps.provision.deleteOnu).toHaveBeenCalledWith(expect.objectContaining({ id: 'olt1' }), '1/3/16', 8, { saveConfig: false });
        expect(deps.logActivity).toHaveBeenCalledWith(expect.objectContaining({ actionType: 'DELETE' }));
    });

    test('register meneruskan saveConfig=true ke service (write)', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/register', {
            onuTypeId: TYPE.id,
            vars: { ponPort: '1/3/16', onuId: '8', sn: 'ZTEGCCA16805' },
            saveConfig: true,
        });
        expect(res.status).toBe(200);
        expect(deps.provision.registerOnu).toHaveBeenCalledWith(
            expect.anything(), expect.anything(), expect.anything(), { saveConfig: true });
    });

    test('facts: hit pertama query OLT, hit kedua dari cache', async () => {
        const { app, deps } = buildApp();
        // Catatan: tiap request() membuat listener baru, tapi router & cache-nya sama.
        const r1 = await request(app, 'GET', '/api/olt/provision/devices/olt1/facts');
        expect(r1.status).toBe(200);
        expect(r1.body.cached).toBe(false);
        expect(r1.body.data.ponPorts).toContain('1/2/1');
        const r2 = await request(app, 'GET', '/api/olt/provision/devices/olt1/facts');
        expect(r2.body.cached).toBe(true);
        expect(deps.provision.getOltFacts).toHaveBeenCalledTimes(1);
        const r3 = await request(app, 'GET', '/api/olt/provision/devices/olt1/facts?force=true');
        expect(r3.body.cached).toBe(false);
        expect(deps.provision.getOltFacts).toHaveBeenCalledTimes(2);
    });

    test('port-onus: daftar ONU per port + klasifikasi vendor per baris', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'GET', '/api/olt/provision/devices/olt1/port-onus?ponPort=1/2/1&names=1');
        expect(res.status).toBe(200);
        expect(res.body.data.count).toBe(2);
        expect(deps.provision.listPortOnus).toHaveBeenCalledWith(expect.objectContaining({ id: 'olt1' }), '1/2/1', { withNames: true });
        const byId = Object.fromEntries(res.body.data.onus.map((o) => [o.onuId, o]));
        expect(byId[1]).toMatchObject({ sn: 'ZTEGAAA00001', name: 'home@vans', tier: 'zte' });
        expect(byId[3]).toMatchObject({ sn: 'RTEGBBB00003', tier: 'clone' });
    });

    test('onu-config mengembalikan interface + pon-onu-mng', async () => {
        const { app } = buildApp();
        const res = await request(app, 'GET', '/api/olt/provision/devices/olt1/onu-config?ponPort=1/2/1&onuId=1');
        expect(res.status).toBe(200);
        expect(res.body.data.interfaceConfig).toContain('interface gpon-onu');
        expect(res.body.data.onuMngConfig).toContain('pon-onu-mng');
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

    test('GET onu-types menyertakan vendorTiers (auto-pilih profil dari prefix SN)', async () => {
        const { app } = buildApp();
        const res = await request(app, 'GET', '/api/olt/provision/onu-types');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.vendorTiers)).toBe(true);
        const byPrefix = Object.fromEntries(res.body.vendorTiers.map((v) => [v.prefix, v]));
        expect(byPrefix.ZTEG).toMatchObject({ tier: 'zte', oltPushable: true });
        expect(byPrefix.RTEG).toMatchObject({ tier: 'clone', oltPushable: false });
        expect(byPrefix.HWTC).toMatchObject({ tier: 'huawei', oltPushable: false });
    });

    test('POST onu-types meneruskan vendorMatch ke store', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/onu-types', {
            name: 'Profil Vendor', scriptTemplate: 'conf t\nend', vendorMatch: ['zte'],
        });
        expect(res.status).toBe(200);
        expect(deps.store.saveOnuType).toHaveBeenCalledWith(expect.objectContaining({ vendorMatch: ['zte'] }));
    });

    test('simpan setting backup → restart cron terpanggil', async () => {
        const restartOltBackupTask = jest.fn();
        const { app, deps } = buildApp({ restartOltBackupTask });
        const res = await request(app, 'POST', '/api/olt/provision/backup/config', { enabled: true, schedule: '0 3 * * *' });
        expect(res.status).toBe(200);
        expect(deps.backup.saveBackupSettings).toHaveBeenCalled();
        expect(restartOltBackupTask).toHaveBeenCalled();
    });

    test('simpan setting backup meneruskan field FTP (method/selfHost/port)', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/backup/config', {
            enabled: true, method: 'ftp', ftpSelfHost: '172.17.231.2', ftpPort: 21,
        });
        expect(res.status).toBe(200);
        expect(deps.backup.saveBackupSettings).toHaveBeenCalledWith(expect.objectContaining({
            method: 'ftp', ftpSelfHost: '172.17.231.2',
        }));
        expect(res.body.data.method).toBe('ftp');
    });

    test('download backup dengan nama tidak aman → 400', async () => {
        const { app } = buildApp();
        const res = await request(app, 'GET', '/api/olt/provision/backups/download?deviceId=olt1&file=..%2F..%2Fconfig.json');
        expect(res.status).toBe(400);
    });
});

describe('olt-provisioning routes — ACS / TR069', () => {
    // Device dengan setting ACS terisi (dibutuhkan endpoint apply/bulk).
    const withAcs = (over = {}) => buildApp({
        getOltDevice: () => ({ ...DEVICE, acs: { url: 'http://172.17.11.2:7547', user: 'acs', pass: 'acs123', mgmtVlan: 100 } }),
        ...over,
    });

    test('POST acs-settings menyimpan (admin) & tidak membocorkan password', async () => {
        const { app, deps } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/acs-settings',
            { url: 'http://172.17.11.2:7547', user: 'acs', pass: 'acs123', mgmtVlan: 100 });
        expect(res.status).toBe(200);
        expect(deps.saveDeviceAcs).toHaveBeenCalled();
        expect(res.body.data.passwordSet).toBe(true);
        expect(res.body.data.pass).toBeUndefined();
    });

    test('POST acs-settings ditolak untuk teknisi (khusus admin)', async () => {
        const { app } = buildApp({ user: { id: 2, username: 'tek', role: 'teknisi' } });
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/acs-settings', { url: 'http://x:7547', user: 'a' });
        expect(res.status).toBe(403);
    });

    test('POST acs-settings menolak URL tidak valid → 400', async () => {
        const { app } = buildApp();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/acs-settings', { url: 'bukan url', user: 'acs', pass: 'p' });
        expect(res.status).toBe(400);
    });

    test('tr069/apply ke ONU ZTE asli → applyTr069Addon dipanggil', async () => {
        const { app, deps } = withAcs();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/tr069/apply',
            { ponPort: '1/2/1', onuId: 1, sn: 'ZTEGAAA00001' });
        expect(res.status).toBe(200);
        expect(deps.provision.applyTr069Addon).toHaveBeenCalled();
    });

    test('tr069/apply ke ONU clone (RTEG) → 409 & TIDAK menyentuh OLT', async () => {
        const { app, deps } = withAcs();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/tr069/apply',
            { ponPort: '1/2/1', onuId: 3, sn: 'RTEGBBB00003' });
        expect(res.status).toBe(409);
        expect(deps.provision.applyTr069Addon).not.toHaveBeenCalled();
    });

    test('tr069/apply tanpa setting ACS OLT → 400', async () => {
        const { app } = buildApp(); // DEVICE default tanpa .acs
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/tr069/apply',
            { ponPort: '1/2/1', onuId: 1, sn: 'ZTEGAAA00001' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/ACS/);
    });

    test('tr069/status merakit aksi adaptif (informed→ok, ZTE→olt-push, clone→modem)', async () => {
        const { app } = withAcs();
        const res = await request(app, 'GET', '/api/olt/provision/devices/olt1/tr069/status');
        expect(res.status).toBe(200);
        const { summary, onus } = res.body.data;
        expect(summary).toMatchObject({ total: 3, informed: 1, oltPush: 1, modem: 1, acsConfigured: true });
        const byId = Object.fromEntries(onus.map((o) => [o.id, o]));
        expect(byId['1/2/1:1'].action).toBe('ok');        // ZTEG sudah inform
        expect(byId['1/2/1:2'].action).toBe('olt-push');  // ZTEG belum inform
        expect(byId['1/2/1:3'].action).toBe('modem');     // RTEG clone
    });

    test('tr069/apply-bulk otomatis pilih ZTEG belum inform & saring clone', async () => {
        const { app, deps } = withAcs();
        const res = await request(app, 'POST', '/api/olt/provision/devices/olt1/tr069/apply-bulk', { saveConfig: false });
        expect(res.status).toBe(200);
        expect(deps.provision.applyTr069AddonBulk).toHaveBeenCalled();
        const targets = deps.provision.applyTr069AddonBulk.mock.calls[0][1];
        expect(targets).toHaveLength(1);            // hanya 1/2/1:2 (ZTEG belum inform)
        expect(targets[0].sn).toBe('ZTEGAAA00002');
    });
});
