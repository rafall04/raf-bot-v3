/**
 * Header Doc
 * Purpose: Facade tipis atas `template-service` untuk compat templates (legacy `message_templates.json` + notification channel) dengan API `getTemplate/getAllTemplates/saveTemplate/formatMessage/getMessage` + utility formatter currency/date/time yang dipakai lintas route admin dan notification listener.
 * Caller: `routes/message-templates.js`, `routes/discount.js`, `routes/change-package.js`, `lib/technician-finance-service.js`.
 * Deps: `./template-service`.
 * MainFuncs: `getAllTemplates`, `getTemplate`, `getMessage`, `saveTemplate`, `formatMessage`, `formatCurrency`, `formatDate`, `formatTime`, `buildUserPlaceholders`, `initializeDefaultTemplates`.
 * SideEffects: Membaca/menulis template melalui template-service; `initializeDefaultTemplates` menulis default seed templates saat pertama kali dijalankan.
 */
"use strict";

const templateService = require('./template-service');

function getAllTemplates() {
    return templateService.listCompatTemplates().reduce((result, template) => {
        result[template.id] = template;
        return result;
    }, {});
}

function getTemplate(templateId) {
    return templateService.getCompatTemplate(templateId);
}

function getMessageTemplate(templateId) {
    return getTemplate(templateId);
}

function saveTemplate(templateId, templateData) {
    try {
        templateService.saveCompatTemplate(templateId, templateData);
        return true;
    } catch (error) {
        console.error('[TEMPLATE_HELPER] Error saving template:', error.message);
        return false;
    }
}

function formatCurrency(amount) {
    return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
}

function formatDate(date, style = 'long') {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return d.toLocaleDateString('id-ID', { dateStyle: style });
}

function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return d.toLocaleTimeString('id-ID', {
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta'
    });
}

function formatMessage(template, data) {
    if (!template) {
        return null;
    }

    const enabled = template.enabled !== false;
    if (!enabled) {
        return null;
    }

    const content = template.content || template.template || '';
    if (!content) {
        return null;
    }

    return templateService.renderString(content, data || {}).text;
}

function getMessage(templateId, data, fallbackMessage = null) {
    const template = getTemplate(templateId);
    if (!template) {
        console.warn(`[TEMPLATE_HELPER] Template "${templateId}" not found`);
        return fallbackMessage;
    }

    const message = formatMessage(template, data);
    return message || fallbackMessage;
}

function buildUserPlaceholders(user, additionalData = {}) {
    const now = new Date();

    return {
        customer_name: user.name || '-',
        customer_id: user.id || '-',
        customer_phone: user.phone_number ? user.phone_number.split('|')[0].trim() : '-',
        customer_address: user.address || '-',
        package_name: user.subscription || '-',
        package_price: formatCurrency(user.subscription_price || 0),
        billing_date: global.config?.tanggal_batas_bayar || '-',
        current_date: formatDate(now),
        current_time: formatTime(now),
        company_name: global.config?.company_name || 'RAF NET',
        ...additionalData
    };
}

function initializeDefaultTemplates() {
    const defaults = {
        discount_notification: {
            name: 'Notifikasi Diskon Pelanggan',
            description: 'Dikirim ke pelanggan saat admin memberikan diskon',
            category: 'discount',
            template: `🎉 *SELAMAT! ANDA MENDAPAT DISKON* 🎉

Halo *\${customer_name}*,

Kami dengan senang hati memberitahukan bahwa Anda mendapatkan diskon khusus untuk tagihan internet Anda.

📋 *Detail Diskon:*
• Paket: \${package_name}
• Harga Normal: \${base_price}
• Potongan: \${discount_text}
• *Harga Setelah Diskon: \${final_price}*

📝 *Alasan Diskon:*
\${discount_reason}

⏰ *Berlaku Sampai:*
\${valid_until}

Terima kasih telah menjadi pelanggan setia kami! 🙏

_Pesan ini dikirim otomatis oleh sistem \${company_name}_`,
            placeholders: ['customer_name', 'package_name', 'base_price', 'discount_text', 'final_price', 'discount_reason', 'valid_until', 'company_name'],
            enabled: true
        },
        discount_removed: {
            name: 'Notifikasi Diskon Dihapus',
            description: 'Dikirim ke pelanggan saat diskon dihapus',
            category: 'discount',
            template: `📢 *INFORMASI DISKON* 📢

Halo *\${customer_name}*,

Kami informasikan bahwa diskon untuk akun Anda telah berakhir.

📋 *Detail:*
• Paket: \${package_name}
• Harga Normal: \${package_price}

Tagihan bulan depan akan kembali ke harga normal.

Terima kasih atas pengertiannya.

_Pesan ini dikirim otomatis oleh sistem \${company_name}_`,
            placeholders: ['customer_name', 'package_name', 'package_price', 'company_name'],
            enabled: true
        },
        kasbon_approved: {
            name: 'Notifikasi Kasbon Disetujui',
            description: 'Dikirim ke teknisi saat kasbon disetujui',
            category: 'kasbon',
            template: `✅ *KASBON DISETUJUI* ✅

Halo *\${technician_name}*,

Pengajuan kasbon Anda telah disetujui oleh admin.

💰 *Detail Kasbon:*
• Nominal: \${kasbon_amount}
• Keperluan: \${kasbon_reason}
• Disetujui oleh: \${admin_name}
• Tanggal: \${current_date}

Silakan ambil dana kasbon sesuai prosedur.

_Pesan ini dikirim otomatis oleh sistem \${company_name}_`,
            placeholders: ['technician_name', 'kasbon_amount', 'kasbon_reason', 'admin_name', 'current_date', 'company_name'],
            enabled: true
        },
        kasbon_rejected: {
            name: 'Notifikasi Kasbon Ditolak',
            description: 'Dikirim ke teknisi saat kasbon ditolak',
            category: 'kasbon',
            template: `❌ *KASBON DITOLAK* ❌

Halo *\${technician_name}*,

Mohon maaf, pengajuan kasbon Anda tidak dapat disetujui.

💰 *Detail Kasbon:*
• Nominal: \${kasbon_amount}
• Keperluan: \${kasbon_reason}
• Alasan Penolakan: \${reject_reason}

Silakan hubungi admin untuk informasi lebih lanjut.

_Pesan ini dikirim otomatis oleh sistem \${company_name}_`,
            placeholders: ['technician_name', 'kasbon_amount', 'kasbon_reason', 'reject_reason', 'company_name'],
            enabled: true
        },
        package_changed: {
            name: 'Notifikasi Perubahan Paket',
            description: 'Dikirim ke pelanggan saat paket diubah',
            category: 'package',
            template: `📦 *PERUBAHAN PAKET LANGGANAN* 📦

Halo *\${customer_name}*,

Paket langganan internet Anda telah diubah.

📋 *Detail Perubahan:*
• Paket Lama: \${old_package}
• Paket Baru: \${new_package}
• Harga Baru: \${new_price}
• Berlaku Mulai: \${effective_date}

Perubahan akan aktif segera setelah proses selesai.

Terima kasih telah menggunakan layanan kami.

_Pesan ini dikirim otomatis oleh sistem \${company_name}_`,
            placeholders: ['customer_name', 'old_package', 'new_package', 'new_price', 'effective_date', 'company_name'],
            enabled: true
        }
    };

    Object.entries(defaults).forEach(([id, template]) => {
        if (!getTemplate(id)) {
            templateService.saveCompatTemplate(id, template);
        }
    });

    return getAllTemplates();
}

module.exports = {
    getAllTemplates,
    getTemplate,
    getMessageTemplate,
    saveTemplate,
    formatMessage,
    getMessage,
    formatCurrency,
    formatDate,
    formatTime,
    buildUserPlaceholders,
    initializeDefaultTemplates
};
