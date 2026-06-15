"use strict";

/**
 * Header Doc
 * Purpose: Guardrail test untuk handleAgentConfirmation — memastikan tiap transactionType
 *          dirutekan ke jalur yang benar. Khususnya 'voucher_sale' (penjualan sudah final
 *          saat dibuat) TIDAK boleh menyentuh processAgentConfirmation yang topup-only,
 *          sehingga agent tidak lagi menerima pesan menyesatkan "Gagal memproses saldo".
 * Caller: Jest test runner.
 * Deps: ../handlers/agent (dengan agent-transaction-manager & saldo-manager di-mock).
 * MainFuncs: Verifikasi cabang voucher_sale, tipe non-topup generik, dan regresi topup.
 * SideEffects: Tidak ada (semua dependency di-mock).
 */

jest.mock('../../lib/agent-manager', () => ({}));

jest.mock('../../lib/agent-transaction-manager', () => ({
    getTransactionById: jest.fn(),
    confirmTransaction: jest.fn()
}));

jest.mock('../../lib/saldo-manager', () => ({
    processAgentConfirmation: jest.fn()
}));

jest.mock('../../lib/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }
}));

jest.mock('../../lib/jid-utils', () => ({
    extractSenderInfo: jest.fn().mockReturnValue({})
}));

jest.mock('../../lib/whatsapp-delivery-service', () => ({
    sendMessage: jest.fn().mockResolvedValue({ sent: true }),
    sendMessageToMany: jest.fn().mockResolvedValue(undefined)
}));

// renderResponseTemplate() jatuh ke fallback hardcoded saat format() balas kosong.
jest.mock('../handlers/conversation-handler', () => ({
    format: jest.fn().mockReturnValue('')
}));

const agentTransactionManager = require('../../lib/agent-transaction-manager');
const saldoManager = require('../../lib/saldo-manager');
const { handleAgentConfirmation } = require('../handlers/agent');

const SENDER = '628999@s.whatsapp.net';
const msg = { key: { remoteJid: SENDER }, message: {} };

describe('handleAgentConfirmation — perutean per transactionType', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("voucher_sale: tidak memanggil confirmTransaction / processAgentConfirmation dan tidak memunculkan error saldo", async () => {
        agentTransactionManager.getTransactionById.mockReturnValue({
            id: 'AGT_TRX_SALE1',
            transactionType: 'voucher_sale',
            status: 'pending',
            amount: 15000,
            customerId: '628111@s.whatsapp.net',
            customerName: 'Pelanggan',
            agentName: 'Agen'
        });

        const reply = jest.fn().mockResolvedValue(undefined);

        await handleAgentConfirmation(msg, SENDER, reply, ['AGT_TRX_SALE1', '1234']);

        // Penjualan sudah final → tak ada yang perlu dikonfirmasi/diproses
        expect(agentTransactionManager.confirmTransaction).not.toHaveBeenCalled();
        expect(saldoManager.processAgentConfirmation).not.toHaveBeenCalled();

        // Pesan informatif, BUKAN error "Gagal memproses saldo"
        expect(reply).toHaveBeenCalledWith(expect.stringContaining('tidak perlu dikonfirmasi'));
        expect(reply).not.toHaveBeenCalledWith(expect.stringContaining('Gagal memproses saldo'));
    });

    test("tipe non-topup lain (mis. 'payment'): dikonfirmasi tapi tidak lewat jalur saldo topup", async () => {
        agentTransactionManager.getTransactionById.mockReturnValue({
            id: 'AGT_TRX_PAY1',
            transactionType: 'payment',
            status: 'pending',
            amount: 50000
        });
        agentTransactionManager.confirmTransaction.mockResolvedValue({
            success: true,
            transaction: { id: 'AGT_TRX_PAY1', transactionType: 'payment', amount: 50000 }
        });

        const reply = jest.fn().mockResolvedValue(undefined);

        await handleAgentConfirmation(msg, SENDER, reply, ['AGT_TRX_PAY1', '1234']);

        expect(agentTransactionManager.confirmTransaction).toHaveBeenCalledWith('AGT_TRX_PAY1', SENDER, '1234');
        expect(saldoManager.processAgentConfirmation).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith(expect.stringContaining('KONFIRMASI BERHASIL'));
        expect(reply).not.toHaveBeenCalledWith(expect.stringContaining('Gagal memproses saldo'));
    });

    test('regresi topup: tetap memanggil processAgentConfirmation', async () => {
        agentTransactionManager.getTransactionById.mockReturnValue({
            id: 'AGT_TRX_TOP1',
            transactionType: 'topup',
            status: 'pending',
            amount: 20000,
            customerId: '628111@s.whatsapp.net',
            customerName: 'Pelanggan',
            agentName: 'Agen'
        });
        agentTransactionManager.confirmTransaction.mockResolvedValue({
            success: true,
            transaction: { id: 'AGT_TRX_TOP1', transactionType: 'topup', amount: 20000 }
        });
        saldoManager.processAgentConfirmation.mockResolvedValue({
            success: true,
            newSaldo: 120000,
            topupRequest: { id: 'TOPUP1' }
        });

        const reply = jest.fn().mockResolvedValue(undefined);

        await handleAgentConfirmation(msg, SENDER, reply, ['AGT_TRX_TOP1', '1234']);

        expect(saldoManager.processAgentConfirmation).toHaveBeenCalledWith('AGT_TRX_TOP1');
        expect(reply).toHaveBeenCalledWith(expect.stringContaining('KONFIRMASI BERHASIL'));
    });
});
