/**
 * WiFi Power Management Handler
 * Handles WiFi transmit power adjustments
 */

const axios = require('axios');

/**
 * Handle WiFi power change
 */
async function handleGantiPowerWifi({ sender, args, matchedKeywordLength, q, isOwner, isTeknisi, users, reply, global, mess, msg, raf }) {
    try {
        let user;

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
            let plainSenderNumber = sender.split('@')[0].split(':')[0];

            let optionalJid = null;
            if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
                optionalJid = msg.key.remoteJidAlt.split('@')[0].split(':')[0];
                plainSenderNumber = optionalJid;
            } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
                optionalJid = msg.participant.split('@')[0].split(':')[0];
                plainSenderNumber = optionalJid;
            }

            user = users.find(u => {
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

            // Power value is after the keyword
            q = args.slice(keywordLength).join(' ').trim();
        }

        if (!user) {
            const errorMessage = (isOwner || isTeknisi)
                ? (providedId ? `Maaf, Kak. Pelanggan dengan ID "${providedId}" tidak ditemukan.` : mess.notRegister)
                : mess.userNotRegister;
            throw errorMessage;
        }

        if (user.subscription == 'PAKET-VOUCHER') {
            throw mess.onlyMonthly;
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
