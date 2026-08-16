/**
 * Header Doc
 * Purpose: Menafsirkan jawaban pendek pelanggan WhatsApp ("Ok mas", "ya ka", "masih lemot kk",
 *          "ini baru dicoba cabut") menjadi niat tegas. Dibuat karena korpus chat nyata menunjukkan
 *          balasan afirmatif hampir selalu bersapaan — exact-match `["ya","ok"]` hanya lolos 17%.
 * Caller: `message/handlers/states/other-state-handler.js` (konfirmasi reboot),
 *         `message/handlers/states/reboot-followup-state-handler.js`,
 *         `message/handlers/connection-check-handler.js` (deteksi "sudah restart sendiri").
 * Deps: Tidak ada.
 * MainFuncs: `isAffirmative`, `isCleanConsent`, `isCleanRebootConsent`, `isDecline`, `isResolvedAnswer`, `isUnresolvedAnswer`, `saysAlreadyRestarted`.
 * SideEffects: Tidak ada (fungsi murni).
 */
"use strict";

// Kata sanggahan. Diperiksa DULUAN supaya "ga bisa" / "belum lancar" tidak dibaca afirmatif
// hanya karena mengandung "bisa" / "lancar".
// ⚠️ "tak" SENGAJA TIDAK di sini: di dialek pelanggan (Bojonegoro) "tak" = "saya", bukan "tidak".
// Korpus nyata: "Sudah tak bayar ya kak" = sudah SAYA bayar; "Sudah tak coba semua hp" = sudah SAYA coba.
const NEGATION_TOKENS = new Set([
    "ga", "gak", "gk", "ngga", "nggak", "enggak", "engga", "tidak", "tdk",
    "ora", "durung", "belum", "blm", "belom", "jangan", "jgn", "gausah", "batal"
]);

// Jawaban "iya, silakan". Termasuk ragam Jawa & gaul yang muncul di korpus.
const AFFIRM_TOKENS = new Set([
    "ya", "y", "iya", "iyo", "yo", "ok", "oke", "okey", "okay", "oks",
    "boleh", "monggo", "mangga", "silakan", "silahkan", "gas", "lanjut", "lanjutkan",
    "siap", "sip", "sipp", "baik", "baiklah", "setuju", "mau", "yaudah", "yowes", "yuk",
    "nggih", "njih", "inggih", "bisa", "tolong", "please"
]);

// Penolakan eksplisit (di luar kata batal universal yang sudah ditangani router state).
const DECLINE_TOKENS = new Set([
    "nanti", "besok", "entar", "engko", "mengko", "skip", "no", "gausah", "jangan", "jgn", "batal"
]);

// Kata "muatan lain" yang menandakan pesan sebenarnya BUKAN sekadar menyetujui reboot, melainkan
// permintaan/pertanyaan/ucapan lain ("bisa cek tagihan?", "siap kak makasih", "boleh minta info
// paket", "ya tapi kok mahal"). Kalau salah satunya muncul → BUKAN konsen bersih → jangan reboot.
// Pakai BLOCKLIST (bukan whitelist partikel) supaya "ya ka"/"iya dong mas" tetap lolos.
const CONSENT_BLOCKERS = new Set([
    "cek", "dicek", "cekin", "tagihan", "bayar", "pembayaran", "transfer", "tf", "saldo", "topup",
    "voucher", "kuota", "sandi", "password", "pass", "pw", "wifi", "ssid",
    "lapor", "laporan", "keluhan", "komplain", "beli", "harga", "biaya", "paket", "upgrade", "downgrade",
    "info", "informasi", "tanya", "nanya", "takon", "menu", "daftar", "psb", "pasang",
    "makasih", "makasi", "trimakasih", "terimakasih", "terima", "suwun", "matur", "thanks", "thx", "tengkyu",
    "mahal", "murah", "kapan", "berapa", "brp", "kenapa", "knp", "gimana", "gmn", "piye", "mana", "dimana"
]);

// Tanda masalah MASIH ada saat ditanya "sudah lancar?".
// ⚠️ "sama"/"pada" TIDAK dimasukkan sebagai token tunggal — terlalu umum. Korpus nyata:
// "Sudah tak bayar ya kak sama punya ibu ku" ("sama" = "dan") akan salah dibaca sebagai keluhan.
// Makna "tidak berubah" ditangkap lewat UNRESOLVED_PHRASES.
const UNRESOLVED_TOKENS = new Set([
    "masih", "msh", "tetep", "tetap", "podo", "durung", "belum", "blm", "belom",
    "lemot", "lelet", "lambat", "lambet", "lag", "lagg", "ngelag", "muter", "buffering",
    "putus", "mati", "eror", "error", "ngadat", "macet", "medhot", "medot", "pedot", "drop"
]);

const UNRESOLVED_PHRASES = [
    "sama saja", "sama aja", "sama wae", "sami mawon", "podo wae",
    "tetap sama", "tetep sama", "masih sama", "gitu aja", "gitu terus", "gini terus"
];

// Tanda masalah SUDAH beres. "sudah/udah" sengaja lemah — kalimat "sudah tp masih lemot"
// harus jatuh ke UNRESOLVED, karena itu diperiksa lebih dulu.
const RESOLVED_TOKENS = new Set([
    "sudah", "udah", "udh", "sdh", "dah", "wes", "wis", "uwis", "sampun",
    "stabil", "lancar", "normal", "aman", "beres", "jalan", "nyala", "konek", "nyambung",
    "mantap", "mantul", "alhamdulillah", "makasih", "terimakasih", "trimakasih", "suwun", "sip", "oke", "ok"
]);

// Pelanggan sudah mencabut/restart modem sendiri — menawarkan reboot lagi terasa mengabaikan.
const RESTART_ACTION_TOKENS = new Set([
    "cabut", "dicabut", "nyabut", "restart", "direstart", "restar", "reboot", "direboot",
    "matiin", "dimatiin", "matikan", "dimatikan", "colok", "dicolok"
]);
const RESTART_DONE_TOKENS = new Set([
    "sudah", "udah", "udh", "sdh", "dah", "wes", "wis", "uwis", "baru", "barusan", "tadi", "berkali", "berulang"
]);

const RESTART_DONE_PHRASES = ["berkali kali", "berkali-kali", "berulang kali", "bolak balik"];

function normalizeText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenize(text) {
    const normalized = normalizeText(text);
    return normalized ? normalized.split(" ") : [];
}

function hasAny(tokens, set) {
    return tokens.some((t) => set.has(t));
}

function hasNegation(tokens) {
    return hasAny(tokens, NEGATION_TOKENS);
}

// ── Niat MEMBATALKAN ─────────────────────────────────────────────────────────────────────────
// Kata yang berdiri sendiri sudah cukup berarti "batalkan".
const CANCEL_TOKENS = new Set([
    "batal", "batalkan", "dibatalkan", "cancel", "canceled", "cancelled", "stop", "hentikan", "berhenti"
]);
// Partikel/sapaan yang boleh menempel tanpa mengubah maknya ("batal aja", "batal ya kak").
const CANCEL_FILLERS = new Set([
    "aja", "saja", "wae", "ae", "dulu", "dhisik", "sik", "ya", "yaa", "yah", "yo", "deh", "dah",
    "kak", "ka", "mas", "mbak", "pak", "bu", "bang", "min", "admin", "gan", "om", "kok", "lah", "sudah", "udah", "udh"
]);
// Pasangan "tidak/nggak/ora + jadi" — bentuk paling umum di korpus.
const CANCEL_PAIR_TAIL = new Set(["jadi", "sido", "sidho", "usah"]);

/**
 * Apakah pesan ini berarti "batalkan"?
 *
 * SENGAJA KETAT, bukan longgar. Fungsi ini dipakai di langkah yang meminta pelanggan mengetik
 * NAMA atau SANDI WiFi — kalau terlalu longgar, nama/sandi yang sah malah ditolak, dan itu
 * kerusakan yang setara. Karena itu hanya dianggap batal bila SELURUH pesan tak berisi apa pun
 * selain kata batal + partikel. "batalkan123" (satu token, bukan kata batal murni) tetap
 * diperlakukan sebagai nilai.
 *
 * KENAPA ADA — daftar lama cocok-PERSIS `['batal','cancel','ga jadi','gak jadi']`, sehingga
 * "batal aja", "batalkan", "batal ya kak", "tidak jadi", "STOP" semuanya lolos dan langsung
 * dipakai sebagai nama/sandi WiFi rumah pelanggan. Ini kesalahan yang sama dengan daftar
 * afirmasi cocok-persis yang dulu menolak 83% ucapan setuju nyata (lihat CLAUDE.md).
 */
function isCancelIntent(text) {
    const tokens = tokenize(text);
    if (!tokens.length || tokens.length > 4) return false;

    const inti = tokens.filter((t) => !CANCEL_FILLERS.has(t));
    if (!inti.length) return false; // cuma partikel ("ya kak") — bukan pembatalan

    // Bentuk "tidak/nggak/ora + jadi|usah|sido".
    if (inti.length === 2 && NEGATION_TOKENS.has(inti[0]) && CANCEL_PAIR_TAIL.has(inti[1])) return true;

    // Sisanya: setiap kata inti HARUS kata batal. Satu kata asing saja → bukan pembatalan,
    // melainkan nilai yang diketik pelanggan.
    return inti.every((t) => CANCEL_TOKENS.has(t));
}

/**
 * "Ya, lakukan." Toleran terhadap sapaan ("ok mas", "ya ka", "boleh kak").
 * Sanggahan menang atas afirmasi: "ga usah" / "ga jadi" tidak pernah afirmatif.
 */
function isAffirmative(text) {
    const tokens = tokenize(text);
    if (!tokens.length) return false;
    if (hasNegation(tokens)) return false;
    if (hasAny(tokens, DECLINE_TOKENS)) return false;
    return hasAny(tokens, AFFIRM_TOKENS);
}

/**
 * Persetujuan BERSIH untuk aksi berisiko. LEBIH KETAT dari `isAffirmative`: tidak boleh ada tanda
 * tanya, harus pendek, wajib mengandung afirmasi, dan tidak boleh mengandung "muatan lain".
 * Tujuannya menutup akar insiden "ketik siap malah reboot": pesan yang kebetulan mengandung token
 * afirmatif tapi sebenarnya permintaan/ucapan lain — "bisa cek tagihan?", "siap kak makasih",
 * "boleh minta info paket" — TIDAK boleh memicu aksi (mereka punya kata "konten" lain).
 * Gagal-aman: kalau persetujuan sah kebetulan tertolak, handler tinggal menanyakan ulang (ya/tidak).
 *
 * `CONSENT_BLOCKERS` disusun dari sudut pandang reboot, sehingga memuat kata domain lain seperti
 * "sandi", "wifi", "saldo", "transfer". Di alur yang justru MEMBAHAS kata itu (konfirmasi ganti
 * sandi, konfirmasi transfer), kata tersebut ON-TOPIC dan tak boleh dianggap muatan lain — kalau
 * tidak, "ya sandi barunya oke" malah tertolak. Karena itu pemanggil menyebut `onTopic`.
 *
 * @param {string} text - balasan mentah pelanggan
 * @param {{onTopic?: string[]}} [options] - kata yang wajar muncul di alur ini, dikecualikan dari blocker
 * @returns {boolean}
 */
function isCleanConsent(text, options = {}) {
    const raw = String(text || "");
    if (raw.includes("?")) return false; // pertanyaan ("bisa reboot ga?") bukan persetujuan
    const tokens = tokenize(raw);
    if (!tokens.length || tokens.length > 7) return false; // konsen wajar itu pendek, bukan paragraf
    if (hasNegation(tokens)) return false;
    if (hasAny(tokens, DECLINE_TOKENS)) return false;
    if (!hasAny(tokens, AFFIRM_TOKENS)) return false; // wajib ada minimal satu afirmasi

    const onTopic = new Set((options.onTopic || []).map((word) => String(word).toLowerCase()));
    const blockers = tokens.filter((t) => CONSENT_BLOCKERS.has(t) && !onTopic.has(t));
    if (blockers.length) return false; // ada muatan lain → bukan konsen bersih
    return true;
}

/**
 * Persetujuan bersih khusus alur reboot modem. Tipis di atas `isCleanConsent` tanpa `onTopic`,
 * karena di konteks reboot semua kata domain lain memang menandakan pelanggan sedang membahas hal lain.
 */
function isCleanRebootConsent(text) {
    return isCleanConsent(text);
}

/**
 * Penolakan halus ("nanti saja mas", "gausah"). Kata batal universal ditangani router state.
 */
function isDecline(text) {
    const tokens = tokenize(text);
    if (!tokens.length) return false;
    if (hasAny(tokens, DECLINE_TOKENS)) return true;
    // "tidak usah", "ga dulu"
    return hasNegation(tokens) && !hasAny(tokens, UNRESOLVED_TOKENS);
}

/**
 * Jawaban atas "masalahnya masih ada?" — TRUE bila masih bermasalah.
 * Diperiksa sebelum `isResolvedAnswer` karena "sudah tapi masih lemot" mengandung keduanya.
 */
function isUnresolvedAnswer(text) {
    const normalized = normalizeText(text);
    const tokens = normalized ? normalized.split(" ") : [];
    if (!tokens.length) return false;
    if (hasAny(tokens, UNRESOLVED_TOKENS)) return true;
    if (UNRESOLVED_PHRASES.some((p) => normalized.includes(p))) return true;
    // "ga bisa", "gak lancar", "belum normal"
    return hasNegation(tokens);
}

/**
 * Jawaban atas "sudah lancar?" — TRUE bila pelanggan menyatakan beres.
 * Panggil SESUDAH `isUnresolvedAnswer` mengembalikan false.
 */
function isResolvedAnswer(text) {
    const tokens = tokenize(text);
    if (!tokens.length) return false;
    if (isUnresolvedAnswer(text)) return false;
    return hasAny(tokens, RESOLVED_TOKENS);
}

/**
 * Pelanggan memberi tahu bahwa ia SUDAH mencabut/merestart modem sendiri.
 * Contoh nyata dari korpus: "Ini baru dicoba cabut", "Sudah berkali kali mas masih tetap sama".
 */
function saysAlreadyRestarted(text) {
    const normalized = normalizeText(text);
    if (!normalized) return false;
    const tokens = normalized.split(" ");

    const didRestart = hasAny(tokens, RESTART_ACTION_TOKENS);
    if (didRestart && (hasAny(tokens, RESTART_DONE_TOKENS) || RESTART_DONE_PHRASES.some((p) => normalized.includes(p)))) {
        return true;
    }
    // "sudah berkali kali" tanpa menyebut aksinya — konteks keluhan berulang.
    return RESTART_DONE_PHRASES.some((p) => normalized.includes(p)) && hasAny(tokens, RESTART_DONE_TOKENS);
}

module.exports = {
    isAffirmative,
    isCancelIntent,
    isCleanConsent,
    isCleanRebootConsent,
    isDecline,
    isResolvedAnswer,
    isUnresolvedAnswer,
    saysAlreadyRestarted,
    _internal: { normalizeText, tokenize }
};
