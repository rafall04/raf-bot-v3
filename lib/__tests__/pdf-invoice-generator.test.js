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
