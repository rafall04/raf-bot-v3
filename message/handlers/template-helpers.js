/**
 * Header Doc
 * Purpose: Helper sentralisasi untuk render responseTemplates dengan fallback aman agar seluruh handler bot memakai pola konsisten.
 * Caller: Seluruh handler di `message/handlers/*` yang perlu render pesan WhatsApp user-facing dengan opsi kustomisasi admin.
 * Deps: `../../lib/template-service` (renderCategoryTemplate).
 * MainFuncs: `renderResponseTemplate(key, fallback, data)`.
 * SideEffects: Tidak ada; pure function yang membaca dari template cache.
 */
"use strict";

const { renderCategoryTemplate } = require('../../lib/template-service');

/**
 * Render template dari kategori `responseTemplates` dengan fallback aman.
 *
 * Perilaku:
 * - Jika key ditemukan dan template ter-render non-empty -> return hasil render.
 * - Jika key tidak ada, template kosong, atau render gagal -> return string `fallback`.
 *
 * Pola ini menjamin backward compatibility saat admin belum men-customize template.
 *
 * @param {string} key - Kunci template di `database/response_templates.json`.
 * @param {string} fallback - String pesan default yang dipakai jika template tidak tersedia.
 * @param {Object} [data] - Data placeholder untuk di-substitute (`${placeholder}`).
 * @returns {string} Pesan siap kirim ke WhatsApp.
 */
function renderResponseTemplate(key, fallback, data = {}) {
    try {
        const result = renderCategoryTemplate('responseTemplates', key, data);
        if (result && result.found && typeof result.text === 'string' && result.text.trim()) {
            return result.text;
        }
    } catch (error) {
        // Jaga-jaga kalau template-service error, jangan crash handler.
        console.warn('[TEMPLATE_HELPER_WARN]', {
            key,
            error: error?.message || String(error)
        });
    }
    return fallback;
}

module.exports = {
    renderResponseTemplate
};
