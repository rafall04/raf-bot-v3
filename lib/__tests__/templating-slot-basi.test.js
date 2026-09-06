/**
 * Header Doc
 * Purpose: Uji #b322 — renderTemplate (jalur notificationTemplates, dipakai broadcast MASSAL cron
 *   reminder/isolir/tenggang) TIDAK menyiarkan ${slot} mentah bila template basi; placeholder tak
 *   terisi dibuang + spasi dirapikan (mirror renderResponseTemplateSafe #b302).
 * Caller: Jest.
 * Deps: mock ../template-service (renderCategoryTemplate).
 * SideEffects: set global.config sementara.
 */
'use strict';

// Pertahankan modul asli (templating.js memanggil loadAllCategories/setupTemplateWatcher saat load)
// — hanya renderCategoryTemplate yang di-override + watcher di-no-op (hindari fs.watch bocor).
jest.mock('../template-service', () => {
    const actual = jest.requireActual('../template-service');
    return { ...actual, renderCategoryTemplate: jest.fn(), setupTemplateWatcher: jest.fn() };
});
const { renderCategoryTemplate } = require('../template-service');
const { renderTemplate } = require('../templating');

describe('renderTemplate: slot basi tak boleh disiarkan mentah (#b322)', () => {
    beforeEach(() => { global.config = {}; renderCategoryTemplate.mockReset(); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { jest.restoreAllMocks(); });

    test('ada slot ${...} tak terisi → dibuang (tak ada ${jumlah} mentah ke pelanggan)', () => {
        renderCategoryTemplate.mockReturnValue({ found: true, text: 'Tagihan ${jumlah} jatuh tempo besok', unresolved: ['${jumlah}'] });
        const out = renderTemplate('unpaid_reminder', {});
        expect(out).not.toMatch(/\$\{jumlah\}/);
        expect(out).toContain('Tagihan');
        expect(out).toContain('jatuh tempo besok');
    });

    test('semua slot terisi → teks apa adanya (tak ada regresi)', () => {
        renderCategoryTemplate.mockReturnValue({ found: true, text: 'Tagihan Rp50.000 jatuh tempo besok', unresolved: [] });
        expect(renderTemplate('unpaid_reminder', {})).toBe('Tagihan Rp50.000 jatuh tempo besok');
    });

    test('template tak ada → pesan Error (perilaku lama dipertahankan)', () => {
        renderCategoryTemplate.mockReturnValue({ found: false, text: '', unresolved: [] });
        expect(renderTemplate('xxx', {})).toMatch(/^Error: Template/);
    });
});
