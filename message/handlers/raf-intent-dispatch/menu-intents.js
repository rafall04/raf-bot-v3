/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent menu, bantuan, dan navigasi umum dispatcher WhatsApp.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `MENU_INTENT_HANDLERS`, `handleButtonIntent`, `handleMenuUtamaIntent`, `handleBantuanIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleButtonIntent(context) {
    const { reply, renderResponseTemplate, pushname } = context;

    await reply(renderResponseTemplate(
        'dispatch_button_menu',
        `Hi Kak ${pushname}! 👋\n\n📋 *MENU UTAMA*\n\nSilakan pilih menu:\n\n*1️⃣ MENU WIFI*\n   List menu untuk WiFi\n\n*2️⃣ MENU PELANGGAN*  \n   List menu pelanggan\n\n*3️⃣ INFO PASANG*\n   Harga pasang WiFi\n\n━━━━━━━━━━━━━━━━\nKetik angka pilihan Anda (1/2/3)\natau ketik:\n• *menuwifi* - Menu WiFi\n• *menupelanggan* - Menu Pelanggan  \n• *pasang* - Info Pasang`,
        { pushname }
    ));
}

async function handleBantuanIntent(context) {
    const { handleBantuan, pushname, global, reply } = context;
    handleBantuan(pushname, global.config, reply);
}

async function handleSapaanUmumIntent(context) {
    const { handleSapaanUmum, pushname, reply } = context;
    handleSapaanUmum(pushname, reply);
}

async function handleMenuPelangganIntent(context) {
    const { handleMenuPelanggan, findUserWithLidSupport, global, msg, plainSenderNumber, raf, reply, pushname, sender, mess } = context;
    // Menu PELANGGAN = khusus pelanggan TERDAFTAR. Non-pelanggan ditolak (konsisten dgn cektagihan) —
    // jangan tampilkan menu fitur pelanggan ke nomor yang tak terdaftar.
    const user = await findUserWithLidSupport(global.users, msg, plainSenderNumber, raf);
    if (!user) {
        return reply(mess.userNotRegister);
    }
    handleMenuPelanggan(global.config, reply, pushname, sender);
}

async function handleMenuUtamaIntent(context) {
    const { handleMenuUtama, global, reply, pushname, sender } = context;
    handleMenuUtama(global.config, reply, pushname, sender);
}

async function handleMenuTeknisiIntent(context) {
    const { handleMenuTeknisi, global, isOwner, isTeknisi, reply, pushname, sender, mess } = context;
    // Menu TEKNISI = khusus teknisi/owner. Non-staf ditolak — jangan ekspos tooling internal.
    if (!isTeknisi && !isOwner) {
        return reply(mess.teknisiOrOwnerOnly);
    }
    handleMenuTeknisi(global.config, reply, pushname, sender);
}

async function handleMenuOwnerIntent(context) {
    const { handleMenuOwner, global, isOwner, reply, pushname, sender } = context;
    handleMenuOwner(global.config, isOwner, reply, pushname, sender);
}

async function handleTanyaCaraPasangIntent(context) {
    const { handleTanyaCaraPasang, global, reply, pushname, sender } = context;
    handleTanyaCaraPasang(global.config, reply, pushname, sender);
}

async function handleTanyaPaketBulananIntent(context) {
    const { handleTanyaPaketBulanan, global, reply, pushname, sender } = context;
    handleTanyaPaketBulanan(global.config, reply, pushname, sender);
}

async function handleTutorialTopupIntent(context) {
    const { handleTutorialTopup, global, reply, pushname, sender } = context;
    handleTutorialTopup(global.config, reply, pushname, sender);
}

const MENU_INTENT_HANDLERS = Object.freeze({
    button: handleButtonIntent,
    BANTUAN: handleBantuanIntent,
    SAPAAN_UMUM: handleSapaanUmumIntent,
    MENU_PELANGGAN: handleMenuPelangganIntent,
    MENU_UTAMA: handleMenuUtamaIntent,
    help: handleMenuUtamaIntent,
    'menu wifi': handleMenuUtamaIntent,
    menuwifi: handleMenuUtamaIntent,
    MENU_TEKNISI: handleMenuTeknisiIntent,
    MENU_OWNER: handleMenuOwnerIntent,
    TANYA_CARA_PASANG: handleTanyaCaraPasangIntent,
    TANYA_PAKET_BULANAN: handleTanyaPaketBulananIntent,
    TUTORIAL_TOPUP: handleTutorialTopupIntent
});

module.exports = {
    MENU_INTENT_HANDLERS,
    handleButtonIntent,
    handleBantuanIntent,
    handleSapaanUmumIntent,
    handleMenuPelangganIntent,
    handleMenuUtamaIntent,
    handleMenuTeknisiIntent,
    handleMenuOwnerIntent,
    handleTanyaCaraPasangIntent,
    handleTanyaPaketBulananIntent,
    handleTutorialTopupIntent
};
