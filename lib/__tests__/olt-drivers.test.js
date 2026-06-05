/**
 * Test registry & kontrak driver OLT multi-merk (Fase 0).
 * Memastikan resolusi brand, fallback aman, dan kapabilitas HIOSO benar —
 * fondasi sebelum driver ZTE/VSOL/HSGQ ditambahkan.
 */

const registry = require('../olt-drivers');
const { defaultCapabilities, normalizeOnu, IDENTIFIER } = require('../olt-drivers/contract');

describe('olt-drivers registry', () => {
    test('resolveDriver default → HIOSO untuk device kosong/auto/undefined', () => {
        expect(registry.resolveDriver().brand).toBe('hioso');
        expect(registry.resolveDriver({}).brand).toBe('hioso');
        expect(registry.resolveDriver({ brand: 'auto' }).brand).toBe('hioso');
        expect(registry.resolveDriver({ brand: '' }).brand).toBe('hioso');
    });

    test('resolveDriver menerima string brand langsung', () => {
        expect(registry.resolveDriver('hioso').brand).toBe('hioso');
        expect(registry.resolveDriver('HIOSO').brand).toBe('hioso'); // case-insensitive
    });

    test('brand tak dikenal → fallback default (tidak crash)', () => {
        expect(registry.resolveDriver({ brand: 'merk-belum-ada' }).brand).toBe('hioso');
    });

    test('listDrivers mengembalikan minimal HIOSO dengan kapabilitas', () => {
        const list = registry.listDrivers();
        const hioso = list.find((d) => d.brand === 'hioso');
        expect(hioso).toBeDefined();
        expect(hioso.label).toBe('HIOSO EPON');
        expect(hioso.capabilities.needsWebScrape).toBe(true);
        expect(hioso.capabilities.losViaSnmp).toBe(false);
        expect(hioso.capabilities.primaryIdentifier).toBe('mac');
    });

    test('detectBrand tanpa host → default (tak nge-probe)', async () => {
        await expect(registry.detectBrand({})).resolves.toBe('hioso');
        await expect(registry.detectBrand()).resolves.toBe('hioso');
    });

    test('registerDriver menambah brand & menolak driver tanpa brand', () => {
        const fake = {
            brand: 'fake-test-brand',
            label: 'Fake',
            capabilities: defaultCapabilities(),
        };
        registry.registerDriver(fake);
        expect(registry.resolveDriver({ brand: 'fake-test-brand' }).brand).toBe('fake-test-brand');
        expect(() => registry.registerDriver({})).toThrow(/brand/);
    });
});

describe('olt-drivers contract helpers', () => {
    test('normalizeOnu mengisi field wajib termasuk serial=null', () => {
        const onu = normalizeOnu({ id: 4, slotId: 1, macAddress: 'AA:BB:CC:DD:EE:FF' });
        expect(onu.serial).toBeNull();
        expect(onu.id).toBe('4');
        expect(onu.slotId).toBe('1');
        expect(onu.rxPower).toBe('N/A');
        expect(onu.isLos).toBe(false);
    });

    test('normalizeOnu mempertahankan tempelan dispatcher (olt_id/olt_name)', () => {
        const onu = normalizeOnu({ id: 1, slotId: 1, olt_id: 'olt2', olt_name: 'OLT B' });
        expect(onu.olt_id).toBe('olt2');
        expect(onu.olt_name).toBe('OLT B');
    });

    test('defaultCapabilities konservatif', () => {
        const cap = defaultCapabilities();
        expect(cap.losViaSnmp).toBe(false);
        expect(cap.needsWebScrape).toBe(false);
        expect(cap.primaryIdentifier).toBe(IDENTIFIER.MAC);
    });
});

describe('hioso driver delegasi', () => {
    test('getOltData menormalisasi onus (menambah serial) saat success', async () => {
        jest.resetModules();
        jest.doMock('../olt-hioso', () => ({
            getOltData: jest.fn().mockResolvedValue({
                status: 'success',
                onus: [{ id: '4', slotId: '1', macAddress: 'AA:BB:CC:DD:EE:FF', rxPower: '-24.50 dBm' }],
            }),
            getSingleOnuData: jest.fn(),
            matchMAC: jest.fn(),
            normalizeMAC: jest.fn(),
        }));
        const hioso = require('../olt-drivers/hioso');
        const result = await hioso.getOltData({ host: '1.2.3.4' });
        expect(result.status).toBe('success');
        expect(result.onus[0].serial).toBeNull();
        expect(result.onus[0].macAddress).toBe('AA:BB:CC:DD:EE:FF');
        jest.dontMock('../olt-hioso');
        jest.resetModules();
    });
});
