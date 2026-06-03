/**
 * Header Doc
 * Purpose: Memusatkan business logic CRUD WiFi templates agar registrar konten admin tetap tipis.
 * Caller: `routes/admin-content-routes.js`.
 * Deps: `lib/database`, `lib/wifi_template_handler`, dan `lib/error-handler`.
 * MainFuncs: `createWifiTemplateConfigService`, `listWifiTemplates`, `createWifiTemplate`, `updateWifiTemplate`, `deleteWifiTemplate`.
 * SideEffects: Menulis `wifi_templates.json` dan mencoba reload cache template WiFi setelah perubahan.
 */
"use strict";

const { createError, ErrorTypes } = require("../lib/error-handler");

function defaultDeps() {
    return {
        loadJSON: require("../lib/database").loadJSON,
        saveJSON: require("../lib/database").saveJSON,
        loadWifiTemplates: require("../lib/wifi_template_handler").loadWifiTemplates
    };
}

function normalizeKeywords(keywords = []) {
    return keywords
        .map((keyword) => String(keyword || "").trim())
        .filter(Boolean);
}

function requireKeywords(keywords) {
    if (!Array.isArray(keywords)) {
        throw createError(ErrorTypes.VALIDATION_ERROR, "Keywords (array) wajib diisi.", 400);
    }

    const normalized = normalizeKeywords(keywords);
    if (normalized.length === 0) {
        throw createError(ErrorTypes.VALIDATION_ERROR, "Keywords (array) wajib diisi.", 400);
    }

    return normalized;
}

function tryReloadTemplateCache(loadWifiTemplates) {
    try {
        loadWifiTemplates();
        console.log("[WIFI_TEMPLATES] Template cache reloaded");
    } catch (reloadError) {
        console.error("[WIFI_TEMPLATES] Failed to reload template cache:", reloadError.message);
    }
}

function createWifiTemplateConfigService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    function loadTemplates() {
        return deps.loadJSON("wifi_templates.json") || [];
    }

    return {
        listWifiTemplates() {
            const templates = loadTemplates();
            return {
                status: 200,
                message: "WiFi templates berhasil dimuat.",
                data: templates
            };
        },

        createWifiTemplate(input = {}, actorCtx = {}) {
            const intent = String(input.intent || "").trim();
            if (!intent) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "Intent dan keywords (array) wajib diisi.", 400);
            }

            const keywords = requireKeywords(input.keywords);
            const templates = loadTemplates();
            const existingTemplate = templates.find((template) => template.intent === intent);
            if (existingTemplate) {
                throw createError(ErrorTypes.VALIDATION_ERROR, `Intent '${intent}' sudah ada. Gunakan update untuk mengubahnya.`, 400);
            }

            const newTemplate = {
                keywords,
                intent,
                category: String(input.category || "other").trim() || "other",
                description: String(input.description || "").trim(),
                icon: String(input.icon || "\uD83D\uDCDD").trim() || "\uD83D\uDCDD"
            };

            const nextTemplates = [...templates, newTemplate];
            deps.saveJSON("wifi_templates.json", nextTemplates);
            tryReloadTemplateCache(deps.loadWifiTemplates);
            console.log(`[WIFI_TEMPLATES] Template baru ditambahkan: ${intent} (${newTemplate.category}) oleh ${actorCtx.username || "system"}`);

            return {
                status: 201,
                message: "Template WiFi berhasil ditambahkan.",
                data: newTemplate
            };
        },

        updateWifiTemplate(intent, input = {}, actorCtx = {}) {
            const currentIntent = String(intent || "").trim();
            if (!currentIntent) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "Intent template tidak boleh kosong.", 400);
            }

            const keywords = requireKeywords(input.keywords);
            const templates = loadTemplates();
            const templateIndex = templates.findIndex((template) => template.intent === currentIntent);
            if (templateIndex === -1) {
                throw createError(ErrorTypes.NOT_FOUND_ERROR, `Template dengan intent '${currentIntent}' tidak ditemukan.`, 404);
            }

            const nextTemplates = [...templates];
            const nextIntent = String(input.newIntent || "").trim();
            if (nextIntent && nextIntent !== currentIntent) {
                const conflictingTemplate = nextTemplates.find((template, index) => template.intent === nextIntent && index !== templateIndex);
                if (conflictingTemplate) {
                    throw createError(ErrorTypes.VALIDATION_ERROR, `Intent '${nextIntent}' sudah digunakan oleh template lain.`, 400);
                }
                nextTemplates[templateIndex].intent = nextIntent;
            }

            nextTemplates[templateIndex].keywords = keywords;
            if (input.category !== undefined && input.category !== null && String(input.category).trim() !== "") {
                nextTemplates[templateIndex].category = String(input.category).trim();
            }
            if (input.description !== undefined && input.description !== null) {
                nextTemplates[templateIndex].description = String(input.description).trim();
            }
            if (input.icon !== undefined && input.icon !== null && String(input.icon).trim() !== "") {
                nextTemplates[templateIndex].icon = String(input.icon).trim();
            }

            deps.saveJSON("wifi_templates.json", nextTemplates);
            tryReloadTemplateCache(deps.loadWifiTemplates);
            console.log(`[WIFI_TEMPLATES] Template diupdate: ${currentIntent} oleh ${actorCtx.username || "system"}`);

            return {
                status: 200,
                message: "Template WiFi berhasil diupdate.",
                data: nextTemplates[templateIndex]
            };
        },

        deleteWifiTemplate(intent, actorCtx = {}) {
            const currentIntent = String(intent || "").trim();
            if (!currentIntent) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "Intent template tidak boleh kosong.", 400);
            }

            const templates = loadTemplates();
            const filteredTemplates = templates.filter((template) => template.intent !== currentIntent);
            if (filteredTemplates.length === templates.length) {
                throw createError(ErrorTypes.NOT_FOUND_ERROR, `Template dengan intent '${currentIntent}' tidak ditemukan.`, 404);
            }

            deps.saveJSON("wifi_templates.json", filteredTemplates);
            tryReloadTemplateCache(deps.loadWifiTemplates);
            console.log(`[WIFI_TEMPLATES] Template dihapus: ${currentIntent} oleh ${actorCtx.username || "system"}`);

            return {
                status: 200,
                message: "Template WiFi berhasil dihapus."
            };
        }
    };
}

module.exports = {
    createWifiTemplateConfigService
};
