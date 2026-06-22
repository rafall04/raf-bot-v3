/**
 * Test helper parsing driver ZTE (murni, tanpa jaringan).
 * Encoding berasal dari discovery C320 asli (docs/olt-zte-c320-snmp-map.md).
 */
const zte = require('../olt-drivers/zte');
const { formatZteSerial, parseRxPower, parseTxPower, classifyStatus, extractIndex, cleanZteTime } = zte.__test;

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

describe('zte: parseRxPower (signed16/500-30, diverifikasi vs CLI)', () => {
    test('sinyal kuat: raw positif (cocok CLI show pon power)', () => {
        expect(parseRxPower(3406)).toBe('-23.19 dBm'); // CLI onu14 -23.188
        expect(parseRxPower(3584)).toBe('-22.83 dBm'); // CLI onu16 -22.832
        expect(parseRxPower(5126)).toBe('-19.75 dBm'); // CLI onu20 -19.790
    });

    test('sinyal LEMAH (< -30): raw wrap → dibaca signed16 (cocok CLI)', () => {
        expect(parseRxPower(65052)).toBe('-30.97 dBm'); // CLI 1/2/4:9 -30.968
        expect(parseRxPower(64762)).toBe('-31.55 dBm'); // CLI 1/2/5:9 -31.548
    });

    test('no-signal / kosong → N/A', () => {
        expect(parseRxPower(65535)).toBe('N/A'); // CLI "no signal"
        expect(parseRxPower(null)).toBe('N/A');
        expect(parseRxPower('')).toBe('N/A');
        expect(parseRxPower('abc')).toBe('N/A');
    });

    test('raw sampah (di luar rentang fisik) → N/A', () => {
        expect(parseRxPower(30000)).toBe('N/A'); // signed +30 dBm (mustahil)
        expect(parseRxPower(50000)).toBe('N/A'); // signed -61 dBm (mustahil)
    });
});

describe('zte: parseTxPower (ONU Tx upstream, c14)', () => {
    test('raw positif → dBm = signed16/500-30 (cocok CLI ONU Tx)', () => {
        expect(parseTxPower(16215)).toBe('2.43 dBm');  // CLI onu20 ONU Tx 2.429
        expect(parseTxPower(16479)).toBe('2.96 dBm');  // CLI onu16 ~2.910
    });
    test('no-signal / di luar rentang → N/A', () => {
        expect(parseTxPower(65535)).toBe('N/A');
        expect(parseTxPower(3406)).toBe('N/A');   // -23 dBm (itu RX, bukan TX valid)
        expect(parseTxPower(null)).toBe('N/A');
    });
});

describe('zte: classifyStatus (col4 state-live + col7 cause, diverifikasi vs CLI)', () => {
    test('col4=3 → Online (lastDownCause null walau col7 ada)', () => {
        const s = classifyStatus(3, 9);
        expect(s.status).toBe('Online');
        expect(s.isLos).toBe(false);
        expect(s.isDyingGasp).toBe(false);
        expect(s.lastDownCause).toBeNull();
    });

    test('col4=1 → LOS (col7=2 → cause "LOS")', () => {
        const s = classifyStatus(1, 2);
        expect(s.status).toBe('LOS');
        expect(s.isLos).toBe(true);
        expect(s.lastDownCause).toBe('LOS');
    });

    test('col4=4 → Dying Gasp (col7=9 → "DyingGasp")', () => {
        const s = classifyStatus(4, 9);
        expect(s.status).toBe('Dying Gasp');
        expect(s.isDyingGasp).toBe(true);
        expect(s.lastDownCause).toBe('DyingGasp');
    });

    test('col4=6 → Offline generik; col7=1 (none) → lastDownCause null', () => {
        const s = classifyStatus(6, 1);
        expect(s.status).toBe('Offline');
        expect(s.isLos).toBe(false);
        expect(s.isDyingGasp).toBe(false);
        expect(s.lastDownCause).toBeNull();
    });

    test('col4 tak dikenal → Offline; col7=3 → cause "LOSi"', () => {
        const s = classifyStatus(99, 3);
        expect(s.status).toBe('Offline');
        expect(s.lastDownCause).toBe('LOSi');
    });
});

describe('zte: cleanZteTime (timestamp col5/col6)', () => {
    test('timestamp valid → apa adanya', () => {
        expect(cleanZteTime('2026-06-22 12:43:32')).toBe('2026-06-22 12:43:32');
    });
    test('"0000-00-00 ..." / kosong / null → null (belum pernah)', () => {
        expect(cleanZteTime('0000-00-00 00:00:00')).toBeNull();
        expect(cleanZteTime('')).toBeNull();
        expect(cleanZteTime(null)).toBeNull();
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
