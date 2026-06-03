/**
 * Regresi purchaseVoucherAsReseller (jalur pembayaran saldo).
 * Fokus: getUserSaldo & deductSaldo async WAJIB di-await.
 * Tanpa await: pre-check saldo (Promise < number = false) & cek !deducted selalu lolos
 * -> agent saldo kurang/deduct gagal tetap dianggap sukses (voucher reseller gratis).
 */

jest.mock('../voucher-manager', () => ({
    getVoucherProfiles: jest.fn(() => [
        { prof: 'R1', namavc: 'Reseller 1', hargaReseller: '4000', durasivc: '1 Hari' }
    ])
}));
jest.mock('../agent-manager', () => ({
    getAgentById: jest.fn(() => ({ id: 'A1', name: 'Agen Satu', phone: '08123456789' }))
}));
jest.mock('../saldo-manager', () => ({
    getUserSaldo: jest.fn(),
    deductSaldo: jest.fn(),
    formatCurrency: (n) => `Rp ${n}`
}));

const saldoManager = require('../saldo-manager');
const { purchaseVoucherAsReseller } = require('../agent-voucher-manager');

beforeEach(() => {
    saldoManager.getUserSaldo.mockReset();
    saldoManager.deductSaldo.mockReset();
});

describe('purchaseVoucherAsReseller - pembayaran saldo', () => {
    test('saldo kurang: tolak TANPA memotong saldo', async () => {
        saldoManager.getUserSaldo.mockResolvedValue(1000); // < 4000
        const result = await purchaseVoucherAsReseller('A1', 'R1', 1, 'saldo', 'Agen Satu');

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Saldo tidak cukup/i);
        expect(saldoManager.deductSaldo).not.toHaveBeenCalled();
    });

    test('deduct gagal: kembalikan gagal (tidak dianggap sukses)', async () => {
        saldoManager.getUserSaldo.mockResolvedValue(10000);
        saldoManager.deductSaldo.mockResolvedValue(false);
        const result = await purchaseVoucherAsReseller('A1', 'R1', 1, 'saldo', 'Agen Satu');

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Gagal memotong saldo/i);
    });
});
