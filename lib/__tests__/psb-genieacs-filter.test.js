const {
    isDefaultPppoeUsername,
    normalizeGenieAcsPsbDevice,
    filterNormalizedPsbDevices,
    stickerHintToHex,
    hexToStickerForm,
    snSearchVariants,
    serialMatchesFilter,
    psbCandidateMatchesHint,
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

describe('pencocokan SN sadar-bentuk-stiker (insiden Dander 2026-08-07)', () => {
    // Stiker Huawei: `HWTC49B734AD`; ACS menyimpan `4857544349B734AD` (48575443 = ASCII "HWTC").
    const ACS_HEX = '4857544349B734AD';
    const STICKER = 'HWTC49B734AD';

    test('konversi dua arah stiker ↔ heksa', () => {
        expect(stickerHintToHex(STICKER)).toBe(ACS_HEX.toLowerCase());
        expect(stickerHintToHex('HWTC49B7')).toBe('4857544349b7'); // potongan awal stiker
        expect(stickerHintToHex('wimpi')).toBeNull(); // nama orang bukan pola stiker
        expect(hexToStickerForm(ACS_HEX)).toBe(STICKER.toLowerCase());
        expect(hexToStickerForm('0011223344556677')).toBeNull(); // 8 heksa awal bukan huruf
        expect(hexToStickerForm('49b734ad')).toBeNull(); // potongan ekor: tak ada vendor prefix
    });

    test('SN LENGKAP persis dari stiker menemukan device ber-SN heksa ACS (akar insiden)', () => {
        expect(serialMatchesFilter(ACS_HEX, STICKER)).toBe(true);
        expect(serialMatchesFilter(ACS_HEX, STICKER.toLowerCase())).toBe(true);
        expect(serialMatchesFilter(ACS_HEX, 'HWTC 49B7 34AD')).toBe(true); // spasi ala stiker
        expect(serialMatchesFilter(ACS_HEX, 'HWTC-49B734AD')).toBe(true);
    });

    test('arah sebaliknya + potongan tetap jalan', () => {
        expect(serialMatchesFilter(STICKER, ACS_HEX)).toBe(true); // ACS simpan bentuk stiker (mis. ZTE)
        expect(serialMatchesFilter(ACS_HEX, '49B734AD')).toBe(true); // ekor heksa
        expect(serialMatchesFilter(ACS_HEX, 'HWTC49B7')).toBe(true); // potongan berawalan vendor
        expect(serialMatchesFilter(ACS_HEX, 'HWTC99999999')).toBe(false); // stiker lain: tak match
        expect(serialMatchesFilter('EQFLH7U22977', 'EQFLH7U2')).toBe(true); // SN non-heksa apa adanya
    });

    test('filter by-sn di listPsbDevices ikut sadar-stiker', () => {
        const devices = [
            { deviceId: 'hw', serialNumber: ACS_HEX },
            { deviceId: 'zte', serialNumber: 'ZTEGC8123456' },
        ];
        expect(
            filterNormalizedPsbDevices(devices, { filterType: 'by-sn', serialNumberFilter: STICKER })
                .map((d) => d.deviceId)
        ).toEqual(['hw']);
    });

    test('psbCandidateMatchesHint: SN stiker, device id, dan PPPoE pemilik lama', () => {
        const device = {
            deviceId: '00259E-HG8145V5-4857544349B734AD',
            serialNumber: ACS_HEX,
            currentPPPUsername: 'wimpi-krajan@rafcybernet',
        };
        expect(psbCandidateMatchesHint(device, 'HWTC49B734AD')).toBe(true); // SN lengkap stiker
        expect(psbCandidateMatchesHint(device, '34ad')).toBe(true); // ekor SN
        expect(psbCandidateMatchesHint(device, 'wimpi')).toBe(true); // nama pemilik lama
        expect(psbCandidateMatchesHint(device, 'wimpi-krajan')).toBe(true); // pppoe dgn pemisah
        expect(psbCandidateMatchesHint(device, 'HG8145V5')).toBe(true); // model di device id
        expect(psbCandidateMatchesHint(device, 'sukirman')).toBe(false);
        expect(psbCandidateMatchesHint(device, '')).toBe(false);
    });

    test('psbCandidateMatchesHint melihat SEMUA username (WAN TR-069 terpisah, PPPoE di index lain)', () => {
        // currentPPPUsername (index 1) = akun manajemen; PPPoE pelanggan hanya ada di daftar lengkap.
        const device = {
            deviceId: 'dev-multi-wan',
            serialNumber: ACS_HEX,
            currentPPPUsername: 'mgmt-acs@wan1',
            allPPPUsernames: ['mgmt-acs@wan1', 'wimpi-krajan@rafcybernet'],
        };
        expect(psbCandidateMatchesHint(device, 'wimpi')).toBe(true);
        expect(psbCandidateMatchesHint(device, 'mgmt-acs')).toBe(true);
        expect(psbCandidateMatchesHint(device, 'sukirman')).toBe(false);
    });

    test('filter by-pppoe & default melihat SEMUA username, bukan hanya index 1', () => {
        const devices = [
            { deviceId: 'multi', currentPPPUsername: 'mgmt-acs@wan1', allPPPUsernames: ['mgmt-acs@wan1', 'wimpi-krajan@rafcybernet'] },
            { deviceId: 'polos-idx2', currentPPPUsername: null, allPPPUsernames: ['tes@hw'] },
            { deviceId: 'lain', currentPPPUsername: 'budi@x', allPPPUsernames: ['budi@x'] },
        ];
        expect(
            filterNormalizedPsbDevices(devices, { filterType: 'by-pppoe', pppoeUsernameFilter: 'wimpi' })
                .map((d) => d.deviceId)
        ).toEqual(['multi']);
        expect(
            filterNormalizedPsbDevices(devices, { filterType: 'default' }).map((d) => d.deviceId)
        ).toEqual(['polos-idx2']);
    });

    test('snSearchVariants memuat bentuk mentah + tanpa-pemisah + konversi', () => {
        expect(snSearchVariants('HWTC 49B734AD')).toEqual(
            expect.arrayContaining(['hwtc 49b734ad', 'hwtc49b734ad', '4857544349b734ad'])
        );
    });
});

describe('normalisasi _lastBootstrap (deteksi modem bekas di-reset)', () => {
    test('_lastBootstrap ikut ternormalisasi; absen → null', () => {
        const withBootstrap = normalizeGenieAcsPsbDevice({
            _id: 'dev-reset',
            _registered: '2024-01-01T00:00:00.000Z',
            _lastBootstrap: '2026-08-07T09:00:00.000Z',
            _lastInform: '2026-08-07T09:05:00.000Z',
        });
        expect(withBootstrap.lastBootstrap).toBe('2026-08-07T09:00:00.000Z');
        expect(withBootstrap.lastBootstrapTimestamp).toBe(Date.parse('2026-08-07T09:00:00.000Z'));
        // `_registered` kuno TETAP kuno — itulah kenapa jalur bootstrap dibutuhkan.
        expect(withBootstrap.registeredDate).toBe('2024-01-01T00:00:00.000Z');

        const without = normalizeGenieAcsPsbDevice({ _id: 'dev-plain' });
        expect(without.lastBootstrap).toBeNull();
        expect(without.lastBootstrapTimestamp).toBeNull();
    });
});

// Pengukuran LANGSUNG di ACS produksi Dander (172.17.11.2:7557) pada 2026-08-08, 160 device.
// Konstanta di bawah bukan tebakan — ia menyalin bentuk data nyata, supaya kalau ACS/vendor berubah
// bentuk SN-nya, suite ini yang jatuh lebih dulu, bukan teknisi yang di lapangan.
describe('bentuk SN NYATA di ACS produksi Dander (diukur 2026-08-08, 160 device)', () => {
    // 156/160 device menyimpan SN sebagai 16-heksa yang 8 heksa awalnya = ASCII "HWTC".
    const SN_PRODUKSI = [
        ['485754437C8EBEB1', 'HWTC7C8EBEB1'],
        ['48575443AC218FAC', 'HWTCAC218FAC'],
        ['4857544306400DAE', 'HWTC06400DAE'],
        ['4857544351C405AB', 'HWTC51C405AB'],
        ['48575443F0A798B0', 'HWTCF0A798B0'],
        ['48575443160112B1', 'HWTC160112B1'],
    ];
    // 4/160 sisanya menyimpan SN apa adanya (ONU ZTE / RAFNET) — tak boleh ikut dikonversi.
    const SN_NON_HEKSA = ['EQFLH7U22977', 'EQFLH7U88183', 'EQFLH7U59730', 'ZTE8QGHM4L32415'];

    test.each(SN_PRODUKSI)('SN ACS %s ketemu saat teknisi mengetik bentuk stiker %s', (acsHex, stiker) => {
        // Inilah yang GAGAL di produksi sebelum perbaikan: pencocokan substring mentah bikin
        // "tidak ada device ditemukan" walau modemnya jelas ada di ACS.
        expect(acsHex.toLowerCase().includes(stiker.toLowerCase())).toBe(false); // bukti kegagalan lama
        expect(serialMatchesFilter(acsHex, stiker)).toBe(true);
        expect(serialMatchesFilter(acsHex, stiker.slice(0, 8))).toBe(true); // potongan awal stiker
        expect(serialMatchesFilter(acsHex, acsHex)).toBe(true); // bentuk heksa tetap jalan
    });

    test('SN stiker satu modem tidak menyenggol modem lain (tak ada tabrakan)', () => {
        for (const [, stiker] of SN_PRODUKSI) {
            const cocok = SN_PRODUKSI.filter(([hex]) => serialMatchesFilter(hex, stiker));
            expect(cocok).toHaveLength(1);
        }
    });

    test('SN non-heksa (ZTE/RAFNET) dicocokkan apa adanya, tanpa konversi', () => {
        for (const sn of SN_NON_HEKSA) {
            expect(serialMatchesFilter(sn, sn)).toBe(true);
            expect(serialMatchesFilter(sn, sn.slice(-6))).toBe(true);
            expect(hexToStickerForm(sn)).toBeNull();
        }
    });
});
