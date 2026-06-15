/**
 * Header Doc
 * Purpose: Test classifier discovery netwatch → CCTV. Memastikan pola script RouterOS asli
 *          (CCTV standar / CCTV belum standar / infra / noise) diklasifikasi benar, plus
 *          cross-check registry (markRegistered).
 * Caller: jest.
 * Deps: ../cctv-netwatch-discovery.
 */
'use strict';

const {
    extractLocal,
    classifyEntry,
    classifyNetwatchEntries,
    markRegistered,
} = require('../cctv-netwatch-discovery');

// Sampel script asli (disederhanakan dari MikroTik produksi).
const CCTV_SCRIPT =
    ':local bot "123:ABC";\r\n:local chat "-4707718346";\r\n:local area "DANDER";\r\n' +
    ':local cctv "CCTV MBAH UTI ARAH MUSHOLLA";\r\n:local msg "CCTV ONLINE (UP)...";\r\n/tool fetch url';
const INFRA_SCRIPT =
    ':local bot "123:ABC";\r\n:local chat "-5161321489";\r\n:local dev "OLT HIOSO HOME";\r\n' +
    ':local msg "KONEKSI PUTUS (DOWN)...";\r\n/tool fetch url';

describe('cctv-netwatch-discovery', () => {
    test('extractLocal mengambil nilai :local dgn benar', () => {
        expect(extractLocal(CCTV_SCRIPT, 'cctv')).toBe('CCTV MBAH UTI ARAH MUSHOLLA');
        expect(extractLocal(CCTV_SCRIPT, 'area')).toBe('DANDER');
        expect(extractLocal(CCTV_SCRIPT, 'dev')).toBeNull();
        expect(extractLocal('', 'cctv')).toBeNull();
    });

    test('CCTV format sesuai → conformant, nama+area dari script', () => {
        const c = classifyEntry({
            host: '192.168.13.2', status: 'up', comment: 'CCTV MBAH UTI 1',
            disabled: 'false', down_script: CCTV_SCRIPT, up_script: CCTV_SCRIPT,
        });
        expect(c.klass).toBe('cctv');
        expect(c.conformant).toBe(true);
        expect(c.name).toBe('CCTV MBAH UTI ARAH MUSHOLLA');
        expect(c.area).toBe('DANDER');
        expect(c.host).toBe('192.168.13.2');
    });

    test('Infra (OLT/link/AP backhaul) → excluded reason=infra', () => {
        const c = classifyEntry({
            host: '192.168.11.2', status: 'up', comment: 'OLT HIOSO HOME',
            down_script: INFRA_SCRIPT, up_script: INFRA_SCRIPT,
        });
        expect(c.klass).toBe('excluded');
        expect(c.excludedReason).toBe('infra');
    });

    test('CCTV by-comment dgn script placeholder → cctv "belum standar"', () => {
        const c = classifyEntry({
            host: '192.168.12.2', status: 'up', comment: 'CCTV IMOU DEPAN',
            down_script: '/tool fetch url', up_script: '/tool fetch url',
        });
        expect(c.klass).toBe('cctv');
        expect(c.conformant).toBe(false);
        expect(c.name).toBe('CCTV IMOU DEPAN');
        expect(c.area).toBeNull();
    });

    test('NVR by-comment dikenali sebagai CCTV + flag disabled netwatch', () => {
        const c = classifyEntry({
            host: '192.168.0.2', status: 'unknown', comment: 'NVR HOME',
            disabled: 'true', down_script: '/tool fetch url', up_script: '/tool fetch url',
        });
        expect(c.klass).toBe('cctv');
        expect(c.conformant).toBe(false);
        expect(c.disabled).toBe(true);
    });

    test('Uji konektivitas / AP biasa → excluded reason=noise', () => {
        expect(classifyEntry({ host: '8.8.8.8', comment: '8.8.8.8 GOOGLE', down_script: '/tool fetch url' }).klass).toBe('excluded');
        expect(classifyEntry({ host: '192.168.20.4', comment: 'AP LOCO M2 UTARA', down_script: '/tool fetch url' }).excludedReason).toBe('noise');
    });

    test('classifyNetwatchEntries memetakan seluruh array', () => {
        const list = classifyNetwatchEntries([
            { host: '192.168.13.2', comment: 'x', down_script: CCTV_SCRIPT },
            { host: '192.168.11.2', comment: 'OLT', down_script: INFRA_SCRIPT },
        ]);
        expect(list).toHaveLength(2);
        expect(list[0].klass).toBe('cctv');
        expect(list[1].klass).toBe('excluded');
        expect(classifyNetwatchEntries(null)).toEqual([]);
    });

    test('markRegistered menandai host yang sudah terdaftar (case-insensitive)', () => {
        const cand = [{ host: '192.168.13.2' }, { host: '192.168.14.2' }];
        const marked = markRegistered(cand, ['192.168.13.2']);
        expect(marked[0].alreadyRegistered).toBe(true);
        expect(marked[1].alreadyRegistered).toBe(false);
    });
});
