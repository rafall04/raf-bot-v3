/**
 * WiFi Power Management Handler
 * Handles WiFi transmit power adjustments
 */

const axios = require('axios');
const { resolveCustomerBySender } = require('../../lib/jid-utils');

/**
 * Handle WiFi power change
 */
async function handleGantiPowerWifi({ sender, args, matchedKeywordLength, q, isOwner, isTeknisi, users, reply, global, mess, msg, raf }) {
    try {
        let user;
        let plainSenderNumber;

        // Use matchedKeywordLength to determine where the actual arguments start
        // Example: "ganti power wifi 10 80" -> keyword is "ganti power wifi" (3 words), so ID is at args[3]
        const keywordLength = matchedKeywordLength || 3; // Default to 3 for "ganti power wifi"

        // Check if admin/teknisi is providing an ID
        const potentialId = args[keywordLength];
        const providedId = (isOwner || isTeknisi) && potentialId && !isNaN(parseInt(potentialId, 10)) ? potentialId : null;

        console.log('[WIFI_POWER_DEBUG] Args:', args);
        console.log('[WIFI_POWER_DEBUG] matchedKeywordLength:', matchedKeywordLength);
        console.log('[WIFI_POWER_DEBUG] keywordLength:', keywordLength);
        console.log('[WIFI_POWER_DEBUG] potentialId:', potentialId);
        console.log('[WIFI_POWER_DEBUG] providedId:', providedId);

        // Admin/Teknisi dapat menyebutkan ID pelanggan
        if (providedId) {
            user = users.find(v => v.id == providedId);
            // Power value is after the ID
            q = args.slice(keywordLength + 1).join(' ').trim();
        } else {
            const resolved = await resolveCustomerBySender({ users, sender, msg, raf });
            user = resolved.user;
            plainSenderNumber = resolved.plainSenderNumber;

            // Power value is after the keyword
            q = args.slice(keywordLength).join(' ').trim();
        }
        if (!user) {
            const errorMessage = (isOwner || isTeknisi)
                ? (providedId ? `Maaf, Kak. Pelanggan dengan ID "${providedId}" tidak ditemukan.` : "Anda belum terdaftar sebagai pelanggan. Untuk mengatur power wifi pelanggan lain, sebutkan ID pelanggannya.")
                : mess.userNotRegister;
            return reply(errorMessage);
        }
        if (user.subscription === 'PAKET-VOUCHER' && !(isOwner || isTeknisi)) {
            return reply(`Maaf Kak, fitur ganti power WiFi saat ini hanya tersedia untuk pelanggan bulanan.`);
        }

        if (!user.device_id) {
            return reply(`Maaf Kak, data device ID untuk pelanggan ini tidak ditemukan.`);
        }

        if (!q) {
            throw `Silahkan Isi Berapa Power Wifi\n\nContoh : gantipower 80\n\nFungsi : Untuk Mengatur Luas Jangkauan Wifi\n\nNB : Untuk Power Hanya Bisa Diisi 100, 80, 60, 40, 20.`;
        }

        if (!['100', '80', '60', '40', '20'].includes(q)) {
            throw `*ERROR!*\n\nSilahkan Cek format gantipower dan coba lagi.\n\nTerimakasih\n${global.config.namabot}`;
        }

        // Make API call to GenieACS
        try {
            const response = await axios.post(
                global.config.genieacsBaseUrl + "/devices/" + encodeURIComponent(user.device_id) + "/tasks?connection_request",
                {
                    name: 'setParameterValues',
                    parameterValues: [
                        ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TransmitPower", `${q}`, "xsd:string"]
                    ]
                }
            );

            console.log('[WIFI_POWER] Success:', response.data);
            await reply(`Power Wifi Berhasil Dirubah Ke :\n\n==================================\n${q}%\n==================================\n\n${global.config.namabot}`);

        } catch (error) {
            console.error('[WIFI_POWER] Error:', error);
            await reply(`Gagal Mengubah Power Wifi\n\nSilahkan Cek Format Power Wifi Atau Hubungi Admin\n\nTerimakasih\n\n${global.config.namabot}`);
        }

    } catch (error) {
        if (typeof error === 'string') {
            await reply(error);
        } else {
            console.error('[WIFI_POWER_HANDLER] Unexpected error:', error);
            await reply('Terjadi kesalahan. Silakan coba lagi atau hubungi admin.');
        }
    }
}

module.exports = {
    handleGantiPowerWifi
};
