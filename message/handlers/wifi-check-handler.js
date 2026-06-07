/**
 * Header Doc
 * Purpose: Handler pengecekan status WiFi/SSID/modem pelanggan lewat perintah WhatsApp; pelanggan reguler auto-lookup, admin/teknisi pakai ID/nama.
 * Caller: Dispatcher bot `message/raf.js` pada intent `CEK_WIFI`.
 * Deps: `../../lib/wifi`, `../../lib/myfunc`, `../../lib/jid-utils`, `./template-helpers` (renderResponseTemplate).
 * MainFuncs: `handleCekWifi`.
 * SideEffects: Query GenieACS untuk info SSID/uptime dan mengirim reply WhatsApp.
 */

const { getSSIDInfo } = require('../../lib/wifi');
const { getProfileBySubscription: _getProfileBySubscription } = require('../../lib/myfunc');
const { getONUInfo: _getONUInfo } = require('../../lib/wifi');
const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { renderResponseTemplate } = require('./template-helpers');

/**
 * Handle cek WiFi status
 */
async function handleCekWifi({ sender, args, matchedKeywordLength, isOwner, isTeknisi, pushname, users, reply, global, mess, msg, raf }) {
    const resolvedCustomer = await resolveCustomerBySender({ users, sender, msg, raf });
    let plainSenderNumber = resolvedCustomer.phoneNumber || sender.split('@')[0].split(':')[0];

    let user;
    let searchMode = 'direct'; // 'direct', 'by_id', 'by_name'
    let searchQuery = null;
    let providedId = null;

    // Use matchedKeywordLength to determine where the actual arguments start
    // Example: "cek wifi 10" -> keyword is "cek wifi" (2 words), so ID is at args[2]
    const keywordLength = matchedKeywordLength || 2; // Default to 2 for "cek wifi"

    // Debug logging
    console.log('[CEK_WIFI_DEBUG] Sender:', sender);
    console.log('[CEK_WIFI_DEBUG] PlainSenderNumber:', plainSenderNumber);
    console.log('[CEK_WIFI_DEBUG] Users count:', users.length);
    console.log('[CEK_WIFI_DEBUG] isOwner:', isOwner, 'isTeknisi:', !!isTeknisi);
    console.log('[CEK_WIFI_DEBUG] Args:', args);
    console.log('[CEK_WIFI_DEBUG] matchedKeywordLength:', matchedKeywordLength);
    console.log('[CEK_WIFI_DEBUG] keywordLength:', keywordLength);

    // Priority 1: Admin/Teknisi providing an ID
    if ((isOwner || isTeknisi) && args.length > keywordLength && !isNaN(parseInt(args[keywordLength], 10))) {
        searchMode = 'by_id';
        providedId = args[keywordLength];
        user = users.find(v => v.id == providedId);
        console.log('[CEK_WIFI_DEBUG] Search by ID:', providedId, 'Found:', !!user);
    }
    // Priority 2: Admin/Teknisi providing a name to search
    else if ((isOwner || isTeknisi) && args.length > keywordLength && isNaN(parseInt(args[keywordLength], 10))) {
        searchMode = 'by_name';
        searchQuery = args.slice(keywordLength).join(' ').toLowerCase().trim();
        user = users.find(v => v.name && v.name.toLowerCase().includes(searchQuery));
        console.log('[CEK_WIFI_DEBUG] Search by name:', searchQuery, 'Found:', !!user);
    } else {
        user = resolvedCustomer.user;

        console.log('[CEK_WIFI_DEBUG] Search by phone/LID:', plainSenderNumber, 'Found:', !!user);

        // Additional debug if not found
        if (!user && plainSenderNumber) {
            console.log('[CEK_WIFI_DEBUG] No user found for phone/LID:', plainSenderNumber);
            console.log('[CEK_WIFI_DEBUG] Sender format:', sender);

            // Check if it's @lid format - no manual verification needed
            if (sender.endsWith('@lid')) {
                console.log('[CEK_WIFI_DEBUG] This is @lid format - user not registered');
                return reply(renderResponseTemplate(
                    'wifi_check_lid_not_registered',
                    `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
                ));
            }
        }
    }

    if (!user) {
        let errorMessage;

        if (isOwner || isTeknisi) {
            if (providedId) {
                errorMessage = `Maaf, Kak. Pelanggan dengan ID "${providedId}" tidak ditemukan.`;
            } else if (searchQuery) {
                errorMessage = `Maaf, Kak. Pelanggan dengan nama "${searchQuery}" tidak ditemukan.`;
            } else {
                // Owner/teknisi without specifying customer
                // Provide helpful guidance instead of error
                let helpMessage = "📋 **CEK WIFI - Panduan Admin/Teknisi**\n\n";
                helpMessage += "Untuk mengecek WiFi pelanggan, gunakan:\n";
                helpMessage += "• `cek wifi [ID]` - Cek berdasarkan ID\n";
                helpMessage += "• `cek wifi [nama]` - Cek berdasarkan nama\n\n";
                helpMessage += "Contoh:\n";
                helpMessage += "• `cek wifi 1`\n";
                helpMessage += "• `cek wifi John`\n";
                helpMessage += "• `cek wifi Pak Budi`\n\n";
                helpMessage += "💡 Tips: Anda sebagai admin/teknisi tidak terdaftar sebagai pelanggan WiFi.";
                return reply(helpMessage);
            }
        } else {
            // Regular user not registered
            errorMessage = mess.userNotRegister || "Maaf, nomor Anda belum terdaftar sebagai pelanggan. Silakan hubungi admin untuk mendaftar.";
        }

        return reply(errorMessage);
    }

    if (!user.device_id) {
        return reply(renderResponseTemplate(
            'wifi_check_device_missing',
            `Maaf, Kak. Data device ID untuk pelanggan "${user.name || 'ini'}" tidak ditemukan di sistem kami, jadi saya tidak bisa melakukan pengecekan.`,
            { nama_pelanggan: user.name || 'ini' }
        ));
    }

    await reply(renderResponseTemplate(
        'wifi_check_loading',
        "⏳ Sedang mengambil informasi WiFi dan modem Anda, mohon tunggu sebentar..."
    ));

    try {
        // Gateway GenieACS handles refresh + read path internally when skipRefresh=false
        const { uptime, ssid } = await getSSIDInfo(user.device_id, false);

        let ssidInfoText = "";
        let filteredSsids = [];

        if (user.bulk && user.bulk.length > 0) {
            const bulkSsidIds = user.bulk.map(String);
            filteredSsids = ssid.filter(s => {
                return s.id && bulkSsidIds.includes(String(s.id));
            });
        } else {
            filteredSsids = ssid.filter(s => String(s.id) === "1");
        }

        if (filteredSsids.length > 0) {
            ssidInfoText = filteredSsids.map(s_item => {
                let ssidIdentifier = "";
                if (s_item.id) ssidIdentifier = `(SSID ID: ${s_item.id})`;
                else ssidIdentifier = "(Band Tidak Diketahui)";

                let devicesConnectedText = "  Tidak ada perangkat terhubung ke SSID ini.";
                if (s_item.associatedDevices && s_item.associatedDevices.length > 0) {
                    devicesConnectedText = `  *Daftar Perangkat Terhubung (${s_item.associatedDevices.length}):*\n` +
                        s_item.associatedDevices.map((d, index) =>
                            `    ${index + 1}. ${d.hostName || "Tanpa Nama"} (IP: ${d.ip || "-"}) Sinyal: ${d.signal ? d.signal + " dBm" : "-"}`
                        ).join("\n");
                }

                return `📶 *Detail SSID: "${s_item.name || 'N/A'}"* ${ssidIdentifier}\n` +
                    `   ⚡ *Transmit Power:* ${s_item.transmitPower ? s_item.transmitPower + "%" : "Tidak Terbaca"}\n` +
                    `${devicesConnectedText}`;
            }).join("\n\n-----------------------------------\n");
        } else {
            ssidInfoText = "Informasi SSID tidak tersedia atau tidak dapat diambil untuk konfigurasi Anda saat ini.";
        }

        const namaPelangganTampil = user.name || pushname;
        const namaLayanan = global.config.nama || "Layanan Kami";
        const botNama = global.config.namabot || "Bot Asisten";

        const messageReply = `📡 *STATUS MODEM ANDA - ${namaLayanan}* 📡\n\nHalo Kak ${namaPelangganTampil}! Berikut adalah informasi modem Anda:\n\n⏱️ *Uptime Perangkat:* ${uptime || "Tidak terbaca"}\n-----------------------------------\n${ssidInfoText}\n-----------------------------------\n\n💡 *Tips Singkat:*\n- Jika ada perangkat dengan sinyal lemah (misalnya, di bawah -75 dBm), coba dekatkan perangkat ke modem atau periksa penghalang sinyal.\n- Jika mengalami kendala, Anda dapat mencoba me-restart modem dengan kalimat "reboot modem saya" atau melaporkannya dengan "lapor wifi saya lemot".\n\nJika ada pertanyaan lebih lanjut, jangan ragu untuk menghubungi saya lagi ya!\n\nTerima kasih,\nTim ${botNama}`;

        await reply(messageReply);

    } catch (e) {
        console.error(`[CEK_WIFI_ERROR] Gagal mengambil info WiFi untuk ${user.name} (Device ID: ${user.device_id}):`, e);

        let userFriendlyError = `*MAAF, TERJADI KESALAHAN!* 😟\n\nTidak dapat mengambil informasi modem untuk pelanggan "${user.name || 'ini'}" saat ini.\nKemungkinan penyebab:\n- Modem sedang offline atau tidak terjangkau.\n- Ada gangguan pada sistem pemantauan.`;

        if (e.response && e.response.status === 404) {
            userFriendlyError += `\n- Device ID tidak ditemukan di sistem.\n\n📞 *Hubungi admin untuk bantuan lebih lanjut.*`;
        } else {
            userFriendlyError += `\n\nSilakan coba lagi beberapa saat atau hubungi admin jika masalah berlanjut.`;
        }

        await reply(userFriendlyError);
    }
}

module.exports = {
    handleCekWifi
};
