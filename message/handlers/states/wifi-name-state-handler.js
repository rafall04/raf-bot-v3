/**
 * Header Doc
 * Purpose: Menangani state perubahan nama WiFi berbasis managed conversation state.
 * Caller: `conversation-state-handler.js`.
 * Deps: `lib/wifi`, `lib/wifi-logger`, `conversation-handler`, dan `lib/affirmative-parser`.
 * MainFuncs: `handleSelectChangeMode`, `handleSelectSsidToChange`, `handleAskNewName`, `handleAskNewNameBulkAuto`, `handleConfirmGantiNamaBulk`.
 * SideEffects: Mengubah nama SSID, menulis log perubahan WiFi, dan membersihkan state.
 */

const { setSSIDName, updateWifiSettings } = require('../../../lib/wifi');
const { logWifiChange } = require('../../../lib/wifi-logger');
const { deleteUserState, format } = require('../conversation-handler');
const { formatWifiSsidInfo } = require('../../../lib/wifi-ssid-summary');
const { isAffirmative } = require('../../../lib/affirmative-parser');
const { assertWifiChangeApplied } = require('../../../lib/wifi-apply-guard');
const { bacaSebabGagalWifi, laporkanKegagalanWifiKeAdmin } = require("../../../lib/wifi-failure-reason");

function renderResponseTemplate(key, fallback, data = {}) {
    const rendered = format(key, data);
    return rendered && rendered.trim() ? rendered : fallback;
}

function sanitizePhone(identifier = '') {
    return String(identifier || '')
        .replace('@s.whatsapp.net', '')
        .replace('@lid', '');
}

/**
 * Bangun field log attribution dari userState.actor (kalau ada) — fallback ke `customer`.
 * Memastikan log mencatat siapa benar-benar trigger (customer self / teknisi / owner)
 * dan customerPhone selalu nomor pelanggan, bukan nomor pelaku.
 */
function buildActorLogFields(userState, fallbackSender) {
    const actor = userState?.actor || null;
    const role = actor?.role || 'customer';
    const displayName = actor?.displayName || null;
    const identifier = actor?.identifier || (role === 'customer' ? 'customer' : displayName || role);
    const actorPhone = actor?.phone || sanitizePhone(fallbackSender || '');
    const changedBy = role === 'customer' ? 'customer' : `${role}:${displayName || identifier}`;
    const targetPhone = userState?.targetUser?.phone_number
        ? sanitizePhone(String(userState.targetUser.phone_number).split('|')[0])
        : sanitizePhone(fallbackSender || '');
    return {
        changedBy,
        customerPhone: targetPhone,
        actorRole: role,
        actorIdentifier: identifier,
        actorPhone
    };
}

/**
 * Resolve SSID mana yang harus diubah, dari yang paling spesifik ke paling umum.
 * JANGAN dikunci ke nama step: dulu cabang bulk hanya cocok untuk
 * `CONFIRM_GANTI_NAMA_BULK`, sehingga step `ASK_NEW_NAME_FOR_BULK_AUTO`
 * (dipasang `wifi-management.service.handleBulkAutoNameChange`) jatuh ke `[]`
 * walau `bulk_ssids` terisi → pelanggan selalu dapat "SSID target tidak ditemukan".
 * `bulk_ssids` kini fallback terakhir untuk step bulk apa pun.
 */
function getSelectedSsids(userState) {
    if (userState.selected_ssids && userState.selected_ssids.length) {
        return userState.selected_ssids;
    }
    if (userState.bulk_ssids && userState.selected_ssid_indices?.length) {
        return userState.selected_ssid_indices.map((index) => userState.bulk_ssids[index]);
    }
    if (userState.ssid_id) {
        return [userState.ssid_id];
    }
    if (userState.bulk_ssids?.length) {
        return userState.bulk_ssids;
    }
    return [];
}

async function handleSelectChangeMode(userState, userReply, reply) {
    const choice = userReply.trim();

    if (choice === '1') {
        userState.step = 'SELECT_SSID_TO_CHANGE';
        const ssidList = userState.ssid_info || (userState.bulk_ssids || []).map((id, index) => `${index + 1}. SSID ${id}`).join('\n');
        return reply(renderResponseTemplate(
            'convo_ganti_nama_pilih_satu',
            `Baik, Anda memilih untuk mengubah satu SSID.\n\nBerikut daftar SSID Anda:\n${ssidList}\n\nSilakan balas dengan *nomor* SSID yang ingin Anda ubah (misalnya: \`1\`).`,
            { ssidList }
        ));
    }

    if (choice === '2') {
        userState.selected_ssids = userState.bulk_ssids || [];
        if (userState.nama_wifi_baru) {
            userState.step = 'CONFIRM_GANTI_NAMA_BULK';
            return reply(renderResponseTemplate(
                'convo_ganti_nama_konfirmasi_semua',
                `Siap! Nama untuk *semua SSID* akan diubah menjadi *"${userState.nama_wifi_baru}"*.\n\nSudah benar? Balas *'ya'* untuk melanjutkan.`,
                { nama_wifi_baru: userState.nama_wifi_baru }
            ));
        }
        userState.step = 'ASK_NEW_NAME_FOR_BULK';
        return reply(renderResponseTemplate(
            'convo_ganti_nama_tanya_nama_semua',
            "Oke, Anda memilih untuk mengubah semua SSID sekaligus. Silakan ketik nama WiFi baru yang Anda inginkan."
        ));
    }

    return reply(renderResponseTemplate(
        'convo_ganti_nama_pilihan_tidak_valid',
        'Pilihan tidak valid. Mohon balas dengan angka *1* atau *2*.'
    ));
}

async function handleSelectSsidToChange(userState, userReply, reply) {
    const choiceIndex = parseInt(userReply, 10) - 1;
    const bulkSsids = userState.bulk_ssids || [];

    if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= bulkSsids.length) {
        return reply(renderResponseTemplate(
            'convo_ganti_nama_nomor_ssid_tidak_valid',
            'Nomor SSID tidak valid. Mohon balas dengan nomor yang sesuai dari daftar.'
        ));
    }

    const selectedSsidId = bulkSsids[choiceIndex];
    userState.selected_ssid_indices = [choiceIndex];
    userState.selected_ssids = [selectedSsidId];

    if (userState.nama_wifi_baru) {
        userState.step = 'CONFIRM_GANTI_NAMA_BULK';
        return reply(renderResponseTemplate(
            'convo_ganti_nama_konfirmasi_satu',
            `Baik. Nama untuk *SSID ${selectedSsidId}* akan diubah menjadi *"${userState.nama_wifi_baru}"*.\n\nSudah benar? Balas *'ya'* untuk melanjutkan.`,
            { selectedSsidId, nama_wifi_baru: userState.nama_wifi_baru }
        ));
    }

    userState.step = 'ASK_NEW_NAME_FOR_SINGLE_BULK';
    return reply(renderResponseTemplate(
        'convo_ganti_nama_tanya_nama_satu',
        'Oke. Sekarang, silakan ketik nama WiFi baru yang Anda inginkan untuk SSID tersebut.'
    ));
}

async function handleAskNewName(userState, chats, reply, sender, global) {
    const newName = chats.trim();

    if (newName.length === 0) {
        return reply(renderResponseTemplate('convo_ganti_nama_nama_kosong', 'Nama WiFi tidak boleh kosong ya, Kak. Silakan ketik nama yang baru atau ketik *batal*.'));
    }
    if (newName.length > 32) {
        return reply(renderResponseTemplate('convo_ganti_nama_nama_panjang', 'Wah, nama WiFi-nya terlalu panjang (maksimal 32 karakter). Coba yang lebih pendek ya, atau ketik *batal*.'));
    }
    if (/[^\w\s\-.]/.test(newName)) {
        return reply(renderResponseTemplate('convo_ganti_nama_karakter_tidak_valid', '⚠️ Nama WiFi mengandung karakter yang tidak diperbolehkan. Gunakan hanya huruf, angka, spasi, titik, dan tanda hubung.'));
    }

    userState.nama_wifi_baru = newName;

    if (global?.config?.custom_wifi_modification) {
        if (userState.ssid_id && !userState.bulk_ssids) {
            userState.step = 'CONFIRM_GANTI_NAMA';
            return reply(renderResponseTemplate(
                'wifi_name_confirm_change',
                `Baik. Nama WiFi akan diubah menjadi *"${newName}"*. Sudah benar?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`,
                { newName }
            ));
        }

        userState.step = 'CONFIRM_GANTI_NAMA_BULK';
        if (!userState.selected_ssids?.length && userState.bulk_ssids?.length) {
            userState.selected_ssids = [...userState.bulk_ssids];
        }

        if (userState.selected_ssids?.length === 1) {
            return reply(renderResponseTemplate(
                'convo_ganti_nama_konfirmasi_satu',
                `Siap. Saya konfirmasi ya, nama untuk *SSID ${userState.selected_ssids[0]}* akan diubah menjadi *"${newName}"*. Sudah benar?\n\nBalas *'ya'* untuk melanjutkan.`,
                { selectedSsidId: userState.selected_ssids[0], nama_wifi_baru: newName }
            ));
        }

        return reply(renderResponseTemplate(
            'convo_ganti_nama_konfirmasi_semua',
            `Siap. Saya konfirmasi ya, nama untuk *semua SSID* akan diubah menjadi *"${newName}"*. Sudah benar?\n\nBalas *'ya'* untuk melanjutkan.`,
            { nama_wifi_baru: newName }
        ));
    }

    try {
        const ssidsToChange = getSelectedSsids(userState);
        if (!ssidsToChange.length) {
            throw new Error('SSID target tidak ditemukan.');
        }

        reply(renderResponseTemplate(
            'wifi_apply_in_progress',
            '⏳ Perubahan sedang saya terapkan ke modem, mohon tunggu sebentar ya...'
        ));

        const payload = {};
        if (ssidsToChange.length === 1) {
            const result = await setSSIDName(userState.targetUser.device_id, ssidsToChange[0], newName);
            assertWifiChangeApplied(result);
        } else {
            ssidsToChange.forEach((ssidId) => {
                payload[`ssid_${ssidId}`] = newName;
            });
            const response = await updateWifiSettings(userState.targetUser.device_id, payload, { verifyApplied: true });
            assertWifiChangeApplied(response);
        }

        const actorFields = buildActorLogFields(userState, sender);
        await logWifiChange({
            userId: userState.targetUser.id,
            deviceId: userState.targetUser.device_id,
            changeType: 'ssid_name',
            changes: {
                oldSsidName: userState.ssid_info_old || userState.ssid_info || '(tidak dicatat)',
                newSsidName: newName
            },
            changeSource: 'wa_bot',
            customerName: userState.targetUser.name || 'Customer',
            reason: `WiFi name change via WhatsApp Bot (${ssidsToChange.join(', ')})`,
            notes: ssidsToChange.length > 1 ? `Changed ${ssidsToChange.length} SSIDs` : `Changed SSID ${ssidsToChange[0]}`,
            ipAddress: 'WhatsApp',
            userAgent: 'WhatsApp Bot',
            ...actorFields
        });

        deleteUserState(sender);
        const ssidInfo = formatWifiSsidInfo(ssidsToChange);
        return reply(renderResponseTemplate(
            'wifi_name_change_success',
            `✅ *Berhasil!*\n\nNama WiFi ${ssidInfo}telah diubah menjadi: *"${newName}"*\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• WiFi dengan nama lama akan terputus\n• Silakan cari WiFi dengan nama baru di perangkat Anda\n• Gunakan password yang sama untuk menyambung\n\n💡 Jika ada masalah, hubungi admin untuk bantuan.`,
            { ssidInfo, newName }
        ));
    } catch (error) {
        console.error('[ASK_NEW_NAME] Error:', error);
        deleteUserState(sender);
        // !! SEBAB YANG BENAR, BUKAN SATU PESAN UNTUK SEMUA (#b268). Menyuruh pelanggan memeriksa
        // modem saat SISTEM KAMI yang bermasalah membuat mereka mengurus perangkat yang tidak
        // rusak, gagal lagi, lalu menyimpulkan layanannya rusak — sementara tak ada yang tahu
        // sistem kita sedang bermasalah.
        const sebab = bacaSebabGagalWifi(error);
        // Menepati janji di teks pelanggan ("Tim kami sudah mendapat pemberitahuannya").
        // Never-throw & ber-jeda 30 menit per sebab supaya satu gangguan tak jadi puluhan pesan.
        laporkanKegagalanWifiKeAdmin(sebab, "ganti nama WiFi", userState, error);
        // #b323: pesan JUJUR per-sebab. 'kami' → janji notif (admin memang dinotif). 'belum_terverifikasi'
        // & 'tidak_diketahui' → JANGAN janji notif (admin tak dinotif) & jangan tuduh modem: perubahan
        // mungkin sudah mendarat, minta pelanggan cek lagi.
        const fallbackSebab = sebab.sarankanCekModem
            ? '⚠️ Maaf Kak, perubahannya *belum tersimpan* karena modem di lokasi Kakak sedang tidak merespons. Coba pastikan modem menyala, lalu ulangi beberapa saat lagi 🙏'
            : sebab.pihak === 'kami'
                ? '⚠️ Maaf Kak, perubahannya *belum tersimpan* karena ada kendala di *sistem kami* — bukan dari modem Kakak. Tim kami sudah mendapat pemberitahuannya 🙏'
                : '⚠️ Perubahannya belum bisa kami *pastikan* tersimpan, Kak. Coba cek WiFi-nya beberapa saat lagi; kalau belum berubah, silakan ulangi 🙏';
        return reply(renderResponseTemplate(sebab.kunciTemplate, fallbackSebab, {}));
    }
}

async function handleAskNewNameBulkAuto(userState, chats, reply, sender, global, _axios) {
    return handleAskNewName(userState, chats, reply, sender, global);
}

async function handleConfirmGantiNamaBulk(userState, userReply, reply, sender, _global, _axios) {
    // Ganti nama bisa diulang, jadi cukup afirmasi longgar: "Ok mas" / "ya ka" / "siap" harus lolos.
    // Exact-match sebelumnya menolak mayoritas balasan nyata pelanggan.
    if (!isAffirmative(userReply)) {
        return reply(renderResponseTemplate('convo_balasan_ya_tidak', "Mohon balas *'ya'* untuk melanjutkan atau ketik *'batal'* untuk membatalkan."));
    }

    const { targetUser, nama_wifi_baru } = userState;
    const ssidsToChange = getSelectedSsids(userState);
    if (!ssidsToChange.length) {
        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'wifi_name_bulk_target_missing',
            '❌ Target SSID tidak ditemukan. Silakan mulai lagi dari awal.'
        ));
    }

    reply(renderResponseTemplate(
        'convo_ganti_nama_proses',
        `Oke, ditunggu sebentar ya. Saya sedang proses perubahan nama WiFi untuk *${targetUser.name}*... ⏳`,
        { targetUserName: targetUser.name }
    ));

    try {
        if (ssidsToChange.length === 1) {
            const result = await setSSIDName(targetUser.device_id, ssidsToChange[0], nama_wifi_baru);
            assertWifiChangeApplied(result);
        } else {
            const payload = {};
            ssidsToChange.forEach((ssidId) => {
                payload[`ssid_${ssidId}`] = nama_wifi_baru;
            });
            const result = await updateWifiSettings(targetUser.device_id, payload, { verifyApplied: true });
            assertWifiChangeApplied(result);
        }

        const actorFields = buildActorLogFields(userState, sender);
        await logWifiChange({
            userId: targetUser.id,
            deviceId: targetUser.device_id,
            changeType: 'ssid_name',
            changes: {
                oldSsidName: userState.ssid_info_old || userState.ssid_info || '(tidak dicatat)',
                newSsidName: nama_wifi_baru
            },
            changeSource: 'wa_bot',
            customerName: targetUser.name,
            reason: 'Perubahan nama WiFi melalui WhatsApp Bot',
            notes: `Mengubah ${ssidsToChange.length} SSID`,
            ipAddress: 'WhatsApp',
            userAgent: 'WhatsApp Bot',
            ...actorFields
        });

        deleteUserState(sender);
        const ssidInfo = formatWifiSsidInfo(ssidsToChange);
        return reply(renderResponseTemplate(
            'convo_ganti_nama_sukses',
            `✨ Berhasil! Nama WiFi ${ssidInfo}sudah saya ubah menjadi *"${nama_wifi_baru}"*.\n\nSilakan cari nama WiFi baru tersebut di perangkat Anda dan sambungkan kembali menggunakan kata sandi yang sama ya. Jika ada kendala, jangan ragu hubungi saya lagi!`,
            { nama_wifi_baru, ssidInfo }
        ));
    } catch (error) {
        console.error('[GANTI_NAMA_BULK_ERROR]', error);
        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'convo_ganti_nama_gagal',
            '⚠️ Aduh, maaf Kak. Sepertinya ada kendala teknis saat saya mencoba mengubah nama WiFi Anda. Mohon pastikan modem dalam keadaan menyala dan coba lagi beberapa saat, ya. Jika masih gagal, silakan hubungi Admin.'
        ));
    }
}

module.exports = {
    handleSelectChangeMode,
    handleSelectSsidToChange,
    handleAskNewName,
    handleAskNewNameBulkAuto,
    handleConfirmGantiNamaBulk
};
