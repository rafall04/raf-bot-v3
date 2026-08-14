/**
 * Header Doc
 * Purpose: Helper context router WhatsApp untuk actor capability dan canonical sender resolution.
 * Caller: `message/raf.js`.
 * Deps: `../../lib/whatsapp-inbound-adapter` dan runtime message payload.
 * MainFuncs: `extractMessageContext`, `isControlEnvelope`, `getOptionalJid`, dan `resolveActorCapabilities`.
 * SideEffects: Tidak ada; helper ini hanya membaca payload runtime dan menghitung capability actor.
 */
"use strict";

const { normalizeIncomingMessage, isControlEnvelope } = require("../../lib/whatsapp-inbound-adapter");

function getOptionalJid(msg, sender) {
    if (!sender || !sender.endsWith('@lid')) {
        return sender;
    }

    if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
        const result = msg.key.remoteJidAlt.split(':')[0];
        return result.endsWith('@s.whatsapp.net') ? result : `${result}@s.whatsapp.net`;
    }

    if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
        return msg.participant;
    }

    return null;
}

function extractMessageContext(msg) {
    return normalizeIncomingMessage(msg);
}

// Peran yang boleh menjalankan perintah teknisi lewat WhatsApp. `agen` SENGAJA tak ada:
// agen menagih pembayaran, bukan mengerjakan tiket gangguan.
const PERAN_BERKAPABILITAS_TEKNISI = ["teknisi", "admin", "owner", "superadmin"];

function resolveActorCapabilities({ ownerNumber, primarySenderId, optionalJid, plainSenderNumber, accounts }) {
    const isOwner =
        ownerNumber.includes(primarySenderId) ||
        (optionalJid ? ownerNumber.includes(optionalJid) : false) ||
        (optionalJid ? ownerNumber.includes(plainSenderNumber) : false);

    const isTeknisi = accounts.find((account) => {
        if (!account) {
            return false;
        }

        // FILTER PERAN. Dulu blok ini sama sekali tak melihat `account.role`: SIAPA PUN yang
        // nomornya terdaftar di accounts.json dianggap teknisi — termasuk peran `agen`.
        // Akibatnya akun agen bisa `list tiket` (melihat seluruh antrean gangguan berikut nama,
        // alamat, prioritas), lalu `proses TKT-0001` — dan karena akun itu dioper sebagai
        // `teknisiAccount`, `resolveTeknisiFromSender` (satu-satunya yang menolak role bukan
        // teknisi) tak pernah dijalankan. Tiketnya terkunci atas nama agen, pelanggan menerima
        // OTP yang menyebutnya "Teknisi", dan teknisi asli dijawab "sudah diproses teknisi lain".
        //
        // admin/owner/superadmin sengaja IKUT: banyak handler menggerbangi dengan
        // `isTeknisi || isOwner`, dan mencabut admin dari sini akan mematahkan alur mereka.
        if (!PERAN_BERKAPABILITAS_TEKNISI.includes(account.role)) {
            return false;
        }

        if (account.lid && account.lid === primarySenderId) {
            return true;
        }

        if (!account.phone_number) {
            return false;
        }

        const phone = account.phone_number;
        if (phone === primarySenderId) {
            return true;
        }

        if (optionalJid && (phone === optionalJid || phone === plainSenderNumber)) {
            return true;
        }

        return false;
    });

    return { isOwner, isTeknisi };
}

module.exports = {
    isControlEnvelope,
    extractMessageContext,
    getOptionalJid,
    resolveActorCapabilities
};
