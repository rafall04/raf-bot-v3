/**
 * Header Doc
 * Purpose: Helper render pesan responseTemplates dengan fallback aman untuk layer `lib/` (outbound notification/service).
 * Caller: `lib/approval-logic.js`, `lib/device-status.js`, dan service notifikasi backend lain yang butuh template editable admin.
 * Deps: `./template-service` (renderCategoryTemplate).
 * MainFuncs: `renderResponseTemplate(key, fallback, data)`.
 * SideEffects: Tidak ada; hanya baca cache template.
 */
"use strict";

const { renderCategoryTemplate } = require('./template-service');

/**
 * Render responseTemplates entry dengan fallback aman.
 * Saat key tidak ada atau template kosong atau renderer throw, kembalikan `fallback`.
 * Signature sejajar dengan `message/handlers/template-helpers.renderResponseTemplate`.
 *
 * @param {string} key - response_templates key
 * @param {string} fallback - string default saat key kosong/missing
 * @param {object} [data={}] - placeholder data
 * @returns {string}
 */
function renderResponseTemplate(key, fallback, data = {}) {
    try {
        const result = renderCategoryTemplate('responseTemplates', key, data);
        if (result && result.found && typeof result.text === 'string' && result.text.trim()) {
            return result.text;
        }
    } catch (err) {
        console.warn('[TEMPLATE_HELPER_WARN]', { key, reason: err && err.message ? err.message : err });
    }
    return typeof fallback === 'string' ? fallback : '';
}

module.exports = {
    renderResponseTemplate
};
