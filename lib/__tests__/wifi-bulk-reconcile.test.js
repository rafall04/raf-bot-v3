// Unit test untuk lib/wifi-bulk-reconcile.js — pakai genieacs asli untuk helper murni
// (getNestedValue/unwrapValue/extractDeviceModel) tapi stub panggilan jaringan.
jest.mock('../genieacs', () => {
    const actual = jest.requireActual('../genieacs');
    return { ...actual, queryDevices: jest.fn(), getDeviceById: jest.fn() };
});

const genieacs = require('../genieacs');
const {
    normalizeBulk,
    deviceHas5G,
    expectedBulkFromDevice,
    bulkMatchesExpected,
    fetchDeviceCapability,
    scanBulkDiff,
} = require('../wifi-bulk-reconcile');

function dualBandDevice(id) {
    return {
        _id: id,
        InternetGatewayDevice: {
            DeviceInfo: { ModelName: 'HG8145V5' },
            LANDevice: { 1: { WLANConfiguration: { 1: { SSID: 'NET' }, 5: { SSID: 'NET 5G' } } } },
        },
    };
}

function singleBandDevice(id) {
    return {
        _id: id,
        InternetGatewayDevice: {
            DeviceInfo: { ModelName: 'HG8546M' },
            LANDevice: { 1: { WLANConfiguration: { 1: { SSID: 'NET' } } } },
        },
    };
}

describe('wifi-bulk-reconcile', () => {
    afterEach(() => jest.clearAllMocks());

    test('normalizeBulk menerima JSON string, array, dan CSV', () => {
        expect(normalizeBulk('["1","5"]')).toEqual(['1', '5']);
        expect(normalizeBulk(['1', 5])).toEqual(['1', '5']);
        expect(normalizeBulk('1,5')).toEqual(['1', '5']);
        expect(normalizeBulk('')).toEqual([]);
        expect(normalizeBulk(null)).toEqual([]);
    });

    test('deviceHas5G & expectedBulkFromDevice bedakan dual vs single band', () => {
        expect(deviceHas5G(dualBandDevice('d'))).toBe(true);
        expect(deviceHas5G(singleBandDevice('d'))).toBe(false);
        expect(expectedBulkFromDevice(dualBandDevice('d'))).toEqual(['1', '5']);
        expect(expectedBulkFromDevice(singleBandDevice('d'))).toEqual(['1']);
    });

    test('bulkMatchesExpected abaikan urutan & duplikat', () => {
        expect(bulkMatchesExpected(['5', '1'], ['1', '5'])).toBe(true);
        expect(bulkMatchesExpected(['1'], ['1', '5'])).toBe(false);
        expect(bulkMatchesExpected('["1","5"]', ['1', '5'])).toBe(true);
        expect(bulkMatchesExpected([], ['1'])).toBe(false);
    });

    test('scanBulkDiff menandai dual-band yang bulk-nya tanpa SSID 5', async () => {
        genieacs.queryDevices.mockResolvedValue({ ok: true, data: [dualBandDevice('dev1'), singleBandDevice('dev2')] });
        const users = [
            { id: 1, name: 'A', device_id: 'dev1', bulk: '["1"]' },       // dual-band, bulk [1] -> beda
            { id: 2, name: 'B', device_id: 'dev1', bulk: '["1","5"]' },    // dual-band, sesuai
            { id: 3, name: 'C', device_id: 'dev2', bulk: '["1"]' },        // single-band, sesuai
            { id: 4, name: 'D', device_id: 'dev2', bulk: '["1","5"]' },    // single-band tapi bulk ada 5 -> beda
            { id: 5, name: 'E', device_id: 'missing', bulk: '["1"]' },     // tak ada di ACS
            { id: 6, name: 'F', device_id: '', bulk: '["1"]' },           // tanpa device -> tak dihitung
        ];
        const res = await scanBulkDiff(users);
        expect(res.stats.total).toBe(5);
        expect(res.stats.notFound).toBe(1);
        expect(res.stats.same).toBe(2);
        expect(res.different.map((d) => d.id).sort()).toEqual([1, 4]);
        const d1 = res.different.find((d) => d.id === 1);
        expect(d1.expected_bulk).toEqual(['1', '5']);
        expect(d1.current_bulk).toEqual(['1']);
        expect(d1.model).toBe('HG8145V5');
        expect(d1.has5G).toBe(true);
    });

    test('scanBulkDiff lempar error saat GenieACS gagal', async () => {
        genieacs.queryDevices.mockResolvedValue({ ok: false, message: 'GenieACS down' });
        await expect(scanBulkDiff([{ id: 1, name: 'A', device_id: 'dev1', bulk: '["1"]' }])).rejects.toThrow('GenieACS down');
    });

    test('fetchDeviceCapability: found:false saat device tak ditemukan', async () => {
        genieacs.getDeviceById.mockResolvedValue({ ok: false, data: null });
        await expect(fetchDeviceCapability('x')).resolves.toMatchObject({ found: false });
    });

    test('fetchDeviceCapability: expectedBulk untuk dual-band', async () => {
        genieacs.getDeviceById.mockResolvedValue({ ok: true, data: dualBandDevice('dev1') });
        await expect(fetchDeviceCapability('dev1')).resolves.toMatchObject({ found: true, has5G: true, expectedBulk: ['1', '5'] });
    });
});
