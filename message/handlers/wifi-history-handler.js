const { getWifiChangeLogs } = require('../../lib/wifi-logger');

/**
 * Handle HISTORY_WIFI intent - Show WiFi change history
 */
async function handleHistoryWifi(sender, reply, global, msg, raf) {
    try {
        let plainSenderNumber = sender.split('@')[0].split(':')[0];

        // Ekstraksi JID (nomor asli opsional) jika tersembunyi
        let optionalJid = null;
        if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
            optionalJid = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
            plainSenderNumber = optionalJid;
        } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
            optionalJid = msg.participant.split('@')[0].split(':')[0];
            plainSenderNumber = optionalJid;
        }

        const user = global.users.find(u => {
            if (u.lid && u.lid === sender) return true;
            if (!u.phone_number) return false;
            const phones = u.phone_number.split('|').map(p => p.trim());
            return phones.some(phone => {
                if (phone === plainSenderNumber || phone === sender) return true;
                let pClean = phone.replace(/[^0-9]/g, '');
                let sClean = plainSenderNumber.replace(/[^0-9]/g, '');
                if (pClean.startsWith('62')) pClean = pClean.substring(2);
                if (pClean.startsWith('0')) pClean = pClean.substring(1);
                if (sClean.startsWith('62')) sClean = sClean.substring(2);
                if (sClean.startsWith('0')) sClean = sClean.substring(1);
                return pClean === sClean;
            });
        });
        if (sender.endsWith('@lid') && !user) {
            console.log('[HISTORY_WIFI] @lid format detected, user not found');
            return reply(`❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`);
        }

        if (!user) {
            return reply('❌ Maaf, nomor Anda tidak terdaftar sebagai pelanggan.');
        }

        // Get logs for this user
        const result = await getWifiChangeLogs({
            userId: user.id,
            limit: 10
        });

        // getWifiChangeLogs returns an object with logs property
        const logs = result.logs || [];

        if (!logs || logs.length === 0) {
            return reply('📋 Tidak ada history perubahan WiFi untuk akun Anda.');
        }

        let message = '📋 *HISTORY PERUBAHAN WIFI*\n';
        message += `👤 *Pelanggan:* ${user.name}\n`;
        message += `📱 *Device:* ${user.device_id}\n`;
        message += '━━━━━━━━━━━━━━━━━━━━\n\n';

        logs.forEach((log, index) => {
            const date = new Date(log.timestamp);
            const dateStr = date.toLocaleDateString('id-ID');
            const timeStr = date.toLocaleTimeString('id-ID');

            message += `*${index + 1}. ${dateStr} - ${timeStr}*\n`;

            if (log.changeType === 'ssid_name') {
                message += `   📡 *Ganti Nama WiFi*\n`;
                message += `   Lama: _${log.changes.oldSsidName || 'Unknown'}_\n`;
                message += `   Baru: *${log.changes.newSsidName}*\n`;
                if (log.changes.ssidId) {
                    message += `   SSID: ${log.changes.ssidId}\n`;
                }
            } else if (log.changeType === 'password') {
                message += `   🔑 *Ganti Password WiFi*\n`;
                message += `   Password: *${log.changes.newPassword}*\n`;  // Show actual password
                if (log.changes.ssidId) {
                    message += `   SSID: ${log.changes.ssidId}\n`;
                } else if (log.changes.ssidIds) {
                    message += `   SSIDs: ${log.changes.ssidIds}\n`;
                }
            }

            message += `   Oleh: ${log.changedBy}\n`;
            if (log.notes) {
                message += `   Info: ${log.notes}\n`;
            }
            message += '\n';
        });

        message += '━━━━━━━━━━━━━━━━━━━━\n';
        message += '💡 _Menampilkan 10 perubahan terakhir_';

        reply(message);

    } catch (error) {
        console.error('[HISTORY_WIFI] Error:', error);
        reply('❌ Maaf, terjadi kesalahan saat mengambil history WiFi.');
    }
}

module.exports = {
    handleHistoryWifi
};
