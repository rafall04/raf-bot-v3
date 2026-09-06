/**
 * Header Doc
 * Purpose: Uji jaring #b319 — `renderResponseTemplate` (layer lib) JATUH ke fallback kode saat
 *   template tersimpan BASI (masih memuat slot ${...} tak terisi), bukan membocorkan ${slot} mentah
 *   ke pelanggan. Selaras jaring #b249/#b302 di template-service.
 * Caller: Jest (`npx jest lib/__tests__/response-template-helper.test.js`).
 * Deps: mock `../template-service` (renderCategoryTemplate).
 * SideEffects: -
 */
'use strict';

jest.mock('../template-service', () => ({ renderCategoryTemplate: jest.fn() }));
const { renderCategoryTemplate } = require('../template-service');
const { renderResponseTemplate } = require('../response-template-helper');

describe('renderResponseTemplate: template basi → fallback, bukan ${slot} mentah', () => {
    let warnSpy;
    beforeEach(() => { renderCategoryTemplate.mockReset(); warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warnSpy.mockRestore(); });

    test('semua slot terisi → pakai teks template tersimpan', () => {
        renderCategoryTemplate.mockReturnValue({ found: true, text: 'Halo Budi', unresolved: [] });
        expect(renderResponseTemplate('k', 'FALLBACK', {})).toBe('Halo Budi');
    });

    test('ada slot ${...} tak terisi → JATUH ke fallback + warn TEMPLATE_SLOT_BASI (tak bocor)', () => {
        renderCategoryTemplate.mockReturnValue({ found: true, text: 'Alasan: ${reason}', unresolved: ['${reason}'] });
        expect(renderResponseTemplate('k', 'Pesan aman', {})).toBe('Pesan aman');
        expect(warnSpy).toHaveBeenCalledWith('[TEMPLATE_SLOT_BASI]', expect.objectContaining({ key: 'k' }));
    });

    test('key tak ada → fallback (perilaku lama tak berubah)', () => {
        renderCategoryTemplate.mockReturnValue({ found: false, text: '', unresolved: [] });
        expect(renderResponseTemplate('k', 'Pesan aman', {})).toBe('Pesan aman');
    });
});
