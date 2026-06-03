/**
 * Header Doc
 * Purpose: Handler riwayat perubahan WiFi pelanggan via command WhatsApp (intent HISTORY_WIFI).
 * Caller: Dispatcher bot pada intent history WiFi.
 * Deps: `../../lib/wifi-logger`, `../../lib/jid-utils`, `./template-helpers` (renderResponseTemplate).
 * MainFuncs: `handleHistoryWifi`.
 * SideEffects: Membaca log perubahan WiFi dan mengirim reply WhatsApp.
 */
const { getWifiChangeLogs } = require('../../lib/wifi-logger');
const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { renderResponseTemplate } = require('./template-helpers');

/**
 * Handle HISTORY_WIFI intent - Show WiFi change history
 */
async function handleHistoryWifi(sender, reply, global, msg, raf) {
    try {
        const resolved = await resolveCustomerBySender({
            users: global.users || [],
            sender,
            msg,
            raf
        });
        const user = resolved.user;

        if (sender.endsWith('@lid') && !user) {
            console.log('[HISTORY_WIFI] @lid format detected, user not found');
            return reply(renderResponseTemplate(
                'wifi_history_lid_not_registered',
                '❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.'
            ));
        }

        if (!user) {
            return reply(renderResponseTemplate(
                'wifi_history_not_registered',
                '❌ Maaf, nomor Anda tidak terdaftar sebagai pelanggan.'
            ));
        }

        const result = await getWifiChangeLogs({
            userId: user.id,
            limit: 10
        });

        const logs = result.logs || [];

        if (!logs || logs.length === 0) {
            return reply(renderResponseTemplate(
                'wifi_history_empty',
                '📋 Tidak ada history perubahan WiFi untuk akun Anda.'
            ));
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
                message += `   Password: *${log.changes.newPassword}*\n`;
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
        reply(renderResponseTemplate(
            'wifi_history_error',
            '❌ Maaf, terjadi kesalahan saat mengambil history WiFi.'
        ));
    }
}

module.exports = {
    handleHistoryWifi
};
