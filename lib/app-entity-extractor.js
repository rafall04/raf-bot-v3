/**
 * Header Doc
 * Purpose: Ekstraktor ENTITAS APLIKASI dari bahasa bebas pelanggan — memetakan sebutan app/game
 *          (TikTok/YouTube/IG/FB/WhatsApp/Shopee/browsing/game/streaming) ke `serviceKey` di
 *          matriks reachability (lib/service-reachability-prober) + kelas kegunaan (video/social/
 *          chat/web/game/marketplace) supaya "cek koneksi" bisa menjawab SPESIFIK per aplikasi.
 *          Rule-based, dialek/typo-aware (hasil tambang korpus prod: "digae tik tok kog muter
 *          terus", "video FB sama YouTube", "browsing semua lemot", "Shopee kak"). Murni tanpa I/O
 *          — nol halusinasi, hanya pemetaan deterministik.
 * Caller: `message/handlers/connection-check-handler.js` (seksi app-spesifik) dan
 *         `message/handlers/customer-fallback-handler.js` (follow-up sebutan app).
 * Deps: — (murni).
 * MainFuncs: `extractAppEntities`, `topAppEntity`, `hasBareAppMention`.
 * SideEffects: Tidak ada.
 */
"use strict";

const MAX_TOKENS = 40;

// Katalog app → { serviceKey (cocok dgn prober), label manusiawi, kind, pola }. serviceKey null
// = tidak ada probe langsung (mis. game) → diagnosa pakai kualitas jalur, bukan sel layanan.
// Urutan penting: entitas paling spesifik dulu supaya "video fb" tidak keburu ketangkap "video".
const APP_CATALOG = [
    {
        key: "tiktok", serviceKey: "tiktok", label: "TikTok", kind: "video",
        re: /\btik\s?tok\b|\btiktok\b|\btt\b(?!l)/i
    },
    {
        key: "youtube", serviceKey: "youtube", label: "YouTube", kind: "video",
        re: /\byou\s?tube\b|\byutub\b|\byt\b|nonton\s+(video|yt)/i
    },
    {
        key: "instagram", serviceKey: "instagram", label: "Instagram", kind: "social",
        re: /\binstagram\b|\binsta\b|\big\b|\bstory\b|\bstori\b|\breel/i
    },
    {
        key: "facebook", serviceKey: "facebook", label: "Facebook", kind: "social",
        re: /\bface\s?book\b|\bfb\b|pesbuk|pesbuk/i
    },
    {
        key: "whatsapp", serviceKey: "whatsapp", label: "WhatsApp", kind: "chat",
        re: /\bwhats\s?app\b|\bwa\b|wasap|wasaf|\bwd\b/i
    },
    {
        key: "telegram", serviceKey: null, label: "Telegram", kind: "chat",
        re: /\btelegram\b|\btelgram\b|\btele\s?gram\b/i
    },
    {
        key: "shopee", serviceKey: "google", label: "Shopee/marketplace", kind: "web",
        re: /\bshopee\b|\bsopi\b|\btokopedia\b|\btokped\b|\blazada\b|\bblibli\b|\bbukalapak\b|\btiktok\s?shop\b|belanja\s?online|toko\s?online|\bolshop\b|checkout/i
    },
    {
        key: "ojol", serviceKey: "google", label: "ojek online/peta", kind: "web",
        re: /\bgojek\b|\bgrab\b|\bmaxim\b|\bojol\b|ojek\s?online|\bindrive\b|google\s?maps|\bgmaps\b|\bmaps\b/i
    },
    {
        key: "game", serviceKey: null, label: "game online", kind: "game",
        re: /\bgame\b|\bgim\b|nge?\s?-?game|gaming|mobile\s?legend|\bml\b(?!bb)?|\bmlbb\b|moba|free\s?fire|\bff\b|\bffmax\b|pubg|valorant|genshin|roblox|\bcodm\b|call\s?of\s?duty|point\s?blank|\bpb\b(?=.*(game|main|lag|ngelag))|arena\s?of\s?valor|\baov\b|efootball|\bpes\b|clash\s?of\s?clan|\bcoc\b|among\s?us|stumble|honkai|\bmain\b(?=.*(game|ml|ff|pubg|valo))/i
    },
    {
        key: "streaming", serviceKey: null, label: "streaming/nonton film", kind: "video",
        re: /\bnetflix\b|\bnonton\b|\bfilm\b|streaming|\bvidio\b|\bdisney\b|\biflix\b|\bwetv\b|\bviu\b|\bbstation\b|\bbilibili\b/i
    },
    {
        key: "musik", serviceKey: null, label: "streaming musik", kind: "streaming",
        re: /\bspotify\b|\bjoox\b|\bresso\b|dengerin\s?lagu|puter\s?lagu|setel\s?lagu|\bsoundcloud\b/i
    },
    {
        key: "discord", serviceKey: null, label: "Discord", kind: "call",
        re: /\bdiscord\b|\bdiskord\b|\bdicord\b/i
    },
    {
        key: "meet", serviceKey: null, label: "video call/meeting", kind: "call",
        re: /\bzoom\b|google\s?meet|\bvidcall\b|video\s?call|\bvc\b|\bmeeting\b|\bwebex\b/i
    },
    {
        key: "browsing", serviceKey: "google", label: "browsing/web", kind: "web",
        re: /browsing|browser|buka\s?web|\bweb\b|\bchrome\b|search|googling|buka\s?situs|donlot|download|unduh|\bdonload\b/i
    },
    {
        key: "web-generic", serviceKey: "cloudflare", label: "internet umum", kind: "web",
        re: /\binternet\b|\bwebsite\b|\bsitus\b/i
    }
];

// Gejala spesifik-app (buffering vs putus vs lambat) — memperkaya jawaban. "muter terus"/"muter
// muter" = buffering (khas video). Korpus: "muter terus", "muter muter 5 menit".
const SYMPTOM_HINTS = [
    { key: "buffering", re: /muter|buffer|ngebuffer|loading\s?terus|lo?ding|mutar|puter/i, label: "loading terus (buffering)" },
    { key: "lambat", re: /lemot|lemod|lambat|lambet|lelet|leled|lola|pelan|\balon\b|berat|\blot\b/i, label: "lambat" },
    { key: "lag", re: /\blag\b|\blagg\b|ngelag|nge\s?lag|patah|nyendat|delay|\bping\b|ping\s?(tinggi|gede|naik)|\brto\b/i, label: "lag/patah-patah" },
    { key: "putus", re: /putus|medhot|medot|pedhot|pedot|kepedot|mati|hilang|ilang|drop|mandek|mandeg|kedisconnect|\bdc\b/i, label: "putus/terputus" },
    { key: "gagal", re: /tidak\s?bisa|tak\s?bisa|gak\s?bisa|ga\s?bisa|gabisa|ra\s?iso|ora\s?iso|ora\s?mlebu|ra\s?mlebu|error|eror|gagal|ga\s?kebuka|ga\s?muncul/i, label: "gagal dibuka" }
];

function normalize(message) {
    return String(message || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Ekstrak semua entitas app yang disebut (urut sesuai kemunculan di teks, dedup by key).
 * @param {string} message
 * @returns {Array<{key,serviceKey,label,kind,symptom:string|null,symptomLabel:string|null}>}
 */
function extractAppEntities(message) {
    const norm = normalize(message);
    if (!norm || norm.split(" ").length > MAX_TOKENS) return [];
    const symptom = SYMPTOM_HINTS.find((s) => s.re.test(norm)) || null;

    const found = [];
    const seen = new Set();
    for (const app of APP_CATALOG) {
        const m = app.re.exec(norm);
        if (!m) continue;
        if (seen.has(app.key)) continue;
        seen.add(app.key);
        found.push({
            key: app.key,
            serviceKey: app.serviceKey,
            label: app.label,
            kind: app.kind,
            at: m.index,
            symptom: symptom ? symptom.key : null,
            symptomLabel: symptom ? symptom.label : null
        });
    }
    // "web-generic" hanya berarti bila TIDAK ada app lebih spesifik (hindari "internet lemot" +
    // "tiktok" menghasilkan dua entitas — cukup tiktok).
    const spesifik = found.filter((f) => f.key !== "web-generic");
    const hasil = spesifik.length ? spesifik : found;
    return hasil.sort((a, b) => a.at - b.at).map((f) => { const { at: _at, ...rest } = f; return rest; });
}

/** Entitas app paling relevan (pertama disebut). null bila tak ada. */
function topAppEntity(message) {
    return extractAppEntities(message)[0] || null;
}

/**
 * Deteksi pesan PENDEK yang isinya (hampir) hanya sebutan app — pola follow-up korpus:
 * "Shopee kak", "TikTok muter", "buat video FB sama youtube kak". Dipakai fallback multi-turn:
 * bila pelanggan baru saja komplain koneksi lalu mengirim ini, arahkan ke diagnosa app.
 * @returns {object|null} entitas app bila memenuhi, else null.
 */
function hasBareAppMention(message) {
    const norm = normalize(message);
    const tokens = norm.split(" ").filter(Boolean);
    if (!tokens.length || tokens.length > 8) return null;
    const ent = topAppEntity(message);
    if (!ent) return null;
    // Buang app "web-generic"/"browsing" murni tanpa gejala → terlalu lemah utk memicu sendiri.
    if ((ent.key === "web-generic") && !ent.symptom) return null;
    return ent;
}

module.exports = {
    extractAppEntities,
    topAppEntity,
    hasBareAppMention,
    _internal: { normalize, APP_CATALOG, SYMPTOM_HINTS }
};
