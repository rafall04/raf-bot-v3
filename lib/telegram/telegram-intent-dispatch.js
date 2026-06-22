/**
 * Header Doc
 * Purpose: Router/dispatcher perintah bot Telegram teknisi (mirror pola map-based
 *          `message/handlers/raf-intent-dispatch`). Tugas: parse teks → tentukan command,
 *          jalankan AUTH GATE whitelist (chat tak terdaftar dibalas info chat_id; terdaftar
 *          tapi dinonaktifkan diberi tahu), batasi hanya private chat, lalu panggil handler.
 *          READ-ONLY pada fase ini (tidak ada aksi tulis ke jaringan).
 * Caller: `lib/telegram/telegram-teknisi-bootstrap.js` (loop poll) per-update.
 * Deps: `./telegram-format` (pesan gate), `repositories/telegram-teknisi.repository` (whitelist).
 * MainFuncs: `createTelegramDispatcher({ repository, commands })` → { handleUpdate, parseCommand };
 *            `parseCommand(text)`.
 * SideEffects: Mengirim balasan via client (diberikan lewat ctx). Tidak menyentuh state lain.
 */
"use strict";

const { buildUnregisteredMessage, buildDisabledMessage } = require("./telegram-format");

/**
 * Parse teks pesan menjadi { command, args }. Toleran: '/cmd', '/cmd@botname', dan
 * 'cmd' (tanpa slash) sama-sama dinormalkan ke '/cmd' lower-case. Sisa teks = args.
 * @returns {{command:string, args:string}|null} null bila teks kosong.
 */
function parseCommand(text) {
    const trimmed = String(text == null ? "" : text).trim();
    if (!trimmed) return null;

    const wsIdx = trimmed.search(/\s/);
    const firstRaw = wsIdx === -1 ? trimmed : trimmed.slice(0, wsIdx);
    const args = wsIdx === -1 ? "" : trimmed.slice(wsIdx + 1).trim();

    let cmd = firstRaw.toLowerCase();
    const atIdx = cmd.indexOf("@");
    if (atIdx >= 0) cmd = cmd.slice(0, atIdx);
    if (!cmd.startsWith("/")) cmd = "/" + cmd;

    return { command: cmd, args };
}

function safe(fn) {
    try {
        return fn();
    } catch (__e) {
        return null;
    }
}

/**
 * @param {object} deps
 * @param {object} [deps.repository] - repo whitelist (default: singleton produksi)
 * @param {Object<string,Function>} [deps.commands] - peta '/cmd' → handler({chatId,args,reply,client,...})
 */
function createTelegramDispatcher(deps = {}) {
    const repository =
        deps.repository || require("../../repositories/telegram-teknisi.repository").telegramTeknisiRepository;
    const commands = deps.commands || {};

    /**
     * Proses satu update Telegram.
     * @param {object} update - objek update dari getUpdates
     * @param {{ client: object }} ctx - client Telegram (punya safeSendMessage)
     */
    async function handleUpdate(update, ctx = {}) {
        const client = ctx.client;
        if (!client) return;

        // Tombol inline → callback_query (READ-ONLY: hanya memicu perintah diagnosa).
        if (update && update.callback_query) {
            return handleCallback(update.callback_query, client);
        }

        const msg = update && update.message;
        if (!msg || typeof msg.text !== "string" || !msg.text.trim()) return;

        const chat = msg.chat || {};
        if (chat.type && chat.type !== "private") return; // hanya private chat

        const chatId = chat.id != null ? chat.id : msg.from && msg.from.id;
        if (chatId == null) return;

        const reply = (text, opts) => client.safeSendMessage(chatId, text, opts);

        // ---- AUTH GATE ----
        const entry = safe(() => repository.find(chatId));
        if (!entry) {
            await reply(buildUnregisteredMessage(chatId));
            return;
        }
        if (entry.enabled === false) {
            await reply(buildDisabledMessage());
            return;
        }

        // ---- DISPATCH ----
        const rawText = msg.text.trim();
        const hadSlash = rawText.startsWith("/");
        const parsed = parseCommand(rawText);
        let handler = parsed ? commands[parsed.command] : null;
        let args = parsed ? parsed.args : "";

        // Teks biasa (tanpa slash) yang bukan perintah → anggap pencarian pelanggan
        // (teknisi tinggal ketik nama/PPPoE, tak perlu hafal perintah).
        if (!handler && !hadSlash && commands["/pelanggan"]) {
            handler = commands["/pelanggan"];
            args = rawText;
        }
        // Perintah tak dikenal → fallback ke /help bila ada.
        if (!handler) handler = commands["/help"];
        if (!handler) {
            await reply("Perintah tidak dikenal. Ketik /help untuk daftar perintah.");
            return;
        }

        const handlerCtx = {
            chatId,
            args,
            reply,
            client,
            update,
            msg,
            from: msg.from,
            command: parsed && parsed.command,
            repository,
        };

        try {
            await handler(handlerCtx);
        } catch (error) {
            console.error(`[TELEGRAM_TEKNISI] Handler error (${parsed && parsed.command}): ${error.message}`);
            await reply("⚠️ Maaf, terjadi kesalahan saat memproses perintah. Coba lagi sebentar.");
        }
    }

    /**
     * Proses tekan tombol inline. Format callback_data: 'do:<cmd>:<userId>'.
     * Auth gate sama dengan jalur teks; pelanggan di-resolve handler via resolvedUserId.
     */
    async function handleCallback(cq, client) {
        // Hentikan indikator loading tombol (best-effort, tidak boleh throw).
        if (typeof client.answerCallbackQuery === "function") {
            try {
                await client.answerCallbackQuery(cq.id);
            } catch (__e) {
                /* abaikan */
            }
        }

        const chat = cq.message && cq.message.chat;
        const chatId = chat && chat.id != null ? chat.id : cq.from && cq.from.id;
        if (chatId == null) return;
        const reply = (text, opts) => client.safeSendMessage(chatId, text, opts);

        const entry = safe(() => repository.find(chatId));
        if (!entry) {
            await reply(buildUnregisteredMessage(chatId));
            return;
        }
        if (entry.enabled === false) {
            await reply(buildDisabledMessage());
            return;
        }

        const data = String(cq.data || "");
        const mDo = data.match(/^do:([a-z]+):(.+)$/);
        const mGo = data.match(/^go:([a-z]+)$/);
        let command;
        let resolvedUserId;
        if (mDo) {
            command = "/" + mDo[1];
            resolvedUserId = mDo[2];
        } else if (mGo) {
            command = "/" + mGo[1]; // perintah tanpa pelanggan (mis. /terakhir, /menu)
            resolvedUserId = undefined;
        } else {
            return; // skema tak dikenal → abaikan diam-diam
        }
        const handler = commands[command];
        if (!handler) return;

        try {
            await handler({ chatId, args: "", reply, client, from: cq.from, command, repository, resolvedUserId });
        } catch (error) {
            console.error(`[TELEGRAM_TEKNISI] callback handler error (${command}): ${error.message}`);
            await reply("⚠️ Maaf, terjadi kesalahan saat memproses perintah.");
        }
    }

    return { handleUpdate, parseCommand };
}

module.exports = { createTelegramDispatcher, parseCommand };
