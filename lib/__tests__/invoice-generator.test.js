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

    // #b330 — nomor invoice WIB & unik lintas-restart
    describe('penomoran invoice (#b330)', () => {
        test('invoiceDateStr memakai WIB, bukan UTC — 06:00 WIB = tanggal HARI ITU', () => {
            const { invoiceDateStr } = require('../invoice-generator');
            // 2026-09-06 23:00 UTC = 2026-09-07 06:00 WIB → harus 20260907, bukan 20260906.
            expect(invoiceDateStr(new Date('2026-09-06T23:00:00.000Z'))).toBe('20260907');
            // 2026-09-06 10:00 UTC = 2026-09-06 17:00 WIB → 20260906.
            expect(invoiceDateStr(new Date('2026-09-06T10:00:00.000Z'))).toBe('20260906');
        });

        test('nextSequence men-seed dari sequence TERTINGGI yang sudah tersimpan', () => {
            const { nextSequence } = require('../invoice-generator');
            const tersimpan = [
                { invoiceNumber: 'INV-20260906-0001' },
                { invoiceNumber: 'INV-20260906-0003' },
                { invoiceNumber: 'INV-20260905-0009' }, // tanggal lain — diabaikan
                { invoiceNumber: 'XXX-20260906-0050' }, // prefix lain — diabaikan
                { tak: 'ada nomor' },
            ];
            expect(nextSequence(tersimpan, 'INV', '20260906')).toBe(4); // 3 + 1, bukan 1
        });

        test('nextSequence mulai dari 1 bila belum ada record untuk tanggal itu', () => {
            const { nextSequence } = require('../invoice-generator');
            expect(nextSequence([], 'INV', '20260906')).toBe(1);
            expect(nextSequence(null, 'INV', '20260906')).toBe(1);
        });
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
