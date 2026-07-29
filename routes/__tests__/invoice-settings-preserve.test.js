/**
 * Header Doc
 * Purpose: Menahan regresi "reset senyap" pada POST /api/invoice-settings.
 *          Form Pengaturan Invoice tidak punya field untuk dueDateType,
 *          dueDateDay, maupun showDueDate. Versi lama menulis
 *          `dueDateType || 'fixed'` sehingga setiap kali admin menekan Simpan —
 *          bahkan tanpa mengubah apa pun — aturan jatuh tempo dikembalikan ke
 *          bawaan. Nilai itu dipakai calculateInvoiceDueDate() untuk tanggal
 *          yang TERCETAK di invoice pelanggan, jadi resetnya mengubah tagihan
 *          secara diam-diam. Tes ini menjaga aturan: kunci yang TIDAK dikirim
 *          harus dipertahankan; kunci yang dikirim KOSONG boleh mengosongkan
 *          (agar admin tetap bisa menghapus catatan/logo/rekening).
 * Caller: Jest (`npm test`).
 * Deps: routes/invoice.js (dibaca sebagai teks — guard statis, tanpa menyalakan
 *       Express/DB), sesuai pola guard lain di repo ini.
 * MainFuncs: -
 * SideEffects: Hanya membaca berkas.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'invoice.js'), 'utf8');

describe('POST /api/invoice-settings tidak mereset setelan tersembunyi', () => {
    test('tidak lagi memaksa bawaan untuk kunci yang tak dikirim form', () => {
        // Pola LAMA yang menyebabkan reset senyap.
        expect(SRC).not.toContain("dueDateType: dueDateType || 'fixed'");
        expect(SRC).not.toContain('dueDateDay: parseInt(dueDateDay) || 10');
        expect(SRC).not.toContain("showDueDate: showDueDate !== 'false'");
    });

    test('memakai helper yang mempertahankan nilai lama', () => {
        expect(SRC).toContain('const keep =');
        expect(SRC).toContain('const keepReq =');
        expect(SRC).toContain('const keepBool =');
        expect(SRC).toContain('dueDateType: keep(dueDateType, prevInvoice.dueDateType');
        expect(SRC).toContain('dueDateDay: parseInt(dueDateDay) || prevInvoice.dueDateDay');
        expect(SRC).toContain('showDueDate: keepBool(showDueDate, prevPdf.showDueDate');
    });

    test('bankAccount & pdfCustomization tidak diganti total (kunci tak dikenal tetap hidup)', () => {
        expect(SRC).toContain('...prevBank');
        expect(SRC).toContain('...prevPdf');
        expect(SRC).toContain('...prevInvoice');
    });

    test('default autoSend selaras dengan lib/invoice-generator (!== false)', () => {
        // GET dulu memakai `=== true` (bawaan MATI) sementara generator memakai
        // `!== false` (bawaan HIDUP) — halaman pengaturan menampilkan autoSend
        // mati padahal sistem tetap mengirim otomatis.
        expect(SRC).not.toContain('autoSend: config.invoice?.autoSend === true');
        expect(SRC).toContain('autoSend: config.invoice?.autoSend !== false');
    });
});

describe('halaman cetak invoice memakai template literal, bukan kutip tunggal', () => {
    const VIEW_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'static', 'js', 'view-invoice.js'), 'utf8');

    test('URL fetch benar-benar diinterpolasi', () => {
        // Kutip tunggal membuat ${invoiceId} terkirim apa adanya → 404 (terbukti
        // di produksi), sehingga halaman tak pernah bisa menampilkan invoice.
        expect(VIEW_JS).not.toContain("fetch('/api/view-invoice?id=${");
        expect(VIEW_JS).not.toContain("fetch('/api/download-invoice-pdf?id=${");
        expect(VIEW_JS).toContain('fetch(`/api/view-invoice?id=${invoiceId}&userId=${userId}`');
        expect(VIEW_JS).toContain('fetch(`/api/download-invoice-pdf?id=${invoiceId}&userId=${userId}`');
    });
});
