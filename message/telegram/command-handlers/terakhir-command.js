/**
 * Header Doc
 * Purpose: Handler /terakhir — tampilkan pelanggan yang baru saja dicek teknisi ini (per chatId)
 *          sebagai tombol "🩺 Cek Lengkap" agar bisa cek ulang instan tanpa mengetik. READ-ONLY.
 * Caller: peta perintah di `index.js`; tombol menu (callback go:terakhir).
 * Deps: `./recents`, `../customer-lookup` (findById), `./resolve-helper` (displayName/firstPart).
 * MainFuncs: `createTerakhirCommand(deps)` → handler(ctx).
 * SideEffects: kirim balasan via ctx.reply.
 */
"use strict";

const recents = require("./recents");
const { findById } = require("../customer-lookup");
const { displayName, firstPart } = require("./resolve-helper");

function createTerakhirCommand(deps = {}) {
    const getUsers = deps.getUsers || (() => global.users || []);
    const findByIdFn = deps.findById || findById;
    const recentsApi = deps.recents || recents;

    return async function handleTerakhir(ctx) {
        const ids = recentsApi.list(ctx.chatId);
        const users = getUsers();
        const found = ids.map((id) => findByIdFn(id, users)).filter(Boolean);

        if (!found.length) {
            await ctx.reply("🕘 Belum ada pelanggan yang kamu cek di sesi ini.\nKetik nama / PPPoE pelanggan untuk mulai.");
            return;
        }

        const keyboard = {
            inline_keyboard: found.map((u) => [
                { text: `🩺 ${displayName(u)} · ${firstPart(u.pppoe_username) || "-"}`, callback_data: `do:cek:${u.id}` },
            ]),
        };
        await ctx.reply("🕘 <b>Pelanggan terakhir kamu cek</b>\nKetuk untuk diagnosa lengkap lagi:", { replyMarkup: keyboard });
    };
}

module.exports = { createTerakhirCommand };
