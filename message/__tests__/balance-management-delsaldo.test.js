/**
 * Test handleDelSaldo (Tier B revive):
 * - Nomor tak terdaftar -> ditolak (pakai checkRegisteredATM), delSaldo TIDAK dipanggil.
 * - Terdaftar + delSaldo sukses -> kirim notifikasi sukses (delSaldo di-await).
 * - Terdaftar + delSaldo gagal -> balas error, tidak kirim sukses.
 */

jest.mock('../handlers/template-helpers', () => ({
    renderResponseTemplate: jest.fn((key) => key)
}));
jest.mock('../../lib/templating', () => ({
    renderTemplate: jest.fn(() => 'DEL_SUCCESS')
}));
jest.mock('../../lib/whatsapp-gateway', () => ({ getSocket: jest.fn(() => ({})) }));
jest.mock('../../lib/whatsapp-delivery-service', () => ({ sendMessage: jest.fn() }));

const { handleDelSaldo } = require('../handlers/balance-management-handler');

const mess = { owner: 'OWNER_ONLY', wrongFormat: 'WRONG', mustNumber: 'MUST_NUMBER' };

function makeArgs(overrides = {}) {
    return {
        q: '628123456789',
        isOwner: true,
        reply: jest.fn().mockResolvedValue(undefined),
        mess,
        checkATMuser: jest.fn().mockResolvedValue(0),
        checkRegisteredATM: jest.fn(),
        delSaldo: jest.fn(),
        ...overrides
    };
}

describe('handleDelSaldo', () => {
    test('nomor tak terdaftar: tolak tanpa memanggil delSaldo', async () => {
        const args = makeArgs();
        args.checkRegisteredATM.mockResolvedValue(false);

        await handleDelSaldo(args);

        expect(args.checkRegisteredATM).toHaveBeenCalled();
        expect(args.delSaldo).not.toHaveBeenCalled();
        expect(args.reply).toHaveBeenCalledWith('balance_del_saldo_not_found');
    });

    test('terdaftar + delSaldo sukses: kirim notifikasi sukses', async () => {
        const args = makeArgs();
        args.checkRegisteredATM.mockResolvedValue(true);
        args.delSaldo.mockResolvedValue(true);

        await handleDelSaldo(args);

        expect(args.delSaldo).toHaveBeenCalledWith('628123456789@s.whatsapp.net');
        expect(args.reply).toHaveBeenCalledWith('DEL_SUCCESS', { skipDuplicateCheck: true });
    });

    test('terdaftar + delSaldo gagal: balas error, bukan sukses', async () => {
        const args = makeArgs();
        args.checkRegisteredATM.mockResolvedValue(true);
        args.delSaldo.mockResolvedValue(false);

        await handleDelSaldo(args);

        expect(args.reply).toHaveBeenCalledWith('balance_del_saldo_generic_error');
        expect(args.reply).not.toHaveBeenCalledWith('DEL_SUCCESS', { skipDuplicateCheck: true });
    });
});
