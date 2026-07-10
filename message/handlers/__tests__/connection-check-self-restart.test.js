/**
 * Header Doc
 * Purpose: Mengunci perilaku saat pelanggan MELAPOR sudah mencabut/merestart modemnya sendiri:
 *          bot TIDAK menawarkan reboot lagi, tetapi WAJIB menjadwalkan pemantauan agar ia aktif
 *          bertanya "sudah aman?" beberapa menit kemudian. Kasus nyata prod (Tanjungharjo,
 *          6281244872662, 2026-07-10): bot diam total setelah "Ini baru dicoba cabut".
 * Caller: Jest.
 * Deps: mock lib/jid-utils, lib/mikrotik, lib/wifi, lib/reboot-followup-service, template-helpers.
 * MainFuncs: -
 * SideEffects: Set global.config sementara.
 */
'use strict';

jest.mock('../../../lib/jid-utils', () => ({ resolveCustomerBySender: jest.fn() }));
jest.mock('../../../lib/mikrotik', () => ({ getActivePPPoEUsers: jest.fn() }));
jest.mock('../../../lib/wifi', () => ({ getSSIDInfo: jest.fn(async () => ({ uptime: '1h', ssid: [] })) }));
jest.mock('../../../repositories/auto-outage.repository', () => ({
    createAutoOutageRepository: jest.fn(() => ({ getStateByUserId: jest.fn(async () => null) }))
}));
jest.mock('../template-helpers', () => ({ renderResponseTemplate: jest.fn((key) => key) }));
jest.mock('../../../lib/reboot-followup-service', () => ({
    evaluateRebootGate: jest.fn(),
    scheduleFollowupForReboot: jest.fn()
}));

const { resolveCustomerBySender } = require('../../../lib/jid-utils');
const { getActivePPPoEUsers } = require('../../../lib/mikrotik');
const { evaluateRebootGate, scheduleFollowupForReboot } = require('../../../lib/reboot-followup-service');
const { handleCekKoneksi } = require('../connection-check-handler');

const USER = { id: 21, name: 'Suci Purwanti', pppoe_username: 'suci', device_id: 'DEV-1', subscription: 'PAKET-110K' };
const CANONICAL = '6281244872662@s.whatsapp.net';

function ctx(chats) {
    const replies = [];
    return {
        sender: '273426359050386@lid',
        msg: {},
        raf: {},
        users: [USER],
        reply: (t) => replies.push(t),
        mess: {},
        pushname: 'suci',
        chats,
        replies
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    global.config = { rebootAssist: { enabled: true } };
    resolveCustomerBySender.mockResolvedValue({ user: USER, canonicalJid: CANONICAL });
    // PPPoE pelanggan aktif → jalur online.
    getActivePPPoEUsers.mockResolvedValue([{ name: 'suci', address: '192.168.41.248' }]);
    scheduleFollowupForReboot.mockReturnValue({ id: 'RFU-9', dueAt: new Date().toISOString() });
});

test("pelanggan bilang sudah cabut sendiri → bot menjadwalkan pemantauan, bukan diam", async () => {
    evaluateRebootGate.mockResolvedValue({ allowed: false, reason: 'SUDAH_RESTART_SENDIRI', mode: 'strict' });

    const c = ctx('Ini baru dicoba cabut');
    await handleCekKoneksi(c);

    expect(scheduleFollowupForReboot).toHaveBeenCalledWith(
        expect.objectContaining({ user: USER, jid: CANONICAL, reason: 'restart_pelanggan' })
    );
    // Balasan memakai template pemantauan, bukan tawaran reboot.
    const { renderResponseTemplate } = require('../template-helpers');
    const keys = renderResponseTemplate.mock.calls.map((c2) => c2[0]);
    expect(keys).toContain('rebootfu_watch_self_restart');
    expect(keys).not.toContain('rebootfu_offer');
});

test("job dikaitkan ke JID kanonik, bukan @lid", async () => {
    evaluateRebootGate.mockResolvedValue({ allowed: false, reason: 'SUDAH_RESTART_SENDIRI', mode: 'strict' });
    await handleCekKoneksi(ctx('sudah tak cabut mas'));

    const arg = scheduleFollowupForReboot.mock.calls[0][0];
    expect(arg.jid).toBe(CANONICAL);
    expect(arg.jid).not.toMatch(/@lid$/);
});

test("gate menolak karena alasan LAIN → tidak menjadwalkan apa pun", async () => {
    evaluateRebootGate.mockResolvedValue({ allowed: false, reason: 'GANGGUAN_AREA', mode: 'full' });
    await handleCekKoneksi(ctx('wifi mati kak'));
    expect(scheduleFollowupForReboot).not.toHaveBeenCalled();
});

test("JID kanonik tak terselesaikan → tidak menjadwalkan (invarian @lid)", async () => {
    resolveCustomerBySender.mockResolvedValue({ user: USER, canonicalJid: null });
    evaluateRebootGate.mockResolvedValue({ allowed: false, reason: 'SUDAH_RESTART_SENDIRI', mode: 'strict' });
    await handleCekKoneksi(ctx('Ini baru dicoba cabut'));
    expect(scheduleFollowupForReboot).not.toHaveBeenCalled();
});
