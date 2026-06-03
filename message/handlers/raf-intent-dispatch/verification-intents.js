/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent verifikasi akun/link LID di dispatcher WhatsApp.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `VERIFICATION_INTENT_HANDLERS`, `handleLinkIntent`, `handleVerifikasiIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleLinkIntent(context) {
    const { sender, reply, renderResponseTemplate, args, processLidVerification, users, format } = context;
    if (!sender.includes('@lid')) {
        return reply(renderResponseTemplate(
            'dispatch_lid_only_command',
            '⚠️ Perintah ini hanya untuk pengguna dengan format @lid'
        ));
    }

    const lidId = sender.split('@')[0];
    const phoneNumber = args[1];

    if (!phoneNumber) {
        return reply(format('error_format_link'));
    }

    const result = processLidVerification(lidId, phoneNumber, users);
    return reply(result.message);
}

async function handleVerifikasiIntent(context) {
    const { sender, reply, renderResponseTemplate, args, processLidVerification, users, format } = context;
    if (!sender.includes('@lid')) {
        return reply(renderResponseTemplate(
            'dispatch_lid_only_command',
            '⚠️ Perintah ini hanya untuk pengguna dengan format @lid'
        ));
    }

    const lidId = sender.split('@')[0];
    const code = args[1];

    if (!code) {
        return reply(format('error_format_verifikasi_lid'));
    }

    const result = processLidVerification(lidId, code, users);
    return reply(result.message);
}

const VERIFICATION_INTENT_HANDLERS = Object.freeze({
    link: handleLinkIntent,
    LINK: handleLinkIntent,
    verifikasi: handleVerifikasiIntent,
    VERIFIKASI: handleVerifikasiIntent
});

module.exports = {
    VERIFICATION_INTENT_HANDLERS,
    handleLinkIntent,
    handleVerifikasiIntent
};
