/**
 * Header Doc
 * Purpose: Mengunci dua perbaikan "jangan mengaku tahu / jangan mengaku terkirim":
 *          (1) `runDeepCheck` tak boleh memvonis SEMUA_HIJAU saat jalur pelanggan TIDAK TERBACA —
 *              `isPppoeOnline` memulangkan null saat MikroTik tak terjangkau, dan gerbang lama
 *              `if (pppoe === false)` meloloskannya sebagai sehat, lalu pelanggan yang jalurnya
 *              putus diberi tahu "dari sisi kami semuanya terpantau normal".
 *          (2) `sendCritical` tak boleh melaporkan `delivered:true` untuk pesan yang tak pernah
 *              keluar — wrapper notifikasi memulangkan OBJEK penanda (blocked_duplicate / error)
 *              alih-alih melempar, sehingga kode voucher "terkirim" tanpa masuk dead-letter.
 * Caller: Jest (`npx jest lib/__tests__/honest-verdict-and-delivery.test.js`).
 * Deps: fs/path (scan statis), `../reboot-followup-service` (runDeepCheck via mock mikrotik).
 * MainFuncs: -
 * SideEffects: Set global.config sementara.
 */
'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../mikrotik', () => ({
    getActivePPPoEUsers: jest.fn(),
    getPPPoESecrets: jest.fn()
}));

const REPO = path.join(__dirname, '..', '..');
const criticalSrc = fs.readFileSync(path.join(REPO, 'lib', 'whatsapp-critical-delivery.js'), 'utf8');
const wrapperSrc = fs.readFileSync(path.join(REPO, 'lib', 'whatsapp-notification-wrapper.js'), 'utf8');
const handlerSrc = fs.readFileSync(
    path.join(REPO, 'message', 'handlers', 'states', 'reboot-followup-state-handler.js'),
    'utf8'
);
const serviceSrc = fs.readFileSync(path.join(REPO, 'lib', 'reboot-followup-service.js'), 'utf8');

describe('runDeepCheck: "hijau" wajib berdiri di atas bukti positif', () => {
    const service = require('../reboot-followup-service');
    const { getActivePPPoEUsers } = require('../mikrotik');

    beforeEach(() => {
        jest.clearAllMocks();
        global.config = { rebootAssist: { enabled: true }, upstreamMonitor: { enabled: false } };
    });

    test('MikroTik tak terjangkau → TAK_TERPANTAU, BUKAN SEMUA_HIJAU', async () => {
        getActivePPPoEUsers.mockRejectedValue(new Error('connect ETIMEDOUT'));

        const out = await service.runDeepCheck({
            id: 'J1',
            pppoeUsername: 'budi@rafcybernet',
            routerId: 'default',
            deviceId: 'DEV-1'
        });

        expect(out.verdict).toBe('TAK_TERPANTAU');
        expect(out.verdict).not.toBe('SEMUA_HIJAU');
    });

    test('username PPPoE kosong (data bolong) juga TAK_TERPANTAU — bukan dianggap sehat', async () => {
        const out = await service.runDeepCheck({ id: 'J2', pppoeUsername: '', routerId: 'default', deviceId: 'DEV-2' });
        expect(out.verdict).toBe('TAK_TERPANTAU');
    });

    test('gerbang lama `pppoe === false` tidak lagi jadi satu-satunya penentu', () => {
        // Kalau seseorang mengembalikan bentuk lama, cabang buta hilang lagi tanpa terasa.
        expect(serviceSrc).toContain('TAK_TERPANTAU');
        expect(serviceSrc).toMatch(/if\s*\(\s*pppoe\s*!==\s*true\s*\)/);
    });

    test('handler punya cabang sendiri untuk TAK_TERPANTAU dan tidak memakai template "semua normal"', () => {
        const idx = handlerSrc.indexOf('TAK_TERPANTAU');
        expect(idx).toBeGreaterThan(-1);
        const cabang = handlerSrc.slice(idx, idx + 900);
        expect(cabang).toContain('rebootfu_deep_unknown');
        expect(cabang).not.toContain('rebootfu_deep_all_green');
        // Admin harus tahu alasan SEBENARNYA, bukan "semua normal".
        expect(cabang).toMatch(/notifyAdmins/);
    });

    test('template cabang buta terdaftar di response_templates.json', () => {
        const templates = require('../../database/response_templates.json');
        expect(templates.rebootfu_deep_unknown).toBeDefined();
    });
});

describe('sendCritical: tak boleh melaporkan terkirim untuk pesan yang tak pernah keluar', () => {
    test('pesan kritis mem-bypass dedup (retry mengirim teks yang sama persis)', () => {
        expect(criticalSrc).toMatch(/sendOpts\.skipDuplicateCheck\s*=\s*true/);
    });

    test('objek penanda dari wrapper dibaca sebagai KEGAGALAN, bukan sukses', () => {
        expect(criticalSrc).toMatch(/res\.status\s*===\s*"error"/);
        expect(criticalSrc).toMatch(/res\.status\s*===\s*"blocked_duplicate"/);
        // Harus melempar supaya masuk jalur retry → dead-letter.
        const idx = criticalSrc.indexOf('blocked_duplicate');
        expect(criticalSrc.slice(idx, idx + 260)).toMatch(/throw new Error/);
    });

    test('hasil sendPayload benar-benar diperiksa, bukan diabaikan', () => {
        expect(criticalSrc).toMatch(/const\s+res\s*=\s*await\s+gateway\.sendPayload\(/);
    });
});

describe('wrapper notifikasi: penanda "terkirim" hanya setelah benar-benar terkirim', () => {
    test('markNotificationSent tidak lagi dipanggil SEBELUM originalSendMessage', () => {
        const idxMark = wrapperSrc.indexOf('markNotificationSent(jid, message)');
        const idxSend = wrapperSrc.indexOf('await originalSendMessage(jid, message, options)');
        expect(idxMark).toBeGreaterThan(-1);
        expect(idxSend).toBeGreaterThan(-1);
        expect(idxMark).toBeGreaterThan(idxSend);
    });

    test('hasil kirim dikembalikan apa adanya ke pemanggil', () => {
        expect(wrapperSrc).toMatch(/const\s+sendResult\s*=\s*await\s+originalSendMessage\(/);
        expect(wrapperSrc).toMatch(/return\s+sendResult/);
    });
});
