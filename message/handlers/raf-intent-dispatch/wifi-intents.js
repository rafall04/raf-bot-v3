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

const WIFI_INTENT_HANDLERS = Object.freeze({
    GANTI_NAMA_WIFI: handleGantiNamaWifiIntent,
    GANTI_SANDI_WIFI: handleGantiSandiWifiIntent,
    GANTI_POWER_WIFI: handleGantiPowerWifiIntent,
    REBOOT_MODEM: handleRebootModemIntent,
    CEK_WIFI: handleCekWifiIntent,
    HISTORY_WIFI: handleHistoryWifiIntent
});

module.exports = {
    WIFI_INTENT_HANDLERS,
    handleGantiNamaWifiIntent,
    handleGantiSandiWifiIntent,
    handleGantiPowerWifiIntent,
    handleRebootModemIntent,
    handleCekWifiIntent,
    handleHistoryWifiIntent
};
