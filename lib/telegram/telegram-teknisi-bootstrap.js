/**
 * Header Doc
 * Purpose: Lifecycle bot Telegram teknisi — long-poll `getUpdates` (single-consumer, cocok
 *          dengan invariant single-instance) lalu dispatch ke command handlers. start/stop/
 *          restart/getStatus dengan guard agar tidak ada dua loop. Loop pakai await-rekursif
 *          (while + await), BUKAN setInterval, supaya satu siklus lambat tidak menumpuk.
 *          Tiap loop memegang OBJEK SESI sendiri (di-thread eksplisit) agar restart yang membuat
 *          sesi baru tidak menyebabkan loop lama "kehilangan" sinyal berhenti → dua consumer/409.
 * Hardening (mencegah bug nyata):
 *   - Restart aman: stop → ABORT long-poll yang menggantung → TUNGGU loop lama benar-benar
 *     selesai → baru start (anti dua consumer pada satu token = 409).
 *   - Stop terminal: token ditolak (401/404/Unauthorized) = permanen → loop berhenti, TIDAK
 *     spin tiap 5s selamanya. 409 (consumer ganda) tetap transient → tetap di-retry.
 *   - Anti-replay cold-start: pesan teks "basi" (dibuat sebelum bot start, sisa antrian saat
 *     bot down) dibuang pada jendela awal — penting begitu aksi tulis aktif, agar /reboot
 *     sejam lalu TIDAK tereksekusi saat bot baru bangun. Offset tetap dimajukan.
 * Caller: `lib/app-runtime.js#initializeBackgroundServices` (start), `lib/process-lifecycle.js`
 *         (stop saat SIGTERM/SIGINT), `routes/admin-telegram-teknisi-routes.js` (restart on config save).
 * Deps: `./telegram-teknisi-client`, `./telegram-intent-dispatch`,
 *       `message/telegram/command-handlers` (buildCommandMap), `repositories/telegram-teknisi.repository`.
 * MainFuncs: `startTelegramTeknisiBot`, `stopTelegramTeknisiBot`, `restartTelegramTeknisiBot` (async), `getStatus`.
 * SideEffects: HTTP long-poll ke Telegram; mengirim balasan; mendaftarkan menu perintah
 *              (setMyCommands, best-effort) sekali per start. Token dibaca dari global.config.
 */
"use strict";

const { createTelegramClient } = require("./telegram-teknisi-client");
const { createTelegramDispatcher } = require("./telegram-intent-dispatch");

const RETRY_DELAY_MS = 5000;
// Selama jendela ini setelah start, pesan teks yang dibuat SEBELUM bot hidup (sisa antrian saat
// bot down) dibuang — anti-replay. Cukup untuk menguras backlog yang datang di siklus pertama.
const COLD_START_GRACE_MS = 15000;
// Toleransi selisih jam: pesan yang dibuat ≤5s sebelum start tetap dianggap "baru".
const CLOCK_SKEW_MS = 5000;

// Menu perintah untuk auto-complete "/" di Telegram (setMyCommands). Nama TANPA slash, lower-case.
// Selaras dengan buildCommandMap (alias /diagnosa,/start,/menu sengaja tak ditampilkan).
const TEKNISI_COMMANDS = [
    { command: "cek", description: "Diagnosa lengkap pelanggan (vonis + saran)" },
    { command: "redaman", description: "Redaman 2 arah: modem (GenieACS) + OLT" },
    { command: "koneksi", description: "Status koneksi PPPoE pelanggan" },
    { command: "modem", description: "Info modem/ONU via GenieACS" },
    { command: "olt", description: "Status ONU di OLT (SNMP)" },
    { command: "pelanggan", description: "Cari pelanggan (nama/PPPoE/HP/serial)" },
    { command: "terakhir", description: "Pelanggan yang terakhir dicek" },
    { command: "help", description: "Bantuan & daftar perintah" },
];

let state = newState();
let currentClient = null; // klien loop aktif — untuk abort long-poll saat stop/restart.
let loopDone = null; // promise loop aktif — untuk menunggu loop lama berhenti sebelum start ulang.

function newState() {
    return {
        running: false,
        stopped: false,
        offset: undefined,
        pollTimeoutSec: 50,
        startedAtMs: null,
        lastPollAt: null,
        lastError: null,
        terminal: false, // true bila token ditolak (loop berhenti permanen sampai diperbaiki).
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
    return new Date().toISOString();
}

/**
 * Pesan teks "basi": update message yang dibuat sebelum bot start (di luar toleransi skew).
 * HANYA untuk `message` — callback_query (read-only / konfirmasi 2-langkah) tidak difilter,
 * karena `date`-nya adalah waktu kartu dikirim, bukan waktu tombol ditekan.
 */
function isStaleMessage(update, startedAtMs) {
    const msg = update && update.message;
    if (!msg || typeof msg.date !== "number" || startedAtMs == null) return false;
    return msg.date * 1000 < startedAtMs - CLOCK_SKEW_MS;
}

/**
 * Error permanen yang tak akan sembuh dengan retry: token salah/dicabut (401/404/Unauthorized).
 * Sengaja TIDAK termasuk 409 (consumer ganda) — itu transient & harus tetap di-retry.
 */
function isTerminalAuthError(e) {
    if (!e) return false;
    const status = e.response && e.response.status;
    const code = e.response && e.response.data && e.response.data.error_code;
    if (status === 401 || status === 404 || code === 401 || code === 404) return true;
    return /unauthorized/i.test(String(e.message || ""));
}

function readConfig() {
    const cfg = (global.config && global.config.telegramTeknisi) || {};
    const pollTimeoutSec = Number.isInteger(cfg.pollTimeoutSec) && cfg.pollTimeoutSec >= 1 ? cfg.pollTimeoutSec : 50;
    return {
        enabled: cfg.enabled === true,
        botToken: cfg.botToken || "",
        pollTimeoutSec,
    };
}

function isPlaceholderToken(token) {
    return !token || String(token).startsWith("ISI_");
}

/**
 * Mulai bot. Idempoten (guard: tidak akan membuat loop kedua).
 * @param {object} [opts] - injeksi untuk test: { client, dispatcher, repository, commands, autoLoop }
 * @returns {{client:object, dispatcher:object}|undefined} handle bila berhasil start, undefined bila tidak.
 */
function startTelegramTeknisiBot(opts = {}) {
    if (state.running) {
        console.log("[TELEGRAM_TEKNISI] Sudah berjalan — start diabaikan.");
        return undefined;
    }

    const cfg = readConfig();
    if (!cfg.enabled) {
        console.log("[TELEGRAM_TEKNISI] Nonaktif (set config.telegramTeknisi.enabled=true untuk mengaktifkan).");
        return undefined;
    }
    if (isPlaceholderToken(cfg.botToken)) {
        console.warn("[TELEGRAM_TEKNISI] botToken belum diisi — bot teknisi tidak dijalankan.");
        return undefined;
    }

    const client = opts.client || createTelegramClient(cfg.botToken);
    const repository =
        opts.repository || require("../../repositories/telegram-teknisi.repository").telegramTeknisiRepository;
    const commands = opts.commands || require("../../message/telegram/command-handlers").buildCommandMap();
    const dispatcher = opts.dispatcher || createTelegramDispatcher({ repository, commands });

    state = newState();
    state.running = true;
    state.pollTimeoutSec = cfg.pollTimeoutSec;
    state.startedAtMs = Date.now();
    currentClient = client;
    loopDone = null;

    console.log(`[TELEGRAM_TEKNISI] Bot teknisi mulai (long-poll, timeout ${cfg.pollTimeoutSec}s).`);

    // Daftarkan menu perintah (auto-complete "/") — best-effort, sekali per start, never-throw.
    if (client && typeof client.setMyCommands === "function") {
        try {
            Promise.resolve(client.setMyCommands(TEKNISI_COMMANDS)).catch((e) =>
                console.error("[TELEGRAM_TEKNISI] setMyCommands error:", e.message)
            );
        } catch (e) {
            console.error("[TELEGRAM_TEKNISI] setMyCommands error:", e.message);
        }
    }

    if (opts.autoLoop !== false) {
        const session = state; // tangkap sesi ini; loop hanya peduli pada sesinya sendiri.
        loopDone = pollLoop(client, dispatcher, session).catch((e) => {
            console.error("[TELEGRAM_TEKNISI] Loop poll berhenti tak terduga:", e.message);
            session.running = false;
        });
    }

    return { client, dispatcher };
}

/**
 * Satu siklus poll: ambil update, majukan offset, dispatch tiap update.
 * @param {object} [session=state] - sesi loop pemilik (default: sesi aktif). Di-thread eksplisit
 *        agar loop lama tetap memakai sesinya sendiri saat restart membuat sesi baru.
 */
async function pollOnce(client, dispatcher, session = state) {
    const updates = await client.getUpdates({ offset: session.offset, timeoutSec: session.pollTimeoutSec });
    session.lastPollAt = nowIso();
    session.lastError = null;

    const inColdStart = session.startedAtMs != null && Date.now() - session.startedAtMs < COLD_START_GRACE_MS;
    let skippedStale = 0;

    for (const update of updates) {
        // Majukan offset lebih dulu supaya update yang sama tidak diproses ulang walau handler error.
        if (update && typeof update.update_id === "number") {
            session.offset = update.update_id + 1;
        }
        // Anti-replay cold-start: buang perintah teks basi sisa antrian saat bot down (offset
        // tetap maju di atas, jadi update tidak ditarik ulang).
        if (inColdStart && isStaleMessage(update, session.startedAtMs)) {
            skippedStale++;
            continue;
        }
        try {
            await dispatcher.handleUpdate(update, { client });
        } catch (e) {
            console.error("[TELEGRAM_TEKNISI] handleUpdate error:", e.message);
        }
    }
    if (skippedStale > 0) {
        console.warn(`[TELEGRAM_TEKNISI] Lewati ${skippedStale} pesan basi (antrian sebelum bot start) — anti-replay.`);
    }
    return updates;
}

async function pollLoop(client, dispatcher, session = state) {
    while (session.running && !session.stopped) {
        try {
            await pollOnce(client, dispatcher, session);
        } catch (e) {
            // Stop diminta saat long-poll menggantung (kemungkinan di-abort) → keluar diam-diam.
            if (session.stopped) break;
            // Token salah/dicabut → permanen. Hentikan loop; jangan spin tiap 5s selamanya.
            if (isTerminalAuthError(e)) {
                session.terminal = true;
                session.running = false;
                session.lastError = { at: nowIso(), message: e.message, terminal: true };
                console.error(
                    `[TELEGRAM_TEKNISI] Token ditolak Telegram (${e.message}) — loop dihentikan. Perbaiki botToken lalu simpan ulang konfigurasi.`
                );
                break;
            }
            // 409 (consumer ganda) / timeout / jaringan → transient: catat, jeda, coba lagi.
            session.lastError = { at: nowIso(), message: e.message };
            console.error("[TELEGRAM_TEKNISI] getUpdates error:", e.message);
            await delay(RETRY_DELAY_MS);
        }
    }
    console.log("[TELEGRAM_TEKNISI] Loop poll selesai.");
}

function stopTelegramTeknisiBot() {
    if (!state.running) return;
    state.running = false;
    state.stopped = true;
    // Batalkan long-poll yang menggantung agar loop keluar segera (bukan menunggu ≤65s).
    if (currentClient && typeof currentClient.abortInflight === "function") {
        try {
            currentClient.abortInflight();
        } catch (__e) {
            /* best-effort */
        }
    }
    console.log("[TELEGRAM_TEKNISI] Stop diminta — loop berhenti pada siklus berikutnya.");
}

/**
 * Restart aman (async, fire-and-forget bagi pemanggil — admin route tidak meng-await):
 * hentikan loop lama, ABORT long-poll-nya, TUNGGU ia benar-benar selesai, baru start ulang.
 * Ini mencegah dua consumer getUpdates pada satu token (= 409) — akar bug race restart lama
 * yang memakai setTimeout(1500) padahal long-poll bisa menahan koneksi hingga ~65s. Cap tunggu
 * mencegah restart menggantung bila loop macet (dengan abort biasanya selesai <1s).
 */
async function restartTelegramTeknisiBot() {
    const prev = loopDone;
    const waitCapMs = (state.pollTimeoutSec + 20) * 1000;
    stopTelegramTeknisiBot();
    if (prev) {
        // prev sudah di-catch di start() → tidak akan reject; race dengan cap sebagai pengaman.
        await Promise.race([prev, delay(waitCapMs)]);
    }
    return startTelegramTeknisiBot();
}

function getStatus() {
    const cfg = readConfig();
    return {
        running: state.running,
        offset: state.offset,
        lastPollAt: state.lastPollAt,
        lastError: state.lastError,
        // true → token ditolak, loop berhenti permanen sampai botToken diperbaiki & disimpan ulang.
        terminal: state.terminal === true,
        config: {
            enabled: cfg.enabled,
            pollTimeoutSec: cfg.pollTimeoutSec,
            tokenConfigured: !isPlaceholderToken(cfg.botToken),
        },
    };
}

module.exports = {
    startTelegramTeknisiBot,
    stopTelegramTeknisiBot,
    restartTelegramTeknisiBot,
    getStatus,
    // Internal — test.
    _pollOnce: pollOnce,
    _pollLoop: pollLoop,
    _isStaleMessage: isStaleMessage,
    _isTerminalAuthError: isTerminalAuthError,
    _getState: () => state,
    _resetState: () => {
        state = newState();
        currentClient = null;
        loopDone = null;
    },
};
