/**
 * Header Doc
 * Purpose: Mengirim notifikasi PSB ke calon pelanggan pada fase registrasi, instalasi, dan keberangkatan teknisi.
 * Caller: Flow PSB, provisioning, dan proses operasional instalasi pelanggan baru.
 * Deps: `./templating`, `./whatsapp-delivery-service`, `./whatsapp-gateway`, dan `./template-service`.
 * MainFuncs: `sendPSBPhase1Notification`, `sendPSBPhase2Notification`, `sendPSBTeknisiMeluncurNotification`, `sendPSBInstallationCompleteNotification`.
 * SideEffects: Mengirim pesan WhatsApp ke calon pelanggan berdasarkan template PSB.
 */

const { renderTemplate } = require('./templating');
const { sendMessage } = require('./whatsapp-delivery-service');
const { isReady } = require('./whatsapp-gateway');
const { renderResponseTemplateSafe } = require('./template-service');

function renderResponseTemplate(key, data = {}) {
    // Jaring pengaman terpusat (#b302): buang ${slot} tak terisi + peringatkan, jangan bocor mentah.
    return renderResponseTemplateSafe(key, data);
}

/**
 * Normalize phone number to WhatsApp JID format
 * @param {string} phone - Phone number
 * @returns {string|null} - JID format atau null jika invalid
 */
function normalizePhoneToJID(phone) {
    if (!phone) return null;
    
    let phoneNum = phone.trim().replace(/[^0-9]/g, '');
    
    if (phoneNum.startsWith('0')) {
        phoneNum = '62' + phoneNum.substring(1);
    } else if (!phoneNum.startsWith('62')) {
        phoneNum = '62' + phoneNum;
    }
    
    return `${phoneNum}@s.whatsapp.net`;
}

async function deliverPsbText(phoneJid, message, contextLabel) {
    const delivery = await sendMessage(phoneJid, { text: message });
    if (delivery.sent) {
        return true;
    }

    console.error('[SEND_MESSAGE_ERROR]', {
        phoneJid,
        error: delivery.warning || delivery.errorCode || 'SEND_FAILED'
    });
    console.error(`[PSB_NOTIF] Failed to send ${contextLabel}:`, delivery.warning || delivery.errorCode || 'SEND_FAILED');
    return false;
}

/**
 * Send WhatsApp notification setelah PSB Phase 1 (Data Awal)
 * @param {Object} user - User object dengan data pelanggan
 * @returns {Promise<boolean>} - True jika berhasil, false jika gagal
 */
async function sendPSBPhase1Notification(user) {
    // PENTING: Cek connection state sesuai rules
    if (!isReady()) {
        console.warn('[PSB_NOTIF] WhatsApp not connected, skipping Phase 1 notification');
        return false;
    }
    
    if (!user || !user.phone_number) {
        console.warn('[PSB_NOTIF] User or phone number missing for Phase 1 notification');
        return false;
    }
    
    // Render template dengan data
    const message = renderTemplate('psb_phase1_registered', {
        nama_pelanggan: user.name || 'Pelanggan',
        customer_id: user.id || '-',
        no_hp: user.phone_number || '-',
        alamat: user.address || '-',
        nama_wifi: global.config?.company?.name || global.config?.nama_wifi || 'RAF NET'
    });
    
    try {
        const phoneJid = normalizePhoneToJID(user.phone_number);
        if (!phoneJid) {
            console.error(`[PSB_NOTIF] Invalid phone number: ${user.phone_number}`);
            return false;
        }
        
        const sent = await deliverPsbText(phoneJid, message, 'Phase 1 notification');
        if (sent) {
            console.log(`[PSB_NOTIF] Phase 1 notification sent to ${user.phone_number}`);
        }
        return sent;
    } catch (error) {
        console.error(`[PSB_NOTIF] Error in sendPSBPhase1Notification:`, error);
        return false;
    }
}

/**
 * Send WhatsApp notification setelah PSB Phase 2 (Konfigurasi Modem)
 * @param {Object} user - User object dengan data pelanggan
 * @param {Object} config - Konfigurasi koneksi { pppoe_username, pppoe_password, wifi_ssid, wifi_password }
 * @returns {Promise<boolean>} - True jika berhasil, false jika gagal
 */
async function sendPSBPhase2Notification(user, config) {
    // PENTING: Cek connection state sesuai rules
    if (!isReady()) {
        console.warn('[PSB_NOTIF] WhatsApp not connected, skipping Phase 2 notification');
        return false;
    }
    
    if (!user || !user.phone_number) {
        console.warn('[PSB_NOTIF] User or phone number missing for Phase 2 notification');
        return false;
    }
    
    if (!config || !config.pppoe_username || !config.wifi_ssid || !config.wifi_password) {
        console.warn('[PSB_NOTIF] Missing config data for Phase 2 notification');
        return false;
    }
    
    // Get portal URL from config
    const portalUrl = global.config?.welcomeMessage?.customerPortalUrl || 
                      global.config?.company?.website || 
                      global.config?.site_url_bot || 
                      'https://rafnet.my.id/customer';
    
    // STARVASI DATA — slot `username`/`password` (KREDENSIAL PPPoE) SENGAJA tidak dioper.
    //
    // Ini ranjau paling licin di jalur pelanggan. Template `psb_welcome` sekarang kebetulan
    // belum memakainya, TAPI template tetangganya `customer_welcome` memakai blok
    // `👤 *Username:* ${username}` / `🔑 *Password:* ${password}` untuk kredensial PORTAL.
    // Admin yang menyalin blok "detail login" itu ke `psb_welcome` akan diam-diam menerbitkan
    // username + password PPPoE — pelanggan lalu mencoba login portal dengan itu dan gagal,
    // sementara kredensial jaringannya sudah tersebar di chat.
    //
    // Jalur kembarnya sudah benar dan jadi acuan: `services/api-users/create-user-persist.js`
    // merender key `psb_welcome` yang SAMA tanpa mengoper username/password sama sekali.
    // Kalau suatu saat kredensial PORTAL memang perlu, oper dengan nama slot yang tak bisa
    // keliru (`portal_username`/`portal_password`), bukan `username`/`password`.
    const message = renderTemplate('psb_welcome', {
        nama_pelanggan: user.name || 'Pelanggan',
        wifi_ssid: config.wifi_ssid,
        wifi_password: config.wifi_password,
        nama_paket: user.subscription || '-',
        portal_url: portalUrl
    });
    
    try {
        const phoneJid = normalizePhoneToJID(user.phone_number);
        if (!phoneJid) {
            console.error(`[PSB_NOTIF] Invalid phone number: ${user.phone_number}`);
            return false;
        }
        
        const sent = await deliverPsbText(phoneJid, message, 'Phase 2 notification');
        if (sent) {
            console.log(`[PSB_NOTIF] Phase 2 notification sent to ${user.phone_number}`);
        }
        return sent;
    } catch (error) {
        console.error(`[PSB_NOTIF] Error in sendPSBPhase2Notification:`, error);
        return false;
    }
}

/**
 * Send WhatsApp notification saat teknisi meluncur ke lokasi
 * @param {Object} psbRecord - PSB record dengan data pelanggan
 * @param {Object} teknisiInfo - Info teknisi { name, phone_number }
 * @returns {Promise<boolean>} - True jika berhasil, false jika gagal
 */
async function sendPSBTeknisiMeluncurNotification(psbRecord, teknisiInfo) {
    // PENTING: Cek connection state sesuai rules
    if (!isReady()) {
        console.warn('[PSB_NOTIF] WhatsApp not connected, skipping teknisi meluncur notification');
        return false;
    }
    
    if (!psbRecord || !psbRecord.phone_number) {
        console.warn('[PSB_NOTIF] PSB record or phone number missing for teknisi meluncur notification');
        return false;
    }
    
    if (!teknisiInfo || !teknisiInfo.name) {
        console.warn('[PSB_NOTIF] Teknisi info missing for teknisi meluncur notification');
        return false;
    }
    
    // Get teknisi phone for contact
    const teknisiPhone = (() => {
        if (!teknisiInfo.phone_number) return null;
        let phone = teknisiInfo.phone_number.replace(/[^0-9]/g, '');
        if (phone.startsWith('0')) {
            return '62' + phone.substring(1);
        } else if (!phone.startsWith('62')) {
            return '62' + phone;
        }
        return phone;
    })();
    
    const teknisiPhoneSection = teknisiPhone
        ? renderResponseTemplate('psb_teknisi_phone_section', { technicianPhone: teknisiPhone })
        : '';
    
    // Get estimation time from config
    const estimationTime = (global.config && global.config.teknisiWorkingHours && global.config.teknisiWorkingHours.psbEstimationTime) 
        ? global.config.teknisiWorkingHours.psbEstimationTime 
        : '30-60 menit';
    
    // Render template dengan data
    const message = renderTemplate('psb_teknisi_meluncur', {
        nama_pelanggan: psbRecord.name || 'Pelanggan',
        customer_id: psbRecord.id || '-',
        teknisi_name: teknisiInfo.name,
        teknisi_phone_section: teknisiPhoneSection,
        estimasi_waktu: estimationTime,
        alamat: psbRecord.address || '-',
        nama_wifi: global.config?.company?.name || global.config?.nama_wifi || 'RAF NET'
    });
    
    try {
        const phoneJid = normalizePhoneToJID(psbRecord.phone_number);
        if (!phoneJid) {
            console.error(`[PSB_NOTIF] Invalid phone number: ${psbRecord.phone_number}`);
            return false;
        }
        
        const sent = await deliverPsbText(phoneJid, message, 'teknisi meluncur notification');
        if (sent) {
            console.log(`[PSB_NOTIF] Teknisi meluncur notification sent to ${psbRecord.phone_number}`);
        }
        return sent;
    } catch (error) {
        console.error(`[PSB_NOTIF] Error in sendPSBTeknisiMeluncurNotification:`, error);
        return false;
    }
}

/**
 * Send WhatsApp notification saat instalasi fisik selesai (Phase 2 - Pemasangan)
 * Dikirim setelah teknisi selesai memasang kabel/perangkat, sebelum setup WiFi
 * @param {Object} psbRecord - PSB record dengan data pelanggan
 * @returns {Promise<boolean>} - True jika berhasil, false jika gagal
 */
async function sendPSBInstallationCompleteNotification(psbRecord) {
    // PENTING: Cek connection state sesuai rules
    if (!isReady()) {
        console.warn('[PSB_NOTIF] WhatsApp not connected, skipping installation complete notification');
        return false;
    }
    
    if (!psbRecord || !psbRecord.phone_number) {
        console.warn('[PSB_NOTIF] PSB record or phone number missing for installation complete notification');
        return false;
    }
    
    // Render template dengan data
    const message = renderTemplate('psb_installation_complete', {
        nama_pelanggan: psbRecord.name || 'Pelanggan',
        customer_id: psbRecord.id || '-',
        nama_wifi: global.config?.company?.name || global.config?.nama_wifi || 'RAF NET'
    });
    
    try {
        const phoneJid = normalizePhoneToJID(psbRecord.phone_number);
        if (!phoneJid) {
            console.error(`[PSB_NOTIF] Invalid phone number: ${psbRecord.phone_number}`);
            return false;
        }
        
        const sent = await deliverPsbText(phoneJid, message, 'installation complete notification');
        if (sent) {
            console.log(`[PSB_NOTIF] Installation complete notification sent to ${psbRecord.phone_number}`);
        }
        return sent;
    } catch (error) {
        console.error(`[PSB_NOTIF] Error in sendPSBInstallationCompleteNotification:`, error);
        return false;
    }
}

module.exports = {
    sendPSBPhase1Notification,
    sendPSBPhase2Notification,
    sendPSBTeknisiMeluncurNotification,
    sendPSBInstallationCompleteNotification,
    normalizePhoneToJID
};

