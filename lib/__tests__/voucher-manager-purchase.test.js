/**
 * Regression test untuk purchaseVoucherWithSaldo.
 * Fokus: getUserSaldo & deductSaldo adalah async dan WAJIB di-await.
 * Tanpa await:
 *   - pre-check `userSaldo < price` membandingkan Promise < number = selalu false (saldo kurang lolos).
 *   - `if (!deducted)` selalu false (deduct gagal dianggap sukses) -> voucher gratis.
 */

jest.mock('../mikrotik', () => ({
    getvoucher: jest.fn()
}));
jest.mock('../financial-ledger', () => ({
    syncFinancialLedgerSources: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('fs', () => ({
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => JSON.stringify([
        { prof: 'P1', namavc: 'Paket 1', hargavc: '5000', durasivc: '1 Hari' }
    ])),
    writeFileSync: jest.fn()
}));

const { getvoucher } = require('../mikrotik');
const { purchaseVoucherWithSaldo } = require('../voucher-manager');

function makeSaldoManager({ saldo, deductResult }) {
    return {
        getUserSaldo: jest.fn().mockResolvedValue(saldo),
        deductSaldo: jest.fn().mockResolvedValue(deductResult)
    };
}

beforeEach(() => {
    getvoucher.mockReset();
    getvoucher.mockResolvedValue({ ok: true, data: { username: 'v123', password: 'p123', profile: 'P1' } });
});

describe('purchaseVoucherWithSaldo', () => {
    test('saldo kurang: tolak TANPA generate voucher di MikroTik', async () => {
        const saldoManager = makeSaldoManager({ saldo: 1000, deductResult: true });
        const result = await purchaseVoucherWithSaldo('user-1', 'P1', saldoManager);

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Saldo tidak cukup/i);
        expect(getvoucher).not.toHaveBeenCalled();
        expect(saldoManager.deductSaldo).not.toHaveBeenCalled();
    });

    test('deduct gagal: kembalikan gagal (tidak menganggap sukses)', async () => {
        const saldoManager = makeSaldoManager({ saldo: 10000, deductResult: false });
        const result = await purchaseVoucherWithSaldo('user-1', 'P1', saldoManager);

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Gagal memotong saldo/i);
    });

    test('happy path: saldo cukup + deduct sukses -> voucher terbit', async () => {
        const saldoManager = makeSaldoManager({ saldo: 10000, deductResult: true });
        const result = await purchaseVoucherWithSaldo('user-1', 'P1', saldoManager);

        expect(result.success).toBe(true);
        expect(result.voucher.code).toBe('v123');
        expect(saldoManager.deductSaldo).toHaveBeenCalledWith('user-1', 5000, expect.any(String));
    });
});
