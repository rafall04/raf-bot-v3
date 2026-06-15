/**
 * Header Doc
 * Purpose: Test generator script netwatch — pastikan SATU BARIS, struktur benar, nama/area auto-isi,
 *          dan sanitasi anti-injeksi CLI (kutip/backslash/newline).
 * Caller: jest.
 * Deps: ../cctv-netwatch-script.
 */
'use strict';

const {
    DEFAULT_NETWATCH,
    sanitizeRouterString,
    buildNetwatchScripts,
    isValidNetwatchConfig,
} = require('../cctv-netwatch-script');

const CFG = { botToken: '123:ABC', chatId: '-4707718346', interval: '5s', timeout: '1s', msgUp: DEFAULT_NETWATCH.msgUp, msgDown: DEFAULT_NETWATCH.msgDown };

describe('cctv-netwatch-script', () => {
    test('script SATU BARIS (tidak ada newline) — wajib utk write() API', () => {
        const { upScript, downScript } = buildNetwatchScripts(CFG, { name: 'CCTV PERTIGAAN RT 02', area: 'DANDER' });
        expect(upScript).not.toMatch(/[\r\n]/);
        expect(downScript).not.toMatch(/[\r\n]/);
    });

    test('nama & area auto-isi via :local', () => {
        const { upScript } = buildNetwatchScripts(CFG, { name: 'CCTV PERTIGAAN RT 02', area: 'DANDER' });
        expect(upScript).toContain(':local cctv "CCTV PERTIGAAN RT 02"');
        expect(upScript).toContain(':local area "DANDER"');
        expect(upScript).toContain(':local chat "-4707718346"');
        expect(upScript).toContain('/tool fetch url="https://api.telegram.org/bot$bot/sendMessage"');
        expect(upScript).toContain('http-data="chat_id=$chat&text=$msg&parse_mode=Markdown"');
    });

    test('up vs down pakai template berbeda (online vs offline)', () => {
        const { upScript, downScript } = buildNetwatchScripts(CFG, { name: 'X', area: 'Y' });
        expect(upScript).toContain('CCTV ONLINE (UP)');
        expect(downScript).toContain('CCTV OFFLINE (DOWN)');
    });

    test('sanitasi: kutip ganda di nama di-escape (anti keluar string)', () => {
        const { upScript } = buildNetwatchScripts(CFG, { name: 'CCTV "HACK" ;/system reset', area: 'A' });
        // Kutip di-escape jadi \" → tidak menutup string :local cctv "..."
        expect(upScript).toContain(':local cctv "CCTV \\"HACK\\" ;/system reset"');
        expect(upScript).not.toMatch(/[\r\n]/);
    });

    test('sanitasi: newline pada nama dibuang (tetap satu baris)', () => {
        const out = sanitizeRouterString('baris1\nbaris2\r\nbaris3');
        expect(out).not.toMatch(/[\r\n]/);
        expect(out).toBe('baris1 baris2 baris3');
    });

    test('sanitasi: backslash di-escape', () => {
        expect(sanitizeRouterString('a\\b')).toBe('a\\\\b');
    });

    test('isValidNetwatchConfig butuh botToken & chatId', () => {
        expect(isValidNetwatchConfig({ botToken: '123:ABC', chatId: '-1' })).toBe(true);
        expect(isValidNetwatchConfig({ botToken: '', chatId: '-1' })).toBe(false);
        expect(isValidNetwatchConfig({ botToken: '123', chatId: '' })).toBe(false);
        expect(isValidNetwatchConfig({})).toBe(false);
    });
});
