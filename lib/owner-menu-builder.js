/**
 * Header Doc
 * Purpose: Generate MENU OWNER WhatsApp dari KATALOG perintah (database/wifi_templates.json) —
 *          dikelompokkan per DOMAIN (Jaringan/ISP, Pelanggan, Keuangan, Voucher, MikroTik, Lainnya),
 *          plus daftar ISP DINAMIS (`data <isp>`) dari monitor upstream aktif + link panel web per
 *          domain. Menu ter-generate = TAK PERNAH BASI: perintah owner/admin baru di katalog otomatis
 *          muncul (yang belum dipetakan domain → seksi "Lainnya", jadi tak pernah tersembunyi) —
 *          beda dari template statis lama yang ketinggalan ~1 tahun fitur (mis. tak ada `data isp`).
 * Caller: `message/wifi.js` (exports.menuowner) → `message/handlers/menu-handler.handleMenuOwner`.
 * Deps: lazy `lib/wifi_template_handler.getWifiTemplates` (katalog perintah), `lib/upstream-quality-poller.getMonitorConfig`
 *       (daftar ISP aktif), `lib/templating.templatesCache.wifiMenuTemplates` (intro/outro editable). Semua di-guard.
 * MainFuncs: `buildOwnerMenu`.
 * SideEffects: Tidak ada (hanya baca katalog + config).
 */
"use strict";

// Urutan & judul domain di menu. `web` = panel admin terkait (null bila belum ada).
const DOMAINS = [
    { key: "jaringan", title: "🌐 *Jaringan & ISP*", web: "/upstream-quality" },
    { key: "pelanggan", title: "👥 *Pelanggan*", web: "/users" },
    { key: "keuangan", title: "💰 *Keuangan & Saldo*", web: null },
    { key: "voucher", title: "🎟️ *Voucher*", web: null },
    { key: "mikrotik", title: "🔧 *Profil & PPPoE (MikroTik)*", web: null },
    { key: "lainnya", title: "⚙️ *Lainnya*", web: null }
];

// Peta intent/keyword → domain. Yang tak ada di sini jatuh ke "lainnya" (anti-basi: tetap tampil).
const INTENT_DOMAIN = {
    DATA_ISP: "jaringan", OPER_JALUR: "jaringan", SWITCH_KONEKSI: "jaringan",
    statusppp: "jaringan", statushotspot: "jaringan", statusap: "jaringan", monitorwifi: "jaringan",
    CARI_PELANGGAN: "pelanggan", DAFTAR_PELANGGAN: "pelanggan", alluser: "pelanggan",
    allsaldo: "keuangan",
    listprofvoucher: "voucher", addprofvoucher: "voucher", delprofvoucher: "voucher",
    listprofstatik: "mikrotik", addprofstatik: "mikrotik", delprofstatik: "mikrotik",
    addbinding: "mikrotik", addppp: "mikrotik"
};
const KEYWORD_DOMAIN = { "<topup": "keuangan", "<delsaldo": "keuangan" };

function safeCatalog(dep) {
    try { return dep ? dep() : require("./wifi_template_handler").getWifiTemplates(); }
    catch (_e) { return []; }
}
function safeMonitor(dep) {
    try { return dep ? dep() : require("./upstream-quality-poller").getMonitorConfig(); }
    catch (_e) { return { enabled: false, paths: [] }; }
}
function safeMenuTemplates(dep) {
    try { return dep || require("./templating").templatesCache.wifiMenuTemplates || {}; }
    catch (_e) { return {}; }
}

// Buang penanda peran di akhir deskripsi — baik berkurung "(Admin/Owner)" maupun
// bertanda hubung "— Admin/Owner" / "- Teknisi" — biar menu bersih.
function cleanDesc(d) {
    return String(d || "")
        .replace(/\s*[—-]\s*(?:admin|owner|teknisi)[\w/]*\s*$/i, "")
        .replace(/\s*\((?:admin|owner|teknisi)[^)]*\)\s*$/i, "")
        .trim();
}

/**
 * Susun teks MENU OWNER. Tidak pernah throw (fallback pesan aman).
 * @param {object} opts { catalog?, config?, nama?, namabot?, menuTemplates?, getCatalog?, getMonitorConfig? }
 */
function buildOwnerMenu(opts = {}) {
    try {
        const catalog = Array.isArray(opts.catalog) ? opts.catalog : safeCatalog(opts.getCatalog);
        const cfg = opts.config || (typeof global !== "undefined" && global.config) || {};
        const namaWifi = opts.nama || cfg.nama || "WiFi";
        const namaBot = opts.namabot || cfg.namabot || "Bot";
        const menuTpl = safeMenuTemplates(opts.menuTemplates);
        const mon = safeMonitor(opts.getMonitorConfig);
        const ispKeys = (mon && mon.enabled && Array.isArray(mon.paths))
            ? mon.paths.map((p) => p && p.key).filter(Boolean)
            : [];

        // Kelompokkan perintah owner/admin per domain.
        const buckets = {};
        for (const e of catalog || []) {
            if (!e || !["admin", "owner"].includes(String(e.category || "").toLowerCase())) continue;
            const kw = (Array.isArray(e.keywords) && e.keywords[0]) ? e.keywords[0] : (e.intent || "");
            if (!kw) continue;
            const dom = INTENT_DOMAIN[e.intent] || KEYWORD_DOMAIN[kw] || "lainnya";
            (buckets[dom] = buckets[dom] || []).push({ kw, intent: e.intent, desc: cleanDesc(e.description) });
        }

        const header = String(menuTpl.menuowner_intro
            || "👑 *MENU OWNER — ${nama_wifi}* 👑\nKontrol penuh jaringan & bisnis Anda.")
            .replace(/\$\{nama_wifi\}/g, namaWifi).replace(/\$\{nama_bot\}/g, namaBot);
        let out = header;

        for (const d of DOMAINS) {
            const items = buckets[d.key];
            if (!items || !items.length) continue;
            out += `\n\n${d.title}`;
            for (const it of items) {
                out += `\n• *${it.kw}* — ${it.desc}`;
                // Daftar ISP DINAMIS tepat di bawah "data isp" (jawaban "tidak ada list isp").
                if (d.key === "jaringan" && it.intent === "DATA_ISP" && ispKeys.length) {
                    out += `\n   └ per ISP: ${ispKeys.map((k) => `*data ${k}*`).join(" · ")}`;
                }
            }
            if (d.web) out += `\n   🌐 Web: *${d.web}*`;
        }

        const footer = String(menuTpl.menuowner_outro
            || "\n\n_Perintah perangkat modem: ketik *menuteknisi*. Menu pelanggan: *menu*._")
            .replace(/\$\{nama_bot\}/g, namaBot).replace(/\$\{nama_wifi\}/g, namaWifi);
        out += footer;
        return out;
    } catch (err) {
        console.warn(`[OwnerMenu] gagal generate: ${err.message}`);
        return "👑 *MENU OWNER*\nMaaf, menu sedang tidak tersedia. Coba lagi sebentar.";
    }
}

module.exports = {
    buildOwnerMenu,
    _internal: { DOMAINS, INTENT_DOMAIN, KEYWORD_DOMAIN, cleanDesc }
};
