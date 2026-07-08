/**
 * Header Doc
 * Purpose: Matcher intent lapis kedua (LONGGAR) — mendeteksi maksud pelanggan dari bahasa bebas:
 *          kata kunci boleh di posisi mana saja + kamus sinonim/typo hasil tambang korpus chat prod
 *          (message_logs.sqlite, review 2026-07-02 & 2026-07-07). HANYA memetakan ke intent aman:
 *          CEK_KONEKSI (read-only), GANTI_SANDI_WIFI (mendarat di wizard tanya-sandi, TIDAK pernah
 *          mengambil password dari kalimat), dan HISTORY_WIFI (read-only, kasus "lupa sandi").
 *          Intent mutasi lain tetap eksklusif milik matcher ketat (lib/wifi_template_handler.js).
 * Caller: `message/handlers/raf-state-routing.js` (resolveKeywordIntent, saat matcher ketat gagal)
 *         dan `message/handlers/customer-fallback-handler.js` (sinyal keluhan koneksi).
 * Deps: lazy `./app-entity-extractor` (sebutan app+gejala sbg konteks jaringan; murni, opsional).
 * MainFuncs: `getLooseIntentFromKeywords`, `hasConnectivityComplaintSignal`.
 * SideEffects: Tidak ada.
 */
"use strict";

// Batas panjang: kalimat sangat panjang (broadcast/forward-an) jangan ditebak-tebak.
const MAX_TOKENS = 30;

// Konteks jaringan — kata yang menandakan pembicaraan soal internet/WiFi (termasuk bentuk Jawa
// "wifine"/"jaringane" dan variasi -nya yang sering muncul di korpus).
const CONTEXT_TOKENS = new Set([
    "wifi", "wifine", "wifinya", "wifiku", "wify", "wifii",
    "internet", "internetnya", "internete", "internetku", "inet", "inetnya",
    "jaringan", "jaringannya", "jaringane", "jaringanku",
    "koneksi", "koneksinya", "konek", "koneknya",
    "sinyal", "sinyale", "sinyalnya", "signal",
    "modem", "modemnya", "router", "routernya", "net"
]);

// Gejala gangguan — satu kata. ("lag"/"lagg"/"muter" dari korpus: "lagg banget", "muter muter 5 menit")
const SYMPTOM_TOKENS = new Set([
    "lemot", "lemotnya", "lambat", "lelet", "lola", "pelan",
    "lag", "lagg", "ngelag", "ngadat", "buffering", "muter",
    "mati", "putus", "putusnya", "nyendat", "macet",
    "eror", "error", "err", "gangguan", "trouble",
    "hilang", "ilang", "lost", "los", "merah",
    "down", "drop", "ngedrop", "lambet", "patah"
]);

// Gejala gangguan — frasa multi-kata (dicek pada string ternormalisasi dengan pembatas spasi).
const SYMPTOM_PHRASES = [
    "tidak bisa", "tak bisa", "gak bisa", "ga bisa", "gabisa", "tdk bisa",
    "ra iso", "gak iso", "ora iso",
    "tidak ada", "gak ada", "ga ada", "gada",
    "tidak jalan", "gak jalan", "ga jalan",
    "tidak konek", "gak konek", "ga konek",
    "tidak nyambung", "gak nyambung", "ga nyambung",
    "tidak lancar", "gak lancar", "gk lancar", "ga lancar",
    "tidak stabil", "gak stabil", "ga stabil",
    "no internet", "tidak muncul", "gak muncul",
    "muter muter", "putus putus", "patah patah"
];

// Permintaan pengecekan eksplisit ("Tolong dicek Wifi-nya kk").
const CHECK_REQUEST_TOKENS = new Set([
    "cek", "dicek", "cekin", "periksa", "diperiksa", "check", "ceki"
]);

// Kosakata sandi/password (typo "pasword"/"paswod" sengaja diakomodasi; "knta sandi" dari korpus
// tetap tertangkap karena token "sandi"-nya utuh).
const PASSWORD_TOKENS = new Set([
    "sandi", "sandinya", "password", "passwordnya", "pasword", "paswod", "passwod",
    "pass", "pw", "katasandi"
]);

// Kata kerja niat mengubah sandi.
const PASSWORD_ACTION_TOKENS = new Set([
    "ganti", "diganti", "gantikan", "gnti", "ubah", "diubah", "rubah", "dirubah",
    "reset", "direset", "bikin", "buat"
]);

const FORGOT_TOKENS = new Set(["lupa", "lali", "kelupaan"]);

function normalizeText(message) {
    return String(message || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(message) {
    const normalized = normalizeText(message);
    return normalized ? normalized.split(" ") : [];
}

function hasAny(tokens, tokenSet) {
    return tokens.some((token) => tokenSet.has(token));
}

function findPhrase(normalized) {
    const padded = ` ${normalized} `;
    return SYMPTOM_PHRASES.find((phrase) => padded.includes(` ${phrase} `)) || null;
}

/**
 * Sinyal keluhan koneksi (gejala saja, TANPA syarat kata konteks) — dipakai fallback anti-diam
 * untuk teks pelanggan seperti "Ga bisa ini" / "Lemot banget".
 * @param {string} message
 * @returns {boolean}
 */
function hasConnectivityComplaintSignal(message) {
    const tokens = tokenize(message);
    if (!tokens.length || tokens.length > MAX_TOKENS) return false;
    return hasAny(tokens, SYMPTOM_TOKENS) || Boolean(findPhrase(tokens.join(" ")));
}

/**
 * Matcher longgar. Dipanggil HANYA saat matcher ketat gagal, dan HANYA untuk pengirim non-staf
 * (gate di caller). Kembalian meniru bentuk `getIntentFromKeywords` + flag `loose`.
 * PENTING: caller wajib memperlakukan seluruh kalimat sebagai keyword (matchedKeywordLength =
 * jumlah kata) supaya parameter (mis. password) TIDAK pernah diambil dari kalimat bebas.
 * @param {string} message
 * @returns {{intent: string, matchedKeyword: string, loose: true}|null}
 */
function getLooseIntentFromKeywords(message) {
    const tokens = tokenize(message);
    if (!tokens.length || tokens.length > MAX_TOKENS) return null;

    const normalized = tokens.join(" ");
    const hasPasswordWord = hasAny(tokens, PASSWORD_TOKENS);

    // Prioritas 1 — niat ganti sandi (korpus: "Kata sandi ganti misnadin916",
    // "MET malam pak mai ganti knta sandi", "ganti kata sandi kayla000").
    // Diperiksa SEBELUM keluhan koneksi karena "Lemot pak ganti sandi aja" maunya ganti sandi.
    if (hasPasswordWord && hasAny(tokens, PASSWORD_ACTION_TOKENS)) {
        return { intent: "GANTI_SANDI_WIFI", matchedKeyword: "loose:sandi+aksi", loose: true };
    }

    // Prioritas 2 — lupa sandi → riwayat WiFi (read-only; password memang ditampilkan sebagai
    // fitur self-recovery, lihat memori wifi-password-plaintext-is-feature).
    if (hasPasswordWord && hasAny(tokens, FORGOT_TOKENS)) {
        return { intent: "HISTORY_WIFI", matchedKeyword: "loose:sandi+lupa", loose: true };
    }

    if (hasPasswordWord && tokens.includes("baru")) {
        return { intent: "GANTI_SANDI_WIFI", matchedKeyword: "loose:sandi+baru", loose: true };
    }

    // Prioritas 2.5 — sebutan APLIKASI + gejala ("tik tok muter", "youtube lemot", "game ngelag"):
    // aplikasi yang dinamai berlaku sebagai konteks jaringan yang kuat, jadi tak perlu kata
    // "wifi/internet". Menjawab pola korpus "Digae tik tok kog muter terus" yang sebelumnya lolos.
    // Read-only (CEK_KONEKSI); diagnosa app-spesifik dilakukan handler dari teks mentah.
    try {
        // topAppEntity (cap 40 token) — bukan hasBareAppMention (cap 8) — supaya kalimat panjang
        // spt "Tiktok kadang buat buka komentar muter muter 5 menit" tetap tertangkap.
        const { topAppEntity } = require("./app-entity-extractor");
        const appMention = topAppEntity(normalized);
        if (appMention && appMention.symptom) {
            return { intent: "CEK_KONEKSI", matchedKeyword: `loose:app:${appMention.key}`, loose: true };
        }
    } catch (_e) { /* ekstraktor opsional — jangan jatuhkan matcher */ }

    // Prioritas 3 — keluhan/permintaan cek koneksi: wajib ada kata KONTEKS jaringan supaya
    // kalimat umum ("Ga bisa ini") tidak salah tangkap; gejala tunggal tanpa konteks ditangani
    // fallback anti-diam (khusus pelanggan terdaftar, lihat customer-fallback-handler).
    const hasContext = hasAny(tokens, CONTEXT_TOKENS);
    if (hasContext) {
        const symptomToken = tokens.find((token) => SYMPTOM_TOKENS.has(token)) || null;
        const symptomPhrase = findPhrase(normalized);
        const checkToken = tokens.find((token) => CHECK_REQUEST_TOKENS.has(token)) || null;
        const matched = symptomToken || symptomPhrase || checkToken;
        if (matched) {
            return { intent: "CEK_KONEKSI", matchedKeyword: `loose:${matched}`, loose: true };
        }
    }

    return null;
}

module.exports = {
    getLooseIntentFromKeywords,
    hasConnectivityComplaintSignal,
    // Diekspor untuk keperluan test/tuning kamus.
    _internal: { normalizeText, tokenize }
};
