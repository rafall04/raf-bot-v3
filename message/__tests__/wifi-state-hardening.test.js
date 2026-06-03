"use strict";

jest.mock('../../lib/wifi', () => ({
    getSSIDInfo: jest.fn().mockResolvedValue({
        ssid: [{ id: '1', name: 'SSID Utama' }]
    }),
    setPassword: jest.fn().mockResolvedValue({
        success: true
    }),
    setSSIDName: jest.fn().mockResolvedValue({
        success: true
    }),
    updateWifiSettings: jest.fn().mockResolvedValue({
        ok: true
    })
}));

jest.mock('../../lib/wifi-logger', () => ({
    logWifiChange: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../lib/jid-utils', () => ({
    resolveCustomerBySender: jest.fn().mockResolvedValue({
        user: {
            id: 1,
            name: 'Pelanggan Test',
            username: 'pelanggan',
            full_name: 'Pelanggan Test',
            phone_number: '628123456789',
            device_id: 'DEVICE-1',
            ssid_id: '1',
            subscription: 'PAKET-BULANAN',
            bulk: []
        }
    })
}));

const { handleGantiSandiWifi } = require('../handlers/wifi-management-handler');
const { handleConversationState } = require('../handlers/conversation-state-handler');
const {
    getUserState,
    clearAllStates
} = require('../handlers/conversation-handler');
const wifiLib = require('../../lib/wifi');

describe('wifi state hardening', () => {
    beforeEach(() => {
        clearAllStates();
        jest.clearAllMocks();
        global.config = {
            custom_wifi_modification: false
        };
    });

    afterEach(() => {
        clearAllStates();
        delete global.config;
    });

    test('ganti sandi stores follow-up state on canonical sender key', async () => {
        const reply = jest.fn();

        await handleGantiSandiWifi({
            sender: '12345@lid',
            stateSender: '628123456789@s.whatsapp.net',
            args: ['ganti', 'sandi'],
            matchedKeywordLength: 2,
            isOwner: false,
            isTeknisi: false,
            pushname: 'Tester',
            users: [],
            reply,
            global,
            mess: {
                userNotRegister: 'not registered'
            },
            msg: { key: { remoteJid: '12345@lid' } },
            raf: {}
        });

        expect(getUserState('628123456789@s.whatsapp.net')).toEqual(expect.objectContaining({
            step: 'ASK_NEW_PASSWORD'
        }));
        expect(getUserState('12345@lid')).toBeNull();
    });

    test('follow-up password input is processed from the same canonical state key', async () => {
        const reply = jest.fn();

        await handleGantiSandiWifi({
            sender: '12345@lid',
            stateSender: '628123456789@s.whatsapp.net',
            args: ['ganti', 'sandi'],
            matchedKeywordLength: 2,
            isOwner: false,
            isTeknisi: false,
            pushname: 'Tester',
            users: [],
            reply,
            global,
            mess: {
                userNotRegister: 'not registered'
            },
            msg: { key: { remoteJid: '12345@lid' } },
            raf: {}
        });

        await handleConversationState({
            sender: '628123456789@s.whatsapp.net',
            chats: 'Password123',
            temp: {},
            reply,
            global,
            isOwner: false,
            isTeknisi: false,
            users: [],
            args: [],
            entities: {},
            plainSenderNumber: '628123456789',
            pushname: 'Tester',
            mess: {},
            sleep: jest.fn(),
            getSSIDInfo: wifiLib.getSSIDInfo,
            namabot: 'Bot',
            buatLaporanGangguan: jest.fn()
        });

        expect(wifiLib.setPassword).toHaveBeenCalledWith('DEVICE-1', '1', 'Password123');
        expect(getUserState('628123456789@s.whatsapp.net')).toBeNull();
    });

    test('password sent while waiting for mode selection gets an explicit invalid-choice response', async () => {
        const reply = jest.fn();

        global.config.custom_wifi_modification = true;

        await handleGantiSandiWifi({
            sender: '628123456789@s.whatsapp.net',
            stateSender: '628123456789@s.whatsapp.net',
            args: ['ganti', 'sandi'],
            matchedKeywordLength: 2,
            isOwner: false,
            isTeknisi: false,
            pushname: 'Tester',
            users: [],
            reply,
            global,
            mess: {
                userNotRegister: 'not registered'
            },
            msg: { key: { remoteJid: '628123456789@s.whatsapp.net' } },
            raf: {}
        });

        const state = getUserState('628123456789@s.whatsapp.net');
        state.step = 'SELECT_CHANGE_PASSWORD_MODE_FIRST';
        state.bulk_ssids = ['1', '2'];

        await handleConversationState({
            sender: '628123456789@s.whatsapp.net',
            chats: 'Password123',
            temp: {},
            reply,
            global,
            isOwner: false,
            isTeknisi: false,
            users: [],
            args: [],
            entities: {},
            plainSenderNumber: '628123456789',
            pushname: 'Tester',
            mess: {},
            sleep: jest.fn(),
            getSSIDInfo: wifiLib.getSSIDInfo,
            namabot: 'Bot',
            buatLaporanGangguan: jest.fn()
        });

        expect(reply).toHaveBeenLastCalledWith(expect.stringContaining('Pilihan tidak valid'));
    });
});
