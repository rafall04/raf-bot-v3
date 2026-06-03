describe('invoice-generator due date', () => {
    beforeEach(() => {
        jest.resetModules();
        global.config = {
            invoice: {
                prefix: 'INV',
                enableTax: false,
                taxRate: 11,
                dueDays: 30,
                dueDateType: 'fixed',
                dueDateDay: 10,
                autoSend: true,
                sendPDF: true
            }
        };
        global.packages = [
            { name: 'PAKET-100K', price: 100000, profile: '10M' }
        ];
    });

    test('fixed due date stays in same month even after due day has passed', () => {
        const { calculateInvoiceDueDate, getInvoiceSettings } = require('../invoice-generator');
        const issueDate = new Date('2026-04-15T10:00:00.000Z');

        const dueDate = calculateInvoiceDueDate(issueDate, getInvoiceSettings());

        expect(dueDate.getUTCMonth()).toBe(issueDate.getUTCMonth());
        expect(dueDate.getUTCDate()).toBe(10);
    });

    test('fixed due date clamps to end of short month', () => {
        global.config.invoice.dueDateDay = 30;
        const { calculateInvoiceDueDate, getInvoiceSettings } = require('../invoice-generator');
        const issueDate = new Date('2026-02-20T10:00:00.000Z');

        const dueDate = calculateInvoiceDueDate(issueDate, getInvoiceSettings());

        expect(dueDate.getUTCMonth()).toBe(1);
        expect(dueDate.getUTCDate()).toBe(28);
    });

    test('generateInvoiceData uses runtime fixed due date and current config', () => {
        const { generateInvoiceData } = require('../invoice-generator');
        const invoice = generateInvoiceData({
            id: 1,
            name: 'Budi',
            phone_number: '08123',
            address: 'Jl. Test',
            subscription: 'PAKET-100K',
            send_invoice: true
        }, {
            issueDate: '2026-04-25T10:00:00.000Z',
            paidDate: '2026-04-25T10:00:00.000Z',
            method: 'TRANSFER_BANK'
        });

        const dueDate = new Date(invoice.dueDate);
        expect(dueDate.getUTCMonth()).toBe(3);
        expect(dueDate.getUTCDate()).toBe(10);
    });
});
