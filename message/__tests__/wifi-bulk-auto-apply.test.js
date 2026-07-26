/**
 * Header Doc
 * Purpose: Regresi insiden prod — jalur multi-langkah ganti sandi/nama WiFi bulk-auto pernah mengirim payload KOSONG ke GenieACS lalu melapor "Berhasil" ke pelanggan.
 * Caller: `npm test` (jest).
 * Deps: `message/handlers/wifi-management-handler`, `message/handlers/conversation-state-handler`, mock `lib/wifi`.
 * MainFuncs: skenario `gantisandi`/`gantinama` tanpa argumen untuk pelanggan multi-SSID (bulk ["1","5"]).
 * SideEffects: tidak ada (semua adapter perangkat di-mock).
 */
"use strict";

jest.mock('../../lib/wifi', () => ({
    getSSIDInfo: jest.fn().mockResolvedValue({
        ssid: [
            { id: '1', name: 'ANTI NUNUT' },
            { id: '5', name: 'ANTI NUNUT' }
        ]
    }),
    setPassword: jest.fn().mockResolvedValue({ success: true, ok: true, accepted: true, applied: true }),
    setSSIDName: jest.fn().mockResolvedValue({ success: true, ok: true, accepted: true, applied: true }),
    updateWifiSettings: jest.fn().mockResolvedValue({ ok: true, accepted: true, applied: true })
}));

jest.mock('../../lib/wifi-logger', () => ({
    logWifiChange: jest.fn().mockResolvedValue(undefined)
}));

// Pelanggan Tanjung yang jadi korban: dua SSID (2.4G + 5G Huawei HG8145V5).
jest.mock('../../lib/jid-utils', () => ({
    resolveCustomerBySender: jest.fn().mockResolvedValue({
        user: {
            id: 89,
            name: 'Nova Adi Wijaya',
            username: 'nova',
            full_name: 'Nova Adi Wijaya',
            phone_number: '6281228967458',
            device_id: '00259E-HG8145V5-48575443470323AF',
            subscription: 'PAKET-BULANAN',
            bulk: ['1', '5']
        }
    })
}));

const { handleGantiSandiWifi, handleGantiNamaWifi } = require('../handlers/wifi-management-handler');
const { handleConversationState } = require('../handlers/conversation-state-handler');
const { getUserState, clearAllStates } = require('../handlers/conversation-handler');
const wifiLib = require('../../lib/wifi');
const wifiLogger = require('../../lib/wifi-logger');

const SENDER = '6281228967458@s.whatsapp.net';

function baseCtx(reply, extra = {}) {
    return {
        sender: SENDER,
        stateSender: SENDER,
        matchedKeywordLength: 1,
        isOwner: false,
        isTeknisi: false,
        pushname: 'Nova',
        users: [],
        reply,
        global,
        mess: { userNotRegister: 'not registered' },
        msg: { key: { remoteJid: SENDER } },
        raf: {},
        ...extra
    };
}

function stateCtx(reply, chats) {
    return {
        sender: SENDER,
        chats,
        temp: {},
        reply,
        global,
        isOwner: false,
        isTeknisi: false,
        users: [],
        args: [],
        entities: {},
        plainSenderNumber: '6281228967458',
        pushname: 'Nova',
        mess: {},
        sleep: jest.fn(),
        getSSIDInfo: wifiLib.getSSIDInfo,
        namabot: 'Bot',
        buatLaporanGangguan: jest.fn()
    };
}

describe('ganti sandi/nama WiFi bulk-auto lewat jalur multi-langkah', () => {
    beforeEach(() => {
        clearAllStates();
        jest.clearAllMocks();
        // Sama dengan prod kedua bot: custom_wifi_modification = false → jalur bulk-auto.
        global.config = { custom_wifi_modification: false };
    });

    afterEach(() => {
        clearAllStates();
        delete global.config;
    });

    test('`gantisandi` tanpa sandi lalu balas sandi → SEMUA SSID di payload, bukan kosong', async () => {
        const reply = jest.fn();

        await handleGantiSandiWifi(baseCtx(reply, { args: ['gantisandi'] }));

        expect(getUserState(SENDER)).toEqual(expect.objectContaining({
            step: 'ASK_NEW_PASSWORD_BULK_AUTO',
            bulk_ssids: ['1', '5']
        }));

        await handleConversationState(stateCtx(reply, 'Doserd4c'));

        // Inti regresi: payload WAJIB memuat kedua SSID. Dulu `{}` → nol task ke ACS.
        expect(wifiLib.updateWifiSettings).toHaveBeenCalledTimes(1);
        const [deviceId, payload] = wifiLib.updateWifiSettings.mock.calls[0];
        expect(deviceId).toBe('00259E-HG8145V5-48575443470323AF');
        expect(payload).toEqual({
            ssid_password_1: 'Doserd4c',
            ssid_password_5: 'Doserd4c'
        });
        expect(Object.keys(payload)).toHaveLength(2);

        // Log audit harus menyebut SSID-nya, bukan string kosong seperti insiden prod.
        expect(wifiLogger.logWifiChange).toHaveBeenCalledTimes(1);
        const logged = wifiLogger.logWifiChange.mock.calls[0][0];
        expect(logged.changes.ssidIds).toBe('1, 5');
        expect(logged.reason).not.toMatch(/\(0 SSIDs\)/);
    });

    test('`gantinama` tanpa nama lalu balas nama → SEMUA SSID di payload', async () => {
        const reply = jest.fn();

        await handleGantiNamaWifi(baseCtx(reply, { args: ['gantinama'] }));

        expect(getUserState(SENDER)).toEqual(expect.objectContaining({
            step: 'ASK_NEW_NAME_FOR_BULK_AUTO',
            bulk_ssids: ['1', '5']
        }));

        await handleConversationState(stateCtx(reply, 'ANTI NUNUT'));

        expect(wifiLib.updateWifiSettings).toHaveBeenCalledTimes(1);
        const [, payload] = wifiLib.updateWifiSettings.mock.calls[0];
        expect(payload).toEqual({
            ssid_1: 'ANTI NUNUT',
            ssid_5: 'ANTI NUNUT'
        });
    });

    test('perangkat menolak perubahan (accepted:false) → JANGAN tulis log & JANGAN bilang berhasil', async () => {
        const reply = jest.fn();
        wifiLib.updateWifiSettings.mockResolvedValueOnce({
            ok: true,
            accepted: false,
            applied: null,
            message: 'Tidak ada perubahan yang dikirim karena tidak ada data baru.'
        });

        await handleGantiSandiWifi(baseCtx(reply, { args: ['gantisandi'] }));
        await handleConversationState(stateCtx(reply, 'Doserd4c'));

        expect(wifiLogger.logWifiChange).not.toHaveBeenCalled();
        const semuaBalasan = reply.mock.calls.map((c) => String(c[0])).join('\n');
        expect(semuaBalasan).not.toMatch(/Berhasil/i);
    });

    test('state tanpa target SSID sama sekali → gagal terang-terangan, tanpa panggil perangkat', async () => {
        const reply = jest.fn();
        const { handleAskNewPasswordBulk } = require('../handlers/states/wifi-password-state-handler');

        await handleAskNewPasswordBulk(
            { step: 'ASK_NEW_PASSWORD_BULK_AUTO', targetUser: { id: 89, device_id: 'DEV-1' } },
            'Doserd4c',
            reply,
            SENDER,
            global
        );

        expect(wifiLib.updateWifiSettings).not.toHaveBeenCalled();
        expect(wifiLogger.logWifiChange).not.toHaveBeenCalled();
        const semuaBalasan = reply.mock.calls.map((c) => String(c[0])).join('\n');
        expect(semuaBalasan).not.toMatch(/Berhasil/i);
    });
});
