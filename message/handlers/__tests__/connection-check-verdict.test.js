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
// Jalur pelanggan kini dari STEERING LIVE (customer-path-resolver) — dimock supaya test tak menyentuh router.
jest.mock('../../../lib/customer-path-resolver', () => ({ resolveCustomerPath: jest.fn() }));
jest.mock('../../../lib/reboot-followup-service', () => ({
    evaluateRebootGate: jest.fn(async () => ({ allowed: false, reason: 'FITUR_MATI', mode: 'strict' })),
    scheduleFollowupForReboot: jest.fn()
}));

const { resolveCustomerBySender } = require('../../../lib/jid-utils');
const { getActivePPPoEUsers } = require('../../../lib/mikrotik');
const { getSSIDInfo } = require('../../../lib/wifi');
const { buildStatusReport } = require('../../../lib/upstream-quality-poller');
const { resolveCustomerPath } = require('../../../lib/customer-path-resolver');
const { evaluateRebootGate } = require('../../../lib/reboot-followup-service');
const { renderResponseTemplate } = require('../template-helpers');
const handler = require('../connection-check-handler');
const { handleCekKoneksi } = handler;

const USER = { id: 7, name: 'Dani', pppoe_username: 'dani-gempol@rafcybernet', device_id: 'DEV-DANI' };
// Jalur pelanggan kini ditentukan mock resolveCustomerPath (steering live), bukan nilai IP.
const ANY_IP = '192.168.70.5';

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
    activePppoe(ANY_IP);
    // Default: pelanggan tak di-steer → jalur utama 'gmdp'. Tiap test menimpanya sesuai skenario.
    resolveCustomerPath.mockResolvedValue('gmdp');
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

    test('jalur pelanggan tak bisa dipastikan (router tak terbaca) TAPI ada jalur sakit → kemungkinan-upstream, reboot TAK ditawarkan', async () => {
        activePppoe(ANY_IP);
        resolveCustomerPath.mockResolvedValue(null); // steering tak terbaca → fail-closed
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

// RC2: gangguan SPESIFIK-LAYANAN ≠ "jaringan terganggu". TERUKUR di Tanjungharjo — uplink GMDP
// rtt 0,1ms & internet umum lancar, tapi Meta 80% loss sendirian bikin SEMUA pelanggan dikabari
// "jalur terganggu padahal aman". Kini: uplink sehat + minoritas layanan buruk → koneksi normal +
// sebut layanannya; "jalur terganggu" hanya saat uplink sakit / jalur putus / mayoritas target rusak.
describe('spesifik-layanan vs seluruh-jalur (RC2 padahal-aman)', () => {
    const TARGETS_NAMA = [
        { key: 'meta', namaAwam: 'Facebook & Instagram' },
        { key: 'youtube', namaAwam: 'YouTube' }
    ];
    // Bangun entri jalur report: gateway + N target PARAH (GANGGUAN) + M target RINGAN (DEGRADASI).
    // 'meta' & 'youtube' punya namaAwam; urutan dibuat supaya yang parah mengenai keduanya lebih dulu.
    function pathEntry({ status, gwLoss, severe = 0, mild = 0 }) {
        const kinds = ['meta', 'youtube', 'akamai', 'google', 'cloudflare', 'garena', 'moonton'];
        const targets = kinds.map((k, i) => {
            let verdict = 'NORMAL';
            if (i < severe) verdict = 'GANGGUAN';
            else if (i < severe + mild) verdict = 'DEGRADASI';
            return { target_key: k, verdict };
        });
        return { key: 'gmdp', label: 'Utama', status, gateway: { loss_avg_pct: gwLoss, rtt_avg_ms: 0.1 }, targets };
    }

    test('uplink SEHAT + hanya Meta PARAH (sisanya normal/ringan) → SERVICE_ISSUE: koneksi normal + sebut Meta, TIDAK "jalur terganggu", reboot TAK ditawarkan', async () => {
        global.config = { upstreamMonitor: { enabled: true, targets: TARGETS_NAMA } };
        // 1 parah (Meta) + 1 ringan (YouTube 7% noise) — persis kondisi terukur di prod.
        buildStatusReport.mockResolvedValue({ paths: [pathEntry({ status: 'DEGRADASI', gwLoss: 7, severe: 1, mild: 1 })] });
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).toContain('conncheck_health_ok'); // uplink terpantau normal
        expect(keys).toContain('conncheck_layanan_terganggu'); // sebut Facebook & Instagram
        expect(keys).not.toContain('conncheck_upstream_issue'); // JANGAN "jaringan/jalur terganggu"
        expect(evaluateRebootGate).not.toHaveBeenCalled(); // bukan masalah perangkat → tak nawari reboot
    });

    test('degradasi RINGAN menyeluruh (noise kuantisasi), tak ada yang PARAH, uplink sehat → HEALTHY (jangan alarm)', async () => {
        global.config = { upstreamMonitor: { enabled: true, targets: TARGETS_NAMA } };
        buildStatusReport.mockResolvedValue({ paths: [pathEntry({ status: 'DEGRADASI', gwLoss: 7, severe: 0, mild: 4 })] });
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).toContain('conncheck_health_ok'); // koneksi normal
        expect(keys).not.toContain('conncheck_layanan_terganggu'); // tak ada layanan parah utk disebut
        expect(keys).not.toContain('conncheck_upstream_issue');
    });

    test('uplink SENDIRI sakit (gateway loss tinggi) → UPSTREAM_ISSUE (jalur benar terganggu)', async () => {
        global.config = { upstreamMonitor: { enabled: true, targets: TARGETS_NAMA } };
        buildStatusReport.mockResolvedValue({ paths: [pathEntry({ status: 'GANGGUAN', gwLoss: 60, severe: 1 })] });
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).toContain('conncheck_upstream_issue');
        expect(keys).not.toContain('conncheck_health_ok');
    });

    test('uplink sehat TAPI MAYORITAS target PARAH (transit ISP) → UPSTREAM_ISSUE', async () => {
        global.config = { upstreamMonitor: { enabled: true, targets: TARGETS_NAMA } };
        buildStatusReport.mockResolvedValue({ paths: [pathEntry({ status: 'GANGGUAN', gwLoss: 5, severe: 5 })] });
        await handleCekKoneksi(ctx());
        expect(renderedKeys()).toContain('conncheck_upstream_issue');
    });

    test('IP pelanggan tak terpetakan + hanya jalur CADANGAN (gmdp2) yang PUTUS → INCONCLUSIVE, BUKAN "sebagian terganggu"', async () => {
        resolveCustomerPath.mockResolvedValue(null);
        global.config = { upstreamMonitor: { enabled: true, targets: TARGETS_NAMA } };
        buildStatusReport.mockResolvedValue({
            paths: [
                { key: 'gmdp', status: 'NORMAL', targets: [] },
                { key: 'gmdp2', status: 'PUTUS', targets: [] }
            ]
        });
        await handleCekKoneksi(ctx());
        const keys = renderedKeys();
        expect(keys).toContain('conncheck_health_active'); // INCONCLUSIVE
        expect(keys).not.toContain('conncheck_health_possible'); // cadangan tak boleh bocor ke pelanggan
    });
});
