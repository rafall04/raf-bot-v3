/**
 * Header Doc
 * Purpose: Owner orchestration fitur Cetak Voucher — gabungkan settings (repo) dengan default dari `global.config` (nama wifi, CS, logo), daftar layout, render lembar cetak (A4/thermal) via engine, dan impor template Mikhmon. Route tetap adapter tipis.
 * Caller: `routes/api-voucher-routes.js`.
 * Deps: `repositories/voucher-print.repository.js`, `services/voucher-print/render`, `services/voucher-print/mikhmon-import`, `deps.getConfig`.
 * MainFuncs: `createVoucherPrintService` -> getSettings, listLayouts, getLayout, saveSettings, saveLayout, deleteLayout, renderPrint, previewMikhmonImport, importMikhmonLayout.
 * SideEffects: Persistensi via repository (file JSON). Render murni in-memory.
 */
"use strict";

const { renderSheet } = require("./voucher-print/render");
const { convertMikhmonTemplate } = require("./voucher-print/mikhmon-import");

function defaultDeps() {
    return { repository: null, getConfig: () => global.config || {}, qrcode: null, addHotspotUsersBatch: null, logger: console };
}

function digitsOnly(value) {
    return String(value || "").replace(/[^0-9]/g, "");
}

function createVoucherPrintService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    function getMergedSettings() {
        const config = deps.getConfig() || {};
        const stored = deps.repository.getSettings();
        const ownerDigits = Array.isArray(config.ownerNumber) && config.ownerNumber[0]
            ? digitsOnly(config.ownerNumber[0])
            : "";
        return {
            ...stored,
            wifi_name: stored.wifi_name || config.nama || config.nama_wifi || "RAF NET",
            cs_number: stored.cs_number || config.telfon || ownerDigits || "",
            logo_url: stored.logo_url || (config.company && config.company.logoPath) || "",
            autologin_url_template: stored.autologin_url_template || ""
        };
    }

    return {
        deps,

        getSettings() {
            return getMergedSettings();
        },

        saveSettings(patch = {}) {
            return deps.repository.saveSettings(patch);
        },

        listLayouts() {
            return deps.repository.getLayouts();
        },

        getLayout(id) {
            return deps.repository.getLayout(id);
        },

        saveLayout(layout) {
            return deps.repository.saveLayout({ ...layout, updated_at: new Date().toISOString() });
        },

        deleteLayout(id) {
            return deps.repository.deleteLayout(id);
        },

        async renderPrint({ layoutId, vouchers, thermal = false, title } = {}) {
            const settings = getMergedSettings();
            const layout = (layoutId && deps.repository.getLayout(layoutId))
                || deps.repository.getLayout(settings.default_layout)
                || deps.repository.getLayouts()[0];
            if (!layout) {
                throw new Error("Tidak ada layout voucher tersedia");
            }
            const html = await renderSheet(layout, vouchers || [], settings, { qrcode: deps.qrcode }, {
                thermal: Boolean(thermal),
                title: title || `Cetak Voucher - ${settings.wifi_name}`
            });
            return { html, layoutId: layout.id, count: Array.isArray(vouchers) ? vouchers.length : 0 };
        },

        async generateBatch({ profile, count, length, chartype, prefix, usernames } = {}) {
            if (!profile) return { ok: false, message: "Profil voucher wajib dipilih" };
            const custom = Array.isArray(usernames) ? usernames.map((u) => String(u).trim()).filter(Boolean) : [];
            const n = parseInt(count, 10) || 0;
            if (custom.length === 0 && n < 1) return { ok: false, message: "Jumlah voucher minimal 1" };
            if (typeof deps.addHotspotUsersBatch !== "function") {
                return { ok: false, message: "Bridge MikroTik batch tidak tersedia" };
            }
            const stored = deps.repository.getSettings();
            const result = await deps.addHotspotUsersBatch({
                profile,
                count: n,
                comment: "VoucherPrint",
                length: parseInt(length, 10) || stored.code_length || 6,
                chartype: chartype || stored.code_chartype || "safe",
                prefix: (prefix !== null && typeof prefix !== "undefined") ? prefix : (stored.code_prefix || ""),
                usernames: custom
            }, { caller: "voucher-print.generateBatch" });
            if (!result || result.ok !== true) {
                return { ok: false, message: (result && result.message) || "Gagal generate batch dari MikroTik" };
            }
            const data = result.data || {};
            return {
                ok: true,
                vouchers: data.vouchers || [],
                created: data.created || 0,
                failed: data.failed || 0,
                requested: data.requested || n
            };
        },

        previewMikhmonImport({ php } = {}) {
            return convertMikhmonTemplate(php || "");
        },

        importMikhmonLayout({ id, name, php, mergeColors = true } = {}) {
            const { template, colors } = convertMikhmonTemplate(php || "");
            const slug = String(id || name || `mikhmon-${Date.now()}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            const saved = deps.repository.saveLayout({
                id: slug || `mikhmon-${Date.now()}`,
                name: name || "Impor Mikhmon",
                width: 200,
                template,
                updated_at: new Date().toISOString()
            });
            if (mergeColors && colors && colors.map && Object.keys(colors.map).length > 0) {
                const patch = { price_colors: colors.map };
                if (colors.default) patch.default_color = colors.default;
                deps.repository.saveSettings(patch);
            }
            return { layout: saved, colors };
        }
    };
}

module.exports = { createVoucherPrintService };
