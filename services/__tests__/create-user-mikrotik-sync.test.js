/**
 * Test untuk syncMikrotikForNewUser mode "new" — fokus E1:
 * WiFi (semua SSID) + PPPoE device digabung jadi SATU panggilan updatePsbDeviceConfig
 * (1 connection_request, bukan N+1), dengan gating yang dipertahankan.
 */

jest.mock('../../lib/genieacs-helper', () => ({
    updatePsbDeviceConfig: jest.fn().mockResolvedValue({ ok: true }),
    setWifiCredentials: jest.fn(),
    setPPPoECredentials: jest.fn()
}));

const genieHelper = require('../../lib/genieacs-helper');
const { syncMikrotikForNewUser } = require('../api-users/create-user-mikrotik-sync');

function baseDeps(overrides = {}) {
    return {
        getProfileBySubscription: jest.fn(() => 'PROFILE-A'),
        addPPPoEUser: jest.fn().mockResolvedValue({ ok: true }),
        assertMikrotikResult: jest.fn(),
        buildMikrotikSyncResult: (status, message) => ({ status, message }),
        getConfig: jest.fn(() => ({ defaultPPPoEPassword: 'pw-default' })),
        logger: { error: jest.fn() },
        ...overrides
    };
}

beforeEach(() => {
    genieHelper.updatePsbDeviceConfig.mockClear();
    genieHelper.updatePsbDeviceConfig.mockResolvedValue({ ok: true });
});

describe('syncMikrotikForNewUser - mode new (E1 batch GenieACS)', () => {
    test('WiFi multi-SSID + PPPoE digabung jadi SATU panggilan updatePsbDeviceConfig', async () => {
        const deps = baseDeps();
        const newUser = { pppoe_username: 'u1', pppoe_password: 'p1', subscription: 'PKT' };
        const userData = { device_id: 'dev-1', wifi_ssid: 'RAF', wifi_password: 'wifipass', ssid_indices: ['1', '2'] };

        const { mikrotikSync } = await syncMikrotikForNewUser(deps, {
            newUser, userData, registrationMode: 'new', addToMikrotik: false, skipMikrotik: false, syncEnabled: true
        });

        expect(deps.addPPPoEUser).toHaveBeenCalledTimes(1);
        expect(genieHelper.updatePsbDeviceConfig).toHaveBeenCalledTimes(1);
        const [devId, payload] = genieHelper.updatePsbDeviceConfig.mock.calls[0];
        expect(devId).toBe('dev-1');
        expect(payload).toMatchObject({
            wifiSSID: 'RAF',
            wifiPassword: 'wifipass',
            ssidIndices: ['1', '2'],
            pppUsername: 'u1',
            pppPassword: 'p1'
        });
        expect(mikrotikSync.status).toBe('applied');
    });

    test('sync disabled: PPPoE-device tidak dikirim, WiFi tetap dikirim (gating dipertahankan)', async () => {
        const deps = baseDeps();
        const newUser = { pppoe_username: 'u1', pppoe_password: 'p1', subscription: 'PKT' };
        const userData = { device_id: 'dev-1', wifi_ssid: 'RAF', wifi_password: 'wifipass', ssid_indices: ['1'] };

        await syncMikrotikForNewUser(deps, {
            newUser, userData, registrationMode: 'new', addToMikrotik: false, skipMikrotik: false, syncEnabled: false
        });

        expect(deps.addPPPoEUser).not.toHaveBeenCalled();
        expect(genieHelper.updatePsbDeviceConfig).toHaveBeenCalledTimes(1);
        const [, payload] = genieHelper.updatePsbDeviceConfig.mock.calls[0];
        expect(payload.wifiSSID).toBe('RAF');
        expect(payload.pppUsername).toBeUndefined();
    });

    test('tanpa device_id: tidak memanggil GenieACS sama sekali', async () => {
        const deps = baseDeps();
        const newUser = { pppoe_username: 'u1', pppoe_password: 'p1', subscription: 'PKT' };
        const userData = { wifi_ssid: 'RAF', wifi_password: 'wifipass', ssid_indices: ['1'] };

        await syncMikrotikForNewUser(deps, {
            newUser, userData, registrationMode: 'new', addToMikrotik: false, skipMikrotik: false, syncEnabled: true
        });

        expect(genieHelper.updatePsbDeviceConfig).not.toHaveBeenCalled();
    });

    test('WiFi awal di-set saat create user → tercatat di wifi log dengan atribusi aktor', async () => {
        const logWifiChange = jest.fn().mockResolvedValue(undefined);
        const deps = baseDeps({ logWifiChange });
        const newUser = { id: 42, name: 'Budi', phone_number: '628111', pppoe_username: 'u1', pppoe_password: 'p1', subscription: 'PKT-10' };
        const userData = { device_id: 'dev-1', wifi_ssid: 'RAF-BUDI', wifi_password: 'rahasia123', ssid_indices: ['1'] };

        await syncMikrotikForNewUser(deps, {
            newUser, userData, registrationMode: 'new', addToMikrotik: false, skipMikrotik: false, syncEnabled: true,
            actor: { username: 'teknisi_andi', role: 'teknisi' },
            requestMeta: { ipAddress: '10.0.0.9', userAgent: 'UA' }
        });

        expect(logWifiChange).toHaveBeenCalledTimes(1);
        const logged = logWifiChange.mock.calls[0][0];
        expect(logged).toMatchObject({
            userId: '42',
            deviceId: 'dev-1',
            changeType: 'both',
            changeSource: 'web_technician',
            actorRole: 'teknisi',
            actorIdentifier: 'teknisi_andi',
            customerName: 'Budi',
            customerPhone: '628111'
        });
        expect(logged.changes).toMatchObject({ newSsidName: 'RAF-BUDI', newPassword: 'rahasia123', passwordChanged: true });
    });

    test('WiFi log TIDAK dipanggil kalau wifi_ssid/password kosong', async () => {
        const logWifiChange = jest.fn();
        const deps = baseDeps({ logWifiChange });
        const newUser = { id: 7, name: 'X', pppoe_username: 'u1', pppoe_password: 'p1', subscription: 'PKT' };
        const userData = { device_id: 'dev-1', ssid_indices: ['1'] }; // tanpa wifi_ssid/password

        await syncMikrotikForNewUser(deps, {
            newUser, userData, registrationMode: 'new', addToMikrotik: false, skipMikrotik: false, syncEnabled: true,
            actor: { username: 'admin1', role: 'admin' }
        });

        expect(logWifiChange).not.toHaveBeenCalled();
    });
});
