/**
 * Header Doc
 * Purpose: Menangani state perubahan kata sandi WiFi berbasis managed conversation state.
 * Caller: `conversation-state-handler.js`.
 * Deps: `lib/wifi`, `lib/wifi-logger`, dan `conversation-handler`.
 * MainFuncs: `handleSelectPasswordMode`, `handleSelectSsidPassword`, `handleAskNewPassword`, `handleAskNewPasswordBulk`, `handleAskNewPasswordBulkAuto`, `handleConfirmGantiSandi`, `handleConfirmGantiSandiBulk`.
 * SideEffects: Mengubah password SSID, menulis log perubahan WiFi, dan membersihkan state.
 */

const { setPassword, updateWifiSettings } = require('../../../lib/wifi');
const { logWifiChange } = require('../../../lib/wifi-logger');
const { deleteUserState, format } = require('../conversation-handler');

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
 * Pattern yang sama dipakai di wifi-name-state-handler.js.
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

function getSelectedSsids(userState) {
    if (userState.selected_ssids && userState.selected_ssids.length) {
        return userState.selected_ssids;
    }
    if (userState.bulk_ssids && userState.selected_ssid_indices?.length) {
        return userState.selected_ssid_indices.map((index) => userState.bulk_ssids[index]);
    }
    if (userState.bulk_ssids && userState.step === 'CONFIRM_GANTI_SANDI_BULK') {
        return userState.bulk_ssids;
    }
    if (userState.ssid_id) {
        return [userState.ssid_id];
    }
    return [];
}

async function handleSelectPasswordMode(userState, userReply, reply) {
    const choice = userReply.trim();

    if (choice === '1') {
        if (userState.step === 'SELECT_CHANGE_PASSWORD_MODE') {
            userState.step = 'SELECT_SSID_PASSWORD';
        } else {
            userState.step = 'SELECT_SSID_PASSWORD_FIRST';
        }

        const ssidOptions = (userState.bulk_ssids || []).map((id, index) =>
            `${index + 1}. SSID ID: ${id}${userState.ssid_info ? ' - ' + userState.ssid_info.split('\n')[index].split(': ')[1] : ''}`
        ).join('\n');

        return reply(renderResponseTemplate(
            'wifi_password_select_ssid_prompt',
            `Pilih nomor SSID yang ingin diubah kata sandinya:\n\n${ssidOptions}\n\nBalas dengan angka pilihan Anda.`,
            { ssidOptions }
        ));
    }

    if (choice === '2') {
        if (userState.step === 'SELECT_CHANGE_PASSWORD_MODE') {
            userState.step = 'CONFIRM_GANTI_SANDI_BULK';
            userState.selected_ssids = userState.bulk_ssids || [];
            return reply(renderResponseTemplate(
                'wifi_password_confirm_all_ssid',
                `Anda yakin ingin mengubah kata sandi SEMUA SSID menjadi: \`${userState.sandi_wifi_baru}\` ?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`,
                { newPassword: userState.sandi_wifi_baru }
            ));
        }

        userState.step = 'ASK_NEW_PASSWORD_BULK';
        userState.selected_ssids = userState.bulk_ssids || [];
        return reply(renderResponseTemplate(
            'convo_ganti_sandi_ask_password_bulk',
            "Silakan ketik kata sandi WiFi baru yang Anda inginkan untuk SEMUA SSID.\n\n🔐 *Ketentuan kata sandi WiFi:*\n• Minimal 8 karakter\n• Boleh menggunakan huruf, angka, dan simbol\n• Contoh: Password123, MyWiFi2024!\n\n💡 Ketik *batal* jika ingin membatalkan proses ini."
        ));
    }

    return reply(renderResponseTemplate(
        'convo_ganti_sandi_mode_invalid',
        'Pilihan tidak valid. Silakan pilih 1 untuk mengubah satu SSID atau 2 untuk mengubah semua SSID sekaligus.'
    ));
}

async function handleSelectSsidPassword(userState, userReply, reply) {
    const choice = parseInt(userReply.trim(), 10);
    const bulkSsids = userState.bulk_ssids || [];

    if (isNaN(choice) || choice < 1 || choice > bulkSsids.length) {
        return reply(renderResponseTemplate(
            'convo_ganti_sandi_ssid_invalid',
            `Pilihan tidak valid. Silakan pilih nomor antara 1 dan ${bulkSsids.length}.`,
            { maxSsid: bulkSsids.length }
        ));
    }

    const selectedSsidId = bulkSsids[choice - 1];
    userState.ssid_id = selectedSsidId;
    userState.selected_ssids = [selectedSsidId];

    if (userState.step === 'SELECT_SSID_PASSWORD') {
        userState.step = 'CONFIRM_GANTI_SANDI';
        return reply(renderResponseTemplate(
            'wifi_password_confirm_single_ssid',
            `Anda yakin ingin mengubah kata sandi WiFi SSID ${selectedSsidId} menjadi: \`${userState.sandi_wifi_baru}\` ?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`,
            {
                ssidInfo: '',
                ssidLabel: ` SSID ${selectedSsidId}`,
                newPassword: userState.sandi_wifi_baru
            }
        ));
    }

    userState.step = 'ASK_NEW_PASSWORD';
    return reply(renderResponseTemplate(
        'wifi_password_enter_new_password',
        `Silakan ketik kata sandi WiFi baru yang Anda inginkan untuk SSID ${selectedSsidId}.\n\n🔐 *Ketentuan kata sandi WiFi:*\n• Minimal 8 karakter\n• Boleh menggunakan huruf, angka, dan simbol\n• Contoh: Password123, MyWiFi2024!\n\n💡 Ketik *batal* jika ingin membatalkan proses ini.`,
        { ssidId: selectedSsidId }
    ));
}

async function handleAskNewPassword(userState, chats, reply, sender, global) {
    const newPassword = chats.trim();

    if (newPassword.length < 8) {
        return reply(renderResponseTemplate('convo_ganti_sandi_too_short', '⚠️ Kata sandi terlalu pendek, minimal harus 8 karakter.'));
    }
    if (newPassword.length > 64) {
        return reply(renderResponseTemplate('convo_ganti_sandi_too_long', '⚠️ Kata sandi terlalu panjang, maksimal 64 karakter.'));
    }

    userState.sandi_wifi_baru = newPassword;

    if (global?.config?.custom_wifi_modification) {
        userState.step = 'CONFIRM_GANTI_SANDI';
        const ssidInfo = userState.current_ssid ? `SSID: *"${userState.current_ssid}"*\n\n` : '';
        return reply(renderResponseTemplate(
            'wifi_password_confirm_single_ssid',
            `${ssidInfo}Anda yakin ingin mengubah kata sandi WiFi${userState.ssid_id ? ` SSID ${userState.ssid_id}` : ''} menjadi: \`${newPassword}\` ?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`,
            {
                ssidInfo,
                ssidLabel: userState.ssid_id ? ` SSID ${userState.ssid_id}` : '',
                newPassword
            }
        ));
    }

    try {
        const result = await setPassword(userState.targetUser.device_id, userState.ssid_id || '1', newPassword);
        if (!result.success) {
            throw new Error(result.message);
        }

        const actorFields = buildActorLogFields(userState, sender);
        await logWifiChange({
            userId: userState.targetUser.id,
            deviceId: userState.targetUser.device_id,
            changeType: 'password',
            changes: {
                oldPassword: '[Previous]',
                newPassword,
                ssidId: userState.ssid_id || '1'
            },
            changeSource: 'wa_bot',
            customerName: userState.targetUser.name || 'Customer',
            reason: `WiFi password change via WhatsApp Bot (SSID ${userState.ssid_id || '1'})`,
            notes: `Password changed for SSID ${userState.ssid_id || '1'}`,
            ipAddress: 'WhatsApp',
            userAgent: 'WhatsApp Bot',
            ...actorFields
        });

        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'wifi_password_change_success',
            `✅ *Berhasil!*\n\nKata sandi WiFi telah diubah menjadi: \`${newPassword}\`\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• WiFi akan terputus dari semua perangkat\n• Silakan sambungkan kembali dengan password baru\n• Nama WiFi tetap sama, hanya password yang berubah\n\n⚠️ *PENTING:* Simpan password ini dengan baik!\n💡 Jika ada masalah, hubungi admin untuk bantuan.`,
            { ssidInfo: '', newPassword }
        ));
    } catch (error) {
        console.error('[ASK_NEW_PASSWORD] Error:', error);
        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'wifi_password_change_error',
            `❌ Maaf, gagal mengubah kata sandi WiFi. Silakan coba lagi atau hubungi admin.\n\nError: ${error.message}`,
            { error_message: error.message }
        ));
    }
}

async function handleAskNewPasswordBulk(userState, chats, reply, sender, global) {
    const newPassword = chats.trim();

    if (newPassword.length < 8) {
        return reply(renderResponseTemplate('convo_ganti_sandi_too_short', '⚠️ Password terlalu pendek! Minimal 8 karakter ya, Kak. Coba lagi atau ketik *batal*.'));
    }
    if (newPassword.length > 64) {
        return reply(renderResponseTemplate('convo_ganti_sandi_too_long', '⚠️ Password terlalu panjang! Maksimal 64 karakter. Coba yang lebih pendek atau ketik *batal*.'));
    }

    userState.sandi_wifi_baru = newPassword;
    const ssidsToChange = getSelectedSsids(userState);

    if (global?.config?.custom_wifi_modification) {
        userState.step = 'CONFIRM_GANTI_SANDI_BULK';
        const ssidInfo = ssidsToChange.length > 1
            ? `untuk *${ssidsToChange.length} SSID*`
            : `untuk SSID ${ssidsToChange[0]}`;
        return reply(renderResponseTemplate(
            'wifi_password_confirm_single_ssid',
            `Anda yakin ingin mengubah kata sandi WiFi ${ssidInfo} menjadi: \`${newPassword}\`?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`,
            {
                ssidInfo: '',
                ssidLabel: ` ${ssidInfo}`,
                newPassword
            }
        ));
    }

    try {
        const bulkPayload = {};
        ssidsToChange.forEach((ssidId) => {
            bulkPayload[`ssid_password_${ssidId}`] = newPassword;
        });

        const response = await updateWifiSettings(userState.targetUser.device_id, bulkPayload, { verifyApplied: true });
        if (!response.ok) {
            throw new Error(response.message);
        }

        const actorFields = buildActorLogFields(userState, sender);
        await logWifiChange({
            userId: userState.targetUser.id,
            deviceId: userState.targetUser.device_id,
            changeType: 'password',
            changes: {
                oldPassword: '[Previous]',
                newPassword,
                ssidIds: ssidsToChange.join(', ')
            },
            changeSource: 'wa_bot',
            customerName: userState.targetUser.name || 'Customer',
            reason: `WiFi password change via WhatsApp Bot (${ssidsToChange.length} SSIDs)`,
            notes: `Changed password for SSIDs: ${ssidsToChange.join(', ')}`,
            ipAddress: 'WhatsApp',
            userAgent: 'WhatsApp Bot',
            ...actorFields
        });

        deleteUserState(sender);
        const ssidInfo = ssidsToChange.length > 1
            ? `untuk *${ssidsToChange.length} SSID*`
            : `untuk SSID ${ssidsToChange[0]}`;
        return reply(renderResponseTemplate(
            'wifi_password_change_success',
            `✅ *Berhasil!*\n\nKata sandi WiFi ${ssidInfo} telah diubah menjadi: \`${newPassword}\`\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• WiFi akan terputus dari semua perangkat\n• Silakan sambungkan kembali dengan password baru\n• Nama WiFi tetap sama, hanya password yang berubah\n\n⚠️ *PENTING:* Simpan password ini dengan baik!\n💡 Jika ada masalah, hubungi admin untuk bantuan.`,
            { ssidInfo: `${ssidInfo} `, newPassword }
        ));
    } catch (error) {
        console.error('[ASK_NEW_PASSWORD_BULK] Error:', error);
        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'wifi_password_change_error',
            `❌ Maaf, gagal mengubah kata sandi WiFi. Silakan coba lagi atau hubungi admin.\n\nError: ${error.message}`,
            { error_message: error.message }
        ));
    }
}

async function handleAskNewPasswordBulkAuto(userState, chats, reply, sender, global, _axios) {
    return handleAskNewPasswordBulk(userState, chats, reply, sender, global);
}

async function handleConfirmGantiSandi(userState, userReply, reply, sender, _global, _axios) {
    const response = userReply.toLowerCase().trim();

    if (!['ya', 'ok', 'lanjut', 'iya', 'y'].includes(response)) {
        return reply(renderResponseTemplate('convo_balasan_ya_tidak', "Mohon balas *'ya'* untuk melanjutkan atau ketik *'batal'* untuk membatalkan."));
    }

    const { targetUser, sandi_wifi_baru, ssid_id } = userState;
    reply(renderResponseTemplate(
        'wifi_password_applying_single',
        `⏳ Sedang mengubah kata sandi WiFi SSID ${ssid_id}...`,
        { ssid_id }
    ));

    try {
        const result = await setPassword(targetUser.device_id, ssid_id, sandi_wifi_baru);
        if (!result.success) {
            throw new Error(result.message);
        }

        const actorFields = buildActorLogFields(userState, sender);
        await logWifiChange({
            userId: targetUser.id,
            deviceId: targetUser.device_id,
            changeType: 'password',
            changes: {
                oldPassword: '[Previous]',
                newPassword: sandi_wifi_baru,
                ssidId: ssid_id
            },
            changeSource: 'wa_bot',
            customerName: targetUser.name,
            reason: 'Perubahan password WiFi melalui WhatsApp Bot',
            notes: `Mengubah password untuk SSID ${ssid_id}`,
            ipAddress: 'WhatsApp',
            userAgent: 'WhatsApp Bot',
            ...actorFields
        });

        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'wifi_password_change_success',
            `✅ *Berhasil!*\n\nKata sandi WiFi untuk SSID ${ssid_id} telah diubah menjadi: \`${sandi_wifi_baru}\`\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• WiFi akan terputus dari semua perangkat\n• Silakan sambungkan kembali dengan password baru\n• Nama WiFi tetap sama, hanya password yang berubah\n\n⚠️ *PENTING:* Simpan password ini dengan baik!\n💡 Jika ada masalah, hubungi admin untuk bantuan.`,
            { ssidInfo: `untuk SSID ${ssid_id} `, newPassword: sandi_wifi_baru }
        ));
    } catch (error) {
        console.error('[GANTI_SANDI_ERROR]', error);
        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'wifi_password_confirm_technical_error',
            '⚠️ Maaf, ada kendala teknis saat mengubah kata sandi WiFi. Mohon pastikan modem menyala dan coba lagi nanti.'
        ));
    }
}

async function handleConfirmGantiSandiBulk(userState, userReply, reply, sender, _global, _axios) {
    const response = userReply.toLowerCase().trim();

    if (!['ya', 'ok', 'lanjut', 'iya', 'y'].includes(response)) {
        return reply(renderResponseTemplate('convo_balasan_ya_tidak', "Mohon balas *'ya'* untuk melanjutkan atau ketik *'batal'* untuk membatalkan."));
    }

    const { targetUser, sandi_wifi_baru } = userState;
    const bulkSsids = getSelectedSsids(userState);

    reply(renderResponseTemplate(
        'wifi_password_applying_bulk',
        `⏳ Sedang mengubah kata sandi untuk ${bulkSsids.length} SSID...`,
        { jumlah_ssid: bulkSsids.length }
    ));

    try {
        const bulkPayload = {};
        bulkSsids.forEach((ssidId) => {
            bulkPayload[`ssid_password_${ssidId}`] = sandi_wifi_baru;
        });

        const result = await updateWifiSettings(targetUser.device_id, bulkPayload, { verifyApplied: true });
        if (!result.ok) {
            throw new Error(result.message);
        }

        const actorFields = buildActorLogFields(userState, sender);
        await logWifiChange({
            userId: targetUser.id,
            deviceId: targetUser.device_id,
            changeType: 'password',
            changes: {
                oldPassword: '[Previous]',
                newPassword: sandi_wifi_baru,
                ssidIds: bulkSsids.join(', ')
            },
            changeSource: 'wa_bot',
            customerName: targetUser.name,
            reason: 'Perubahan password WiFi melalui WhatsApp Bot (Bulk)',
            notes: `Mengubah password untuk ${bulkSsids.length} SSID: ${bulkSsids.join(', ')}`,
            ipAddress: 'WhatsApp',
            userAgent: 'WhatsApp Bot',
            ...actorFields
        });

        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'wifi_password_change_success',
            `✅ *Berhasil!*\n\nKata sandi WiFi untuk *${bulkSsids.length} SSID* telah diubah menjadi: \`${sandi_wifi_baru}\`\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• WiFi akan terputus dari semua perangkat\n• Silakan sambungkan kembali dengan password baru\n• Nama WiFi tetap sama, hanya password yang berubah\n\n⚠️ *PENTING:* Simpan password ini dengan baik!\n💡 Jika ada masalah, hubungi admin untuk bantuan.`,
            { ssidInfo: `untuk *${bulkSsids.length} SSID* `, newPassword: sandi_wifi_baru }
        ));
    } catch (error) {
        console.error('[GANTI_SANDI_BULK_ERROR]', error);
        deleteUserState(sender);
        return reply(renderResponseTemplate(
            'wifi_password_confirm_technical_error',
            '⚠️ Maaf, ada kendala teknis saat mengubah kata sandi WiFi. Mohon pastikan modem menyala dan coba lagi nanti.'
        ));
    }
}

module.exports = {
    handleSelectPasswordMode,
    handleSelectSsidPassword,
    handleAskNewPassword,
    handleAskNewPasswordBulk,
    handleAskNewPasswordBulkAuto,
    handleConfirmGantiSandi,
    handleConfirmGantiSandiBulk
};
