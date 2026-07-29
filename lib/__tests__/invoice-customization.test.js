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
        const html = generateInvoiceHTML(buatInvoice(), {});
        expect(html).toContain('BRI');
        expect(html).toContain('1234567890');
        expect(html).toContain('Kirim bukti ke WhatsApp.');
    });

    test('tanpa rekening terkonfigurasi, invoice tidak menampilkan detail bank kosong', () => {
        const inv = buatInvoice();
        inv.bankAccount = { bankName: '', accountNumber: '', accountName: '', paymentInstructions: '' };
        const html = generateInvoiceHTML(inv, {});
        expect(html).toContain('Metode Pembayaran yang Diterima');
        expect(html).toContain('Transfer Bank');
        expect(html).not.toContain('a.n.');
    });

    test('bawaan tanpa customization: setelan aktif semua kecuali pembayaran online', () => {
        const html = generateInvoiceHTML(buatInvoice(), {});
        expect(html).toContain('DETAIL LAYANAN:');
        expect(html).toContain('70Mbps');
        expect(html).not.toContain('Pembayaran Online');
    });
});
