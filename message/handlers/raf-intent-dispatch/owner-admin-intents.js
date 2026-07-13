/**
 * Header Doc
 * Purpose: Handler map untuk intent owner/admin non-agent di dispatcher WhatsApp — kontak admin,
 *          saldo/user global, cari/daftar pelanggan, switch koneksi WAN, dan rangkuman data ISP.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: lazy `../admin-handler`, `../state-domains/wan-switch.state` (startWanSwitch +
 *       resolveStaffRole utk gate peran presisi), `../../../lib/isp-data-summary` (DATA_ISP).
 * MainFuncs: `OWNER_ADMIN_INTENT_HANDLERS`, `handleAdminIntent`, `handleCariPelangganIntent`,
 *            `handleDaftarPelangganIntent`, `handleSwitchKoneksiIntent`, `handleDataIspIntent`.
 * SideEffects: Balas WhatsApp via `reply` context; DATA_ISP read-only.
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

async function handleDataIspIntent(context) {
    // Rangkuman data jalur ISP on-demand ("data gmdp" / "data isp" / "rapor isp").
    // READ-ONLY; gate peran PRESISI dari accounts.json (pola sama dengan switch koneksi).
    const { reply, renderResponseTemplate, chats } = context;
    const { resolveStaffRole } = require("../state-domains/wan-switch.state");
    const role = (resolveStaffRole(context) || "").toLowerCase();
    if (!["admin", "owner", "superadmin"].includes(role)) {
        return reply(renderResponseTemplate(
            "ispdata_not_authorized",
            "Perintah ini khusus admin. Ketik *menu* untuk melihat fitur yang tersedia."
        ));
    }
    const summary = require("../../../lib/isp-data-summary");
    const pathKey = summary.resolvePathArg(chats);
    const body = pathKey
        ? await summary.buildIspDataSummary(pathKey)
        : await summary.buildIspOverview();
    return reply(renderResponseTemplate("ispdata_result", "${body}", { body }));
}

async function handleOperJalurIntent(context) {
    // Owner/admin-only. Gate peran presisi (accounts.json) ada di dalam startOperJalur, jadi
    // non-admin di-`handled:false` diam-diam. "oper <segmen> ke <jalur>" → pratinjau + konfirmasi.
    const { startOperJalur } = require("../state-domains/oper-jalur.state");
    const result = await startOperJalur(context);
    if (result && result.handled) return;
    const { reply, renderResponseTemplate } = context;
    if (typeof reply === "function") {
        return reply(renderResponseTemplate(
            "oper_not_authorized",
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
    SWITCH_KONEKSI: handleSwitchKoneksiIntent,
    DATA_ISP: handleDataIspIntent,
    OPER_JALUR: handleOperJalurIntent
});

module.exports = {
    OWNER_ADMIN_INTENT_HANDLERS,
    handleAdminIntent,
    handleAllSaldoIntent,
    handleVc123Intent,
    handleAllUserIntent,
    handleCariPelangganIntent,
    handleDaftarPelangganIntent,
    handleSwitchKoneksiIntent,
    handleDataIspIntent
};
