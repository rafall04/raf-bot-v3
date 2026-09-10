/**
 * Header Doc
 * Purpose: CHOKE-POINT tunggal routing notifikasi operasional. Dulu hampir semua alert (otorisasi,
 *   kualitas jaringan, voucher, billing, LOS…) jatuh jadi DM ke SATU inbox admin (getAdminJids) →
 *   "ketindihan". Router ini me-resolve tujuan per-kategori dari config.notifRouting (grup WA) dengan
 *   FALLBACK ke DM admin, lalu mengirim sesuai severity. Titik-kirim memanggil dispatch() dengan
 *   adminFallback = perilaku lamanya, jadi:
 *     - gate OFF  → kirim ke adminFallback (PERSIS perilaku sekarang; inert/deploy-gelap),
 *     - gate ON tapi grup kosong/invalid → FAIL-OPEN ke adminFallback (notifikasi TAK PERNAH hilang),
 *     - gate ON + grup valid → kirim ke grup.
 *   NEVER-THROW: error resolusi/kirim apa pun tak boleh menjatuhkan pemanggil (notifikasi bukan
 *   jalur kritis pemanggil). @lid ditolak; hanya @g.us diterima sebagai grup (salah setel = kebocoran).
 * Caller: services/bulk-approval-job.service, routes/requests.js, alerter jaringan/voucher/LOS (migrasi bertahap).
 * Deps: ./notif-categories, ./whatsapp-delivery-service (sendMessage), ./whatsapp-critical-delivery (sendCritical).
 * MainFuncs: recipientsFor(category, opts), dispatch(category, opts).
 * SideEffects: Mengirim WhatsApp (lewat helper never-throw); tidak menulis state.
 */
"use strict";

const { categoryByKey } = require("./notif-categories");

const GROUP_RE = /@g\.us$/;

function _cfg(config) {
    if (config) return config;
    return typeof global !== "undefined" && global.config ? global.config : {};
}

/** Saring daftar grup: hanya @g.us yang sah; buang kosong & @lid (JID @lid tak boleh jadi target). */
function _validGroups(list) {
    return (Array.isArray(list) ? list : [])
        .map((x) => String(x == null ? "" : x).trim())
        .filter((x) => x && GROUP_RE.test(x) && !x.endsWith("@lid"));
}

/**
 * Tentukan penerima + mode + severity untuk sebuah kategori.
 * @param {string} category  key di lib/notif-categories.
 * @param {object} opts
 * @param {string[]} [opts.adminFallback]  penerima lama (mis. getAdminJids()) — dipakai saat gate OFF / fallback.
 * @param {object} [opts.config]  default global.config.
 * @returns {{recipients:string[], mode:string, severity:string}} mode: legacy|group|fallback_admin|error.
 */
function recipientsFor(category, { adminFallback = [], config } = {}) {
    try {
        const cat = categoryByKey(category);
        const baseSeverity = (cat && cat.defaultSeverity) || "info";
        const routing = (_cfg(config) && _cfg(config).notifRouting) || {};
        if (routing.enabled !== true) {
            return { recipients: Array.isArray(adminFallback) ? adminFallback : [], mode: "legacy", severity: baseSeverity };
        }
        const route = (routing.routes && routing.routes[category]) || {};
        const severity = route.severity || baseSeverity;
        const groups = _validGroups(route.groups);
        if (groups.length) {
            return { recipients: groups, mode: "group", severity };
        }
        // Gate ON tapi belum diarahkan / grup invalid → jangan hilang, balik ke admin.
        return { recipients: Array.isArray(adminFallback) ? adminFallback : [], mode: "fallback_admin", severity };
    } catch (_e) {
        return { recipients: Array.isArray(adminFallback) ? adminFallback : [], mode: "error", severity: "info" };
    }
}

/**
 * Kirim satu notifikasi kategori ke penerima ter-resolve. Transport dipilih dari severity:
 * critical → sendCritical (retry+dead-letter), info → sendMessage biasa. Kirim PER-JID supaya satu
 * grup gagal tak menutupi grup lain. NEVER-THROW.
 * @param {string} category
 * @param {object} opts
 * @param {string} opts.text  isi pesan (sudah jadi; router hanya mengubah penerima, bukan isi).
 * @param {string[]} [opts.adminFallback]
 * @param {object} [opts.config]
 * @param {object} [opts.deps]  {sendMessage, sendCritical} untuk uji.
 * @returns {Promise<{sent:number, recipients:string[], mode:string, severity:string}>}
 */
async function dispatch(category, { text, adminFallback = [], config, deps = {} } = {}) {
    const resolved = recipientsFor(category, { adminFallback, config });
    const uniq = Array.from(new Set((resolved.recipients || []).filter(Boolean)));
    if (!uniq.length || !text) {
        return { sent: 0, recipients: uniq, mode: resolved.mode, severity: resolved.severity };
    }
    const sendMessage = deps.sendMessage || require("./whatsapp-delivery-service").sendMessage;
    const sendCritical = deps.sendCritical || require("./whatsapp-critical-delivery").sendCritical;
    let sent = 0;
    for (const jid of uniq) {
        try {
            if (resolved.severity === "critical") {
                await sendCritical(jid, { text }, { label: `notif:${category}` });
            } else {
                await sendMessage(jid, { text }, { skipDuplicateCheck: true });
            }
            sent += 1;
        } catch (_e) {
            /* per-jid best-effort — satu penerima gagal tak menghentikan sisanya, tak melempar */
        }
    }
    return { sent, recipients: uniq, mode: resolved.mode, severity: resolved.severity };
}

module.exports = { recipientsFor, dispatch, _validGroups };
