/**
 * Header Doc
 * Purpose: Handler /olt — status ONU pelanggan di OLT (sisi upstream): online/LOS/Dying Gasp,
 *          RX power OLT, PON/slot/onu, OLT mana. Pakai snapshot OLT ber-cache (anti spam SNMP).
 * Caller: peta perintah di `index.js`.
 * Deps: `./resolve-helper`, `./olt-format`, `lib/telegram/telegram-format`,
 *       resolveByCustomer & getOltSnapshot (diinjeksi dari lib/olt-optical-resolver).
 * MainFuncs: `createOltCommand(deps)` → handler(ctx).
 * SideEffects: ambil snapshot OLT (SNMP, ber-cache), kirim balasan via ctx.reply.
 */
"use strict";

const { resolveCustomerOrReply, displayName, firstPart, customerActionsKeyboard, getActivePppoeList } = require("./resolve-helper");
const { code, escapeHtml } = require("../../../lib/telegram/telegram-format");
const { fmtOltLines } = require("./olt-format");

function createOltCommand(deps) {
    const resolveByCustomer = deps.resolveByCustomer;
    const getOltSnapshot = deps.getOltSnapshot;

    return async function handleOlt(ctx) {
        const user = await resolveCustomerOrReply(ctx, deps, { example: "/olt budi@isp", command: "olt" });
        if (!user) return;

        const nama = displayName(user);
        const pppoe = firstPart(user.pppoe_username);
        await ctx.reply(`⏳ Mengecek status OLT untuk ${escapeHtml(nama)}…`);

        let snapshot = null;
        try {
            snapshot = await getOltSnapshot();
        } catch (e) {
            await ctx.reply(`⚠️ Gagal mengambil data OLT: ${escapeHtml(e.message)}`);
            return;
        }

        // Sesi PPPoE aktif = SUMBER MAC UTAMA untuk resolveByCustomer (sama seperti /cek). Dulu []
        // → jalur MAC mati → pelanggan EPON yang cuma teridentifikasi via MAC "tak terpetakan".
        const pppoeActive = await getActivePppoeList(deps, "telegram.olt");
        const r = resolveByCustomer(user, { oltSnapshot: snapshot, pppoeActive });
        const head = `🛰️ <b>STATUS OLT — ${escapeHtml(nama)}</b>\nPPPoE: ${code(pppoe || "-")}`;
        await ctx.reply([head, ...fmtOltLines(r)].join("\n"), { replyMarkup: customerActionsKeyboard(user) });
    };
}

module.exports = { createOltCommand };
