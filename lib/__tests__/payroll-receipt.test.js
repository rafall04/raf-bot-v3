/**
 * Header Doc
 * Purpose: Mengunci struk GAJI teknisi. Payroll sudah menyimpan seluruh angkanya (gaji pokok,
 *   komisi penarikan, bonus, potongan kasbon), tapi sebelum ini teknisi tidak pernah diberi tahu
 *   apa pun saat gajinya dibayar — uang masuk rekening tanpa rincian, dan potongan kasbon (bagian
 *   yang paling sering dipertanyakan) tak terlihat sama sekali.
 * Caller: Jest (`npx jest lib/__tests__/payroll-receipt.test.js`).
 * Deps: `lib/services/payroll-receipt` (builder murni), fs/path (scan statis titik kirim).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');
const { buildPayrollReceiptText, resolveTechnicianPhones, _rupiah } = require('../services/payroll-receipt');

const PAYROLL = {
    id: 12,
    teknisi_id: 3,
    teknisi_name: 'Slamet',
    period_month: 8,
    period_year: 2026,
    gaji_pokok: 1500000,
    bonus: 0,
    bonus_manual: 100000,
    komisi_collection: 75000,
    potongan_kasbon: 200000,
    potongan_lain: 0,
    total_potongan: 200000,
    net_amount: 1475000
};

describe('struk gaji teknisi', () => {
    test('memuat nama, periode, dan gaji BERSIH', () => {
        const teks = buildPayrollReceiptText(PAYROLL);
        expect(teks).toContain('Slamet');
        expect(teks).toContain('Agustus 2026');
        expect(teks).toContain(_rupiah(1475000));
    });

    test('POTONGAN ditampilkan — justru bagian yang paling sering dipertanyakan', () => {
        const teks = buildPayrollReceiptText(PAYROLL);
        expect(teks).toMatch(/potongan kasbon/i);
        expect(teks).toContain(_rupiah(200000));
    });

    test('komponen pendapatan yang ADA ditampilkan, yang NOL tidak (tak ada baris "Rp 0")', () => {
        const teks = buildPayrollReceiptText(PAYROLL);
        expect(teks).toMatch(/komisi penarikan/i);
        expect(teks).not.toMatch(/Potongan lain/i);

        const polos = buildPayrollReceiptText({
            id: 1, teknisi_name: 'Budi', period_month: 8, period_year: 2026,
            gaji_pokok: 1500000, net_amount: 1500000, total_potongan: 0
        });
        expect(polos).not.toMatch(/potongan kasbon/i);
        expect(polos).not.toMatch(/komisi penarikan/i);
    });

    test('tak ada slot yang gagal tersubstitusi', () => {
        expect(buildPayrollReceiptText(PAYROLL)).not.toMatch(/\$\{[a-zA-Z0-9_]+\}/);
    });

    test('penjaga template hilang: tak pernah mengirim teks error sebagai struk gaji', () => {
        jest.resetModules();
        jest.doMock('../templating', () => ({
            renderTemplate: () => 'Error: Template "gaji_struk_teknisi" not found. Please check message_templates.json.'
        }));
        const { buildPayrollReceiptText: builder } = require('../services/payroll-receipt');
        const teks = String(builder(PAYROLL));
        expect(teks).not.toMatch(/^Error: Template/);
        expect(teks).toContain('Slamet');
        expect(teks).toMatch(/gaji bersih/i);
        jest.dontMock('../templating');
        jest.resetModules();
    });

    test('nomor teknisi diambil dari akun, multi-nomor (|) semuanya', () => {
        const akun = [{ id: 3, role: 'teknisi', phone_number: '628111|628222' }];
        expect(resolveTechnicianPhones(3, akun)).toEqual(['628111', '628222']);
        expect(resolveTechnicianPhones(99, akun)).toEqual([]);
    });
});

describe('titik kirim di routes/gaji.js', () => {
    const src = baca('routes', 'gaji.js');

    test('dikirim tepat setelah payroll DIBAYAR', () => {
        // Diperiksa lewat PERILAKU, bukan posisi teks di berkas: pengirimannya kini hidup di
        // `kirimStrukGaji()` (dipakai bersama jalur kirim-ulang), jadi asersi berbasis urutan
        // baris akan merah setiap kali fungsinya dipindah walau alurnya tetap benar.
        const idxPay = src.indexOf("router.put('/:id/pay'");
        expect(idxPay).toBeGreaterThan(-1);
        const blokBayar = src.slice(idxPay, idxPay + 4000);
        expect(blokBayar).toMatch(/kirimStrukGaji\(/);
        // Dan fungsi itu benar-benar merakit teks struknya.
        const idxFn = src.indexOf('async function kirimStrukGaji');
        expect(idxFn).toBeGreaterThan(-1);
        expect(src.slice(idxFn, idxFn + 1500)).toMatch(/buildPayrollReceiptText/);
    });

    test('lewat sendCritical — ini uang, tak boleh hilang diam-diam', () => {
        expect(src).toMatch(/sendCritical\(/);
        expect(src).toMatch(/struk_gaji_teknisi/);
    });

    test('NEVER-THROW: gagal kirim tak membatalkan pembayaran yang sudah tercatat', () => {
        const idx = src.indexOf('buildPayrollReceiptText');
        const blok = src.slice(idx - 500, idx + 1200);
        expect(blok).toMatch(/try\s*\{/);
        expect(blok).toMatch(/catch\s*\(strukErr\)/);
    });

    test('teknisi tanpa nomor dicatat, bukan diam', () => {
        expect(src).toMatch(/tak punya nomor WA/i);
    });
});
