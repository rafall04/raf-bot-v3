/**
 * Header Doc
 * Purpose: Helper bersama lintas sub-router `routes/public/` — dipakai oleh auth.js, customer.js,
 *          requests.js (dan bisa dipakai modul lain di folder ini). Sengaja DIJAMIN murni helper:
 *          tanpa route, tanpa state modul.
 * Caller: `routes/public/auth.js`, `routes/public/customer.js`, `routes/public/requests.js`.
 * Deps: `lib/auth` (apiAuth), `lib/template-service` (renderCategoryTemplate),
 *       `lib/services/public-auth-service` (PublicAuthService).
 * MainFuncs: renderResponseTemplate, getCustomerAuthPayload, setSensitiveResponseHeaders,
 *            ensureCustomerAuthenticated.
 * SideEffects: Tidak ada (fungsi murni / middleware delegasi).
 */
const { apiAuth } = require('../../lib/auth');
const { renderCategoryTemplate } = require('../../lib/template-service');
const { PublicAuthService } = require('../../lib/services/public-auth-service');

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate("responseTemplates", key, data).text;
}

function getCustomerAuthPayload(user) {
    return PublicAuthService.buildAuthResponse(user);
}

function setSensitiveResponseHeaders(res) {
    res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
}

// Wrapper di atas middleware apiAuth terpusat — dipindah dari index.js saat domain ini
// diekstraksi, lalu dari routes/public.js saat split #b392.
function ensureCustomerAuthenticated(req, res, next) {
    apiAuth(req, res, next);
}

module.exports = {
    renderResponseTemplate,
    getCustomerAuthPayload,
    setSensitiveResponseHeaders,
    ensureCustomerAuthenticated
};
