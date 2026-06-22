/**
 * Header Doc
 * Purpose: Handler /help, /start, /menu bot Telegram teknisi — panduan singkat + legenda warna +
 *          tombol akses cepat (Pelanggan Terakhir). Mendorong alur tercepat: cukup ketik nama.
 * Caller: peta perintah di `index.js`.
 * Deps: (tidak ada).
 * MainFuncs: `createHelpCommand()` → handler(ctx).
 * SideEffects: kirim balasan via ctx.reply.
 */
"use strict";

function createHelpCommand() {
    const text = [
        "🤖 <b>Bot Teknisi</b>",
        "Cukup ketik <b>nama / PPPoE / no HP / serial</b> pelanggan untuk mulai — atau pakai perintah:",
        "",
        "🩺 /cek &lt;pelanggan&gt; — <b>diagnosa lengkap</b> (vonis + penyebab + saran)",
        "📶 /redaman &lt;pelanggan&gt; — redaman 2 arah (modem + OLT)",
        "🔌 /koneksi &lt;pelanggan&gt; — status PPPoE (online / IP / uptime)",
        "📡 /modem &lt;pelanggan&gt; — info modem & perangkat terhubung",
        "🛰️ /olt &lt;pelanggan&gt; — status ONU di OLT",
        "🧾 /pelanggan &lt;kunci&gt; — data pelanggan dari database",
        "🕘 /terakhir — pelanggan yang baru kamu cek",
        "",
        "<b>Legenda:</b> 🟢 sehat/baik · 🟡 waspada · 🔴 bermasalah · ⚪ tak tercek",
        "💡 Setelah hasil muncul, ketuk <b>tombol</b> untuk cek cepat pelanggan yang sama (tanpa ketik ulang).",
    ].join("\n");

    const replyMarkup = { inline_keyboard: [[{ text: "🕘 Pelanggan Terakhir", callback_data: "go:terakhir" }]] };

    return async function handleHelp(ctx) {
        await ctx.reply(text, { replyMarkup });
    };
}

module.exports = { createHelpCommand };
