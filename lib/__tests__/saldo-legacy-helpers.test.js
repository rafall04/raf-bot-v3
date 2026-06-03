/**
 * Regresi lib/saldo.js: checkRegisteredATM & delSaldo (Tier B).
 * - checkRegisteredATM: pakai getUserSaldoData (null bila tak ada) -> boolean benar.
 * - delSaldo: async; potong seluruh saldo (set ke 0); saldo 0 = sukses tanpa deduct.
 */

jest.useFakeTimers(); // netralkan setTimeout sync 2s di module load

jest.mock('../saldo-manager', () => ({
    getUserSaldo: jest.fn(),
    getUserSaldoData: jest.fn(),
    deductSaldo: jest.fn(),
    createUserSaldo: jest.fn(),
    addSaldo: jest.fn(),
    getAllSaldoData: jest.fn().mockResolvedValue([])
}));

const saldoManager = require('../saldo-manager');
const { checkRegisteredATM, delSaldo } = require('../saldo');

beforeEach(() => {
    saldoManager.getUserSaldo.mockReset();
    saldoManager.getUserSaldoData.mockReset();
    saldoManager.deductSaldo.mockReset();
});

describe('checkRegisteredATM', () => {
    test('user terdaftar (row ada) -> true', async () => {
        saldoManager.getUserSaldoData.mockResolvedValue({ user_id: 'u@s.whatsapp.net', saldo: 0 });
        await expect(checkRegisteredATM('u@s.whatsapp.net')).resolves.toBe(true);
    });

    test('user tak terdaftar (null) -> false', async () => {
        saldoManager.getUserSaldoData.mockResolvedValue(null);
        await expect(checkRegisteredATM('x@s.whatsapp.net')).resolves.toBe(false);
    });
});

describe('delSaldo', () => {
    test('saldo > 0: potong seluruh saldo lalu sukses', async () => {
        saldoManager.getUserSaldo.mockResolvedValue(5000);
        saldoManager.deductSaldo.mockResolvedValue(true);

        await expect(delSaldo('u@s.whatsapp.net')).resolves.toBe(true);
        expect(saldoManager.deductSaldo).toHaveBeenCalledWith('u@s.whatsapp.net', 5000, 'Hapus saldo');
    });

    test('saldo 0: sukses tanpa memanggil deduct', async () => {
        saldoManager.getUserSaldo.mockResolvedValue(0);

        await expect(delSaldo('u@s.whatsapp.net')).resolves.toBe(true);
        expect(saldoManager.deductSaldo).not.toHaveBeenCalled();
    });

    test('deduct gagal: kembalikan false', async () => {
        saldoManager.getUserSaldo.mockResolvedValue(5000);
        saldoManager.deductSaldo.mockResolvedValue(false);

        await expect(delSaldo('u@s.whatsapp.net')).resolves.toBe(false);
    });
});
