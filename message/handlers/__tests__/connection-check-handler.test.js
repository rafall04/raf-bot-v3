/**
 * Header Doc
 * Purpose: Unit test handler "Cek Koneksi" — verifikasi pemilihan pesan per kondisi:
 *          jalur online, terputus (gangguan area), terputus (hanya pelanggan), status unknown,
 *          pelanggan belum terdaftar, dan MikroTik error (graceful, tidak throw).
 * Caller: Jest.
 * Deps: mock lib/jid-utils, lib/mikrotik, lib/wifi, repositories/auto-outage.repository, template-helpers.
 * MainFuncs: -
 * SideEffects: Set global.config/global.users sementara selama test.
 */
'use strict';

jest.mock('../../../lib/jid-utils', () => ({ resolveCustomerBySender: jest.fn() }));
jest.mock('../../../lib/mikrotik', () => ({ getActivePPPoEUsers: jest.fn() }));
jest.mock('../../../lib/wifi', () => ({ getSSIDInfo: jest.fn() }));
jest.mock('../../../repositories/auto-outage.repository', () => ({
    createAutoOutageRepository: jest.fn(() => ({ getStateByUserId: jest.fn(async () => null) }))
}));
// renderResponseTemplate dimock mengembalikan KEY → mudah assert cabang mana yang dipilih.
jest.mock('../template-helpers', () => ({ renderResponseTemplate: jest.fn((key) => key) }));

const { resolveCustomerBySender } = require('../../../lib/jid-utils');
const { getActivePPPoEUsers } = require('../../../lib/mikrotik');
const { getSSIDInfo } = require('../../../lib/wifi');
const { createAutoOutageRepository } = require('../../../repositories/auto-outage.repository');
const { renderResponseTemplate } = require('../template-helpers');
const { handleCekKoneksi } = require('../connection-check-handler');

function activeFrom(usernames) {
    return usernames.map((name) => ({ name }));
}

function makeUsers(count) {
    return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `U${i}`, pppoe_username: `cust-${i}` }));
}

function baseCtx(overrides = {}) {
    return {
        sender: '628111@s.whatsapp.net',
        msg: {},
        raf: {},
        reply: jest.fn(),
        mess: { userNotRegister: 'USER_NOT_REGISTER' },
        pushname: 'Budi',
        users: [],
        ...overrides
    };
}

function lastReply(ctx) {
    const calls = ctx.reply.mock.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
}

// router_id unik per test → key cache PPP-active berbeda → tidak bocor antar-test
function withRouter(routerId) {
    createAutoOutageRepository.mockReturnValue({
        getStateByUserId: jest.fn(async () => ({ router_id: routerId }))
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    global.config = {};
    global.users = [];
    getSSIDInfo.mockResolvedValue({ uptime: '1d', ssid: [] });
    createAutoOutageRepository.mockReturnValue({ getStateByUserId: jest.fn(async () => null) });
});

describe('handleCekKoneksi', () => {
    test('pelanggan tidak terdaftar → pesan not_registered, tidak query MikroTik', async () => {
        resolveCustomerBySender.mockResolvedValue({ user: null });
        const ctx = baseCtx();
        await handleCekKoneksi(ctx);
        expect(lastReply(ctx)).toBe('conncheck_not_registered');
        expect(getActivePPPoEUsers).not.toHaveBeenCalled();
    });

    test('jalur AKTIF saat pppoe ada di daftar PPP active (+ modem dicek bila ada device_id)', async () => {
        withRouter('r-online');
        const users = makeUsers(5);
        const target = { ...users[1], device_id: 'D1' }; // cust-1
        users[1] = target;
        resolveCustomerBySender.mockResolvedValue({ user: target });
        getActivePPPoEUsers.mockResolvedValue(activeFrom(['cust-0', 'cust-1', 'cust-2']));
        const ctx = baseCtx({ users });

        await handleCekKoneksi(ctx);

        expect(ctx.reply).toHaveBeenCalledWith('conncheck_loading');
        expect(lastReply(ctx)).toBe('conncheck_online');
        expect(getActivePPPoEUsers).toHaveBeenCalledWith({ router_id: 'r-online' });
        expect(getSSIDInfo).toHaveBeenCalledWith('D1', true);
    });

    test('TERPUTUS + gangguan area saat banyak pelanggan offline berbarengan', async () => {
        withRouter('r-area');
        const users = makeUsers(10);
        resolveCustomerBySender.mockResolvedValue({ user: users[9] }); // cust-9 offline
        getActivePPPoEUsers.mockResolvedValue(activeFrom(['cust-0', 'cust-1', 'cust-2', 'cust-3'])); // 6 offline
        const ctx = baseCtx({ users });

        await handleCekKoneksi(ctx);

        expect(lastReply(ctx)).toBe('conncheck_offline_area_v3');
    });

    // Jumlah pelanggan yang ikut offline = DATA USAHA (saat gangguan massal angkanya nyaris sama
    // dengan total pelanggan). Pernah bocor lewat slot `${jumlah}` di template lama
    // `conncheck_offline_area`. Guard ini menjaga KEDUA sisi jalur render sekaligus:
    //   (a) slot tak pernah dioper ke render → admin pun tak bisa re-leak lewat edit template;
    //   (b) teks fallback runtime tidak memuat angka.
    // Template TERSIMPAN dijaga terpisah di bawah (template menimpa fallback).
    test('pesan gangguan area TIDAK membocorkan jumlah pelanggan terdampak', async () => {
        withRouter('r-area-bocor');
        const users = makeUsers(10);
        resolveCustomerBySender.mockResolvedValue({ user: users[9] });
        getActivePPPoEUsers.mockResolvedValue(activeFrom(['cust-0', 'cust-1', 'cust-2', 'cust-3']));

        await handleCekKoneksi(baseCtx({ users }));

        const call = renderResponseTemplate.mock.calls.find(([key]) => key === 'conncheck_offline_area_v3');
        expect(call).toBeDefined();
        const [, fallback, data] = call;
        expect(Object.keys(data)).not.toContain('jumlah');
        expect(fallback).not.toContain('${jumlah}');
        expect(fallback).not.toMatch(/\d+\s*pelanggan/i);
    });

    test('template tersimpan gangguan area bebas slot jumlah (template menimpa fallback)', () => {
        const templates = require('../../../database/response_templates.json');
        expect(templates.conncheck_offline_area_v3).toBeDefined();
        // Key lama sengaja DIBUANG dari repo: salinan hasil kustomisasi di prod (merge-key,
        // tak pernah ditimpa deploy) jadi yatim → kebocoran berhenti tanpa edit manual di server.
        expect(templates.conncheck_offline_area).toBeUndefined();
        // v2 menjanjikan 'kami kabari begitu koneksi pulih' — janji yang tak punya pemilik
        // (pengabar-pulih hanya menyapa yang IA sendiri DM). Dibuang dengan alasan yang sama.
        expect(templates.conncheck_offline_area_v2).toBeUndefined();
        expect(templates.conncheck_offline_area_v3.template).not.toContain('${jumlah}');
        expect(templates.conncheck_offline_area_v3.template).not.toMatch(/\d+\s*pelanggan/i);
    });

    test('TERPUTUS hanya pelanggan ini saat mayoritas online', async () => {
        withRouter('r-single');
        const users = makeUsers(10);
        resolveCustomerBySender.mockResolvedValue({ user: users[9] }); // hanya cust-9 offline
        getActivePPPoEUsers.mockResolvedValue(
            activeFrom(['cust-0', 'cust-1', 'cust-2', 'cust-3', 'cust-4', 'cust-5', 'cust-6', 'cust-7', 'cust-8'])
        );
        const ctx = baseCtx({ users });

        await handleCekKoneksi(ctx);

        expect(lastReply(ctx)).toBe('conncheck_offline_single');
    });

    test('status unknown saat pelanggan tanpa pppoe_username (tidak query MikroTik)', async () => {
        const user = { id: 1, name: 'NoPPP' };
        resolveCustomerBySender.mockResolvedValue({ user });
        const ctx = baseCtx({ users: [user] });

        await handleCekKoneksi(ctx);

        expect(lastReply(ctx)).toBe('conncheck_unknown');
        expect(getActivePPPoEUsers).not.toHaveBeenCalled();
    });

    test('graceful saat MikroTik error → unknown, tidak throw', async () => {
        withRouter('r-err');
        const users = makeUsers(3);
        resolveCustomerBySender.mockResolvedValue({ user: users[0] });
        getActivePPPoEUsers.mockRejectedValue(new Error('mikrotik down'));
        const ctx = baseCtx({ users });

        await expect(handleCekKoneksi(ctx)).resolves.not.toThrow();
        expect(lastReply(ctx)).toBe('conncheck_unknown');
    });
});
