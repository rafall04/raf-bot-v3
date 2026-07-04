const {
    isDefaultPppoeUsername,
    normalizeGenieAcsPsbDevice,
    filterNormalizedPsbDevices,
} = require('../psb-genieacs-filter');

describe('psb-genieacs-filter', () => {
    test('default filter only keeps tes@hw and excludes empty username', () => {
        const devices = [
            { currentPPPUsername: 'tes@hw', serialNumber: 'SN-1' },
            { currentPPPUsername: ' Tes@HW ', serialNumber: 'SN-2' },
            { currentPPPUsername: '', serialNumber: 'SN-3' },
            { currentPPPUsername: null, serialNumber: 'SN-4' },
            { currentPPPUsername: 'pelanggan001', serialNumber: 'SN-5' },
        ];

        expect(isDefaultPppoeUsername(' Tes@HW ')).toBe(true);
        expect(filterNormalizedPsbDevices(devices, { filterType: 'default' })).toEqual([
            { currentPPPUsername: 'tes@hw', serialNumber: 'SN-1' },
            { currentPPPUsername: ' Tes@HW ', serialNumber: 'SN-2' },
        ]);
    });

    test('new filter only keeps devices registered within last 24 hours', () => {
        const now = Date.parse('2026-04-04T12:00:00.000Z');
        const devices = [
            { deviceId: 'new-1', registeredTimestamp: now - 60 * 60 * 1000 },
            { deviceId: 'new-2', registeredTimestamp: now - 10 * 60 * 60 * 1000 },
            { deviceId: 'old-1', registeredTimestamp: now - 3 * 24 * 60 * 60 * 1000 },
            { deviceId: 'missing-reg', registeredTimestamp: null },
        ];

        expect(filterNormalizedPsbDevices(devices, { filterType: 'new', now }).map((device) => device.deviceId)).toEqual([
            'new-1',
            'new-2',
        ]);
    });

    test('by-pppoe matches partial username and excludes empty values', () => {
        const devices = [
            { deviceId: '1', currentPPPUsername: 'cust-alpha' },
            { deviceId: '2', currentPPPUsername: 'alpha-beta' },
            { deviceId: '3', currentPPPUsername: '' },
            { deviceId: '4', currentPPPUsername: null },
        ];

        expect(
            filterNormalizedPsbDevices(devices, {
                filterType: 'by-pppoe',
                pppoeUsernameFilter: 'alpha',
            }).map((device) => device.deviceId)
        ).toEqual(['1', '2']);
    });

    test('normalize device extracts serial number and preserves empty PPP as null', () => {
        const extractor = jest.fn((device, parameterType) => {
            if (parameterType === 'serialNumber') {
                return device.VirtualParameters.getSerialNumber._value;
            }
            return null;
        });

        const normalized = normalizeGenieAcsPsbDevice({
            _id: 'device-123',
            VirtualParameters: {
                getSerialNumber: { _value: 'SN-ABC-123' },
            },
            Device: {
                DeviceInfo: {
                    ModelName: { _value: 'ZXHN F609' },
                    Manufacturer: { _value: 'ZTE' },
                },
                WANDevice: {
                    1: {
                        WANConnectionDevice: {
                            1: {
                                WANPPPConnection: {
                                    1: {
                                        Username: { _value: '   ' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            Events: {
                Registered: { _value: '2026-04-04T08:30:00.000Z' },
            },
            _lastInform: '2026-04-04T09:00:00.000Z',
        }, extractor);

        expect(normalized).toMatchObject({
            deviceId: 'device-123',
            serialNumber: 'SN-ABC-123',
            model: 'ZXHN F609',
            manufacturer: 'ZTE',
            currentPPPUsername: null,
            registeredDate: '2026-04-04T08:30:00.000Z',
            registrationSource: 'events_registered',
        });
    });

    test('normalize device prioritizes root _registered over Events.Registered (real ACS shape)', () => {
        // ONU lapangan (verified live ACS): `_registered` terisi, `Events.Registered` KOSONG →
        // registrasi WAJIB dibaca dari `_registered`, kalau tidak filter `new` mati (bug modem baru).
        const fromRoot = normalizeGenieAcsPsbDevice({
            _id: 'dev-root-reg',
            _registered: '2026-07-01T11:52:08.958Z',
            _lastInform: '2026-07-04T10:15:20.716Z',
        });
        expect(fromRoot.registeredDate).toBe('2026-07-01T11:52:08.958Z');
        expect(fromRoot.registrationSource).toBe('registered_root');

        // Bila keduanya ada, `_registered` (root) menang atas `Events.Registered`.
        const both = normalizeGenieAcsPsbDevice({
            _id: 'dev-both',
            _registered: '2026-07-01T00:00:00.000Z',
            Events: { Registered: { _value: '2020-01-01T00:00:00.000Z' } },
        });
        expect(both.registeredDate).toBe('2026-07-01T00:00:00.000Z');
        expect(both.registrationSource).toBe('registered_root');
    });

    test('normalize device reads PPPoE username from Device.PPP.Interface path', () => {
        const normalized = normalizeGenieAcsPsbDevice({
            _id: 'device-ppp-interface',
            Device: {
                PPP: {
                    Interface: {
                        1: {
                            Username: { _value: 'customer-ppp' },
                        },
                    },
                },
            },
        });

        expect(normalized.currentPPPUsername).toBe('customer-ppp');
    });

    test('serial number filter works on normalized devices', () => {
        const devices = [
            { deviceId: '1', serialNumber: 'ZTE-ABC-001' },
            { deviceId: '2', serialNumber: 'HW-XYZ-002' },
            { deviceId: '3', serialNumber: 'N/A' },
        ];

        expect(
            filterNormalizedPsbDevices(devices, {
                filterType: 'default',
                serialNumberFilter: 'xyz',
            }).map((device) => device.deviceId)
        ).toEqual([]);

        expect(
            filterNormalizedPsbDevices(devices, {
                filterType: 'by-sn',
                serialNumberFilter: 'xyz',
            }).map((device) => device.deviceId)
        ).toEqual(['2']);
    });
});
