/**
 * Header Doc
 * Purpose: Facade multi-category template lookup tipis di atas `template-service` untuk kebutuhan admin (`template-manager.hasTemplate/getTemplate/saveTemplate`) yang perlu mencari key lintas 9 kategori tanpa tahu kategorinya.
 * Caller: `routes/admin-router.js` (inject ke admin-content dependency), `message/handlers/utility-handler.js`, `message/handlers/menu-handler.js`.
 * Deps: `./template-service`.
 * MainFuncs: `reloadTemplates`, `getTemplate`, `hasTemplate`, `renderTemplate`, `getAllTemplateKeys`, `getTemplateInfo`, `saveTemplate`.
 * SideEffects: Membaca/menulis template JSON via template-service dan memuat cache saat save.
 */
"use strict";

const templateService = require('./template-service');

const categoryLookup = [
    'notificationTemplates',
    'commandTemplates',
    'menuTemplates',
    'responseTemplates',
    'wifiMenuTemplates',
    'systemTemplates',
    'reportTemplates',
    'errorTemplates',
    'successTemplates'
];

function findTemplate(key) {
    for (const category of categoryLookup) {
        const entry = templateService.getTemplateEntry(category, key);
        if (entry) {
            return { category, entry };
        }
    }
    return null;
}

const templateManager = {
    templates: templateService.cache,

    reloadTemplates() {
        templateService.loadAllCategories();
        this.templates = templateService.cache;
        return this.templates;
    },

    getTemplate(key, data = {}, fallback = null) {
        const found = findTemplate(key);
        if (!found) {
            console.warn(`[TemplateManager] Template '${key}' not found`);
            return fallback || `Template '${key}' not found. Please check template configuration.`;
        }

        const template = templateService.extractTemplateString(found.entry);
        return templateService.renderString(template, data).text;
    },

    hasTemplate(key) {
        return Boolean(findTemplate(key));
    },

    renderTemplate(template, data = {}) {
        return templateService.renderString(template, data).text;
    },

    getAllTemplateKeys() {
        const keys = new Set();
        categoryLookup.forEach((category) => {
            Object.keys(templateService.cache[category] || {}).forEach((key) => keys.add(key));
        });
        return [...keys];
    },

    getTemplateInfo(key) {
        const found = findTemplate(key);
        if (!found) return null;

        const template = templateService.extractTemplateString(found.entry);
        return {
            key,
            category: found.category,
            name: found.entry?.name || key,
            template,
            placeholders: [...new Set((template.match(/\$\{([^}]+)\}/g) || []).map((item) => item.slice(2, -1)))]
        };
    },

    saveTemplate(key, name, template, category = 'notificationTemplates') {
        const targetCategory = templateService.CATEGORY_FILES[category] ? category : 'notificationTemplates';
        templateService.updateCategoryEntry(targetCategory, key, (existing) => ({
            ...(existing && typeof existing === 'object' ? existing : {}),
            name: name || existing?.name || key,
            template,
            modified: new Date().toISOString()
        }));
        this.templates = templateService.cache;
        return true;
    }
};

module.exports = templateManager;
