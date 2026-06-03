/**
 * Header Doc
 * Purpose: Helper context router WhatsApp untuk actor capability dan canonical sender resolution.
 * Caller: `message/raf.js`.
 * Deps: `../../lib/whatsapp-inbound-adapter` dan runtime message payload.
 * MainFuncs: `extractMessageContext`, `getOptionalJid`, dan `resolveActorCapabilities`.
 * SideEffects: Tidak ada; helper ini hanya membaca payload runtime dan menghitung capability actor.
 */
"use strict";

const { normalizeIncomingMessage } = require("../../lib/whatsapp-inbound-adapter");

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

function resolveActorCapabilities({ ownerNumber, primarySenderId, optionalJid, plainSenderNumber, accounts }) {
    const isOwner =
        ownerNumber.includes(primarySenderId) ||
        (optionalJid ? ownerNumber.includes(optionalJid) : false) ||
        (optionalJid ? ownerNumber.includes(plainSenderNumber) : false);

    const isTeknisi = accounts.find((account) => {
        if (!account) {
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
    extractMessageContext,
    getOptionalJid,
    resolveActorCapabilities
};
