/**
 * Header Doc
 * Purpose: Sumber tunggal pemuatan, render, dan penyimpanan seluruh kategori template pesan
 *          (`database/*_templates.json`). Menyimpan cache per kategori yang dipakai seluruh app.
 * Caller: `lib/templating.js`, `lib/response-template-helper.js`, `message/handlers/template-helpers.js`,
 *         `routes/admin-content-routes.js`, dan `routes/message-templates.js`.
 * Deps: `fs`, `path`, `./database` (loadJSON/saveJSON), lazy `./template-usage-scanner` (diagnostics).
 * MainFuncs: `loadCategory`, `loadAllCategories`, `renderString`, `renderCategoryTemplate`,
 *            `saveCategory` (dengan backup + pengaman penghapusan massal), `getDiagnostics`.
 * SideEffects: Menulis file kategori di `database/`, menyalin cadangan ke `backups/templates/`,
 *              dan memperbarui cache in-memory.
 */
const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON } = require('./database');

const CATEGORY_FILES = {
    notificationTemplates: 'message_templates.json',
    wifiMenuTemplates: 'wifi_menu_templates.json',
    responseTemplates: 'response_templates.json',
    commandTemplates: 'command_templates.json',
    errorTemplates: 'error_templates.json',
    successTemplates: 'success_templates.json',
    systemTemplates: 'system_messages.json',
    menuTemplates: 'menu_templates.json',
    reportTemplates: 'report_templates.json'
};

const COMPAT_FILE = 'message-templates.json';
const legacyUsage = {};
const legacyWarningEmitted = new Set();
const cache = Object.keys(CATEGORY_FILES).reduce((result, category) => {
    result[category] = {};
    return result;
}, {});

function shouldEmitLegacyWarning() {
    if (process.env.NODE_ENV === 'test') return false;
    if (process.env.SUPPRESS_TEMPLATE_LEGACY_WARNINGS === '1') return false;
    return true;
}

function buildLegacyWarningKey(adapter, operation, metadata) {
    const metaKey = metadata && typeof metadata === 'object'
        ? (metadata.templateId || metadata.key || metadata.path || '')
        : '';
    return `${adapter}::${operation}::${metaKey}`;
}

function recordLegacyUsage(adapter, operation, metadata = {}) {
    const key = String(adapter || 'unknown');
    const current = legacyUsage[key] || {
        adapter: key,
        count: 0,
        operations: {},
        lastUsedAt: null,
        lastMetadata: null
    };

    current.count += 1;
    current.operations[operation] = (current.operations[operation] || 0) + 1;
    current.lastUsedAt = new Date().toISOString();
    current.lastMetadata = metadata;
    legacyUsage[key] = current;

    if (!shouldEmitLegacyWarning()) return;

    // Rate-limit: emit only once per unique (adapter, operation, templateId/key) combo
    const warningKey = buildLegacyWarningKey(key, operation, metadata);
    if (legacyWarningEmitted.has(warningKey)) return;
    legacyWarningEmitted.add(warningKey);

    console.warn('[TEMPLATE_LEGACY_ADAPTER_USED]', {
        adapter: key,
        operation,
        metadata,
        note: 'This legacy adapter is deprecated. Warning shown once per unique call site. Set SUPPRESS_TEMPLATE_LEGACY_WARNINGS=1 to silence.'
    });
}

function getDatabaseFilePath(fileName) {
    return path.join(__dirname, '..', 'database', fileName);
}

function normalizeLegacyPlaceholders(value) {
    if (typeof value !== 'string') {
        return value;
    }

    return value.replace(/(^|[^$])\{([a-zA-Z0-9_.]+)\}/g, '$1${$2}');
}

function cloneAndNormalizeTemplateEntry(entry) {
    if (typeof entry === 'string') {
        return normalizeLegacyPlaceholders(entry);
    }

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return entry;
    }

    const normalized = { ...entry };
    if (typeof normalized.template === 'string') {
        normalized.template = normalizeLegacyPlaceholders(normalized.template);
    }
    if (typeof normalized.content === 'string') {
        normalized.content = normalizeLegacyPlaceholders(normalized.content);
    }

    return normalized;
}

function normalizeCategoryData(category, data) {
    const input = data && typeof data === 'object' ? data : {};
    const normalized = {};

    Object.entries(input).forEach(([key, value]) => {
        if (category === 'wifiMenuTemplates' && value && typeof value === 'object' && typeof value.template === 'string') {
            normalized[key] = normalizeLegacyPlaceholders(value.template);
            return;
        }

        normalized[key] = cloneAndNormalizeTemplateEntry(value);
    });

    return normalized;
}

function loadCategory(category) {
    const fileName = CATEGORY_FILES[category];
    if (!fileName) {
        throw new Error(`Unknown template category: ${category}`);
    }

    const data = loadJSON(fileName);
    cache[category] = normalizeCategoryData(category, data);
    return cache[category];
}

function loadAllCategories() {
    Object.keys(CATEGORY_FILES).forEach((category) => loadCategory(category));
    return cache;
}

function getTemplateEntry(category, key) {
    if (!cache[category]) {
        loadCategory(category);
    }
    return cache[category]?.[key];
}

function extractTemplateString(entry) {
    if (typeof entry === 'string') {
        return entry;
    }
    if (entry && typeof entry.template === 'string') {
        return entry.template;
    }
    if (entry && typeof entry.content === 'string') {
        return entry.content;
    }
    return '';
}

// Placeholder identitas/brand yang dipakai lintas-template (nama_wifi, nama_bot,
// dll). Disuntik sebagai default di setiap render agar template response/command/
// menu yang memakainya tidak tampil mentah saat pemanggil tidak mengoper datanya.
// Data dari pemanggil tetap menimpa default ini.
function getBrandDefaults() {
    const cfg = (typeof global !== 'undefined' && global.config) ? global.config : {};
    const wifiName = cfg.nama || cfg.namaWifi || (cfg.company && cfg.company.name) || 'Layanan WiFi Kami';
    const botName = cfg.namabot || cfg.botName || 'Bot Asisten';
    return {
        nama_wifi: wifiName,
        wifiName: wifiName,
        nama_layanan: wifiName,
        nama_layanan_upper: String(wifiName).toUpperCase(),
        nama_bot: botName,
        namabot: botName,
        nama: cfg.nama || wifiName,
        company_name: (cfg.company && cfg.company.name) || cfg.company_name || wifiName,
        telfon: cfg.telfon || ''
    };
}

function renderString(template, data = {}) {
    const normalizedTemplate = normalizeLegacyPlaceholders(template || '');
    const mergedData = { ...getBrandDefaults(), ...(data || {}) };
    const rendered = normalizedTemplate.replace(/\$\{([^}]+)\}/g, (placeholder, key) => (
        Object.prototype.hasOwnProperty.call(mergedData, key) ? mergedData[key] : placeholder
    ));

    const unresolved = rendered.match(/\$\{[^}]+\}/g) || [];
    return {
        text: rendered,
        unresolved
    };
}

function renderCategoryTemplate(category, key, data = {}) {
    const entry = getTemplateEntry(category, key);
    const template = extractTemplateString(entry);
    if (!template) {
        return {
            found: false,
            text: '',
            unresolved: [],
            entry: null
        };
    }

    const result = renderString(template, data);
    return {
        found: true,
        text: result.text,
        unresolved: result.unresolved,
        entry
    };
}

/**
 * JARING PENGAMAN terpusat untuk pemanggil yang merender responseTemplates TANPA fallback kode
 * (mis. `renderCategoryTemplate(...).text` langsung di lib/services/*, alert-system, dst).
 *
 * KENAPA ADA (#b302): renderString sengaja memulangkan `${slot}` MENTAH bila slot tak dioper —
 * dan message/handlers/template-helpers.js sudah menjaga jalur ber-fallback dengan menjatuhkannya
 * ke fallback + memperingatkan. Tapi ~8 pemanggil di lib/ mengambil `.text` langsung, TANPA
 * fallback dan TANPA cek `.unresolved`, sehingga bila suatu slot dicabut dari kode (skenario yang
 * CLAUDE.md sebut BERULANG) mereka akan membocorkan `${jumlah}` mentah ke pelanggan — diam-diam,
 * dan tak muncul di log karena tak memperingatkan apa pun.
 *
 * Karena pemanggil ini tak punya fallback untuk dijatuhi, perilaku amannya: BUANG placeholder
 * mentah (tampil kosong, bukan `${slot}`) + peringatkan supaya template basinya dirapikan.
 * Saat semua slot terisi (keadaan sekarang di seluruh situs) hasilnya IDENTIK dengan sebelumnya.
 */
function renderResponseTemplateSafe(key, data = {}) {
    const result = renderCategoryTemplate('responseTemplates', key, data);
    if (!result.found) return '';
    if (Array.isArray(result.unresolved) && result.unresolved.length) {
        console.warn('[TEMPLATE_SLOT_BASI]', {
            key,
            unresolved: result.unresolved.slice(0, 5),
            tindakan: 'slot dikosongkan — rapikan template di /api/templates'
        });
        return result.text
            .replace(/\$\{[^}]+\}/g, '')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/ +\n/g, '\n')
            .trim();
    }
    return result.text;
}

/**
 * Ambang penghapusan key yang dianggap tidak wajar. `saveCategory` menimpa SATU KATEGORI PENUH,
 * jadi satu POST parsial dari UI bisa menghapus ratusan template sekaligus (response_templates
 * sendiri berisi ~900 key). Simpanan yang menghapus lebih dari ambang ini ditolak kecuali
 * pemanggil memang meniatkannya lewat `options.allowMassDeletion`.
 */
const MASS_DELETION_RATIO = 0.2;
const MASS_DELETION_MIN_KEYS = 10;

/** Salin file kategori ke `backups/templates/` sebelum ditimpa. Best-effort: tak boleh menggagalkan simpan. */
function backupCategoryFile(fileName, stamp) {
    try {
        const source = path.join(__dirname, '..', 'database', fileName);
        if (!fs.existsSync(source)) return null;
        const dir = path.join(__dirname, '..', 'backups', 'templates');
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, `${fileName.replace(/\.json$/, '')}.${stamp}.json`);
        fs.copyFileSync(source, target);
        return target;
    } catch (error) {
        console.warn('[TEMPLATE_BACKUP_WARN]', fileName, error.message);
        return null;
    }
}

/**
 * @param {string} category
 * @param {Record<string, any>} templates - isi kategori PENUH (bukan patch)
 * @param {{allowMassDeletion?: boolean}} [options]
 */
function saveCategory(category, templates, options = {}) {
    const fileName = CATEGORY_FILES[category];
    if (!fileName) {
        throw new Error(`Unknown template category: ${category}`);
    }

    const normalized = normalizeCategoryData(category, templates);

    const existing = cache[category] || {};
    const existingKeys = Object.keys(existing);
    const removed = existingKeys.filter((key) => !(key in normalized));
    if (!options.allowMassDeletion
        && existingKeys.length >= MASS_DELETION_MIN_KEYS
        && removed.length > Math.ceil(existingKeys.length * MASS_DELETION_RATIO)) {
        const error = new Error(
            `Simpan dibatalkan: akan menghapus ${removed.length} dari ${existingKeys.length} template `
            + `di kategori "${category}". Kirim ulang isi lengkapnya, atau set allowMassDeletion bila memang disengaja.`
        );
        error.code = 'TEMPLATE_MASS_DELETION';
        error.removedCount = removed.length;
        error.existingCount = existingKeys.length;
        throw error;
    }

    backupCategoryFile(fileName, new Date().toISOString().replace(/[:.]/g, '-'));
    saveJSON(fileName, normalized);
    cache[category] = normalized;
    return cache[category];
}

function updateCategoryEntry(category, key, updater) {
    const current = { ...(cache[category] || loadCategory(category)) };
    const nextValue = typeof updater === 'function' ? updater(current[key]) : updater;
    current[key] = cloneAndNormalizeTemplateEntry(nextValue);
    return saveCategory(category, current);
}

function listCompatTemplates() {
    const notificationTemplates = cache.notificationTemplates || loadCategory('notificationTemplates');
    return Object.entries(notificationTemplates).map(([id, value]) => {
        const templateText = extractTemplateString(value);
        return {
            id,
            name: value?.name || id,
            description: value?.description || '',
            category: value?.category || 'notification',
            content: templateText,
            template: templateText,
            placeholders: value?.placeholders || [],
            enabled: value?.enabled !== false,
            updated_at: value?.updated_at || null
        };
    });
}

function getCompatTemplate(templateId) {
    return listCompatTemplates().find((template) => template.id === templateId) || null;
}

function saveCompatTemplate(templateId, templateData) {
    return updateCategoryEntry('notificationTemplates', templateId, (existing) => ({
        ...(existing && typeof existing === 'object' ? existing : {}),
        ...templateData,
        id: templateId,
        template: normalizeLegacyPlaceholders(templateData.template ?? templateData.content ?? existing?.template ?? ''),
        updated_at: new Date().toISOString()
    }));
}

function hasLegacyCompatFile() {
    return fs.existsSync(getDatabaseFilePath(COMPAT_FILE));
}

/**
 * @param {{health?: boolean, force?: boolean}} [options] - `health:true` menambahkan laporan
 *        kesehatan (key yatim / hilang / slot tak dikenal). Pemindaian source cukup mahal, jadi
 *        OPT-IN dan hasilnya di-cache di `lib/template-usage-scanner`.
 */
function getDiagnostics(options = {}) {
    const categories = {};
    Object.keys(CATEGORY_FILES).forEach((category) => {
        categories[category] = Object.keys(cache[category] || {}).length;
    });

    const diagnostics = {
        categories,
        compatFileExists: hasLegacyCompatFile(),
        sourceFiles: { ...CATEGORY_FILES },
        legacyUsage: Object.values(legacyUsage)
    };

    // Dulu diagnostics hanya menghitung jumlah key per kategori — tak ada sinyal apakah sebuah key
    // masih terpakai, atau apakah ada key yang dirujuk kode tapi hilang dari JSON (yang membuatnya
    // tak bisa diedit admin walau pesannya tetap terkirim lewat fallback).
    if (options.health) {
        try {
            const { buildHealthReport } = require('./template-usage-scanner');
            diagnostics.health = {
                responseTemplates: buildHealthReport(cache.responseTemplates || {}, { force: options.force })
            };
        } catch (error) {
            diagnostics.health = { error: error.message };
        }
    }

    return diagnostics;
}

function resetLegacyUsage() {
    Object.keys(legacyUsage).forEach((key) => delete legacyUsage[key]);
    legacyWarningEmitted.clear();
}

loadAllCategories();

module.exports = {
    CATEGORY_FILES,
    cache,
    normalizeLegacyPlaceholders,
    normalizeCategoryData,
    loadCategory,
    loadAllCategories,
    getTemplateEntry,
    extractTemplateString,
    renderString,
    renderCategoryTemplate,
    renderResponseTemplateSafe,
    saveCategory,
    updateCategoryEntry,
    listCompatTemplates,
    getCompatTemplate,
    saveCompatTemplate,
    hasLegacyCompatFile,
    getDiagnostics,
    recordLegacyUsage,
    resetLegacyUsage
};
