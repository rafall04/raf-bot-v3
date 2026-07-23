/**
 * Header Doc
 * Purpose: Adapter inbound WhatsApp untuk menormalkan shape pesan Baileys ke kontrak internal bot yang stabil.
 * Caller: `message/handlers/raf-context.js` dan test kontrak inbound.
 * Deps: Objek pesan runtime WhatsApp/Baileys.
 * MainFuncs: `normalizeIncomingMessage`.
 * SideEffects: Tidak ada; hanya parsing payload pesan masuk.
 */
"use strict";

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
    let chats = resolveMessageText(msg, messageType);

    if (chats === undefined || chats === null) {
        return null;
    }

    if (typeof chats !== "string") {
        chats = String(chats || "");
    }

    const isGroup = from.endsWith("@g.us");
    // Pengirim di GRUP ada di `msg.key.participant` — itu tempat kanoniknya di Baileys.
    // `msg.participant` (level atas) hanya terisi pada sebagian bentuk pesan, dan dulu
    // hanya itu yang dibaca: begitu kosong, fungsi ini mengembalikan `null` sehingga
    // `raf.js` membuang pesannya dengan "[WARNING] chats is undefined". Akibatnya SELURUH
    // pesan grup mati diam-diam — intake PSB via grup maupun perintah dompet tak pernah
    // terpanggil, tanpa jejak selain baris WARNING yang menyesatkan (teksnya ADA).
    // Terbukti di prod 2026-07-23: key.participant `…@lid` terisi, msg.participant kosong.
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
    normalizeIncomingMessage
};
