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

// Panduan teknisi (PSB + perbaikan) — teknisi/owner. Body via template (editable), link dari config.
async function handleTutorialTeknisiIntent(context) {
    const { isTeknisi, isOwner, reply, mess, global, renderResponseTemplate } = context;
    if (!isTeknisi && !isOwner) {
        return reply(mess.teknisiOrOwnerOnly);
    }
    const body = renderResponseTemplate(
        'dispatch_tutorial_teknisi',
        `📖 *PANDUAN TEKNISI*\n\n━━━ *PSB (Pasang Baru)* ━━━\nJapri bot area kamu:\n1. Foto KTP + caption \`#PSB\` (Nama/Paket/WiFi/Sandi/HP)\n2. Kirim foto rumah\n3. Share lokasi rumah\n4. Bot tampilkan SN modem → balas *YA* (cocok) / *TIDAK* (pilih angka)\n5. Selesai — pelanggan online\n\n━━━ *PERBAIKAN (Tiket)* ━━━\n1. *list tiket* — lihat tiket\n2. *proses [ID]* — ambil tiket\n3. *otw [ID]* + share lokasi\n4. *sampai [ID]* — pelanggan dapat OTP\n5. *verifikasi [ID] [OTP]*\n6. Kirim min. 2 foto → *done*\n7. Ketik catatan perbaikan\n8. *selesai [ID]* — tutup tiket\n\n💡 Ketik *batal* untuk membatalkan proses.`,
        {}
    );
    const url = (global.config && global.config.teknisiTutorialUrl) || '';
    const linkLine = url
        ? `\n\n📖 Panduan lengkap (bergambar) — buka *panel teknisi → menu Panduan*:\n${url}`
        : `\n\n📖 Panduan lengkap (bergambar) ada di *panel teknisi → menu Panduan*.`;
    await reply(body + linkLine);
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
    TUTORIAL_TOPUP: handleTutorialTopupIntent,
    TUTORIAL_TEKNISI: handleTutorialTeknisiIntent
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
    handleTutorialTopupIntent,
    handleTutorialTeknisiIntent
};
