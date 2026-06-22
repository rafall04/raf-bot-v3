/**
 * Header Doc
 * Purpose: Klien HTTP Telegram Bot API untuk bot teknisi — long-poll `getUpdates`,
 *          `sendMessage` (HTML + inline keyboard), dan `safeSendMessage` (never-throw).
 *          Sengaja TIDAK memakai framework bot; cukup axios langsung ke api.telegram.org
 *          (mengikuti pola `lib/telegram-backup.js` tapi token diparameterkan). Token bot
 *          teknisi WAJIB terpisah dari bot backup (dua consumer getUpdates pada satu token
 *          menyebabkan konflik 409 / update hilang).
 * Caller: `lib/telegram/telegram-teknisi-bootstrap.js` (loop poll) dan dispatcher/handlers (reply).
 * Deps: `axios` (injectable untuk test).
 * MainFuncs: `createTelegramClient(botToken, { axios })` → { getUpdates, sendMessage,
 *            safeSendMessage, answerCallbackQuery, getMe, abortInflight, setMyCommands }.
 * SideEffects: HTTP keluar ke api.telegram.org. safeSendMessage tidak pernah throw.
 *            `abortInflight()` membatalkan long-poll getUpdates yang sedang menggantung (lewat
 *            AbortController) agar loop bisa keluar segera saat stop/restart — bukan menunggu
 *            long-poll timeout (≤65s) selesai dulu.
 */
"use strict";

const TELEGRAM_API = "https://api.telegram.org";

/**
 * @param {string} botToken
 * @param {{ axios?: object }} [opts]
 */
function createTelegramClient(botToken, opts = {}) {
    const http = opts.axios || require("axios");
    const apiBase = `${TELEGRAM_API}/bot${botToken}`;

    // AbortController long-poll getUpdates yang sedang berjalan (untuk dibatalkan saat stop/restart).
    let inflightController = null;

    async function callApi(method, payload, { timeoutMs, signal } = {}) {
        const res = await http.post(`${apiBase}/${method}`, payload, {
            timeout: timeoutMs || 15000,
            signal,
        });
        return res && res.data;
    }

    /**
     * Long-poll daftar update. timeoutSec = lama server menahan koneksi bila tak ada update.
     * @returns {Promise<Array>} array update (mungkin kosong)
     */
    async function getUpdates({ offset, timeoutSec = 50, allowedUpdates } = {}) {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        inflightController = controller;
        try {
            const data = await callApi(
                "getUpdates",
                {
                    offset,
                    timeout: timeoutSec,
                    allowed_updates: allowedUpdates || ["message", "callback_query"],
                },
                // axios timeout harus > long-poll timeout agar tidak putus duluan.
                { timeoutMs: (timeoutSec + 15) * 1000, signal: controller ? controller.signal : undefined }
            );
            if (!data || !data.ok) {
                throw new Error((data && data.description) || "getUpdates gagal");
            }
            return Array.isArray(data.result) ? data.result : [];
        } finally {
            // Jangan hapus controller yang lebih baru bila (entah bagaimana) ada yang menimpa.
            if (inflightController === controller) inflightController = null;
        }
    }

    /**
     * Batalkan long-poll getUpdates yang sedang menggantung. Best-effort & idempoten —
     * aman dipanggil walau tidak ada request berjalan. Dipakai saat stop/restart agar loop
     * keluar segera (bukan menunggu long-poll timeout ≤65s).
     */
    function abortInflight() {
        const c = inflightController;
        if (c && typeof c.abort === "function") {
            try {
                c.abort();
            } catch (__e) {
                /* abaikan */
            }
        }
    }

    /**
     * Kirim pesan. Default parse_mode HTML + web preview dimatikan.
     * @param {string|number} chatId
     * @param {string} text
     * @param {{ parseMode?:string, replyMarkup?:object, disablePreview?:boolean, timeoutMs?:number }} [options]
     */
    async function sendMessage(chatId, text, options = {}) {
        const payload = {
            chat_id: chatId,
            text,
            parse_mode: options.parseMode || "HTML",
            disable_web_page_preview: options.disablePreview !== false,
        };
        if (options.replyMarkup) payload.reply_markup = options.replyMarkup;

        const data = await callApi("sendMessage", payload, { timeoutMs: options.timeoutMs || 15000 });
        if (!data || !data.ok) {
            throw new Error((data && data.description) || "sendMessage gagal");
        }
        return data.result;
    }

    /**
     * Versi aman dari sendMessage — tidak pernah throw (log & lanjut). Mirror semangat
     * `lib/cron/shared.js#safeSendMessage` untuk WhatsApp: notifikasi tak boleh menjatuhkan loop.
     * @returns {Promise<{success:boolean, result?:object, error?:string}>}
     */
    async function safeSendMessage(chatId, text, options = {}) {
        try {
            const result = await sendMessage(chatId, text, options);
            return { success: true, result };
        } catch (error) {
            const msg = (error.response && error.response.data && error.response.data.description) || error.message;
            console.error(`[TELEGRAM_TEKNISI] Gagal kirim pesan ke ${chatId}: ${msg}`);
            return { success: false, error: msg };
        }
    }

    /**
     * Jawab callback query (tekan tombol inline) — dipakai fase aksi nanti. Best-effort.
     */
    async function answerCallbackQuery(callbackQueryId, options = {}) {
        try {
            await callApi(
                "answerCallbackQuery",
                {
                    callback_query_id: callbackQueryId,
                    text: options.text,
                    show_alert: !!options.showAlert,
                },
                { timeoutMs: 10000 }
            );
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Daftarkan daftar perintah bot ke Telegram agar muncul sebagai auto-complete (menu "/").
     * Best-effort & never-throw (kegagalan tidak boleh menjatuhkan start bot).
     * @param {Array<{command:string, description:string}>} commands - nama TANPA slash, lower-case.
     * @returns {Promise<{success:boolean, error?:string}>}
     */
    async function setMyCommands(commands) {
        try {
            const data = await callApi("setMyCommands", { commands }, { timeoutMs: 10000 });
            return { success: !!(data && data.ok) };
        } catch (error) {
            const msg = (error.response && error.response.data && error.response.data.description) || error.message;
            console.error(`[TELEGRAM_TEKNISI] setMyCommands gagal: ${msg}`);
            return { success: false, error: msg };
        }
    }

    /**
     * Validasi token / ambil identitas bot. Best-effort (null bila gagal).
     */
    async function getMe() {
        try {
            const data = await callApi("getMe", {}, { timeoutMs: 10000 });
            return data && data.ok ? data.result : null;
        } catch (__e) {
            return null;
        }
    }

    return { getUpdates, sendMessage, safeSendMessage, answerCallbackQuery, getMe, abortInflight, setMyCommands, botToken };
}

module.exports = { createTelegramClient, TELEGRAM_API };
