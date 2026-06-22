/**
 * Header Doc
 * Purpose: Handler /modem — info inti modem pelanggan dari GenieACS (model/serial/firmware/
 *          suhu/uptime) + jumlah perangkat WiFi terhubung. Force-refresh agar tidak basi.
 * Caller: peta perintah di `index.js`.
 * Deps: `./resolve-helper`, `lib/telegram/telegram-format`, getDeviceCoreInfo & getSSIDInfo (diinjeksi).
 * MainFuncs: `createModemCommand(deps)` → handler(ctx).
 * SideEffects: query GenieACS (refresh+read), kirim balasan via ctx.reply.
 */
"use strict";

const { resolveCustomerOrReply, displayName, customerActionsKeyboard } = require("./resolve-helper");
const { b, code, escapeHtml } = require("../../../lib/telegram/telegram-format");

function countConnectedDevices(ssidInfo) {
    const list = ssidInfo && Array.isArray(ssidInfo.ssid) ? ssidInfo.ssid : [];
    return list.reduce((n, s) => n + ((s && Array.isArray(s.associatedDevices) && s.associatedDevices.length) || 0), 0);
}

function createModemCommand(deps) {
    const getDeviceCoreInfo = deps.getDeviceCoreInfo;
    const getSSIDInfo = deps.getSSIDInfo;

    return async function handleModem(ctx) {
        const user = await resolveCustomerOrReply(ctx, deps, { example: "/modem budi@isp", command: "modem" });
        if (!user) return;

        const nama = displayName(user);
        if (!user.device_id) {
            await ctx.reply(`📡 <b>MODEM — ${escapeHtml(nama)}</b>\nPelanggan ini belum terhubung ke GenieACS (tidak ada device ACS).`);
            return;
        }

        await ctx.reply(`⏳ Mengambil data modem ${b(nama)}…`);

        const [coreR, ssidR] = await Promise.allSettled([
            getDeviceCoreInfo(user.device_id),
            getSSIDInfo(user.device_id, true),
        ]);
        const core = coreR.status === "fulfilled" ? coreR.value : null;
        const ssid = ssidR.status === "fulfilled" ? ssidR.value : null;

        if (!core && !ssid) {
            await ctx.reply(`📡 <b>MODEM — ${escapeHtml(nama)}</b>\n⚠️ Modem tidak terjangkau via GenieACS (mungkin offline / belum inform).`);
            return;
        }

        const lines = [`📡 <b>MODEM — ${escapeHtml(nama)}</b>`];
        if (core) {
            if (core.modemType) lines.push(`Model: ${escapeHtml(core.modemType)}`);
            if (core.manufacturer) lines.push(`Pabrikan: ${escapeHtml(core.manufacturer)}`);
            if (core.serialNumber) lines.push(`Serial: ${code(core.serialNumber)}`);
            if (core.softwareVersion) lines.push(`Firmware: ${escapeHtml(core.softwareVersion)}`);
            if (core.temperature != null && core.temperature !== "") lines.push(`Suhu: ${escapeHtml(String(core.temperature))}°C`);
        }
        if (ssid) {
            if (ssid.uptime) lines.push(`Uptime: ${escapeHtml(String(ssid.uptime))}`);
            lines.push(`Perangkat terhubung: <b>${countConnectedDevices(ssid)}</b>`);
        }
        await ctx.reply(lines.join("\n"), { replyMarkup: customerActionsKeyboard(user) });
    };
}

module.exports = { createModemCommand, countConnectedDevices };
