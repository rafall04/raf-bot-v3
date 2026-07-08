/**
 * Header Doc
 * Purpose: Fallback anti-diam untuk pesan pelanggan TANPA intent (gate config
 *          `customerAssist.fallback.enabled`, default MATI). Bot lama diam total saat tidak
 *          paham (korpus prod: 78-81% pesan pelanggan tak terjawab) — modul ini memutuskan:
 *          (a) teks bergejala gangguan → alihkan ke intent CEK_KONEKSI (diagnosa read-only),
 *          (b) teks bebas lain → balas menu bantuan (template, ber-cooldown per chat),
 *          (c) tetap DIAM untuk: staf/agen, non-pelanggan, ack pendek ("oke", "iya mas"),
 *              dan chat yang sedang ditangani admin manual (jejak fromMe, anti-menyela).
 * Caller: `message/raf.js` (setelah resolveKeywordIntent gagal, sebelum dispatchIntent).
 * Deps: `./template-helpers` (renderResponseTemplate), `../../lib/loose-intent-matcher`
 *       (sinyal keluhan), `../../lib/chat-activity-tracker` (jejak admin + cooldown).
 * MainFuncs: `evaluateCustomerFallback`.
 * SideEffects: Mengirim balasan WhatsApp via `reply` yang disuntik caller (skipDuplicateCheck
 *              karena balasan langsung) dan menulis penanda cooldown in-memory. Tidak pernah throw.
 */
"use strict";

const { renderResponseTemplate } = require("./template-helpers");
const { hasConnectivityComplaintSignal, _internal: looseInternal } = require("../../lib/loose-intent-matcher");
const { hasBareAppMention } = require("../../lib/app-entity-extractor");
const {
    getAdminOutboundAgeMs,
    noteFallbackReply,
    getFallbackReplyAgeMs,
    noteConnectivityComplaint,
    getConnectivityComplaintAgeMs
} = require("../../lib/chat-activity-tracker");

const DEFAULT_COOLDOWN_MINUTES = 30;
const DEFAULT_ADMIN_QUIET_MINUTES = 15;
// Jendela multi-turn: sebutan app polos ("Shopee kak") dianggap lanjutan komplain bila pelanggan
// baru saja mengeluh koneksi dalam rentang ini (pola korpus: app disebut di pesan susulan).
const DEFAULT_COMPLAINT_CONTEXT_MINUTES = 10;

// Token yang menandakan pesan basa-basi/ack lanjutan percakapan (dari korpus: "iya mas",
// "Ok mas", "oke makasi kak", "Siap", "Ya") — bot harus tetap diam, itu bukan pertanyaan.
const ACK_TOKENS = new Set([
    "ok", "oke", "okee", "okey", "okeh", "okedeh", "y", "ya", "yaa", "iya", "iyaa", "yo", "yoi",
    "sip", "siap", "siyap", "asiap", "baik", "baiklah", "done", "dah", "udah", "sudah", "udh", "sdh",
    "nggih", "njih", "enggih", "inggih", "monggo", "mantap", "mantab", "jos", "joss",
    "makasih", "makasi", "maksih", "trimakasih", "terimakasih", "terima", "kasih",
    "thanks", "thank", "tq", "thx", "suwun", "maturnuwun", "matur", "nuwun",
    "sami", "sama", "samasama", "p",
    // sapaan/honorifik pengisi kalimat
    "mas", "kak", "kk", "min", "pak", "bu", "bang", "om", "mbak", "bro", "gan", "ka",
    // salam pendek — versi kanonik ("halo", "selamat pagi") sudah ditangani intent SAPAAN_UMUM
    "halo", "hai", "hallo", "hello", "met", "selamat", "pagi", "siang", "sore", "malam",
    "permisi", "punten", "assalamualaikum", "waalaikumsalam"
]);

function isAckOnly(tokens) {
    return tokens.length > 0 && tokens.length <= 4 && tokens.every((token) => ACK_TOKENS.has(token));
}

function minutesToMs(value, fallbackMinutes) {
    const parsed = Number(value);
    const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMinutes;
    return minutes * 60 * 1000;
}

function buildDefaultMenuText(pushname) {
    const nama = pushname || "Kak";
    return `Halo Kak ${nama} 🙏 Saya *asisten bot* di nomor ini.\n\n` +
        "Pesan Kakak sudah terekam ya — kalau perlu jawaban admin, mohon ditunggu, admin akan membalas secepatnya. 😊\n\n" +
        "Sambil menunggu, saya bisa bantu langsung:\n" +
        "• Ketik *cek koneksi* — kalau internet lemot/mati, saya cek jalurnya sekarang\n" +
        "• Ketik *ganti sandi* — ubah kata sandi WiFi\n" +
        "• Ketik *cek tagihan* — info tagihan bulan ini\n" +
        "• Ketik *menu* — semua fitur bot\n\n" +
        "Ketik salah satu ya, Kak 🙌";
}

/**
 * Evaluasi pesan pelanggan tanpa intent. Tidak pernah throw.
 * @returns {Promise<{action: 'intent', intent: string}|{action: 'replied'}|{action: 'skip', reason: string}>}
 */
async function evaluateCustomerFallback({
    chats,
    sender,
    stateSender,
    pushname,
    customer,
    isOwner,
    isTeknisi,
    isAgent,
    reply,
    globalConfig
}) {
    try {
        const cfg = globalConfig?.customerAssist?.fallback;
        if (!cfg || cfg.enabled !== true) {
            return { action: "skip", reason: "disabled" };
        }
        if (isOwner || isTeknisi || isAgent) {
            return { action: "skip", reason: "staf" };
        }
        if (!customer) {
            // v1: hanya pelanggan terdaftar — nomor asing tetap diam (hindari spam ke orang salah).
            return { action: "skip", reason: "bukan-pelanggan" };
        }

        const text = typeof chats === "string" ? chats.trim() : "";
        if (text.length < 4 || /^\d+$/.test(text)) {
            return { action: "skip", reason: "terlalu-pendek" };
        }

        const tokens = looseInternal.tokenize(text);
        if (!tokens.length || isAckOnly(tokens)) {
            return { action: "skip", reason: "ack" };
        }

        // Jangan menyela percakapan yang sedang ditangani admin manual dari nomor bot.
        const adminQuietMs = minutesToMs(cfg.adminQuietMinutes, DEFAULT_ADMIN_QUIET_MINUTES);
        const chatKeys = [sender, stateSender].filter(Boolean);
        if (chatKeys.some((jid) => getAdminOutboundAgeMs(jid) < adminQuietMs)) {
            return { action: "skip", reason: "admin-aktif" };
        }

        // Gejala gangguan tanpa kata konteks (mis. "Ga bisa ini", "Lemot banget") — untuk
        // pelanggan terdaftar di japri, jawaban paling berguna = diagnosa koneksi read-only.
        if (hasConnectivityComplaintSignal(text)) {
            noteConnectivityComplaint(stateSender || sender);
            return { action: "intent", intent: "CEK_KONEKSI" };
        }

        // Sebutan APP (multi-turn): "Digae tik tok kog muter terus" (app+gejala, langsung) ATAU
        // "Shopee kak" polos yang menyusul komplain koneksi baru-baru ini (pola korpus prod).
        // Keduanya → CEK_KONEKSI, yang lalu memberi jawaban SPESIFIK per app dari matriks live.
        const appMention = hasBareAppMention(text);
        if (appMention) {
            const complaintCtxMs = minutesToMs(cfg.complaintContextMinutes, DEFAULT_COMPLAINT_CONTEXT_MINUTES);
            const adaKonteks = chatKeys.some((jid) => getConnectivityComplaintAgeMs(jid) < complaintCtxMs);
            if (appMention.symptom || adaKonteks) {
                noteConnectivityComplaint(stateSender || sender);
                return { action: "intent", intent: "CEK_KONEKSI" };
            }
        }

        const cooldownMs = minutesToMs(cfg.cooldownMinutes, DEFAULT_COOLDOWN_MINUTES);
        if (chatKeys.some((jid) => getFallbackReplyAgeMs(jid) < cooldownMs)) {
            return { action: "skip", reason: "cooldown" };
        }

        const teks = renderResponseTemplate(
            "assist_fallback_menu",
            buildDefaultMenuText(pushname),
            { pushname: pushname || "Kak" }
        );
        // Balasan langsung atas pesan user → lewati dedup notifikasi; anti-spam dijaga cooldown.
        await reply(teks, { skipDuplicateCheck: true });
        noteFallbackReply(stateSender || sender);
        return { action: "replied" };
    } catch (err) {
        // Fallback tidak boleh menjatuhkan jalur pesan — telan, log, lanjut diam.
        console.warn(`[CUSTOMER_FALLBACK_WARN] ${err && err.message ? err.message : err}`);
        return { action: "skip", reason: "error" };
    }
}

module.exports = {
    evaluateCustomerFallback,
    // Diekspor untuk test.
    _internal: { isAckOnly, buildDefaultMenuText, ACK_TOKENS }
};
