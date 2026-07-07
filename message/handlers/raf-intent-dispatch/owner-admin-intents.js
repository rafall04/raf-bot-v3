/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent owner/admin non-agent di dispatcher WhatsApp.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `OWNER_ADMIN_INTENT_HANDLERS`, `handleAdminIntent`, `handleCariPelangganIntent`, `handleDaftarPelangganIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleAdminIntent(context) {
    const { handleAdminContact, from, ownerNumber, global, msg, sendContact, reply } = context;
    handleAdminContact(from, ownerNumber || global.config?.ownerNumber || [], global.config, msg, sendContact, reply);
}

async function handleAllSaldoIntent(context) {
    const { handleAllSaldo, isOwner, reply, mess, global } = context;
    handleAllSaldo(isOwner, reply, mess, global.config, global.atm || []);
}

async function handleVc123Intent(context) {
    const { handleVc123, global, voucher, reply } = context;
    handleVc123(global.config, voucher, reply);
}

async function handleAllUserIntent(context) {
    const { handleAllUser, isOwner, reply, mess, users } = context;
    handleAllUser(isOwner, reply, mess, users);
}

async function handleCariPelangganIntent(context) {
    const { isOwner, isTeknisi, reply, mess, qAfterKeyword, renderResponseTemplate } = context;
    if (!isOwner && !isTeknisi) {
        return reply(mess.teknisiOrOwnerOnly);
    }

    const searchQuery = qAfterKeyword && qAfterKeyword.trim() ? qAfterKeyword.trim() : '';
    if (!searchQuery) {
        return reply(renderResponseTemplate(
            'dispatch_cari_pelanggan_format',
            `🔍 *CARI PELANGGAN*\n\nFormat: *cari [nama/nomor/ID]*\n\nContoh:\n• cari Budi\n• cari 08123456789\n• cari 15`
        ));
    }

    const { handleSearchUser } = require('../admin-handler');
    const result = handleSearchUser({ query: searchQuery });
    return reply(result.message);
}

async function handleSwitchKoneksiIntent(context) {
    // Owner/admin-only. Gate peran presisi ada di dalam startWanSwitch (accounts.json), jadi
    // non-admin akan di-`handled:false` diam-diam dan jatuh ke fallback intent lain.
    const { startWanSwitch } = require("../state-domains/wan-switch.state");
    const result = await startWanSwitch(context);
    if (result && result.handled) return;
    // Bukan admin → jangan bocorkan fitur; balas seolah command tak dikenal via bantuan ringan.
    const { reply, renderResponseTemplate } = context;
    if (typeof reply === "function") {
        return reply(renderResponseTemplate(
            "wanswitch_not_authorized",
            "Perintah ini khusus admin. Ketik *menu* untuk melihat fitur yang tersedia."
        ));
    }
}

async function handleDaftarPelangganIntent(context) {
    const { isOwner, isTeknisi, reply, mess, qAfterKeyword } = context;
    if (!isOwner && !isTeknisi) {
        return reply(mess.teknisiOrOwnerOnly);
    }

    let filter = null;
    let page = 1;

    if (qAfterKeyword) {
        const parts = qAfterKeyword.toLowerCase().trim().split(/\s+/);

        for (const part of parts) {
            if (part === 'lunas') {
                filter = 'paid';
            } else if (part === 'belum') {
                filter = 'unpaid';
            } else if (!isNaN(parseInt(part, 10))) {
                page = parseInt(part, 10);
            }
        }
    }

    const { handleListUsers } = require('../admin-handler');
    const result = handleListUsers({ filter, page });
    return reply(result.message);
}

const OWNER_ADMIN_INTENT_HANDLERS = Object.freeze({
    admin: handleAdminIntent,
    allsaldo: handleAllSaldoIntent,
    vc123: handleVc123Intent,
    alluser: handleAllUserIntent,
    CARI_PELANGGAN: handleCariPelangganIntent,
    DAFTAR_PELANGGAN: handleDaftarPelangganIntent,
    SWITCH_KONEKSI: handleSwitchKoneksiIntent
});

module.exports = {
    OWNER_ADMIN_INTENT_HANDLERS,
    handleAdminIntent,
    handleAllSaldoIntent,
    handleVc123Intent,
    handleAllUserIntent,
    handleCariPelangganIntent,
    handleDaftarPelangganIntent,
    handleSwitchKoneksiIntent
};
