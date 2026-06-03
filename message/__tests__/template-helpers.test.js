/**
 * Header Doc
 * Purpose: Verifikasi kontrak helper `renderResponseTemplate` agar fallback konsisten, render placeholder benar, dan error tidak bocor ke caller.
 * Caller: Jest test runner (`npm test`).
 * Deps: `message/handlers/template-helpers`, `lib/template-service`.
 * MainFuncs: Test case fallback path, found path, dan error path.
 * SideEffects: Tidak ada; test murni unit.
 */
"use strict";

// Mock template-service agar test tidak menyentuh disk/cache produksi.
jest.mock('../../lib/template-service', () => ({
    renderCategoryTemplate: jest.fn()
}));

describe('template-helpers renderResponseTemplate', () => {
    let renderResponseTemplate;
    let templateService;

    beforeEach(() => {
        jest.resetModules();
        templateService = require('../../lib/template-service');
        ({ renderResponseTemplate } = require('../handlers/template-helpers'));
        templateService.renderCategoryTemplate.mockReset();
    });

    test('return fallback jika key tidak ditemukan (found=false)', () => {
        templateService.renderCategoryTemplate.mockReturnValue({
            found: false,
            text: '',
            unresolved: [],
            entry: null
        });

        const result = renderResponseTemplate('non_existent_key', 'fallback text');
        expect(result).toBe('fallback text');
    });

    test('return rendered text jika key ditemukan dan text non-empty', () => {
        templateService.renderCategoryTemplate.mockReturnValue({
            found: true,
            text: 'Halo Budi',
            unresolved: [],
            entry: { template: 'Halo ${nama}' }
        });

        const result = renderResponseTemplate('wave_helper_test_simple', 'fallback', { nama: 'Budi' });
        expect(result).toBe('Halo Budi');
        expect(templateService.renderCategoryTemplate).toHaveBeenCalledWith(
            'responseTemplates',
            'wave_helper_test_simple',
            { nama: 'Budi' }
        );
    });

    test('return fallback jika text kosong meski found=true', () => {
        templateService.renderCategoryTemplate.mockReturnValue({
            found: true,
            text: '',
            unresolved: [],
            entry: {}
        });

        const result = renderResponseTemplate('empty_key', 'expected fallback');
        expect(result).toBe('expected fallback');
    });

    test('return fallback jika text whitespace-only', () => {
        templateService.renderCategoryTemplate.mockReturnValue({
            found: true,
            text: '   \n\t  ',
            unresolved: [],
            entry: {}
        });

        const result = renderResponseTemplate('ws_key', 'safe fallback');
        expect(result).toBe('safe fallback');
    });

    test('tidak throw meski renderCategoryTemplate melempar, tetap return fallback', () => {
        templateService.renderCategoryTemplate.mockImplementation(() => {
            throw new Error('simulated failure');
        });

        const result = renderResponseTemplate('whatever', 'safe fallback');
        expect(result).toBe('safe fallback');
    });

    test('return rendered text walau data tidak disediakan (default {})', () => {
        templateService.renderCategoryTemplate.mockReturnValue({
            found: true,
            text: 'Halo tanpa placeholder',
            unresolved: [],
            entry: {}
        });

        const result = renderResponseTemplate('static_key', 'fallback');
        expect(result).toBe('Halo tanpa placeholder');
        expect(templateService.renderCategoryTemplate).toHaveBeenCalledWith(
            'responseTemplates',
            'static_key',
            {}
        );
    });
});
