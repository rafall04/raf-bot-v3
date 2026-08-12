/**
 * Header Doc
 * Purpose: Adapter inbound WhatsApp untuk menormalkan shape pesan Baileys ke kontrak internal bot yang stabil,
 *          sekaligus MENYARING envelope kontrol yang bukan pesan manusia (lihat `CONTROL_MESSAGE_TYPES`).
 * Caller: `message/handlers/raf-context.js` dan test kontrak inbound.
 * Deps: Objek pesan runtime WhatsApp/Baileys.
 * MainFuncs: `normalizeIncomingMessage`, `isControlEnvelope`.
 * SideEffects: Tidak ada; hanya parsing payload pesan masuk.
 */
"use strict";

// Envelope KONTROL WhatsApp — bukan pesan dari manusia dan TAK PERNAH berisi teks. Baileys tetap
// mengantarkannya lewat `messages.upsert`: `protocolMessage` menyusul ±2 detik sesudah hampir tiap
// pesan nyata, `senderKeyDistributionMessage` saat kunci sesi dirotasi, `reactionMessage` saat
// pemakai menempel emoji.
//
// Dulu ketiganya LOLOS sebagai pesan berteks KOSONG (`resolveMessageText` mengembalikan `""` untuk
// tipe yang tak dikenalnya) lalu ikut masuk ke conversation state. Teks kosong tak cocok dengan
// YA/TIDAK/angka mana pun, sehingga wizard jatuh ke cabang "balasan tak dikenal" dan mengirim teks
// bantuannya UNTUK KEDUA KALINYA — itulah "pesan dobel" pada wizard PSB (insiden Tanjungharjo
// 2026-08-12: tiap pesan teknisi dibalas dua kali, terbukti dari pasangan jam pesan ↔ protocolMessage).
//
// Terukur di prod Tanjungharjo: 137 `protocolMessage` + 60 `senderKeyDistributionMessage` dari 822
// pesan masuk (24%), tersebar di 10+ nomor berbeda — jadi ini perilaku normal WhatsApp, bukan gejala
// satu perangkat rusak. Disaring di SATU pintu masuk ini supaya SEMUA state domain ikut terlindungi
// sekaligus; menambalnya per-wizard hanya akan mengulang bug yang sama di wizard berikutnya.
const CONTROL_MESSAGE_TYPES = new Set([
    "protocolMessage",
    "senderKeyDistributionMessage",
    "reactionMessage"
]);

/**
 * True bila `msg` cuma envelope kontrol (bukan pesan pemakai). Dipakai `message/raf.js` untuk
 * membuangnya sedini mungkin, sejajar dengan skip status/broadcast/newsletter.
 */
function isControlEnvelope(msg) {
    if (!msg || !msg.message) {
        return false;
    }

    return CONTROL_MESSAGE_TYPES.has(Object.keys(msg.message)[0]);
}

function resolveMessageText(msg, messageType) {
    return messageType === "conversation" && msg.message.conversation ? msg.message.conversation :
        messageType === "imageMessage" && msg.message.imageMessage.caption ? msg.message.imageMessage.caption :
        messageType === "documentMessage" && msg.message.documentMessage.caption ? msg.message.documentMessage.caption :
        messageType === "videoMessage" && msg.message.videoMessage.caption ? msg.message.videoMessage.caption :
        messageType === "extendedTextMessage" && msg.message.extendedTextMessage.text ? msg.message.extendedTextMessage.text :
        messageType === "buttonsResponseMessage" && msg.message.buttonsResponseMessage.selectedButtonId ? msg.message.buttonsResponseMessage.selectedButtonId :
        messageType === "templateButtonReplyMessage" && msg.message.templateButtonReplyMessage.selectedId ? msg.message.templateButtonReplyMessage.selectedId :
        messageType === "messageContextInfo" ? (msg.message.buttonsResponseMessage?.selectedButtonId || msg.message.listResponseMessage?.singleSelectReply.selectedRowId) :
        messageType === "listResponseMessage" && msg.message.listResponseMessage.singleSelectReply.selectedRowId ? msg.message.listResponseMessage.singleSelectReply.selectedRowId :
        "";
}

function normalizeIncomingMessage(msg) {
    if (!msg || !msg.message || !msg.key) {
        return null;
    }

    const from = msg.key.remoteJid;
    const messageType = Object.keys(msg.message)[0];

    // Envelope kontrol dibuang SEBELUM teksnya di-resolve, supaya ia tak pernah bisa muncul
    // sebagai "pesan berteks kosong" di jalur mana pun — termasuk pemanggil selain `raf.js`.
    if (CONTROL_MESSAGE_TYPES.has(messageType)) {
        return null;
    }

    let chats = resolveMessageText(msg, messageType);

    if (chats === undefined || chats === null) {
        return null;
    }

    if (typeof chats !== "string") {
        chats = String(chats || "");
    }

    const isGroup = from.endsWith("@g.us");
    // Pengirim di GRUP ada di `msg.key.participant` — itu tempat kanoniknya di Baileys.
    // `msg.participant` (level atas) hanya terisi pada SEBAGIAN bentuk pesan, dan dulu hanya
    // itu yang dibaca: begitu kosong, fungsi ini mengembalikan `null` sehingga `raf.js`
    // membuang pesannya dengan "[WARNING] chats is undefined" — padahal teksnya jelas ada.
    // Yang terkena adalah pesan TEKS BIASA di grup (mis. perintah dompet). Intake PSB via
    // grup tidak terpengaruh karena memakai gambar ber-caption, dan pada bentuk itu
    // `msg.participant` terisi — itulah sebabnya bug ini bertahan lama tanpa ketahuan.
    // Terbukti di prod 2026-07-23: key.participant `…@lid` terisi, msg.participant kosong.
    // Urutan ini aditif — bentuk lama tetap dihormati, jadi jalur PSB tak berubah.
    const sender = isGroup ? (msg.key.participant || msg.participant) : from;
    if (!sender) {
        return null;
    }

    const command = chats.toLowerCase().split(" ")[0] || "";

    return {
        from,
        type: messageType,
        messageType,
        chats,
        args: chats.split(" "),
        command,
        isGroup,
        sender,
        pushname: msg.pushName,
        q: chats.slice(command.length + 1, chats.length)
    };
}

module.exports = {
    CONTROL_MESSAGE_TYPES,
    isControlEnvelope,
    normalizeIncomingMessage
};
