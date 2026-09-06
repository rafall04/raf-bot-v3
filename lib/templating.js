const fs = require('fs');
const path = require('path');
const convertRupiah = require('rupiah-format');
const templateService = require('./template-service');
const { expandSpintax } = require('./spintax');

const notificationTemplatesPath = path.join(__dirname, '../database/message_templates.json');
const wifiMenuTemplatesPath = path.join(__dirname, '../database/wifi_menu_templates.json');
const responseTemplatesPath = path.join(__dirname, '../database/response_templates.json');
const commandTemplatesPath = path.join(__dirname, '../database/command_templates.json');
const errorTemplatesPath = path.join(__dirname, '../database/error_templates.json');
const successTemplatesPath = path.join(__dirname, '../database/success_templates.json');
const systemTemplatesPath = path.join(__dirname, '../database/system_messages.json');
const menuTemplatesPath = path.join(__dirname, '../database/menu_templates.json');
const reportTemplatesPath = path.join(__dirname, '../database/report_templates.json');

const templatesCache = templateService.cache;

function formatBankAccounts() {
    if (!global.config?.bankAccounts || global.config.bankAccounts.length === 0) {
        return null;
    }

    let formatted = '';
    global.config.bankAccounts.forEach((account, index) => {
        if (account.bank && account.number) {
            formatted += ` ${account.bank}:\n`;
            formatted += `${account.number}\n`;
            if (account.name) {
                formatted += `a.n ${account.name}`;
            }
            if (index < global.config.bankAccounts.length - 1) {
                formatted += '\n\n';
            }
        }
    });

    return formatted || null;
}

function reloadTemplateWithRetry(filePath, cacheKey, retries = 3, delay = 100) {
    setTimeout(() => {
        try {
            templateService.loadCategory(cacheKey);
        } catch (error) {
            if (retries > 0) {
                const fileName = path.basename(filePath);
                console.warn(`[Templating] Error reloading ${fileName} (retry ${4 - retries}/3):`, error.message);
                reloadTemplateWithRetry(filePath, cacheKey, retries - 1, delay * 2);
            } else {
                const fileName = path.basename(filePath);
                console.error(`[Templating] Error reloading ${fileName} after 3 retries:`, error.message);
            }
        }
    }, delay);
}

let templateWatchersCount = 0;

function setupTemplateWatcher(filePath, cacheKey, displayName) {
    if (!fs.existsSync(filePath)) {
        return false;
    }

    let lastMtime = fs.statSync(filePath).mtime.getTime();

    fs.watchFile(filePath, { interval: 1000 }, (curr, prev) => {
        const currMtime = curr.mtime ? curr.mtime.getTime() : 0;
        const prevMtime = prev.mtime ? prev.mtime.getTime() : 0;

        if (currMtime !== prevMtime && currMtime !== lastMtime) {
            lastMtime = currMtime;
            console.log(`[Templating] Template file changed: ${displayName}`);
            reloadTemplateWithRetry(filePath, cacheKey, 3, 200);
        }
    });

    templateWatchersCount += 1;
    return true;
}

templateService.loadAllCategories();

if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_FILE_WATCHERS !== 'true') {
    setupTemplateWatcher(notificationTemplatesPath, 'notificationTemplates', 'message_templates.json');
    setupTemplateWatcher(wifiMenuTemplatesPath, 'wifiMenuTemplates', 'wifi_menu_templates.json');
    setupTemplateWatcher(responseTemplatesPath, 'responseTemplates', 'response_templates.json');
    setupTemplateWatcher(commandTemplatesPath, 'commandTemplates', 'command_templates.json');
    setupTemplateWatcher(errorTemplatesPath, 'errorTemplates', 'error_templates.json');
    setupTemplateWatcher(successTemplatesPath, 'successTemplates', 'success_templates.json');
    setupTemplateWatcher(systemTemplatesPath, 'systemTemplates', 'system_messages.json');
    setupTemplateWatcher(menuTemplatesPath, 'menuTemplates', 'menu_templates.json');
    setupTemplateWatcher(reportTemplatesPath, 'reportTemplates', 'report_templates.json');
    console.log(`[Templating] ${templateWatchersCount} template watchers aktif`);
}

function getAdminContactData() {
    // Kontak "chat admin" yang dilihat PELANGGAN = nomor bot/bisnis (config.adminPhone),
    // bukan nomor pribadi admin. (Alert INTERNAL ke admin pakai jalur lain: lib/admin-recipients.)
    const adminPhoneNumber = global.config?.adminPhone || global.config?.telfon || '089685645956';
    const adminPhoneClean = adminPhoneNumber.replace(/\D/g, '');
    const adminWaLink = adminPhoneClean
        ? `https://wa.me/${adminPhoneClean.startsWith('62') ? adminPhoneClean : adminPhoneClean.startsWith('0') ? `62${adminPhoneClean.substring(1)}` : `62${adminPhoneClean}`}`
        : 'https://wa.me/6289685645956';

    return {
        adminWaLink,
        nomor_admin: adminPhoneNumber || '089685645956'
    };
}

function renderTemplate(templateName, data = {}) {
    const { adminWaLink, nomor_admin } = getAdminContactData();
    const fullData = {
        nama: '',
        nama_pelanggan: '',
        paket: '',
        jatuh_tempo: 'N/A',
        periode: 'bulan ini',
        rekening: formatBankAccounts() || global.config?.rekening_details || 'Informasi rekening belum diatur. Silakan hubungi Admin.',
        nama_wifi: global.config?.nama || 'Layanan WiFi Kami',
        nama_bot: global.config?.namabot || 'Bot Asisten',
        telfon: global.config?.telfon || 'N/A',
        adminWaLink,
        nomor_admin,
        ...data,
        nama_pelanggan: data.nama_pelanggan !== undefined ? data.nama_pelanggan : (data.nama !== undefined ? data.nama : ''),
    };

    if (data.harga !== undefined && data.harga !== null && data.harga !== '') {
        fullData.harga = typeof data.harga === 'string' && data.harga.includes('Rp')
            ? data.harga
            : convertRupiah.convert(data.harga);
    } else {
        fullData.harga = '';
    }

    if (data.formattedSaldo !== undefined && data.formattedSaldo !== null && data.formattedSaldo !== '') {
        fullData.formattedSaldo = typeof data.formattedSaldo === 'string' && data.formattedSaldo.includes('Rp')
            ? data.formattedSaldo
            : convertRupiah.convert(data.formattedSaldo);
    } else {
        fullData.formattedSaldo = '';
    }

    const result = templateService.renderCategoryTemplate('notificationTemplates', templateName, fullData);
    if (!result.found) {
        console.warn(`[Templating] Warning: Template "${templateName}" not found in notification templates.`);
        return `Error: Template "${templateName}" not found. Please check message_templates.json.`;
    }

    if (result.unresolved.length > 0) {
        console.warn(`[TEMPLATE_SLOT_BASI] Template "${templateName}" punya slot tak terisi:`, result.unresolved.slice(0, 5));
        console.warn(`[Templating] Available data keys:`, Object.keys(fullData));
        // #b322: JANGAN siarkan ${slot} MENTAH ke pelanggan — renderTemplate dipakai broadcast MASSAL
        // (reminder/isolir/tenggang/redaman/transfer saldo). message_templates.json prod merge-key &
        // bisa diedit admin, jadi slot yang dicabut dari kode akan mengirim '${jumlah}' apa adanya ke
        // SETIAP penerima. Buang placeholder tak terisi + rapikan spasi, seperti jaring
        // renderResponseTemplateSafe (#b302/#b249). Saat semua slot terisi (normal) hasilnya identik.
        const dibersihkan = String(result.text)
            .replace(/\$\{[^}]+\}/g, '')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/ +\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return expandSpintax(dibersihkan);
    }

    // SPINTAX: variasi isi acak `{a|b|c}` (inert bila template tak memakainya). Setelah slot terisi,
    // teks tak lagi mengandung `${...}` → hanya grup ber-pipe yang diekspansi.
    return expandSpintax(result.text);
}

function renderSystemMessage(templateName, data = {}) {
    const fullData = {
        ...data,
        nama_wifi: global.config?.namaWifi || global.config?.nama || 'WiFi Service',
        nama_bot: global.config?.botName || global.config?.namabot || 'Bot',
        telfon: global.config?.phoneSupport || global.config?.telfon || ''
    };

    const result = templateService.renderCategoryTemplate('systemTemplates', templateName, fullData);
    if (!result.found) {
        console.error(`[Templating] System template "${templateName}" not found`);
        return `System template "${templateName}" not found`;
    }

    return result.text;
}

function errorMessage(type, data = {}) {
    return renderSystemMessage(`error_${type}`, data);
}

function successMessage(type, data = {}) {
    return renderSystemMessage(`success_${type}`, data);
}

function promptMessage(type, data = {}) {
    return renderSystemMessage(`prompt_${type}`, data);
}

function infoMessage(type, data = {}) {
    return renderSystemMessage(`info_${type}`, data);
}

function validationMessage(type, data = {}) {
    return renderSystemMessage(`validation_${type}`, data);
}

function greetingMessage(name) {
    const hour = new Date().getHours();
    let type = 'morning';

    if (hour >= 5 && hour < 11) type = 'morning';
    else if (hour >= 11 && hour < 15) type = 'afternoon';
    else if (hour >= 15 && hour < 18) type = 'evening';
    else type = 'night';

    return renderSystemMessage(`greeting_${type}`, { nama: name });
}

function renderReport(reportType, data = {}) {
    const templateName = `report_${reportType}`;
    const { adminWaLink, nomor_admin } = getAdminContactData();
    const fullData = {
        ...data,
        nama_wifi: global.config?.namaWifi || global.config?.nama || 'WiFi Service',
        nama_bot: global.config?.botName || global.config?.namabot || 'Bot',
        telfon: global.config?.phoneSupport || global.config?.telfon || '',
        admin_contact: global.config?.adminPhone || global.config?.ownerNumber?.[0] || '',
        adminWaLink,
        nomor_admin
    };

    const result = templateService.renderCategoryTemplate('reportTemplates', templateName, fullData);
    if (!result.found) {
        console.error(`[Templating] Report template "${templateName}" not found`);
        return `Report template "${templateName}" not found`;
    }

    return result.text;
}

function renderMenu(menuType, data = {}) {
    const templateName = `menu_${menuType}`;
    const { adminWaLink, nomor_admin } = getAdminContactData();
    const fullData = {
        icon_tagihan: '💰',
        icon_saldo: '💳',
        icon_lapor: '📢',
        icon_tiket: '🎟️',
        icon_wifi: '📶',
        icon_nama: '✏️',
        icon_password: '🔐',
        icon_history: '📜',
        icon_speed: '🚀',
        icon_admin: '👨‍💼',
        icon_help: '❓',
        icon_info: 'ℹ️',
        icon_list: '📋',
        icon_add: '➕',
        icon_edit: '✏️',
        icon_delete: '🗑️',
        icon_isolir: '🔌',
        icon_payment: '💵',
        icon_report: '📊',
        icon_assign: '👤',
        icon_close: '❌',
        icon_broadcast: '📢',
        icon_config: '⚙️',
        icon_backup: '💾',
        icon_log: '📝',
        icon_restart: '🔄',
        icon_process: '⚡',
        icon_otw: '🚗',
        icon_arrive: '📍',
        icon_working: '🔧',
        icon_complete: '✅',
        icon_reboot: '🔄',
        icon_power: '🔋',
        icon_redaman: '📡',
        icon_stats: '📈',
        ...data,
        nama_wifi: global.config?.namaWifi || global.config?.nama || 'WiFi Service',
        nama_bot: global.config?.botName || global.config?.namabot || 'Bot',
        telfon: global.config?.phoneSupport || global.config?.telfon || '',
        adminWaLink,
        nomor_admin
    };

    const result = templateService.renderCategoryTemplate('menuTemplates', templateName, fullData);
    if (!result.found) {
        console.error(`[Templating] Menu template "${templateName}" not found`);
        return `Menu template "${templateName}" not found`;
    }

    return result.text;
}

module.exports = {
    renderTemplate,
    renderSystemMessage,
    renderMenu,
    renderReport,
    errorMessage,
    successMessage,
    promptMessage,
    infoMessage,
    validationMessage,
    greetingMessage,
    formatBankAccounts,
    templatesCache
};
