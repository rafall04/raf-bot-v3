/**
 * Test helper parsing driver ZTE (murni, tanpa jaringan).
 * Encoding berasal dari discovery C320 asli (docs/olt-zte-c320-snmp-map.md).
 */
const zte = require('../olt-drivers/zte');
const { formatZteSerial, parseRxPower, classifyStatus, extractIndex } = zte.__test;

describe('zte: formatZteSerial', () => {
    test('8 byte: 4 ASCII vendor + 4 hex', () => {
        // hex 5a544547 d5d42874 → "ZTEG" + "D5D42874"
        const buf = Buffer.from('5a544547d5d42874', 'hex');
        expect(formatZteSerial(buf)).toBe('ZTEGD5D42874');
    });

    test('buffer kosong / null → null', () => {
        expect(formatZteSerial(null)).toBeNull();
        expect(formatZteSerial(Buffer.alloc(0))).toBeNull();
    });

    test('8 byte ASCII tetap lewat jalur vendor+hex (4 char + hex 4 byte)', () => {
        // "ZTEGTEST" = 8 byte → vendor "ZTEG" + hex("TEST")=54455354
        expect(formatZteSerial(Buffer.from('ZTEGTEST', 'ascii'))).toBe('ZTEG54455354');
    });

    test('panjang ≠ 8 → fallback ascii', () => {
        const six = Buffer.from('414243444546', 'hex'); // "ABCDEF" 6 byte
        expect(formatZteSerial(six)).toBe('ABCDEF');
    });
});

describe('zte: parseRxPower', () => {
    test('raw → -(raw/100) dBm (hipotesis discovery)', () => {
        expect(parseRxPower(2593)).toBe('-25.93 dBm');
        expect(parseRxPower(1276)).toBe('-12.76 dBm');
        expect(parseRxPower('2841')).toBe('-28.41 dBm');
    });

    test('sentinel / kosong → N/A', () => {
        expect(parseRxPower(0)).toBe('N/A');
        expect(parseRxPower(65535)).toBe('N/A');
        expect(parseRxPower(null)).toBe('N/A');
        expect(parseRxPower('')).toBe('N/A');
        expect(parseRxPower('abc')).toBe('N/A');
    });
});

describe('zte: classifyStatus', () => {
    test('phaseState 6 → Online', () => {
        const s = classifyStatus(6, 9);
        expect(s.status).toBe('Online');
        expect(s.isLos).toBe(false);
        expect(s.isDyingGasp).toBe(false);
    });

    test('offline + reason LOS(2) → LOS', () => {
        const s = classifyStatus(0, 2);
        expect(s.status).toBe('LOS');
        expect(s.isLos).toBe(true);
    });

    test('offline + reason dying-gasp(5) → Dying Gasp', () => {
        const s = classifyStatus(0, 5);
        expect(s.status).toBe('Dying Gasp');
        expect(s.isDyingGasp).toBe(true);
    });

    test('offline + reason unknown(1) → Offline generik', () => {
        const s = classifyStatus(0, 1);
        expect(s.status).toBe('Offline');
        expect(s.isLos).toBe(false);
        expect(s.isDyingGasp).toBe(false);
        expect(s.lastDownCause).toBe(1);
    });
});

describe('zte: extractIndex', () => {
    const base = '1.3.6.1.4.1.3902.1012.3.28.1.1.2';
    test('ekstrak pon.onu', () => {
        expect(extractIndex(`${base}.268566784.3`, base)).toEqual({ pon: '268566784', onu: '3' });
    });
    test('abaikan sub-index DDM tambahan', () => {
        const rxBase = '1.3.6.1.4.1.3902.1012.3.50.12.1.1.10';
        expect(extractIndex(`${rxBase}.268566784.3.1`, rxBase)).toEqual({ pon: '268566784', onu: '3' });
    });
    test('oid di luar base → null', () => {
        expect(extractIndex('1.3.6.1.2.1.1.1.0', base)).toBeNull();
    });
});

describe('zte: matchIdentity (deskripsi PPPoE → serial)', () => {
    test('cocok via description (pppoe), case-insensitive', () => {
        expect(zte.matchIdentity('caper@suwito', { description: 'caper@suwito', serial: 'ZTEGD5D42874' })).toBe(true);
        expect(zte.matchIdentity('CAPER@SUWITO', { description: 'caper@suwito' })).toBe(true);
    });
    test('fallback via serial', () => {
        expect(zte.matchIdentity('ZTEGD5D42874', { description: 'lain', serial: 'ZTEGD5D42874' })).toBe(true);
    });
    test('tidak cocok → false', () => {
        expect(zte.matchIdentity('xxx', { description: 'caper@suwito', serial: 'ZTEGD5D42874' })).toBe(false);
        expect(zte.matchIdentity('', {})).toBe(false);
    });
});

describe('zte: capabilities & metadata', () => {
    test('GPON native: LOS via SNMP, tanpa scraper', () => {
        expect(zte.brand).toBe('zte');
        expect(zte.enterpriseOids).toContain('3902');
        expect(zte.capabilities.losViaSnmp).toBe(true);
        expect(zte.capabilities.needsWebScrape).toBe(false);
    });
});

describe('registry mengenali ZTE + auto-deteksi', () => {
    test('resolveDriver brand zte', () => {
        const reg = require('../olt-drivers');
        expect(reg.resolveDriver({ brand: 'zte' }).brand).toBe('zte');
        expect(reg.listDrivers().some((d) => d.brand === 'zte')).toBe(true);
    });
});
