/**
 * Header Doc
 * Purpose: Menilai apakah sebuah modem masih hidup berdasarkan `_lastInform` GenieACS.
 * Caller: `lib/reboot-followup-service.js`, `message/handlers/smart-report-text-menu.js`.
 * Deps: `./genieacs` (getDeviceById, getGenieAcsConfig).
 * MainFuncs: `isDeviceOnline`, `getDeviceLastInform`, `getDeviceOfflineMessage`.
 * SideEffects: Panggilan HTTP ke NBI GenieACS. Tidak pernah throw.
 */
const { getDeviceById, getGenieAcsConfig } = require('./genieacs');

// !! AMBANG INI HARUS BEBERAPA KALI INTERVAL INFORM, BUKAN "beberapa menit" (#b257).
// Terukur di ACS produksi 2026-08-24, 160 modem: SEMUANYA disetel
// `PeriodicInformInterval = 900 detik (15 menit)`, dan umur `_lastInform` bermedian 9,7 menit.
// Berapa banyak modem SEHAT yang lolos, per ambang:
//
//     5 menit  ->  33/160 (21%)      15 menit -> 158/160 (99%)
//     7 menit  ->  49/160 (31%)      20 menit -> 158/160 (99%)
//    10 menit  ->  96/160 (60%)      30 menit -> 158/160 (99%)
//
// Bawaan LAMA 5 menit karena itu memvonis MATI 79% modem yang sehat sempurna. Dua modem sisanya
// memang benar-benar hilang (266 menit dan 48 hari) — jadi menaikkan ambang TIDAK menyembunyikan
// modem mati, ia cuma berhenti memfitnah modem hidup.
//
// Dipilih 30 menit = DUA siklus inform penuh + kelonggaran. Modem yang melewatkan dua siklus
// berturut memang patut dicurigai; yang melewatkan satu siklus itu normal.
//
// Pelajaran ini sudah pernah dibayar sekali: `reboot-followup-service.js` mencatat "ambang 7 menit
// dulu hanya mengenali 7% modem sehat" dan menaikkan gerbangnya ke 45 menit — tapi perbaikannya
// tak ikut ke sini, sehingga jalur PELANGGAN tetap memakai angka yang sudah terbukti salah.
const DEFAULT_MAX_INFORM_MINUTES = 30;

/**
 * Apakah modem masih hidup menurut `_lastInform`.
 *
 * !! "Inform basi" BUKAN "modem mati" — ia cuma berarti modem belum menyapa lagi. Bukti kuat
 * bahwa modem hidup adalah connection request yang dijawab (HTTP 200), dan itu terbukti berhasil
 * pada modem yang inform-nya 13,7 menit lalu: dijawab dalam 4,4 detik. Jangan pakai fungsi ini
 * sebagai satu-satunya dasar untuk memberi tahu pelanggan bahwa perangkatnya mati.
 *
 * @param {string} deviceId - Device ID
 * @param {number} maxMinutes - Batas umur inform (bawaan: DEFAULT_MAX_INFORM_MINUTES, terukur)
 * @returns {Promise<{online: boolean, lastInform: Date|null, minutesAgo: number|null}>}
 */
async function isDeviceOnline(deviceId, maxMinutes = DEFAULT_MAX_INFORM_MINUTES) {
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
    DEFAULT_MAX_INFORM_MINUTES,
    isDeviceOnline,
    getDeviceLastInform,
    getDeviceOfflineMessage
};
