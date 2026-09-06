/**
 * Header Doc
 * Purpose: Helper bersama command-handlers Telegram teknisi — resolusi 1 pelanggan dari
 *          argumen perintah ATAU dari id tombol (callback), balasan baku untuk arg kosong/
 *          tak ditemukan/ambigu, serta builder inline keyboard (tombol aksi pelanggan & list
 *          kandidat) agar teknisi bisa cek 1-ketuk tanpa mengetik ulang. Menjaga handler tipis.
 * Caller: `message/telegram/command-handlers/*`, dipakai juga oleh dispatcher (lewat handler).
 * Deps: `message/telegram/customer-lookup` (findById), `lib/telegram/telegram-format`.
 * MainFuncs: `resolveCustomerOrReply(ctx, deps, opts)`, `customerActionsKeyboard`, `candidatesKeyboard`.
 * SideEffects: hanya mengirim balasan via ctx.reply.
 */
"use strict";

const { escapeHtml, b, code } = require("../../../lib/telegram/telegram-format");
const { findById } = require("../customer-lookup");
const recents = require("./recents");

function displayName(user) {
    return String((user && user.name) || "").split("|")[0].trim() || "(tanpa nama)";
}

function firstPart(value) {
    return String(value == null ? "" : value).split("|")[0].trim();
}

// Tombol aksi untuk satu pelanggan: drill-down diagnosa tanpa ketik ulang.
// callback_data 'do:<cmd>:<id>' dipakai dispatcher (READ-ONLY).
function customerActionsKeyboard(user) {
    const id = user && user.id;
    if (id == null) return undefined;
    return {
        inline_keyboard: [
            [{ text: "🩺 Cek Lengkap", callback_data: `do:cek:${id}` }],
            [
                { text: "📶 Redaman", callback_data: `do:redaman:${id}` },
                { text: "🔌 Koneksi", callback_data: `do:koneksi:${id}` },
            ],
            [
                { text: "📡 Modem", callback_data: `do:modem:${id}` },
                { text: "🛰️ OLT", callback_data: `do:olt:${id}` },
            ],
        ],
    };
}

// List kandidat (saat pencarian ambigu) jadi tombol; ketuk → langsung jalankan
// perintah yang sama untuk pelanggan terpilih (mempertahankan niat awal).
function candidatesKeyboard(candidates, command) {
    const cmd = command || "pelanggan";
    return {
        inline_keyboard: candidates.map((u) => [
            {
                text: `${displayName(u)} · ${firstPart(u.pppoe_username) || "-"}`,
                callback_data: `do:${cmd}:${u.id}`,
            },
        ]),
    };
}

function fmtCandidates(candidates, truncated, example) {
    const lines = candidates.map((u, i) => `${i + 1}. ${escapeHtml(displayName(u))} — <code>${escapeHtml(firstPart(u.pppoe_username))}</code>`);
    let text = `🔎 Ditemukan ${b(candidates.length + (truncated ? "+" : ""))} pelanggan. Ketuk tombol di bawah untuk memilih, atau perjelas kata kunci:\n\n${lines.join("\n")}`;
    if (truncated) text += "\n\n…dan lainnya. Persempit kata kunci.";
    if (example) text += `\n\nContoh: ${code(example)}`;
    return text;
}

/**
 * Resolusi pelanggan dari ctx.resolvedUserId (tombol) atau ctx.args (teks).
 * Mengembalikan user bila tepat satu; selain itu mengirim balasan yang sesuai
 * (termasuk tombol kandidat saat ambigu) dan mengembalikan null.
 * @param {object} ctx - { args?, resolvedUserId?, reply }
 * @param {object} deps - { findOneCustomer, getUsers, findById? }
 * @param {object} [opts] - { example?:string, command?:string }
 * @returns {Promise<object|null>}
 */
async function resolveCustomerOrReply(ctx, deps, opts = {}) {
    const getUsers = deps.getUsers || (() => global.users || []);
    const users = getUsers();

    // Jalur tombol: resolusi langsung by id (tanpa pencarian teks).
    if (ctx.resolvedUserId != null) {
        const finder = deps.findById || findById;
        const u = finder(ctx.resolvedUserId, users);
        if (u) {
            (deps.recents || recents).record(ctx.chatId, u);
            return u;
        }
        await ctx.reply("🔍 Data pelanggan tidak ditemukan (mungkin sudah berubah). Coba cari lagi.");
        return null;
    }

    const example = opts.example || "/pelanggan budi@isp";
    const query = String(ctx.args || "").trim();
    if (!query) {
        await ctx.reply(`Sertakan kata kunci pelanggan (PPPoE / nama / no HP / serial).\n\nContoh: ${code(example)}`);
        return null;
    }

    const { user, candidates, truncated } = deps.findOneCustomer(query, users);
    if (user) {
        (deps.recents || recents).record(ctx.chatId, user);
        return user;
    }
    if (candidates && candidates.length) {
        await ctx.reply(fmtCandidates(candidates, truncated, example), {
            replyMarkup: candidatesKeyboard(candidates, opts.command),
        });
        return null;
    }
    await ctx.reply(`🔍 Pelanggan "${b(query)}" tidak ditemukan.\nCoba kata kunci lain (PPPoE / nama / no HP / serial).`);
    return null;
}

function unwrapPppoeList(res) {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    if (res && res.data && Array.isArray(res.data.data)) return res.data.data;
    return [];
}

/**
 * Daftar sesi PPPoE aktif (best-effort) untuk resolveByCustomer. Ini SUMBER MAC UTAMA (caller_id
 * sesi live) — jauh lebih akurat dari cache file, dan WAJIB dioper agar /olt & /redaman memetakan
 * ONU sama benarnya dengan /cek (semua OLT Hioso/EPON: MAC-prefix satu-satunya jalur match untuk
 * pelanggan tanpa deskripsi/serial). MikroTik gagal/tak terjangkau → [] (resolver fallback ke cache).
 */
async function getActivePppoeList(deps, caller) {
    try {
        if (!deps || typeof deps.getActivePPPoEUsers !== "function") return [];
        const res = await deps.getActivePPPoEUsers({ caller });
        if (res && res.ok === false) return [];
        return unwrapPppoeList(res);
    } catch (_e) {
        return [];
    }
}

module.exports = {
    resolveCustomerOrReply,
    customerActionsKeyboard,
    candidatesKeyboard,
    fmtCandidates,
    displayName,
    firstPart,
    getActivePppoeList,
};
