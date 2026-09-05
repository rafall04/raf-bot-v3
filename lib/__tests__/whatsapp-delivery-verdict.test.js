/**
 * Header Doc
 * Purpose: Uji PERILAKU fondasi "kejujuran kirim WA" (#b318): helper verdict bersama + dua sibling
 *   yang dulu memperlakukan objek-penanda gagal wrapper sebagai sukses —
 *   `whatsapp-delivery-service.sendMessage` (lapor sent:true walau {status:'error'}) dan
 *   `whatsapp-critical-delivery.retryFailedDeliveries` (tandai dead-letter retried buta → kode
 *   voucher/konfirmasi saldo hilang permanen).
 * Caller: Jest (`npx jest lib/__tests__/whatsapp-delivery-verdict.test.js`).
 * Deps: mock `../whatsapp-gateway`; spy `fs` untuk dead-letter.
 * MainFuncs: -
 * SideEffects: -
 */
'use strict';

jest.mock('../whatsapp-gateway', () => ({
    isReady: jest.fn(() => true),
    getConnectionState: jest.fn(() => 'open'),
    sendPayload: jest.fn(),
}));

const fs = require('fs');
const gateway = require('../whatsapp-gateway');
const verdict = require('../whatsapp-delivery-verdict');
const delivery = require('../whatsapp-delivery-service');
const critical = require('../whatsapp-critical-delivery');

const RAW_OK = { key: { id: 'WA_OK_1', remoteJid: '628@s.whatsapp.net' } };
const MARK_ERROR = { key: { id: 'ERR_1' }, status: 'error', error: 'WhatsApp connection not ready (state: close)' };
const MARK_DUP = { key: { id: 'DUP_1' }, status: 'blocked_duplicate' };

describe('helper verdict: kenali penanda gagal wrapper', () => {
    test('deliveryFailureReason: error/blocked_duplicate → alasan; sukses/null → null', () => {
        expect(verdict.deliveryFailureReason(MARK_ERROR)).toBe('error');
        expect(verdict.deliveryFailureReason(MARK_DUP)).toBe('blocked_duplicate');
        expect(verdict.deliveryFailureReason(RAW_OK)).toBeNull();
        expect(verdict.deliveryFailureReason(null)).toBeNull();
        expect(verdict.deliveryFailureReason(undefined)).toBeNull();
    });

    test('isDeliverySuccessful (KETAT): hanya true bila bukan error DAN bukan blocked_duplicate', () => {
        expect(verdict.isDeliverySuccessful(RAW_OK)).toBe(true);
        expect(verdict.isDeliverySuccessful(null)).toBe(true);
        expect(verdict.isDeliverySuccessful(MARK_ERROR)).toBe(false);
        expect(verdict.isDeliverySuccessful(MARK_DUP)).toBe(false);
    });

    test('status Baileys berupa ANGKA tidak dianggap gagal (strict string)', () => {
        expect(verdict.isDeliverySuccessful({ key: {}, status: 2 })).toBe(true);
    });
});

describe('delivery-service.sendMessage: sent HARUS jujur', () => {
    beforeEach(() => {
        gateway.isReady.mockReturnValue(true);
        gateway.sendPayload.mockReset();
    });

    test('{status:"error"} → sent:false (bukan lagi sent:true palsu)', async () => {
        gateway.sendPayload.mockResolvedValue(MARK_ERROR);
        const r = await delivery.sendMessage('6281234567890', { text: 'halo' });
        expect(r.sent).toBe(false);
        expect(r.successCount).toBe(0);
        expect(r.errorCode).toBe('SEND_FAILED');
    });

    test('hasil Baileys mentah → sent:true (tak ada regresi jalur sukses)', async () => {
        gateway.sendPayload.mockResolvedValue(RAW_OK);
        const r = await delivery.sendMessage('6281234567890', { text: 'halo' });
        expect(r.sent).toBe(true);
        expect(r.successCount).toBe(1);
        expect(r.deduplicated).toBeUndefined();
    });

    test('{status:"blocked_duplicate"} → sent:true + deduplicated:true (identik sudah terkirim)', async () => {
        gateway.sendPayload.mockResolvedValue(MARK_DUP);
        const r = await delivery.sendMessage('6281234567890', { text: 'halo' });
        expect(r.sent).toBe(true);
        expect(r.deduplicated).toBe(true);
    });
});

describe('retryFailedDeliveries: dead-letter finansial tak boleh hilang senyap', () => {
    let writeSpy;
    const DEAD = [{ id: 'dl1', recipient: '6281234567890', label: 'voucher', message: { text: 'KODE VOUCHER: AB12CD' }, retried: false }];

    beforeEach(() => {
        gateway.isReady.mockReturnValue(true);
        gateway.sendPayload.mockReset();
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(DEAD));
        writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    });
    afterEach(() => { jest.restoreAllMocks(); });

    test('kirim ulang GAGAL ({status:error}) → TETAP unretried, delivered:0, dead-letter tak ditimpa', async () => {
        gateway.sendPayload.mockResolvedValue(MARK_ERROR);
        const out = await critical.retryFailedDeliveries();
        expect(out.attempted).toBe(1);
        expect(out.delivered).toBe(0);
        expect(writeSpy).not.toHaveBeenCalled(); // tak menandai retried → tak menulis
    });

    test('kirim ulang pakai skipDuplicateCheck:true (teks identik dgn kiriman semula)', async () => {
        gateway.sendPayload.mockResolvedValue(MARK_ERROR);
        await critical.retryFailedDeliveries();
        expect(gateway.sendPayload).toHaveBeenCalledWith(
            expect.stringContaining('@s.whatsapp.net'),
            expect.objectContaining({ text: expect.stringContaining('KODE VOUCHER') }),
            { skipDuplicateCheck: true }
        );
    });

    test('kirim ulang BERHASIL → retried=true, delivered:1, dead-letter ditulis', async () => {
        gateway.sendPayload.mockResolvedValue(RAW_OK);
        const out = await critical.retryFailedDeliveries();
        expect(out.delivered).toBe(1);
        expect(writeSpy).toHaveBeenCalled();
        const written = JSON.parse(writeSpy.mock.calls[0][1]);
        expect(written[0].retried).toBe(true);
    });
});
