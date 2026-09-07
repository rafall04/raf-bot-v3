/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent operasi WiFi pelanggan/teknisi di dispatcher WhatsApp.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `WIFI_INTENT_HANDLERS`, `handleGantiNamaWifiIntent`, `handleCekWifiIntent`, `handleHistoryWifiIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleGantiNamaWifiIntent(context) {
    const { handleWifiIntent, intentOwner } = context;
    await handleWifiIntent({
        ...context,
        intentOwner
    });
}

async function handleGantiSandiWifiIntent(context) {
    const { handleWifiIntent, intentOwner } = context;
    await handleWifiIntent({
        ...context,
        intentOwner
    });
}

async function handleGantiPowerWifiIntent(context) {
    const {
        handleGantiPowerWifi,
        sender,
        args,
        matchedKeywordLength,
        q,
        isOwner,
        isTeknisi,
        users,
        reply,
        global,
        mess,
        msg,
        raf
    } = context;
    await handleGantiPowerWifi({
        sender,
        args,
        matchedKeywordLength,
        q,
        isOwner,
        isTeknisi,
        users,
        reply,
        global,
        mess,
        msg,
        raf
    });
}

async function handleRebootModemIntent(context) {
    const {
        handleRebootModem,
        sender,
        stateSender,
        entities,
        isOwner,
        isTeknisi,
        plainSenderNumber,
        pushname,
        users,
        reply,
        mess,
        msg,
        raf
    } = context;
    // stateSender (JID kanonik) wajib diteruskan untuk key state, dan raf untuk
    // resolusi pelanggan @lid (signalRepository.lidMapping). await agar error/await
    // tidak bocor keluar concurrency guard di message/raf.js.
    await handleRebootModem({
        sender,
        stateSender,
        entities,
        isOwner,
        isTeknisi,
        plainSenderNumber,
        pushname,
        users,
        reply,
        mess,
        msg,
        raf
    });
}

async function handleCekWifiIntent(context) {
    const {
        handleCekWifi,
        sender,
        args,
        matchedKeywordLength,
        isOwner,
        isTeknisi,
        pushname,
        users,
        reply,
        global,
        mess,
        msg,
        raf
    } = context;
    await handleCekWifi({
        sender,
        args,
        matchedKeywordLength,
        isOwner,
        isTeknisi,
        pushname,
        users,
        reply,
        global,
        mess,
        msg,
        raf
    });
}

async function handleHistoryWifiIntent(context) {
    const { handleHistoryWifi, sender, reply, global, msg, raf } = context;
    await handleHistoryWifi(sender, reply, global, msg, raf);
}

// #b351: intent WA TEKNISI cek redaman dua-sisi (Modem+OLT). Handler konkret di
// message/handlers/redaman-check-handler.js (di-inject sbg context.handleCekRedaman di raf.js).
async function handleCekRedamanIntent(context) {
    const { handleCekRedaman, qAfterKeyword, args, matchedKeywordLength, isOwner, isTeknisi, users, reply, global, mess, msg, raf } = context;
    await handleCekRedaman({ qAfterKeyword, args, matchedKeywordLength, isOwner, isTeknisi, users, reply, global, mess, msg, raf });
}

// #b352: intent WA TEKNISI daftar pelanggan TERDAMPAK berperingkat (gated config.redamanTerdampak).
async function handleCekRedamanTerdampakIntent(context) {
    const { handleRedamanTerdampak, qAfterKeyword, isOwner, isTeknisi, reply, global, mess } = context;
    await handleRedamanTerdampak({ qAfterKeyword, isOwner, isTeknisi, reply, global, mess });
}

// #b353: intent WA TEKNISI pantau redaman live saat perbaikan (durabel, gated config.redamanWatch).
async function handlePantauRedamanIntent(context) {
    const { handlePantauRedaman, qAfterKeyword, isOwner, isTeknisi, users, reply, global, mess, sender, msg, raf } = context;
    await handlePantauRedaman({ qAfterKeyword, isOwner, isTeknisi, users, reply, global, mess, sender, msg, raf });
}
async function handleStopPantauIntent(context) {
    const { handleStopPantau, isOwner, isTeknisi, users, reply, mess, sender, msg, raf } = context;
    await handleStopPantau({ isOwner, isTeknisi, users, reply, mess, sender, msg, raf });
}

// #b354: intent WA TEKNISI self-service — `setelan saya` (RONDE 6 Fase A: tampil preferensi aktif).
// isTeknisi diteruskan sbg OBJEK akun (punya .id) untuk key store per-teknisi; gated config.teknisiPrefs.
async function handleSetelanSayaIntent(context) {
    const { handleSetelanSaya, isOwner, isTeknisi, reply, global, mess } = context;
    await handleSetelanSaya({ isOwner, isTeknisi, reply, global, mess });
}
// #b355: `alert ...` — ubah preferensi alert (on/off, kelas, area, kanal). qAfterKeyword = argumen stlh "alert".
async function handleAlertPrefIntent(context) {
    const { handleAlertPref, qAfterKeyword, isOwner, isTeknisi, reply, global, mess } = context;
    await handleAlertPref({ qAfterKeyword, isOwner, isTeknisi, reply, global, mess });
}

const WIFI_INTENT_HANDLERS = Object.freeze({
    GANTI_NAMA_WIFI: handleGantiNamaWifiIntent,
    GANTI_SANDI_WIFI: handleGantiSandiWifiIntent,
    GANTI_POWER_WIFI: handleGantiPowerWifiIntent,
    REBOOT_MODEM: handleRebootModemIntent,
    CEK_WIFI: handleCekWifiIntent,
    CEK_REDAMAN: handleCekRedamanIntent,
    CEK_REDAMAN_TERDAMPAK: handleCekRedamanTerdampakIntent,
    PANTAU_REDAMAN: handlePantauRedamanIntent,
    STOP_PANTAU: handleStopPantauIntent,
    SETELAN_SAYA: handleSetelanSayaIntent,
    ALERT_PREF: handleAlertPrefIntent,
    HISTORY_WIFI: handleHistoryWifiIntent
});

module.exports = {
    WIFI_INTENT_HANDLERS,
    handleGantiNamaWifiIntent,
    handleGantiSandiWifiIntent,
    handleGantiPowerWifiIntent,
    handleRebootModemIntent,
    handleCekWifiIntent,
    handleCekRedamanIntent,
    handleCekRedamanTerdampakIntent,
    handlePantauRedamanIntent,
    handleStopPantauIntent,
    handleSetelanSayaIntent,
    handleAlertPrefIntent,
    handleHistoryWifiIntent
};
