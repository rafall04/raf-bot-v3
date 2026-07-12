/**
 * Header Doc
 * Purpose: Mengunci perbaikan "data real bukan data palsu" pada Cek Koneksi:
 *          (1) baris modem tak pernah mengklaim data GenieACS BASI (uptime/jumlah perangkat) dan
 *              tak pernah bilang "0 perangkat terhubung"; (2) verdict jalur-AKTIF berbasis BUKTI
 *              (upstream link utama/cadangan) — tak pernah klaim "normal" tanpa bukti (fail-closed);
 *              (3) reboot tak ditawarkan saat JARINGAN yang sakit (gate reboot tak dipanggil).
 *          Latar: pelanggan Dander (Dani) menerima "koneksi normal, 0 perangkat, mau reboot?" untuk
 *          keluhan LEMOT padahal link utama sedang terganggu. Ini menutup regresi itu.
 * Caller: Jest.
 * Deps: mock jid-utils, mikrotik, wifi, auto-outage.repository, template-helpers,
 *       upstream-quality-poller (buildStatusReport), reboot-followup-service (evaluateRebootGate).
 * MainFuncs: -
 * SideEffects: Set global.config/global.users sementara; reset cache in-memori handler per test.
 */
'use strict';

jest.mock('../../../lib/jid-utils', () => ({ resolveCustomerBySender: jest.fn() }));
jest.mock('../../../lib/mikrotik', () => ({ getActivePPPoEUsers: jest.fn() }));
jest.mock('../../../lib/wifi', () => ({ getSSIDInfo: jest.fn() }));
jest.mock('../../../repositories/auto-outage.repository', () => ({
    createAutoOutageRepository: jest.fn(() => ({ getStateByUserId: jest.fn(async () => null) }))
}));
// renderResponseTemplate dimock mengembalikan KEY → mudah assert cabang/template mana yang dipilih.
jest.mock('../template-helpers', () => ({ renderResponseTemplate: jest.fn((key) => key) }));
jest.mock('../../../lib/upstream-quality-poller', () => ({ buildStatusReport: jest.fn() }));
jest.mock('../../../lib/reboot-followup-service', () => ({
    evaluateRebootGate: jest.fn(async () => ({ allowed: false, reason: 'FITUR_MATI', mode: 'strict' })),
    scheduleFollowupForReboot: jest.fn()
}));

const { resolveCustomerBySender } = require('../../../lib/jid-utils');
const { getActivePPPoEUsers } = require('../../../lib/mikrotik');
const { getSSIDInfo } = require('../../../lib/wifi');
const { buildStatusReport } = require('../../../lib/upstream-quality-poller');
const { evaluateRebootGate } = require('../../../lib/reboot-followup-service');
const { renderResponseTemplate } = require('../template-helpers');
const handler = require('../connection-check-handler');
const { handleCekKoneksi } = handler;

const USER = { id: 7, name: 'Dani', pppoe_username: 'dani-gempol@rafcybernet', device_id: 'DEV-DANI' };
// 192.168.70.5 ∈ pool default 'gmdp' (jalur utama); 10.99.99.5 tak masuk pool mana pun.
const MAPPED_IP = '192.168.70.5';
const UNMAPPED_IP = '10.99.99.5';

function ctx(overrides = {}) {
    const replies = [];
    return {
        sender: '628123@s.whatsapp.net',
        msg: {},
        raf: {},
        users: [USER],
        reply: (t) => replies.push(t),
        mess: {},
        pushname: 'Dani',
        chats: 'wifi lemot',
        replies,
        ...overrides
    };
}
function renderedKeys() {
    return renderResponseTemplate.mock.calls.map((c) => c[0]);
}
function activePppoe(ip) {
    getActivePPPoEUsers.mockResolvedValue([{ name: 'dani-gempol@rafcybernet', address: ip }]);
}

beforeEach(() => {
    jest.clearAllMocks();
    handler._resetCachesForTest();
    global.config = {};
    global.users = [USER];
    resolveCustomerBySender.mockResolvedValue({ user: USER, canonicalJid: '628123@s.whatsapp.net' });
    // Default: modem SEGAR, 2 perangkat. Tiap test menimpanya sesuai skenario.
    getSSIDInfo.mockResolvedValue({
        uptime: '3d',
        ssid: [{ associatedDevices: [{}, {}] }],
        lastInform: new Date().toISOString()
    });
    activePppoe(MAPPED_IP);
});

describe('anti data-palsu: baris modem', () => {
    test('data GenieACS BASI (lastInform 60 mnt lalu) → baris modem dihilangkan, tak ada klaim uptime/jumlah', async () => {
        global.config = { upstreamMonitor: { enabled: true } };
        buildStatusReport.mockResolvedValue({ paths: [{ key: 'gmdp', status: 'NORMAL' }] });
        getSSIDInfo.mockResolvedValue({
            uptime: '15d',
            ssid: [],
            lastInform: new Date(Date.now() - 60 * 60 * 1000).toISOString()
        });
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).not.toContain('conncheck_modem_line');
        expect(keys).not.toContain('conncheck_modem_line_nocount');
    });

    test('modem SEGAR tapi 0 perangkat → pakai template TANPA jumlah (tak pernah bilang "0 perangkat")', async () => {
        global.config = { upstreamMonitor: { enabled: true } };
        buildStatusReport.mockResolvedValue({ paths: [{ key: 'gmdp', status: 'NORMAL' }] });
        getSSIDInfo.mockResolvedValue({
            uptime: '3d',
            ssid: [{ associatedDevices: [] }],
            lastInform: new Date().toISOString()
        });
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).toContain('conncheck_modem_line_nocount');
        expect(keys).not.toContain('conncheck_modem_line');
    });

    test('modem SEGAR & ada perangkat → boleh menampilkan jumlah', async () => {
        global.config = { upstreamMonitor: { enabled: true } };
        buildStatusReport.mockResolvedValue({ paths: [{ key: 'gmdp', status: 'NORMAL' }] });
        await handleCekKoneksi(ctx());
        expect(renderedKeys()).toContain('conncheck_modem_line');
    });
});

describe('verdict jalur-AKTIF berbasis bukti', () => {
    test('jalur PELANGGAN sakit (PUTUS) → note jalur bermasalah, TIDAK klaim normal, reboot TAK ditawarkan', async () => {
        global.config = { upstreamMonitor: { enabled: true } };
        buildStatusReport.mockResolvedValue({
            paths: [{ key: 'gmdp', status: 'PUTUS', label: 'Utama', targets: [] }]
        });
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).toContain('conncheck_upstream_issue'); // note "jalur bermasalah, bukan perangkat Anda"
        expect(keys).not.toContain('conncheck_health_ok'); // TIDAK bilang "normal"
        expect(evaluateRebootGate).not.toHaveBeenCalled(); // reboot tak ditawarkan saat jaringan sakit
    });

    test('IP belum terpetakan TAPI ada jalur lain sakit → verdict kemungkinan-upstream, reboot TAK ditawarkan', async () => {
        activePppoe(UNMAPPED_IP);
        global.config = { upstreamMonitor: { enabled: true } };
        buildStatusReport.mockResolvedValue({ paths: [{ key: 'gmdp', status: 'PUTUS' }] });
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).toContain('conncheck_health_possible');
        expect(keys).not.toContain('conncheck_health_ok');
        expect(evaluateRebootGate).not.toHaveBeenCalled();
    });

    test('SEMUA jalur sehat → verdict HEALTHY (boleh klaim normal) + reboot dipertimbangkan', async () => {
        global.config = { upstreamMonitor: { enabled: true } };
        buildStatusReport.mockResolvedValue({ paths: [{ key: 'gmdp', status: 'NORMAL' }] });
        await handleCekKoneksi(ctx());
        expect(renderedKeys()).toContain('conncheck_health_ok');
        expect(evaluateRebootGate).toHaveBeenCalled();
    });

    test('tanpa sinyal upstream (fitur mati) → INCONCLUSIVE: aktif TANPA klaim normal, reboot dipertimbangkan', async () => {
        global.config = {}; // upstreamMonitor mati (mis. Tanjungharjo)
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).toContain('conncheck_health_active');
        expect(keys).not.toContain('conncheck_health_ok');
        expect(buildStatusReport).not.toHaveBeenCalled(); // tak menyentuh poller saat fitur mati
        expect(evaluateRebootGate).toHaveBeenCalled();
    });
});
