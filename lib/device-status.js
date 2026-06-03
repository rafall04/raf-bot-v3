const { getDeviceById, getGenieAcsConfig } = require('./genieacs');

/**
 * Check if device is online based on last inform time
 * @param {string} deviceId - Device ID
 * @param {number} maxMinutes - Maximum minutes since last inform (default: 5)
 * @returns {Promise<{online: boolean, lastInform: Date|null, minutesAgo: number|null}>}
 */
async function isDeviceOnline(deviceId, maxMinutes = 5) {
    try {
        const deviceIdStr = String(deviceId);
        const genieAcsConfig = getGenieAcsConfig();

        if (!deviceIdStr || deviceIdStr.startsWith('DEVICE-')) {
            console.log(`[isDeviceOnline] Skipping check - Mock mode or invalid device ID: ${deviceIdStr}`);
            return {
                online: null,
                lastInform: null,
                minutesAgo: null,
                mockMode: true
            };
        }

        if (!genieAcsConfig.valid) {
            return {
                online: null,
                lastInform: null,
                minutesAgo: null,
                mockMode: true,
                error: 'GENIEACS_CONFIG_INVALID'
            };
        }
        
        const response = await getDeviceById(deviceIdStr, ['_lastInform'], {
            operation: 'device-status.isDeviceOnline',
            timeoutMs: 5000,
        });
        
        if (response.ok && response.data && response.data._lastInform) {
            const lastInform = new Date(response.data._lastInform);
            const now = new Date();
            const diffMinutes = (now - lastInform) / 1000 / 60;
            
            console.log(`[isDeviceOnline] Device ${deviceId}: Last inform ${diffMinutes.toFixed(2)} minutes ago`);
            
            return {
                online: diffMinutes < maxMinutes,
                lastInform: lastInform,
                minutesAgo: Math.round(diffMinutes)
            };
        }
        
        console.warn(`[isDeviceOnline] Device ${deviceId}: No last inform data`);
        return {
            online: false,
            lastInform: null,
            minutesAgo: null
        };
    } catch (error) {
        console.error(`[isDeviceOnline] Error checking device ${deviceId}:`, error.message);
        // If error, assume offline to be safe
        return {
            online: false,
            lastInform: null,
            minutesAgo: null,
            error: error.message
        };
    }
}

/**
 * Get device last inform time
 * @param {string} deviceId - Device ID
 * @returns {Promise<Date|null>} Last inform date or null
 */
async function getDeviceLastInform(deviceId) {
    try {
        const genieAcsConfig = getGenieAcsConfig();
        if (!genieAcsConfig.valid || !deviceId || String(deviceId).startsWith('DEVICE-')) {
            return null;
        }

        const response = await getDeviceById(deviceId, ['_lastInform'], {
            operation: 'device-status.getDeviceLastInform',
            timeoutMs: 5000,
        });
        
        if (response.ok && response.data && response.data._lastInform) {
            return new Date(response.data._lastInform);
        }
        
        return null;
    } catch (error) {
        console.error(`[getDeviceLastInform] Error:`, error.message);
        return null;
    }
}

/**
 * Get formatted offline message for user
 * @param {string} userName - User name
 * @param {number|null} minutesAgo - Minutes since last contact
 * @returns {string} Formatted message
 */
function getDeviceOfflineMessage(userName, minutesAgo = null) {
    const { renderResponseTemplate } = require('./response-template-helper');

    const lastOnlineSection = minutesAgo !== null
        ? `📅 *Terakhir Online:* ${minutesAgo} menit yang lalu\n\n`
        : '';

    // Build fallback (untuk saat responseTemplates belum di-customize admin)
    let fallback = `❌ *Perangkat Offline*\n\n`;
    fallback += `Maaf Kak ${userName}, perangkat Anda sedang tidak terhubung ke sistem.\n\n`;
    fallback += lastOnlineSection;
    fallback += `*Kemungkinan Penyebab:*\n`;
    fallback += `├ Modem mati/tidak ada listrik\n`;
    fallback += `├ Kabel power lepas\n`;
    fallback += `├ Gangguan jaringan\n`;
    fallback += `└ Isolir karena tunggakan\n\n`;
    fallback += `*Solusi:*\n`;
    fallback += `1️⃣ Pastikan modem menyala (lampu indikator nyala)\n`;
    fallback += `2️⃣ Periksa kabel power dan LAN\n`;
    fallback += `3️⃣ Tunggu 5 menit lalu coba lagi\n`;
    fallback += `4️⃣ Pastikan tagihan sudah dibayar\n\n`;
    fallback += `Jika masih bermasalah setelah pengecekan di atas, silakan hubungi teknisi atau ketik *lapor gangguan*.`;

    return renderResponseTemplate(
        'device_offline_message',
        fallback,
        { user_name: userName, last_online_section: lastOnlineSection }
    );
}

module.exports = {
    isDeviceOnline,
    getDeviceLastInform,
    getDeviceOfflineMessage
};
