/**
 * Header Doc
 * Purpose: Mengunci perilaku setelan tampilan invoice. Enam setelan
 *          (serviceTitle, showServiceSpeed, showServiceDescription, showNotes,
 *          additionalNotes, paymentMethods) DULU dirakit ke `customization` oleh
 *          routes/invoice.js & lib/approval-logic.js tapi TIDAK PERNAH dibaca
 *          generator — jadi kontrolnya ada di halaman Pengaturan Invoice,
 *          tersimpan ke config.json, lalu tak berpengaruh apa pun. Terbukti di
 *          produksi: showServiceSpeed=true dengan data speed "70Mbps" namun
 *          kecepatan tak pernah muncul. Tes ini menahan regresi ke keadaan itu.
 * Caller: Jest (`npm test` / `npx jest lib/__tests__/invoice-customization.test.js`).
 * Deps: lib/pdf-invoice-generator (generateInvoiceHTML — murni, tanpa puppeteer).
 * MainFuncs: -
 * SideEffects: Tidak ada; fungsi murni yang mengembalikan string HTML.
 */
'use strict';

const { generateInvoiceHTML } = require('../pdf-invoice-generator');

function buatInvoice() {
    return {
        invoiceNumber: 'INV-TEST-0001',
        issueDate: '2026-07-01T00:00:00.000Z',
        dueDate: '2026-07-10T00:00:00.000Z',
        customer: { id: 75, name: 'SPPG Tanjungharjo', phone: '6285648676526', address: 'Alamat' },
        service: { name: 'PAKET-220K', period: 'Bulanan', description: 'Layanan Internet PAKET-220K', speed: '70Mbps' },
        billing: { subtotal: 220000, tax: 0, total: 220000, enableTax: false, taxRate: 11 },
        payment: { status: 'PAID', paidDate: '2026-07-02T00:00:00.000Z', method: 'Cash', approvedBy: 'raf' },
        company: { name: 'RAF NET', npwp: '' },
        bankAccount: { bankName: 'BRI', accountNumber: '1234567890', accountName: 'RAF NET', paymentInstructions: 'Kirim bukti ke WhatsApp.' },
        notes: ''
    };
}

describe('setelan tampilan invoice benar-benar diterapkan', () => {
    test('saat DINYALAKAN, keenam setelan muncul di invoice', () => {
        const html = generateInvoiceHTML(buatInvoice(), {
            theme: 'red',
            serviceTitle: 'RINCIAN LAYANAN:',
            showServiceSpeed: true,
            showServiceDescription: true,
            showNotes: true,
            additionalNotes: 'Terima kasih sudah berlangganan.',
            showPaymentMethods: true,
            paymentMethods: 'all'
        });

        expect(html).toContain('RINCIAN LAYANAN:');            // serviceTitle
        expect(html).toContain('70Mbps');                       // showServiceSpeed
        expect(html).toContain('Layanan Internet PAKET-220K');  // showServiceDescription
        expect(html).toContain('Terima kasih sudah berlangganan.'); // showNotes + additionalNotes
        expect(html).toContain('Pembayaran Online');            // paymentMethods = all
    });

    test('saat DIMATIKAN, isinya benar-benar hilang (bukan sekadar tak dirender)', () => {
        const html = generateInvoiceHTML(buatInvoice(), {
            serviceTitle: 'LAYANAN',
            showServiceSpeed: false,
            showServiceDescription: false,
            showNotes: false,
            additionalNotes: 'JANGAN TAMPIL',
            showPaymentMethods: true,
            paymentMethods: 'cash_transfer'
        });

        expect(html).toContain('LAYANAN');
        expect(html).not.toContain('70Mbps');
        expect(html).not.toContain('Layanan Internet PAKET-220K');
        expect(html).not.toContain('JANGAN TAMPIL');
        expect(html).not.toContain('Pembayaran Online');
    });

    test('rekening yang diisi admin sampai ke invoice', () => {
        // invoiceData.bankAccount sudah lama disimpan di tiap record tapi tak
        // pernah ditampilkan — rekening tak pernah sampai ke pelanggan.
        const html = generateInvoiceHTML(buatInvoice(), { showPaymentMethods: true });
        expect(html).toContain('BRI');
        expect(html).toContain('1234567890');
        expect(html).toContain('Kirim bukti ke WhatsApp.');
    });

    test('tanpa rekening terkonfigurasi, Transfer Bank tidak diklaim diterima', () => {
        // DIPERKETAT #b233. Versi lama tes ini mengharapkan "Transfer Bank" TETAP tercetak
        // saat rekening kosong (hanya tanpa "a.n."). Itu mengunci instruksi yang mustahil
        // dijalankan pelanggan: "silakan transfer" tanpa satu pun nomor tujuan — dan persis
        // itulah yang terjadi di produksi Tanjungharjo. Maksud tes ini ("jangan tampilkan
        // detail bank kosong") tetap sama; assertion-nya yang dulu terlalu longgar.
        const inv = buatInvoice();
        inv.bankAccount = { bankName: '', accountNumber: '', accountName: '', paymentInstructions: '' };
        inv.bankAccounts = [];
        const html = generateInvoiceHTML(inv, { showPaymentMethods: true });
        expect(html).toContain('Metode Pembayaran yang Diterima');
        expect(html).not.toContain('Transfer Bank');
        expect(html).not.toContain('a.n.');
    });

    test('bawaan tanpa customization: setelan aktif semua kecuali pembayaran online', () => {
        const html = generateInvoiceHTML(buatInvoice(), { showPaymentMethods: true });
        expect(html).toContain('DETAIL LAYANAN:');
        expect(html).toContain('70Mbps');
        expect(html).not.toContain('Pembayaran Online');
    });

    test('tidak ada catatan pengembang yang bocor ke invoice pelanggan', () => {
        // Markup invoice hidup di dalam SATU template literal raksasa. Komentar
        // HTML di dalamnya IKUT TERKIRIM ke pelanggan dan masuk ke PDF. Pernah
        // terjadi: catatan "jangan pakai backtick" sempat ikut terbawa, dan
        // sekaligus membuat verifikasi showNotes memberi hasil positif palsu.
        const html = generateInvoiceHTML(buatInvoice(), { showNotes: false, additionalNotes: '' });
        expect(html).not.toMatch(/PENYUNTING|catatan pengembang|JANGAN pakai backtick/i);
        expect(html).not.toMatch(/Catatan:/);
    });
});
