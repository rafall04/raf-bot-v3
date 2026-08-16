/**
 * Header Doc
 * Purpose: Owner state domain WiFi untuk managed WiFi steps.
 * Caller: `conversation-state-router`.
 * Deps: `handleConversationState`.
 * MainFuncs: `handleWifiConversationState`.
 * SideEffects: Memperbarui state WiFi dan mengirim reply hasil perubahan WiFi.
 */
"use strict";

const managedConversationSteps = new Set([
    "SELECT_CHANGE_MODE_FIRST",
    "SELECT_CHANGE_MODE",
    "SELECT_SSID_TO_CHANGE",
    "ASK_NEW_NAME_FOR_SINGLE",
    "ASK_NEW_NAME_FOR_SINGLE_BULK",
    "ASK_NEW_NAME_FOR_BULK",
    "ASK_NEW_NAME_FOR_BULK_AUTO",
    "CONFIRM_GANTI_NAMA",
    "CONFIRM_GANTI_NAMA_BULK",
    "SELECT_CHANGE_PASSWORD_MODE",
    "SELECT_CHANGE_PASSWORD_MODE_FIRST",
    "SELECT_SSID_PASSWORD",
    "SELECT_SSID_PASSWORD_FIRST",
    "ASK_NEW_PASSWORD",
    "ASK_NEW_PASSWORD_BULK",
    "ASK_NEW_PASSWORD_BULK_AUTO",
    "CONFIRM_GANTI_SANDI",
    "CONFIRM_GANTI_SANDI_BULK"
]);

async function handleWifiConversationState(context) {
    const {
        stateStep,
        stateSender,
        chats,
        temp,
        reply,
        global,
        isOwner,
        isTeknisi,
        users,
        args,
        entities = {},
        plainSenderNumber,
        pushname,
        mess,
        sleep,
        getSSIDInfo,
        namabot,
        buatLaporanGangguan,
        handleConversationState
    } = context;

    if (!stateStep) {
        return { handled: false };
    }

    if (managedConversationSteps.has(stateStep)) {
        // WAJIB di-await lalu dipulangkan sebagai { handled: true }.
        //
        // Langkah-langkah di `conversation-state-handler` memulangkan hasil `reply()` (Promise
        // Baileys), BUKAN penanda. Dulu nilai itu dipulangkan apa adanya lalu di-spread oleh
        // `conversation-state-router` (`{ owner, ...hasil }`) — hasilnya objek TANPA kunci
        // `handled`, sehingga router menyimpulkan pesan belum ditangani dan `message/raf.js`
        // memprosesnya SEKALI LAGI beberapa baris kemudian. Gejalanya: pelanggan yang salah
        // ketik nama/sandi WiFi menerima teguran yang sama DUA KALI.
        //
        // Ini juga ranjau: bila `custom_wifi_modification` dinyalakan, pemrosesan kedua bisa
        // memakai angka pilihan menu ("2") sebagai nama WiFi seisi rumah.
        //
        // Semua domain state lain sudah memulangkan `{ handled: true }`; hanya domain ini yang
        // tertinggal — dikunci tes agar tak terulang.
        await handleConversationState({
            sender: stateSender,
            chats,
            temp,
            reply,
            global,
            isOwner,
            isTeknisi,
            users,
            args,
            entities,
            plainSenderNumber,
            pushname,
            mess,
            sleep,
            getSSIDInfo,
            namabot,
            buatLaporanGangguan
        });
        return { handled: true };
    }

    return { handled: false };
}

module.exports = {
    managedConversationSteps,
    handleWifiConversationState
};
