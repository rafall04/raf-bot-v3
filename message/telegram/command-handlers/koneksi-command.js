/**
 * Header Doc
 * Purpose: Handler /koneksi — status jalur PPPoE pelanggan (online/terputus) dari sesi aktif
 *          MikroTik, plus IP, uptime, dan MAC (caller-id). READ-ONLY.
 * Caller: peta perintah di `message/telegram/command-handlers/index.js`.
 * Deps: `./resolve-helper`, `lib/telegram/telegram-format`, getActivePPPoEUsers (diinjeksi).
 * MainFuncs: `createKoneksiCommand(deps)` → handler(ctx).
 * SideEffects: baca PPP active MikroTik (live), kirim balasan via ctx.reply.
 */
"use strict";

const { resolveCustomerOrReply, displayName, firstPart, customerActionsKeyboard } = require("./resolve-helper");
const { code, escapeHtml } = require("../../../lib/telegram/telegram-format");

function unwrapList(res) {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    if (res && res.data && Array.isArray(res.data.data)) return res.data.data;
    return [];
}

function createKoneksiCommand(deps) {
    const getActivePPPoEUsers = deps.getActivePPPoEUsers;

    return async function handleKoneksi(ctx) {
        const user = await resolveCustomerOrReply(ctx, deps, { example: "/koneksi budi@isp", command: "koneksi" });
        if (!user) return;

        const nama = displayName(user);
        const pppoe = firstPart(user.pppoe_username);
        if (!pppoe) {
            await ctx.reply(`🔌 <b>KONEKSI — ${escapeHtml(nama)}</b>\nPelanggan ini belum punya username PPPoE.`);
            return;
        }

        let res;
        try {
            res = await getActivePPPoEUsers({ caller: "telegram.koneksi" });
        } catch (e) {
            await ctx.reply(`⚠️ Gagal membaca data MikroTik: ${escapeHtml(e.message)}`);
            return;
        }
        if (res && res.ok === false) {
            await ctx.reply(`⚠️ Data PPPoE tidak tersedia saat ini (${escapeHtml(res.message || "MikroTik tak terjangkau")}).`);
            return;
        }

        const list = unwrapList(res);
        const session = list.find((s) => String(s.name || "").trim().toLowerCase() === pppoe.toLowerCase());

        const head = `🔌 <b>STATUS KONEKSI — ${escapeHtml(nama)}</b>\nPPPoE: ${code(pppoe)}`;
        if (session) {
            const lines = [head, "🟢 <b>ONLINE</b>"];
            if (session.address) lines.push(`IP: ${code(session.address)}`);
            if (session.uptime) lines.push(`Uptime: ${escapeHtml(session.uptime)}`);
            if (session.caller_id) lines.push(`MAC: ${code(session.caller_id)}`);
            await ctx.reply(lines.join("\n"), { replyMarkup: customerActionsKeyboard(user) });
        } else {
            await ctx.reply(
                `${head}\n🔴 <b>TERPUTUS</b>\nTidak ada sesi PPPoE aktif. Cek modem/ONU pelanggan, atau jalankan /redaman & /olt untuk diagnosa lebih dalam.`,
                { replyMarkup: customerActionsKeyboard(user) }
            );
        }
    };
}

module.exports = { createKoneksiCommand };
