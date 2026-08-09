"use strict";

jest.mock('../../lib/device-status', () => ({
    isDeviceOnline: jest.fn().mockResolvedValue({
        online: false,
        lastInform: '2026-04-02T00:00:00.000Z'
    }),
    getDeviceOfflineMessage: jest.fn().mockReturnValue('offline')
}));

jest.mock('../../lib/working-hours-helper', () => ({
    getResponseTimeMessage: jest.fn().mockReturnValue('response'),
    isWithinWorkingHours: jest.fn().mockReturnValue(true)
}));

jest.mock('../../lib/report-helper', () => ({
    hasActiveReport: jest.fn().mockReturnValue(false)
}));

jest.mock('../../lib/saldo-manager', () => ({
    getUserTopupRequests: jest.fn(),
    saveTopupRequests: jest.fn()
}));

jest.mock('../../lib/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('../../lib/templating', () => ({
    renderTemplate: jest.fn().mockReturnValue('no pending'),
    templatesCache: {
        responseTemplates: {}
    }
}));

jest.mock('../../lib/jid-utils', () => ({
    normalizeJidForSaldo: jest.fn().mockResolvedValue('628123456789@s.whatsapp.net'),
    resolveCustomerBySender: jest.fn().mockResolvedValue({
        user: {
            id: 1,
            username: 'Pelanggan',
            full_name: 'Pelanggan Test',
            phone_number: '628123456789',
            device_id: 'DEVICE-1'
        },
        phoneNumber: '628123456789',
        canonicalJid: '628123456789@s.whatsapp.net',
        resolved: true,
        resolutionSource: 'test'
    })
}));

const {
    getUserState,
    setUserState,
    clearAllStates,
    createScopedStateProxy
} = require('../handlers/conversation-handler');
const {
    handleMenuSelection
} = require('../handlers/smart-report-text-menu');
const {
    handleTopupPaymentProof
} = require('../handlers/topup-handler');
const {
    handleBeliVoucher
} = require('../handlers/payment-processor-handler');
const {
    handleComplaint
} = require('../handlers/customer-handler');
const saldoManager = require('../../lib/saldo-manager');

describe('WhatsApp bot hardening regressions', () => {
    beforeEach(() => {
        clearAllStates();
        jest.clearAllMocks();
        global.users = [];
        global.whatsappConnectionState = 'open';
        global.raf = {
            sendMessage: jest.fn().mockResolvedValue(undefined)
        };
    });

    afterEach(() => {
        clearAllStates();
        delete global.users;
        delete global.raf;
        delete global.whatsappConnectionState;
    });

    test('scoped proxies keep legacy and teknisi state in one managed store', () => {
        const legacyTemp = createScopedStateProxy('legacy-temp');
        const teknisiStates = createScopedStateProxy('teknisi');
        const sender = '628123456789@s.whatsapp.net';

        legacyTemp[sender] = { step: 'CONFIRM_CANCEL_TICKET' };
        const legacyState = getUserState(sender);

        expect(legacyState.step).toBe('CONFIRM_CANCEL_TICKET');
        expect(legacyState._scope).toBe('legacy-temp');
        expect(legacyState.createdAt).toBeTruthy();
        expect(legacyState.updatedAt).toBeTruthy();
        expect(teknisiStates[sender]).toBeNull();

        teknisiStates[sender] = { step: 'AWAITING_PHOTO_CATEGORY_1' };
        const teknisiState = getUserState(sender);

        expect(teknisiState.step).toBe('AWAITING_PHOTO_CATEGORY_1');
        expect(teknisiState._scope).toBe('teknisi');
        expect(legacyTemp[sender]).toBeNull();
    });

    test('report menu selection for internet mati does not crash without msg metadata', async () => {
        const sender = '628123456789@s.whatsapp.net';
        global.users = [{
            id: 1,
            username: 'Pelanggan',
            full_name: 'Pelanggan Test',
            phone_number: '628123456789',
            device_id: 'DEVICE-1'
        }];

        setUserState(sender, {
            step: 'REPORT_MENU',
            customer: global.users[0],
            userData: global.users[0]
        });

        const result = await handleMenuSelection({
            sender,
            choice: '1',
            reply: jest.fn()
        });

        expect(result).toEqual(expect.objectContaining({
            success: true
        }));
    });

    test('topup proof lookup uses canonical sender and does not crash on logger fields', async () => {
        saldoManager.getUserTopupRequests
            .mockReturnValueOnce([])
            .mockReturnValueOnce([]);

        await handleTopupPaymentProof({
            key: {
                remoteJid: '12345@lid'
            },
            message: {}
        }, { id: 99 }, 'Tester');

        expect(saldoManager.getUserTopupRequests).toHaveBeenNthCalledWith(1, '628123456789@s.whatsapp.net');
        expect(global.raf.sendMessage).toHaveBeenCalledWith('12345@lid', expect.objectContaining({
            text: 'no pending'
        }), expect.anything());
    });

    test('voucher choice flow stores state in managed conversation store', async () => {
        const sender = '628123456789@s.whatsapp.net';
        const reply = jest.fn();

        global.voucher = [{
            namavc: 'Voucher 1 Jam',
            durasivc: '1 Jam',
            hargavc: '1000'
        }];

        await handleBeliVoucher({
            sender,
            pushname: 'Tester',
            entities: {},
            q: '',
            reply,
            global,
            helpers: {}
        });

        expect(getUserState(sender)).toEqual(expect.objectContaining({
            step: 'ASK_VOUCHER_CHOICE',
            flow: 'payment'
        }));
    });

    // `handleComplaint` kini ASYNC: keluhan bebas dibuatkan TIKET NYATA lewat
    // `lib/report-orchestration-service.createCustomerComplaintTicket` (dulu cuma console.log).
    // Maksud test ini tak berubah — state tetap di-key `sender`, bukan nomor tersimpan.
    test('customer complaint state uses sender key instead of stored phone field', async () => {
        const sender = '628123456789@s.whatsapp.net';
        const user = {
            id: 77,
            name: 'Pelanggan',
            phone_number: '08123456789'
        };

        const complaintResult = await handleComplaint({
            sender,
            user,
            pushname: 'Tester',
            complaint: ''
        });

        expect(complaintResult.success).toBe(true);
        expect(getUserState(sender)).toEqual(expect.objectContaining({
            step: 'AWAITING_COMPLAINT'
        }));
    });
});
