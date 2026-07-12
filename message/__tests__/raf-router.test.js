"use strict";

// Mock baileys to avoid dynamic import errors
jest.mock('@whiskeysockets/baileys', () => ({
    generateWAMessageFromContent: jest.fn(),
    prepareWAMessageMedia: jest.fn(),
    proto: {}
}), { virtual: true });

const rafRouter = require('../raf');
const { createMockRaf, setupMockGlobalState, resetMockGlobalState } = require('../../lib/__tests__/helpers/test-harness');

// Mock all handlers that are imported in raf.js
jest.mock('../handlers/menu-handler', () => ({
    handleMenuUtama: jest.fn().mockResolvedValue(true),
    handleMenuPelanggan: jest.fn().mockResolvedValue(true),
    handleMenuTeknisi: jest.fn().mockResolvedValue(true),
    handleMenuOwner: jest.fn().mockResolvedValue(true)
}));

jest.mock('../handlers/utility-handler', () => ({
    handleBantuan: jest.fn().mockResolvedValue(true),
    handleSapaanUmum: jest.fn().mockResolvedValue(true),
    handleAdminContact: jest.fn().mockResolvedValue(true)
}));

jest.mock('../handlers/conversation-handler', () => ({
    getUserState: jest.fn(),
    setUserState: jest.fn(),
    deleteUserState: jest.fn(),
    createScopedStateProxy: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../handlers/smart-report-text-menu', () => ({
    handleMenuSelection: jest.fn().mockResolvedValue({ success: true, message: 'handled' })
}));

jest.mock('../../lib/state-manager', () => ({
    isProcessing: jest.fn().mockReturnValue(false),
    setProcessing: jest.fn(),
    clearProcessing: jest.fn()
}));

jest.mock('../../lib/saldo-manager', () => ({
    createUserSaldo: jest.fn().mockResolvedValue(true),
    getUserSaldo: jest.fn().mockResolvedValue(0)
}));

jest.mock('../../lib/jid-utils', () => ({
    toCanonicalJid: jest.fn().mockImplementation((jid) => Promise.resolve(jid)),
    buildCanonicalContext: jest.fn().mockReturnValue({ isResolved: true }),
    extractSenderInfo: jest.fn().mockReturnValue({ phoneNumber: '628123456789' }),
    normalizeJid: jest.fn().mockImplementation((jid) => Promise.resolve(jid)),
    normalizePhoneToJid: jest.fn().mockImplementation((phone) => `${phone}@s.whatsapp.net`),
    normalizePhoneNumber: jest.fn().mockImplementation((phone) => phone.replace(/[^0-9]/g, '')),
    extractPhoneFromJid: jest.fn().mockImplementation((jid) => jid.split('@')[0]),
    getPreferredPlainSenderNumber: jest.fn().mockReturnValue('628123456789'),
    findUserWithLidSupport: jest.fn().mockResolvedValue(null),
    resolveCustomerBySender: jest.fn().mockResolvedValue({ user: null, plainSenderNumber: '628123456789' })
}));

// Provide a mock for lid-handler too since some handlers still require it
jest.mock('../../lib/lid-handler', () => ({
    extractSenderInfo: jest.fn().mockReturnValue({ phoneNumber: '628123456789' }),
    resolveCustomerBySender: jest.fn().mockResolvedValue({ user: null, plainSenderNumber: '628123456789' })
}), { virtual: true });

jest.mock('../../lib/saldo', () => ({
    checkATMuser: jest.fn().mockResolvedValue(1000)
}));

jest.mock('../../lib/wifi_template_handler', () => ({
    getIntentFromKeywords: jest.fn()
}));

jest.mock('../../lib/templating', () => ({
    templatesCache: {
        responseTemplates: {
            mess_owner: { template: 'Owner only' },
            mess_teknisiOnly: { template: 'Teknisi only' },
            mess_teknisiOrOwnerOnly: { template: 'Teknisi or Owner only' }
        }
    }
}));

describe('raf-router.test.js - Main Router Integration', () => {
    let raf;
    const sender = '628123456789@s.whatsapp.net';

    beforeEach(() => {
        setupMockGlobalState();
        raf = createMockRaf();
        global.raf = raf;
        global.accounts = [];
        jest.clearAllMocks();
    });

    afterEach(() => {
        resetMockGlobalState();
    });

    describe('Intent Dispatching', () => {
        it('should route "menu" to handleMenuUtama', async () => {
            const { getIntentFromKeywords } = require('../../lib/wifi_template_handler');
            const { handleMenuUtama } = require('../handlers/menu-handler');
            
            getIntentFromKeywords.mockReturnValue({ intent: 'MENU_UTAMA', matchedKeywordLength: 1 });
            
            const m = {
                key: { remoteJid: sender, fromMe: false, id: 'ABC1' },
                message: { conversation: 'menu' },
                pushName: 'Test User'
            };
            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            expect(handleMenuUtama).toHaveBeenCalled();
        });

        it('should route "bantuan" to handleBantuan', async () => {
            const { getIntentFromKeywords } = require('../../lib/wifi_template_handler');
            const { handleBantuan } = require('../handlers/utility-handler');
            
            getIntentFromKeywords.mockReturnValue({ intent: 'BANTUAN', matchedKeywordLength: 1 });
            
            const m = {
                key: { remoteJid: sender, fromMe: false, id: 'ABC2' },
                message: { conversation: 'bantuan' },
                pushName: 'Test User'
            };
            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            expect(handleBantuan).toHaveBeenCalled();
        });
    });

    describe('Role Guard', () => {
        it('should prevent non-teknisi from accessing teknisi restricted intents', async () => {
            const { getIntentFromKeywords } = require('../../lib/wifi_template_handler');
            const { handleMenuTeknisi } = require('../handlers/menu-handler');
            
            // LIST_TIKET is restricted to isTeknisi or isOwner
            getIntentFromKeywords.mockReturnValue({ intent: 'LIST_TIKET', matchedKeywordLength: 1 });
            
            const m = {
                key: { remoteJid: sender, fromMe: false, id: 'ABC3' },
                message: { conversation: 'list tiket' },
                pushName: 'Test User'
            };
            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            expect(handleMenuTeknisi).not.toHaveBeenCalled();
        });

        it('should allow teknisi to access restricted intents', async () => {
            const { getIntentFromKeywords } = require('../../lib/wifi_template_handler');
            
            // Mock as teknisi
            global.accounts = [{ phone_number: sender, username: 'tech1' }];
            
            getIntentFromKeywords.mockReturnValue({ intent: 'LIST_TIKET', matchedKeywordLength: 1 });
            
            const m = {
                key: { remoteJid: sender, fromMe: false, id: 'ABC4' },
                message: { conversation: 'list tiket' },
                pushName: 'Test User'
            };
            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            expect(raf.sendMessage).toHaveBeenCalledWith(sender, expect.objectContaining({ text: expect.stringMatching(/DAFTAR TIKET|TIDAK ADA TIKET/) }), expect.anything());
        });
    });

    describe('State Guard', () => {
        it('should route to state handler if user has active state', async () => {
            const { getUserState } = require('../handlers/conversation-handler');
            const { handleMenuSelection } = require('../handlers/smart-report-text-menu');
            const { getIntentFromKeywords } = require('../../lib/wifi_template_handler');

            // Set state that is NOT in protectedStates to allow breakout check
            getUserState.mockReturnValue({ step: 'REPORT_MENU' });
            
            // Ensure no intent is matched so it doesn't breakout
            getIntentFromKeywords.mockReturnValue(null);
            
            const m = {
                key: { remoteJid: sender, fromMe: false, id: 'ABC5' },
                message: { conversation: '1' },
                pushName: 'Test User'
            };
            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            expect(handleMenuSelection).toHaveBeenCalled();
        });
    });

    describe('Global Cancel', () => {
        it('should clear all states when user sends "batal"', async () => {
            const { deleteUserState, getUserState } = require('../handlers/conversation-handler');
            const { toCanonicalJid } = require('../../lib/jid-utils');

            toCanonicalJid.mockResolvedValue(sender);

            getUserState.mockReturnValue({ step: 'ASK_NEW_PASSWORD' });

            const m = {
                key: { remoteJid: sender, fromMe: false, id: 'ABC6' },
                message: { conversation: 'batal' },
                pushName: 'Test User'
            };

            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            expect(deleteUserState).toHaveBeenCalled();
            expect(raf.sendMessage).toHaveBeenCalledWith(sender, expect.objectContaining({ text: expect.stringContaining('dibatalkan') }), expect.anything());
        });
    });

    // Regresi: FOTO STATUS (story) WhatsApp pelanggan pernah ikut ditangkap sebagai "bukti
    // pembayaran" lalu diteruskan ke admin/owner. Penyebabnya `status@broadcast` lolos guard
    // grup (isGroup hanya true utk @g.us), sedangkan buildCanonicalContext tetap me-resolve
    // pelanggan lewat key.participant → hook bukti bayar aktif. Guard baru harus membuang
    // envelope non-chat SEBELUM context di-resolve.
    describe('Non-chat envelope guard (status/broadcast/newsletter)', () => {
        it('should ignore WhatsApp status/story (status@broadcast) before resolving the customer', async () => {
            const { buildCanonicalContext } = require('../../lib/jid-utils');

            const m = {
                key: { remoteJid: 'status@broadcast', participant: sender, fromMe: false, id: 'STATUS1' },
                message: { imageMessage: { caption: '' } },
                pushName: 'Test User'
            };
            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            // Return lebih awal → foto status tak pernah menyentuh resolusi pelanggan,
            // hook bukti pembayaran, maupun auto-reply apa pun.
            expect(buildCanonicalContext).not.toHaveBeenCalled();
            expect(raf.sendMessage).not.toHaveBeenCalled();
        });

        it('should ignore channel/newsletter messages', async () => {
            const { buildCanonicalContext } = require('../../lib/jid-utils');

            const m = {
                key: { remoteJid: '120363000000000000@newsletter', participant: sender, fromMe: false, id: 'NEWS1' },
                message: { imageMessage: { caption: 'promo' } },
                pushName: 'Channel'
            };
            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            expect(buildCanonicalContext).not.toHaveBeenCalled();
            expect(raf.sendMessage).not.toHaveBeenCalled();
        });

        it('should still process a normal direct message (control)', async () => {
            const { buildCanonicalContext } = require('../../lib/jid-utils');

            const m = {
                key: { remoteJid: sender, fromMe: false, id: 'DIRECT1' },
                message: { conversation: 'halo' },
                pushName: 'Test User'
            };
            await rafRouter(raf, m, { messages: [m], type: 'notify' });

            expect(buildCanonicalContext).toHaveBeenCalled();
        });
    });
});
