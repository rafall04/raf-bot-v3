/**
 * Header Doc
 * Purpose: Helper BACA/MUTASI config.notifRouting untuk halaman /notif-routing (pola immutable +
 *   validasi, seperti lib/feature-flags.applyFlag). Memisahkan mutasi config dari lib/notif-router
 *   (yang murni resolver kirim). Menjaga hanya @g.us tersimpan (salah setel grup = kebocoran).
 * Caller: routes/admin-config-routes.js (endpoint /api/notif-routing).
 * Deps: ./notif-categories.
 * MainFuncs: readRouting(config), setEnabled(config, bool), setRoute(config, category, {groups,severity}).
 * SideEffects: Tidak ada (murni; pemanggil yang menulis config.json).
 */
"use strict";

const { listCategories, categoryByKey } = require("./notif-categories");

const GROUP_RE = /@g\.us$/;

/** @g.us sah saja; buang kosong/@lid/@s.whatsapp.net. Dedup. */
function sanitizeGroups(groups) {
    const out = [];
    const seen = new Set();
    (Array.isArray(groups) ? groups : []).forEach((x) => {
        const v = String(x == null ? "" : x).trim();
        if (v && GROUP_RE.test(v) && !v.endsWith("@lid") && !seen.has(v)) {
            seen.add(v);
            out.push(v);
        }
    });
    return out;
}

/** Status routing lengkap untuk UI: enabled + tiap kategori dgn grup & severity efektifnya. */
function readRouting(config = (typeof global !== "undefined" ? global.config : {})) {
    const routing = (config && config.notifRouting) || {};
    const routes = routing.routes || {};
    return {
        enabled: routing.enabled === true,
        categories: listCategories().map((c) => {
            const r = routes[c.key] || {};
            return {
                key: c.key,
                label: c.label,
                desc: c.desc,
                defaultSeverity: c.defaultSeverity,
                severity: r.severity === "critical" || r.severity === "info" ? r.severity : c.defaultSeverity,
                groups: Array.isArray(r.groups) ? r.groups.slice() : [],
            };
        }),
    };
}

/** Salinan config dengan notifRouting.enabled di-set (immutable; jaga routes tetap ada). */
function setEnabled(config, enabled) {
    const next = { ...(config || {}) };
    const routing = { ...(next.notifRouting || {}) };
    routing.enabled = enabled === true;
    if (!routing.routes || typeof routing.routes !== "object") routing.routes = {};
    next.notifRouting = routing;
    return next;
}

/** Salinan config dengan route satu kategori di-set (immutable). Lempar bila kategori tak dikenal. */
function setRoute(config, category, { groups, severity } = {}) {
    if (!categoryByKey(category)) throw new Error(`Kategori notif tak dikenal: ${category}`);
    const next = { ...(config || {}) };
    const routing = { ...(next.notifRouting || {}) };
    routing.routes = { ...(routing.routes || {}) };
    const entry = { ...(routing.routes[category] || {}) };
    entry.groups = sanitizeGroups(groups);
    if (severity === "critical" || severity === "info") entry.severity = severity;
    routing.routes[category] = entry;
    next.notifRouting = routing;
    return next;
}

module.exports = { readRouting, setEnabled, setRoute, sanitizeGroups };
