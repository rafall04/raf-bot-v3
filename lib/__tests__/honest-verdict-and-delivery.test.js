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
    const verdictSrc = fs.readFileSync(path.join(REPO, 'lib', 'whatsapp-delivery-verdict.js'), 'utf8');

    test('pesan kritis mem-bypass dedup (retry mengirim teks yang sama persis)', () => {
        expect(criticalSrc).toMatch(/sendOpts\.skipDuplicateCheck\s*=\s*true/);
    });

    test('penanda gagal wrapper (error/blocked_duplicate) terpusat di helper verdict', () => {
        // #b318: pengenalan penanda dipindah ke helper bersama supaya semua sibling sepakat.
        expect(verdictSrc).toMatch(/'error'/);
        expect(verdictSrc).toMatch(/'blocked_duplicate'/);
    });

    test('sendCritical membaca hasil via helper & melempar supaya masuk retry → dead-letter', () => {
        expect(criticalSrc).toMatch(/const\s+res\s*=\s*await\s+gateway\.sendPayload\(/);
        expect(criticalSrc).toMatch(/deliveryFailureReason\(res\)/);
        const idx = criticalSrc.indexOf('deliveryFailureReason(res)');
        expect(criticalSrc.slice(idx, idx + 220)).toMatch(/throw new Error/);
    });

    test('retry dead-letter pakai skipDuplicateCheck & PERIKSA hasil (tak tandai retried buta)', () => {
        // Sibling yang dulu terlewat: retryFailedDeliveries kirim `{}` lalu langsung retried=true.
        const idx = criticalSrc.indexOf('async function retryFailedDeliveries');
        const end = criticalSrc.indexOf('\nmodule.exports', idx);
        const body = criticalSrc.slice(idx, end > idx ? end : idx + 2000);
        expect(body).toMatch(/skipDuplicateCheck:\s*true/);
        expect(body).toMatch(/isDeliverySuccessful\(res\)/);
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
