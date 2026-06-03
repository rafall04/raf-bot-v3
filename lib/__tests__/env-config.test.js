const { getMonitoringConfig } = require('../env-config');

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
