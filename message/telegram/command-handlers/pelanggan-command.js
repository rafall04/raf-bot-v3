/**
 * Header Doc
 * Purpose: Handler /pelanggan — tampilkan kartu data pelanggan dari database (READ-ONLY,
 *          tanpa panggilan jaringan). Berguna untuk cek identitas/PPPoE/serial sebelum
 *          perintah diagnosa lain.
 * Caller: peta perintah di `message/telegram/command-handlers/index.js`.
 * Deps: `./resolve-helper`, `lib/telegram/telegram-format`.
 * MainFuncs: `createPelangganCommand(deps)` → handler(ctx).
 * SideEffects: kirim balasan via ctx.reply.
 */
"use strict";

const { resolveCustomerOrReply, displayName, firstPart, customerActionsKeyboard } = require("./resolve-helper");
const { b, code, escapeHtml } = require("../../../lib/telegram/telegram-format");

function createPelangganCommand(deps) {
    return async function handlePelanggan(ctx) {
        const user = await resolveCustomerOrReply(ctx, deps, { example: "/pelanggan budi", command: "pelanggan" });
        if (!user) return;

        const lines = [
            "🧾 <b>DATA PELANGGAN</b>",
            `Nama: ${b(displayName(user))}`,
            `PPPoE: ${code(firstPart(user.pppoe_username) || "-")}`,
            `No HP: ${escapeHtml(firstPart(user.phone_number) || "-")}`,
            `Alamat: ${escapeHtml(firstPart(user.address) || "-")}`,
            `Device ACS: ${user.device_id ? code(user.device_id) : "-"}`,
            `Serial OLT: ${escapeHtml(firstPart(user.olt_serial) || "-")}`,
            `ID: ${escapeHtml(user.id != null ? String(user.id) : "-")}`,
        ];
        await ctx.reply(lines.join("\n"), { replyMarkup: customerActionsKeyboard(user) });
    };
}

module.exports = { createPelangganCommand };
