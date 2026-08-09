/**
 * Header Doc
 * Purpose: Mengunci perbaikan "bayar sebagian, pelanggan tak diberi kabar". Notifikasi pelanggan
 *          selama ini hanya dipasang di callback `onFinalPaid`, yang menurut kontraknya HANYA
 *          dipanggil saat periode LUNAS PENUH — sehingga pembayaran sebagian tidak memicu pesan
 *          apa pun. Pelanggan menyerahkan uang, tak menerima tanda terima, lalu besoknya
 *          "cek tagihan" menjawab nominal PENUH + BELUM LUNAS; dari sisinya uangnya seperti hilang.
 * Caller: Jest (`npx jest lib/__tests__/partial-payment-receipt.test.js`).
 * Deps: fs/path + `lib/services/paid-receipt` (builder murni, tak menyentuh jaringan).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');
const { buildPartialPaymentReceiptText, formatRupiah } = require('../services/paid-receipt');

describe('struk cicilan: pelanggan yang bayar sebagian tetap diberi tanda terima', () => {
    test('builder tersedia di pemilik struk yang sama (bukan template tandingan)', () => {
        expect(typeof buildPartialPaymentReceiptText).toBe('function');
    });

    test('struk memuat jumlah dibayar DAN sisa tagihan', () => {
        const teks = String(buildPartialPaymentReceiptText({
            user: { name: 'Endang', subscription: 'PAKET-150K' },
            amountPaid: 75000,
            amountRemaining: 75000,
            periodMonth: 8,
            periodYear: 2026,
            method: 'cash',
            paidAt: new Date('2026-08-09T10:00:00Z').toISOString(),
            refId: 123
        }));
        expect(teks).toContain('Endang');
        expect(teks).toContain(formatRupiah(75000));
        expect(teks).toMatch(/sisa/i);
        // Tidak boleh mengklaim lunas.
        expect(teks).not.toMatch(/\bLUNAS\b/);
        // Tak ada slot yang gagal tersubstitusi.
        expect(teks).not.toMatch(/\$\{[a-zA-Z0-9_]+\}/);
    });

    test('jalur pembayaran sebagian benar-benar mengirim struk itu', () => {
        const src = baca('routes', 'partial-payment.js');
        expect(src).toMatch(/buildPartialPaymentReceiptText/);
        // Uang sudah berpindah tangan → wajib jalur berjaminan (retry + dead-letter).
        expect(src).toMatch(/sendCritical\(/);
        expect(src).toMatch(/struk_cicilan/);
    });

    test('hanya dikirim saat SEBAGIAN — pelunasan penuh tetap memakai struk lunas', () => {
        const src = baca('routes', 'partial-payment.js');
        const idx = src.indexOf('buildPartialPaymentReceiptText');
        const sebelum = src.slice(Math.max(0, idx - 900), idx);
        expect(sebelum).toMatch(/if\s*\(isPartial\)/);
    });

    test('gagal kirim TIDAK membatalkan pencatatan pembayaran', () => {
        const src = baca('routes', 'partial-payment.js');
        const idx = src.indexOf('buildPartialPaymentReceiptText');
        const blok = src.slice(idx - 400, idx + 1400);
        expect(blok).toMatch(/try\s*\{/);
        expect(blok).toMatch(/catch\s*\(strukErr\)/);
    });

    test('nomor multi (dipisah |) semuanya dikirimi', () => {
        const src = baca('routes', 'partial-payment.js');
        const idx = src.indexOf('buildPartialPaymentReceiptText');
        const blok = src.slice(idx, idx + 1200);
        expect(blok).toMatch(/split\('\|'\)/);
    });

    test('template cicilan terdaftar di store yang sama dengan struk lunas', () => {
        const t = JSON.parse(baca('database', 'message_templates.json'));
        expect(t.tagihan_struk_cicilan).toBeDefined();
        const teks = String(t.tagihan_struk_cicilan.template || t.tagihan_struk_cicilan);
        expect(teks).toMatch(/\$\{sisa_tagihan\}/);
        expect(teks).toMatch(/\$\{jumlah_dibayar\}/);
    });
});
