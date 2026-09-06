const { generateInvoiceHTML } = require('../pdf-invoice-generator');

describe('pdf-invoice-generator', () => {
    test('renders stored dueDate without recalculating from paidDate', () => {
        const html = generateInvoiceHTML({
            invoiceNumber: 'INV-TEST-1',
            issueDate: '2026-04-25T10:00:00.000Z',
            dueDate: '2026-04-10T10:00:00.000Z',
            company: { name: 'RAF NET', address: 'Jl. Test', phone: '08123', email: 'a@b.c', npwp: '123' },
            customer: { id: 1, name: 'Budi', phone: '08123', address: 'Jl. Cust' },
            service: { name: 'Paket', description: 'Desc', period: 'April 2026' },
            billing: { subtotal: 100000, taxRate: 11, tax: 0, total: 100000, enableTax: false },
            payment: { status: 'PAID', paidDate: '2026-04-25T10:00:00.000Z', method: 'Transfer Bank', approvedBy: 'Admin' },
            notes: 'Test'
        }, { showDueDate: true });

        expect(html).toContain('10 April 2026');
        expect(html).not.toContain('25 Mei 2026');
    });

    // #b330 — stored XSS: field pelanggan/user disisipkan mentah ke HTML yang dikembalikan
    // apa adanya (text/html) ke browser admin lewat /api/view-invoice.
    test('meng-escape field pelanggan yang berisi HTML (cegah XSS tersimpan)', () => {
        const jahat = '<script>alert(document.cookie)</script>';
        const html = generateInvoiceHTML({
            invoiceNumber: 'INV-XSS-1',
            issueDate: '2026-04-25T10:00:00.000Z',
            dueDate: '2026-04-10T10:00:00.000Z',
            company: { name: 'RAF NET', address: 'Jl. Test', phone: '08123', email: 'a@b.c', npwp: '123' },
            customer: { id: 1, name: jahat, phone: jahat, address: jahat },
            service: { name: jahat, description: jahat, period: jahat, speed: jahat },
            billing: { subtotal: 100000, taxRate: 11, tax: 0, total: 100000, enableTax: false },
            payment: { status: 'PAID', paidDate: '2026-04-25T10:00:00.000Z', method: 'Transfer Bank', approvedBy: jahat },
            notes: 'Test'
        }, { showDueDate: true, showCustomerID: true, showCustomerPhone: true, showServiceSpeed: true, showServiceDescription: true });

        // TIDAK boleh ada tag <script> hidup di keluaran.
        expect(html).not.toContain('<script>alert(document.cookie)</script>');
        // Harus muncul dalam bentuk ter-escape.
        expect(html).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;');
    });

    test('meng-escape data perusahaan & teks kustomisasi yang berisi HTML', () => {
        const jahat = '<img src=x onerror=alert(1)>';
        const html = generateInvoiceHTML({
            invoiceNumber: 'INV-XSS-2',
            issueDate: '2026-04-25T10:00:00.000Z',
            dueDate: '2026-04-10T10:00:00.000Z',
            company: { name: jahat, address: jahat, phone: jahat, email: jahat, npwp: jahat },
            customer: { id: 1, name: 'Budi', phone: '08123', address: 'Jl. Cust' },
            service: { name: 'Paket', description: 'Desc', period: 'April 2026' },
            billing: { subtotal: 100000, taxRate: 11, tax: 0, total: 100000, enableTax: false },
            payment: { status: 'PAID', paidDate: '2026-04-25T10:00:00.000Z', method: 'Transfer Bank', approvedBy: 'Admin' },
            notes: 'Test'
        }, { showDueDate: true, showNPWP: true, headerText: jahat, footerText: jahat, additionalNotes: jahat, showNotes: true });

        expect(html).not.toContain('<img src=x onerror=alert(1)>');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    test('nilai bersih tetap tampil apa adanya (escape tak merusak teks normal)', () => {
        const html = generateInvoiceHTML({
            invoiceNumber: 'INV-OK-1',
            issueDate: '2026-04-25T10:00:00.000Z',
            dueDate: '2026-04-10T10:00:00.000Z',
            company: { name: 'RAF NET', address: 'Jl. Test', phone: '08123', email: 'a@b.c', npwp: '123' },
            customer: { id: 7, name: 'Budi Santoso', phone: '08123456789', address: 'Jl. Melati 5' },
            service: { name: 'PAKET-100K', description: 'Layanan Internet', period: 'April 2026' },
            billing: { subtotal: 100000, taxRate: 11, tax: 0, total: 100000, enableTax: false },
            payment: { status: 'PAID', paidDate: '2026-04-25T10:00:00.000Z', method: 'Transfer Bank', approvedBy: 'Admin' },
            notes: 'Test'
        }, {});
        expect(html).toContain('Budi Santoso');
        expect(html).toContain('Jl. Melati 5');
        expect(html).toContain('PAKET-100K');
    });

    test('renders explicit fallback instead of Invalid Date for invalid stored dates', () => {
        const html = generateInvoiceHTML({
            invoiceNumber: 'INV-TEST-2',
            issueDate: 'invalid-date',
            dueDate: '',
            company: { name: 'RAF NET', address: 'Jl. Test', phone: '08123', email: 'a@b.c', npwp: '123' },
            customer: { id: 1, name: 'Budi', phone: '08123', address: 'Jl. Cust' },
            service: { name: 'Paket', description: 'Desc', period: 'April 2026' },
            billing: { subtotal: 100000, taxRate: 11, tax: 0, total: 100000, enableTax: false },
            payment: { status: 'PAID', paidDate: null, method: 'Transfer Bank', approvedBy: 'Admin' },
            notes: 'Test'
        }, { showDueDate: true });

        expect(html).not.toContain('Invalid Date');
        expect(html).toContain('<tr><td class="label">Tanggal:</td><td>-</td></tr>');
        expect(html).toContain('<tr><td class="label">Jatuh Tempo:</td><td>-</td></tr>');
        expect(html).toContain('<strong>Tanggal Bayar:</strong> -');
    });
});
