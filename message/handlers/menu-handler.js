/**
 * Menu Handler
 * Menangani semua tampilan menu
 */

const { wifimenu, menupaket, menubelivoucher, menupasang, menuowner, technicianmenu } = require('../wifi');
const templateManager = require('../../lib/template-manager');

/**
 * Handle main menu
 */
function handleMenuUtama(config, reply, pushname, sender) {
    reply(wifimenu(config.nama, config.namabot, pushname, sender));
}

/**
 * Handle teknisi menu
 */
function handleMenuTeknisi(config, reply, pushname, sender) {
    reply(technicianmenu(config.nama, config.namabot, pushname, sender));
}

/**
 * Handle owner menu
 */
function handleMenuOwner(config, isOwner, reply, pushname, sender) {
    if (!isOwner) throw mess.owner;
    reply(menuowner(config.nama, config.namabot, pushname, sender));
}

/**
 * Handle cara pasang menu
 */
function handleTanyaCaraPasang(config, reply, pushname, sender) {
    reply(menupasang(config.nama, config.namabot, pushname, sender));
}

/**
 * Handle paket bulanan menu
 */
function handleTanyaPaketBulanan(config, reply, pushname, sender) {
    reply(menupaket(config.nama, config.namabot, pushname, sender));
}

/**
 * Handle tutorial topup
 */
function handleTutorialTopup(config, reply, pushname, sender) {
    reply(menubelivoucher(config.nama, config.namabot, pushname, sender));
}

/**
 * Handle customer menu
 */
function handleMenuPelanggan(config, reply, pushname, sender) {
    // Try to use template first
    if (templateManager.hasTemplate('menu_pelanggan')) {
        const message = templateManager.getTemplate('menu_pelanggan', {
            pushname: pushname,
            sender: sender,
            phone: sender?.replace('@s.whatsapp.net', '')
        });
        reply(message);
    } else {
        // Fallback to hardcoded menu
        const namaLayanan = config.nama || "Layanan Kami";
        const namaBot = config.namabot || "Bot Kami";
        
        const menuText = `📱 *MENU PELANGGAN ${namaLayanan.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━

📋 *LAYANAN GANGGUAN*
• *lapor* - Laporkan gangguan
• *cektiket [ID]* - Cek status tiket
• *batalkantiket [ID]* - Batalkan tiket

🚀 *SPEED BOOST*
• *speedboost* - Request speed boost
• *cekspeed* - Cek status boost

💳 *TAGIHAN & PAKET*
• *cektagihan* - Cek status tagihan
• *ubahpaket* - Ubah paket langganan

🔧 *PENGATURAN WIFI*
• *gantinama* - Ubah nama WiFi
• *gantisandi* - Ubah password WiFi
• *cekwifi* - Info WiFi Anda
• *reboot* - Restart modem

📞 *BANTUAN*
• *admin* - Hubungi admin
• *bantuan* - Panduan lengkap

━━━━━━━━━━━━━━━━━━━
_${namaBot} - Siap membantu Anda 24/7_`;
    
        reply(menuText);
    }
}

module.exports = {
    handleMenuUtama,
    handleMenuTeknisi,
    handleMenuOwner,
    handleTanyaCaraPasang,
    handleTanyaPaketBulanan,
    handleTutorialTopup,
    handleMenuPelanggan
};
