const { getMonitoringConfig, getDatabasePath } = require('../env-config');

describe('getDatabasePath: isolasi test menjaga ekstensi asli (#b319)', () => {
    // NODE_ENV=test di jest → cabang isolasi aktif.
    test('.sqlite → *_test.sqlite (perilaku lama TIDAK berubah)', () => {
        expect(getDatabasePath('users.sqlite').replace(/\\/g, '/')).toMatch(/users_test\.sqlite$/);
    });
    test('.json → *_test.json (BUKAN namafile.json_test.sqlite) → store JSON prod tak tertimpa `npm test`', () => {
        const p = getDatabasePath('topup_requests.json').replace(/\\/g, '/');
        expect(p).toMatch(/topup_requests_test\.json$/);
        expect(p).not.toMatch(/topup_requests\.json_test/);
    });
    test('nama tanpa ekstensi tetap jatuh ke .sqlite (kompat lama)', () => {
        expect(getDatabasePath('foo').replace(/\\/g, '/')).toMatch(/foo_test\.sqlite$/);
    });
});

describe('getMonitoringConfig', () => {
    const originalValue = process.env.MONITORING_ENABLED;

    afterEach(() => {
        if (originalValue === undefined) {
            delete process.env.MONITORING_ENABLED;
        } else {
            process.env.MONITORING_ENABLED = originalValue;
        }
    });

    test('defaults to disabled when env and config are absent', () => {
        delete process.env.MONITORING_ENABLED;

        expect(getMonitoringConfig({})).toEqual(expect.objectContaining({ enabled: false }));
    });

    test('reads config.json fallback when env is absent', () => {
        delete process.env.MONITORING_ENABLED;

        expect(getMonitoringConfig({ monitoring: { enabled: true } })).toEqual(expect.objectContaining({ enabled: true }));
    });

    test('process env overrides config.json', () => {
        process.env.MONITORING_ENABLED = 'false';

        expect(getMonitoringConfig({ monitoring: { enabled: true } })).toEqual(expect.objectContaining({ enabled: false }));
    });
});
