"use strict";

jest.mock('../../lib/saldo-manager', () => ({
    createUserSaldo: jest.fn(),
    getUserSaldo: jest.fn().mockResolvedValue(25000),
    getAllTransactions: jest.fn().mockReturnValue([])
}));

jest.mock('../../lib/jid-utils', () => ({
    resolveCanonicalCustomerContext: jest.fn().mockResolvedValue({
        rawSender: '12345@lid',
        canonicalJid: '628123456789@s.whatsapp.net',
        phoneNumber: '628123456789',
        resolved: true,
        resolutionSource: 'message_metadata',
        user: null
    }),
    normalizePhoneToJid: jest.fn((phone) => `${phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`),
    maskPhoneNumber: jest.fn((phone) => phone)
}));

jest.mock('../../lib/templating', () => ({
    renderTemplate: jest.fn().mockImplementation((key, data) => `${key}:${data.nomor_hp || ''}`)
}));

jest.mock('../../lib/logger', () => ({
    logger: {
        info: jest.fn(),
        error: jest.fn()
    }
}));

const saldoManager = require('../../lib/saldo-manager');
const { handleCekSaldo } = require('../handlers/saldo-handler');

describe('saldo canonicalization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('cek saldo uses canonical jid for @lid sender', async () => {
        const reply = jest.fn().mockResolvedValue(undefined);

        await handleCekSaldo({
            key: { remoteJid: '12345@lid' },
            message: {}
        }, '12345@lid', reply, 'Tester');

        expect(saldoManager.createUserSaldo).toHaveBeenCalledWith('628123456789@s.whatsapp.net');
        expect(saldoManager.getUserSaldo).toHaveBeenCalledWith('628123456789@s.whatsapp.net');
        expect(reply).toHaveBeenCalledWith(expect.stringContaining('628123456789'), expect.anything());
    });
});
