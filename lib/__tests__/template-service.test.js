describe('template-service', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('renderString normalizes legacy brace placeholders', () => {
        jest.doMock('../database', () => ({
            loadJSON: jest.fn((file) => (file === 'message_templates.json'
                ? { sample: { name: 'Sample', template: 'Halo {nama}' } }
                : {})),
            saveJSON: jest.fn()
        }));

        const service = require('../template-service');
        const result = service.renderString('Halo {nama}, tiket ${ticket_id}', {
            nama: 'Budi',
            ticket_id: 'T123'
        });

        expect(result.text).toBe('Halo Budi, tiket T123');
        expect(result.unresolved).toEqual([]);
    });

    test('saveCompatTemplate writes normalized template to notification source', () => {
        const saveJSON = jest.fn();
        jest.doMock('../database', () => ({
            loadJSON: jest.fn((file) => (file === 'message_templates.json' ? {} : {})),
            saveJSON
        }));

        const service = require('../template-service');
        service.saveCompatTemplate('discount_notification', {
            name: 'Discount',
            category: 'discount',
            content: 'Halo {customer_name}'
        });

        expect(saveJSON).toHaveBeenCalledWith('message_templates.json', expect.objectContaining({
            discount_notification: expect.objectContaining({
                id: 'discount_notification',
                template: 'Halo ${customer_name}'
            })
        }));
    });

    test('listCompatTemplates returns notification templates from unified cache', () => {
        jest.doMock('../database', () => ({
            loadJSON: jest.fn((file) => (file === 'message_templates.json'
                ? {
                    customer_welcome: {
                        name: 'Welcome',
                        category: 'notification',
                        template: 'Halo ${nama_pelanggan}'
                    }
                }
                : {})),
            saveJSON: jest.fn()
        }));

        const service = require('../template-service');
        const templates = service.listCompatTemplates();

        expect(templates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'customer_welcome',
                name: 'Welcome',
                content: 'Halo ${nama_pelanggan}'
            })
        ]));
    });

    test('diagnostics capture legacy adapter usage', () => {
        jest.doMock('../database', () => ({
            loadJSON: jest.fn(() => ({
                sample_template: {
                    name: 'Sample',
                    template: 'Halo ${nama}'
                }
            })),
            saveJSON: jest.fn()
        }));

        const service = require('../template-service');
        service.resetLegacyUsage();
        service.recordLegacyUsage('message-template-helper', 'getTemplate', { templateId: 'sample_template' });

        const diagnostics = service.getDiagnostics();
        expect(diagnostics.legacyUsage).toEqual(expect.arrayContaining([
            expect.objectContaining({
                adapter: 'message-template-helper',
                count: 1,
                operations: expect.objectContaining({
                    getTemplate: 1
                })
            })
        ]));
    });
});
