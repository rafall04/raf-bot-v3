const fs = require('fs');
const path = require('path');

describe('speed admin page approval fixes', () => {
    test('speed boost config preserves explicit false booleans during hydration', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', '..', 'static', 'js', 'speed-boost-config.js'), 'utf8');
        expect(source.includes("speedBoostConfig.enabled || true")).toBe(false);
        expect(source.includes("requirePaymentFirst || true")).toBe(false);
        expect(source.includes("autoApproveDoubleBoost || true")).toBe(false);
        expect(source.includes('resolveBoolean(')).toBe(true);
    });

    test('speed requests page uses a stable global DataTable reference', () => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'sb-admin', 'speed-requests.php'), 'utf8');
        expect(source.includes('window.speedRequestTable = null;')).toBe(true);
        expect(source.includes('function getSpeedRequestTable()')).toBe(true);
        expect(source.includes('getSpeedRequestTable()?.ajax.reload();')).toBe(true);
    });
});
