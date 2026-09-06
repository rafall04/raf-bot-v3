/**
 * Header Doc
 * Purpose: Uji #b319 — handleTopup TIDAK boleh klaim sukses saat kredit GAGAL. addKoinUser
 *   fail-closed (return false bila JID tak ter-resolve / amount invalid / DB sibuk); harus di-await
 *   & dicek. Bila gagal: owner dapat error, penerima TIDAK menerima "saldo Rp X masuk" (bohong).
 * Caller: Jest (`npx jest message/__tests__/balance-management-topup.test.js`).
 * Deps: mock template-helpers, templating, whatsapp-gateway, whatsapp-delivery-service, saldo-manager.
 * SideEffects: -
 */
'use strict';

jest.mock('../handlers/template-helpers', () => ({ renderResponseTemplate: jest.fn((key) => key) }));
jest.mock('../../lib/templating', () => ({ renderTemplate: jest.fn(() => 'PESAN') }));
jest.mock('../../lib/whatsapp-gateway', () => ({ getSocket: jest.fn(() => ({})) }));
jest.mock('../../lib/whatsapp-delivery-service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../lib/saldo-manager', () => ({ createUserSaldo: jest.fn() }));

const { handleTopup } = require('../handlers/balance-management-handler');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');

function topupArgs(over = {}) {
    return {
        q: '628123456789|50000',
        isOwner: true,
        sender: '628999@s.whatsapp.net',
        reply: jest.fn().mockResolvedValue(undefined),
        msg: {},
        mess: { owner: 'OWNER_ONLY', wrongFormat: 'WRONG', mustNumber: 'MUST_NUMBER' },
        addKoinUser: jest.fn(),
        ...over,
    };
}

describe('handleTopup: gagal kredit tak boleh klaim sukses (#b319)', () => {
    beforeEach(() => { sendMessage.mockReset(); sendMessage.mockResolvedValue({ sent: true }); });

    test('addKoinUser sukses → notif admin + kirim "saldo masuk" ke penerima', async () => {
        const args = topupArgs({ addKoinUser: jest.fn().mockResolvedValue(true) });
        await handleTopup(args);
        expect(args.addKoinUser).toHaveBeenCalledWith('628123456789@s.whatsapp.net', '50000');
        expect(args.reply).toHaveBeenCalled();
        expect(sendMessage).toHaveBeenCalledWith('628123456789@s.whatsapp.net', expect.any(Object), expect.any(Object));
    });

    test('addKoinUser GAGAL (false) → owner dapat error, penerima TIDAK di-notif "saldo masuk"', async () => {
        const args = topupArgs({ addKoinUser: jest.fn().mockResolvedValue(false) });
        await handleTopup(args);
        expect(args.reply).toHaveBeenCalledWith('balance_topup_generic_error');
        expect(sendMessage).not.toHaveBeenCalled();
    });
});
