/**
 * Header Doc
 * Purpose: Owner persistensi fitur Cetak Voucher — settings branding/warna (database/voucher_print_settings.json) dan layout custom (database/voucher_layouts.json). Layout bawaan diambil dari `services/voucher-print/layouts.js` lalu digabung dengan custom.
 * Caller: `services/voucher-print.service.js`.
 * Deps: `fs`, `path`, `../services/voucher-print/layouts`.
 * MainFuncs: `createVoucherPrintRepository` -> getSettings, saveSettings, getLayouts, getLayout, saveLayout, deleteLayout.
 * SideEffects: Baca/tulis dua file JSON di `database/`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { getBuiltinLayouts } = require("../services/voucher-print/layouts");

const DEFAULT_PRICE_COLORS = {
    "1000": "#FF1493", "2000": "#8B008B", "3000": "#666666", "5000": "#FF4500",
    "10000": "#E65100", "15000": "#228B22", "20000": "#008000", "30000": "#FF00FF",
    "55000": "#0F6E56", "60000": "#E60C00", "70000": "#FF0000"
};

const DEFAULT_SETTINGS = {
    wifi_name: "",
    portal_text: "Sambungkan ke WiFi, lalu buka browser",
    cs_number: "",
    logo_url: "",
    footer_text: "",
    default_layout: "band",
    qr_mode: "code",
    autologin_url_template: "",
    default_price: 0,
    default_color: "#BA68C8",
    price_colors: DEFAULT_PRICE_COLORS
};

function defaultDeps() {
    return {
        settingsPath: path.join(__dirname, "..", "database", "voucher_print_settings.json"),
        layoutsPath: path.join(__dirname, "..", "database", "voucher_layouts.json")
    };
}

function readJsonSafe(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return parsed;
    } catch (_error) {
        return fallback;
    }
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createVoucherPrintRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    return {
        deps,

        getSettings() {
            const stored = readJsonSafe(deps.settingsPath, {}) || {};
            return {
                ...DEFAULT_SETTINGS,
                ...stored,
                price_colors: { ...DEFAULT_PRICE_COLORS, ...(stored.price_colors || {}) }
            };
        },

        saveSettings(patch = {}) {
            const next = { ...this.getSettings(), ...patch };
            if (patch.price_colors) {
                next.price_colors = { ...this.getSettings().price_colors, ...patch.price_colors };
            }
            writeJson(deps.settingsPath, next);
            return next;
        },

        getCustomLayouts() {
            const list = readJsonSafe(deps.layoutsPath, []);
            return Array.isArray(list) ? list : [];
        },

        getLayouts() {
            const builtins = getBuiltinLayouts();
            const customs = this.getCustomLayouts().map((layout) => ({ ...layout, builtin: false }));
            const customIds = new Set(customs.map((layout) => layout.id));
            return [...customs, ...builtins.filter((layout) => !customIds.has(layout.id))];
        },

        getLayout(id) {
            return this.getLayouts().find((layout) => layout.id === id) || null;
        },

        saveLayout(layout = {}) {
            if (!layout.id || !layout.template) {
                throw new Error("Layout butuh id dan template");
            }
            const customs = this.getCustomLayouts().filter((item) => item.id !== layout.id);
            const record = {
                id: String(layout.id),
                name: layout.name || layout.id,
                width: layout.width || 200,
                template: layout.template,
                builtin: false,
                updated_at: layout.updated_at || null
            };
            customs.push(record);
            writeJson(deps.layoutsPath, customs);
            return record;
        },

        deleteLayout(id) {
            const customs = this.getCustomLayouts();
            const next = customs.filter((item) => item.id !== id);
            writeJson(deps.layoutsPath, next);
            return { deleted: customs.length - next.length };
        }
    };
}

module.exports = { createVoucherPrintRepository, DEFAULT_SETTINGS, DEFAULT_PRICE_COLORS };
