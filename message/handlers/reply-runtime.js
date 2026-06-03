/**
 * Header Doc
 * Purpose: Menyediakan primitive reply/contact untuk router bot tanpa membaca socket WhatsApp mentah secara langsung.
 * Caller: `message/raf.js` dan handler bot lain yang membutuhkan reply berbasis quoted/contact card.
 * Deps: `../../lib/whatsapp-gateway`.
 * MainFuncs: `sendReply`, `sendContactCard`.
 * SideEffects: Mengirim pesan teks atau contact payload melalui gateway runtime WA aktif.
 */
"use strict";

const { isReady, sendPayload } = require('../../lib/whatsapp-gateway');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendReply({ recipient, text, quoted, skipDuplicateCheck = false, delayMs = 500 }) {
    if (!isReady()) {
        console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', recipient);
        return;
    }

    try {
        await wait(delayMs);
        await sendPayload(recipient, { text }, {
            quoted,
            ...(skipDuplicateCheck ? { skipDuplicateCheck: true } : {})
        });
    } catch (error) {
        console.error('[SEND_MESSAGE_ERROR]', {
            from: recipient,
            error: error.message
        });
    }
}

async function sendContactCard({ recipient, number, name, quoted }) {
    if (!isReady()) {
        console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', recipient);
        return;
    }

    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const vcard = 'BEGIN:VCARD\n'
        + 'VERSION:3.0\n'
        + 'FN:' + name + '\n'
        + 'ORG:;\n'
        + 'TEL;type=CELL;type=VOICE;waid=' + sanitized + ':+' + sanitized + '\n'
        + 'END:VCARD';

    try {
        await sendPayload(recipient, {
            contacts: {
                displayName: name,
                contacts: [{ vcard }]
            }
        }, { quoted });
    } catch (error) {
        console.error('[SEND_MESSAGE_ERROR]', {
            from: recipient,
            type: 'contact',
            error: error.message
        });
    }
}

module.exports = {
    sendReply,
    sendContactCard
};
