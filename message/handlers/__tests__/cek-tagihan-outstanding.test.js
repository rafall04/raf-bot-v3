/**
 * Header Doc
 * Purpose: Mengunci "cek tagihan menampilkan SISA, bukan harga penuh". Bu Endang menyerahkan
 *          Rp75.000 dari tagihan Rp150.000; besoknya `cek tagihan` menjawab nominal PENUH +
 *          BELUM LUNAS, sehingga dari sisinya uangnya seperti hilang. Sumber kebenaran sisa adalah
 *          ledger (`getPaymentPositionForPeriod().outstanding`) — sama dengan yang dipakai
 *          penagihan — dan jalurnya GAGAL-TERTUTUP: ledger tak terbaca ⇒ kembali ke harga efektif,
 *          bukan menebak angka.
 * Caller: Jest (`npx jest message/handlers/__tests__/cek-tagihan-outstanding.test.js`).
 * Deps: fs/path (scan statis) + `database/message_templates.json`.
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');
const handler = baca('message', 'handlers', 'billing-management-handler.js');

describe('cek tagihan: pelanggan yang mencicil melihat SISA-nya', () => {
    test('nominal diambil dari posisi ledger, bukan sekadar harga paket', () => {
        expect(handler).toMatch(/getPaymentPositionForPeriod\(/);
        expect(handler).toMatch(/tagihan\s*=\s*Math\.max\(0,\s*Number\(posisi\.outstanding\)\)/);
        expect(handler).toMatch(/harga:\s*tagihan/);
    });

    test('GAGAL-TERTUTUP: ledger tak terbaca → kembali ke harga efektif', () => {
        expect(handler).toMatch(/let\s+tagihan\s*=\s*hargaEfektif/);
        expect(handler).toMatch(/catch\s*\(posErr\)/);
        // Tidak boleh menampilkan 0 atau menebak saat pembacaan gagal.
        const idx = handler.indexOf('catch (posErr)');
        expect(handler.slice(idx, idx + 260)).not.toMatch(/tagihan\s*=\s*0/);
    });

    test('cicilan yang sudah masuk disebutkan ke pelanggan', () => {
        expect(handler).toMatch(/sudahDibayar\s*=\s*Math\.max\(0,\s*hargaEfektif\s*-\s*tagihan\)/);
        expect(handler).toMatch(/cicilan_info/);
    });

    test('slot cicilan KOSONG untuk pelanggan biasa — tak ada baris menggantung', () => {
        expect(handler).toMatch(/sudahDibayar\s*>\s*0[\s\S]{0,200}:\s*''/);
    });

    test('kedua template tagihan punya slot ${cicilan_info} (template tersimpan menimpa fallback)', () => {
        const t = JSON.parse(baca('database', 'message_templates.json'));
        for (const key of ['tagihan_belum_lunas', 'tagihan_lunas']) {
            const teks = String(t[key].template || t[key]);
            expect(teks).toContain('${cicilan_info}');
        }
    });

    test('harga efektif tetap jadi dasar amountDue yang dikirim ke ledger', () => {
        expect(handler).toMatch(/amountDue:\s*hargaEfektif/);
    });
});
