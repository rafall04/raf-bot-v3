/**
 * Header Doc
 * Purpose: Parser MURNI balasan survei rating pelanggan (CSAT). Mengubah teks bebas ala
 *   pelanggan RAF Net (pendek, campur Jawa, jarang menulis angka bersih) menjadi skor 1–5 +
 *   sentimen, atau menandai `optout` / `unclear`. TIDAK menyentuh I/O sehingga mudah diuji.
 *   Prinsip (CLAUDE.md "Accept the language customers actually use" + [[customer-chat-corpus]]):
 *   JANGAN exact-match. Terima "4 mas", "bagus kok", "lemot terus", emoji, kata-angka ("lima"),
 *   dan dialek Jawa ("medhot", "alon", "aman"). `unclear` dipakai supaya bot TIDAK membajak
 *   pesan yang jelas-jelas bukan jawaban survei (mis. pelanggan malah tanya "cek koneksi").
 * Caller: lib/csat/csat-survey-service.js (state machine tangkap balasan).
 * Deps: tidak ada (pure).
 * MainFuncs: parseRatingReply(text) -> {kind:'rating'|'optout'|'unclear', score?, sentiment?};
 *   isSkipWord(text); isBareAck(text); scoreToSentiment(score).
 * SideEffects: tidak ada.
 */
"use strict";

// Emoji sentimen — sengaja sederhana, cukup untuk basis pelanggan yang jarang pakai emoji rumit.
const EMOJI_POS = ["😍", "🥰", "😄", "😁", "😊", "🙂", "👍", "❤️", "😘", "🤩", "👌", "🙏"];
const EMOJI_NEG = ["😞", "😔", "😢", "😭", "😡", "😠", "👎", "😤", "💢", "🤬", "😩", "😣"];
const EMOJI_NEUTRAL = ["😐", "😑", "🙄", "😶"];

// Kata → skor. Diurut dari frasa paling spesifik/kuat ke umum supaya "sangat puas" menang atas "puas".
// Dialek Jawa & gaya lokal disertakan (medhot=putus, alon/lelet=lambat, aman/lancar jaya=baik).
const STRONG_POS = ["sangat puas", "puas sekali", "sangat bagus", "bagus sekali", "sangat memuaskan", "memuaskan sekali", "luar biasa", "mantap jiwa", "mantul", "joss", "sempurna", "keren banget", "lancar jaya", "top markotop"];
const POS = ["puas", "bagus", "baik", "lancar", "oke", "okay", "mantap", "memuaskan", "stabil", "enak", "nyaman", "aman", "kenceng", "kencang", "cepet", "cepat", "gada masalah", "gak ada masalah", "ga ada masalah", "tidak ada masalah", "gak ada kendala", "alhamdulillah", "sip", "sae", "apik"];
const NEUTRAL = ["biasa", "lumayan", "cukup", "standar", "sedang", "kadang", "so so", "sedeng", "yo ngono kae"];
const NEG = ["kurang", "jelek", "lemot", "lambat", "lelet", "alon", "kecewa", "tidak puas", "gak puas", "ga puas", "nggak puas", "buruk", "sering putus", "sering mati", "sering gangguan", "gangguan terus", "medhot", "mendet", "mandek", "ngadat", "sinyal jelek", "susah konek", "muter", "muter terus", "buffering", "ngebuffer", "mumet", "ngelag", "nge-lag", "putus terus"];
const STRONG_NEG = ["sangat jelek", "jelek sekali", "sangat buruk", "parah", "parah banget", "payah", "mengecewakan", "tiap hari mati", "tiap malam lemot", "buruk sekali", "ampun"];

// Kata-angka Indonesia/lokal.
const WORD_NUMBERS = { satu: 1, siji: 1, dua: 2, loro: 2, tiga: 3, telu: 3, empat: 4, papat: 4, lima: 5, limo: 5 };

// Optout survei — SEMPIT supaya tidak menelan "berhenti berlangganan" (itu churn, bukan optout survei).
const OPTOUT_RE = /(^|\b)(stop|unsubscribe|berhenti survei|stop survei|jangan (survei|kirim survei|tanya lagi|di ?survei)|jgn survei|ga usah survei|gausah survei)(\b|$)/i;

// Kata "lewati/tidak ada komentar" — dipakai HANYA pada tahap komentar (tahap-2).
const SKIP_RE = /^(\s*)(-|\.|skip|lewati|batal|cancel|ga ?jadi|gajadi|ndak ?usah|gausah|udahan|selesai)(\s*)$/i;

// Afirmasi/ucapan singkat yang BUKAN rating dan BUKAN sinyal apa pun ("siap", "iya", "makasih",
// "nggih"). Dipakai HANYA saat survei aktif menunggu rating: balasan begini JANGAN dibiarkan jatuh
// ke pipeline normal — di sana "siap"/"iya" bisa disalahartikan sebagai konfirmasi (mis. reboot).
// SENGAJA SEMPIT — hanya token pendek berdiri sendiri, biar pesan sungguhan ("Info mas", "cek
// koneksi") tetap lewat. Token yang sudah jadi rating (oke/sip/baik = POS) tak perlu di sini karena
// parser menilai rating lebih dulu.
const BARE_ACK_RE = /^(\s*)(iya+h?|iyo|ya+h?|yoi|yo|yes|yup|yaudah|ya ?we?s|yowes|yowis|siap+|siyap|lanjut|gas|monggo|mangga|betul|bener|leres|ng?gih|inggih|enggih|makasih+|makasi+|mksh|thanks?|thx|tengkyu|thankyou|matur ?nuwun|suwun|noted|ok ?siap|siap ?(mas|kak|kk|pak|bu|bos))(\s*)$/i;

function normalize(text) {
    return String(text || "").toLowerCase().trim();
}

function scoreToSentiment(score) {
    if (!score && score !== 0) return null;
    if (score <= 2) return "neg";
    if (score === 3) return "neutral";
    return "pos";
}

function containsAny(haystack, list) {
    return list.some((w) => haystack.includes(w));
}

function countEmoji(text, list) {
    // Hitung KEMUNCULAN (bukan sekadar ada/tidak) supaya "😍😍" lebih kuat dari "😍".
    return list.reduce((n, e) => n + (text.split(e).length - 1), 0);
}

/**
 * Ekstrak angka 1–5 yang berdiri sendiri (tidak bagian dari angka lebih besar seperti 10/15/2000).
 * Menangani "4", "4 mas", "kasih 5", "5/5", "bintang 4", "nilai 4".
 * @returns {number|null}
 */
function extractDigitScore(text) {
    // Buang pola yang menipu supaya angka satuan waktu/uang/kuota tak salah dibaca sbg skor:
    //   "jam 5" / "pukul 5" (angka SESUDAH kata), "5 menit" / "5rb" / "5gb" (angka SEBELUM satuan),
    //   "rp 5000". Angka dibuang BERSAMA satuannya, bukan cuma katanya.
    const cleaned = text
        .replace(/\b(jam|pukul)\s*\d+/gi, " ")
        .replace(/\d+\s*(menit|detik|jam|hari|bulan|rb|ribu|jt|juta|k|gb|mb|kb|mbps|kbps|x|kali)\b/gi, " ")
        .replace(/\brp\.?\s*\d+/gi, " ");
    const re = /(?<![\d.,])([1-5])(?![\d.,])/g;
    let m;
    const found = [];
    while ((m = re.exec(cleaned)) !== null) found.push(parseInt(m[1], 10));
    if (found.length === 0) return null;
    // Kalau ada beberapa (mis. "5/5"), ambil yang pertama.
    return found[0];
}

function extractWordScore(text) {
    for (const [word, val] of Object.entries(WORD_NUMBERS)) {
        const re = new RegExp(`(^|\\b)${word}(\\b|$)`, "i");
        if (re.test(text)) return val;
    }
    return null;
}

/**
 * Skor dari kata sentimen. Kembalikan skor representatif (frasa terkuat menang).
 * @returns {number|null}
 */
function extractSentimentScore(text) {
    if (containsAny(text, STRONG_NEG)) return 1;
    if (containsAny(text, STRONG_POS)) return 5;
    // Negasi eksplisit membalik positif: "tidak/gak/ga/nggak/kurang <positif>"
    const negatedPositive = /\b(tidak|tdk|gak|ga|nggak|ndak|kurang|belum|blm)\s+(puas|bagus|baik|lancar|stabil|nyaman|enak)\b/i.test(text);
    if (negatedPositive) return 2;
    if (containsAny(text, NEG)) return 2;
    if (containsAny(text, POS)) return 4;
    if (containsAny(text, NEUTRAL)) return 3;
    return null;
}

function extractEmojiScore(text) {
    const pos = countEmoji(text, EMOJI_POS);
    const neg = countEmoji(text, EMOJI_NEG);
    const neu = countEmoji(text, EMOJI_NEUTRAL);
    if (pos === 0 && neg === 0 && neu === 0) return null;
    if (neg > pos) return neg >= 2 ? 1 : 2;
    if (pos > neg) return pos >= 2 ? 5 : 4;
    if (neu > 0) return 3;
    return null;
}

/**
 * Inti parser. Urutan: optout → angka digit → kata-angka → sentimen kata → emoji.
 * `unclear` bila tak ada sinyal rating sama sekali (biar tak membajak pesan lain).
 * @param {string} text
 * @returns {{kind:'rating'|'optout'|'unclear', score?:number, sentiment?:string}}
 */
function parseRatingReply(text) {
    const t = normalize(text);
    if (!t) return { kind: "unclear" };

    if (OPTOUT_RE.test(t)) return { kind: "optout" };

    let score = extractDigitScore(t);
    if (score === null) score = extractWordScore(t);
    if (score === null) score = extractSentimentScore(t);
    if (score === null) score = extractEmojiScore(t);

    if (score === null) return { kind: "unclear" };
    // Clamp defensif.
    score = Math.max(1, Math.min(5, score));
    return { kind: "rating", score, sentiment: scoreToSentiment(score) };
}

/**
 * True bila teks pada tahap-2 (komentar) berarti "lewati / tidak ada komentar".
 * SEMPIT — "gak ada masalah" JANGAN dianggap skip (itu justru feedback positif berharga).
 */
function isSkipWord(text) {
    return SKIP_RE.test(normalize(text));
}

/** True bila teks tampak jelas sebagai perintah/kata-batal universal (agar tak dibajak jadi komentar). */
function isCancelWord(text) {
    const t = normalize(text);
    return /^(batal|cancel|ga ?jadi|gajadi|menu|keluar)$/i.test(t);
}

/**
 * True bila teks = afirmasi/ucapan singkat non-rating ("siap", "iya", "makasih"). Dipakai saat
 * survei aktif menunggu rating untuk mencegah balasan begini bocor ke pipeline (mis. dikira
 * konfirmasi reboot). SEMPIT: hanya token pendek berdiri sendiri.
 */
function isBareAck(text) {
    return BARE_ACK_RE.test(normalize(text));
}

module.exports = {
    parseRatingReply,
    isSkipWord,
    isCancelWord,
    isBareAck,
    scoreToSentiment,
    // diekspor untuk pengujian unit granular
    _internal: { extractDigitScore, extractWordScore, extractSentimentScore, extractEmojiScore },
};
