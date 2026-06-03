/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent laporan gangguan dan panduan reporting dispatcher WhatsApp.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `REPORTING_INTENT_HANDLERS`, `handleLaporGangguanIntent`, `handleLaporGangguanMatiIntent`, `handleLaporGangguanLemotIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleLaporPanduanIntent(context) {
    const {
        global,
        msg,
        plainSenderNumber,
        sender,
        findUserWithLidSupport,
        reply,
        mess,
        format,
        pushname,
        raf
    } = context;

    const user = await findUserWithLidSupport(global.users, msg, plainSenderNumber, raf);

    if (sender.includes('@lid') && !user) {
        console.log('[LAPOR_PANDUAN] @lid format detected, user not found');
        console.log('[LAPOR_PANDUAN] Sender:', sender);
    }

    if (!user) {
        return reply(mess.userNotRegister);
    }

    reply(format('panduan_laporan_cerdas', { pushname: pushname || 'Kak' }));
}

async function handleLaporGangguanIntent(context) {
    const { handleReportingIntent, intentOwner, runtimeSocket } = context;

    await handleReportingIntent({
        ...context,
        intentOwner,
        runtimeSocket
    });
}

async function handleLaporGangguanMatiIntent(context) {
    const { handleReportingIntent, intentOwner, runtimeSocket } = context;

    await handleReportingIntent({
        ...context,
        intentOwner,
        runtimeSocket
    });
}

async function handleLaporGangguanLemotIntent(context) {
    const {
        deleteUserState,
        stateSender,
        startReportFlow,
        sender,
        pushname,
        reply,
        msg,
        runtimeSocket,
        handleMenuSelection
    } = context;

    deleteUserState(stateSender);

    await startReportFlow({
        sender,
        stateKey: stateSender,
        pushname,
        reply,
        msg,
        raf: runtimeSocket
    });
    const result = await handleMenuSelection({
        sender,
        stateKey: stateSender,
        choice: '2',
        reply,
        msg,
        raf: runtimeSocket
    });

    if (result.message) {
        await reply(result.message);
    }
}

const REPORTING_INTENT_HANDLERS = Object.freeze({
    LAPOR_PANDUAN: handleLaporPanduanIntent,
    LAPOR_GANGGUAN: handleLaporGangguanIntent,
    LAPOR_GANGGUAN_MATI: handleLaporGangguanMatiIntent,
    LAPOR_GANGGUAN_LEMOT: handleLaporGangguanLemotIntent
});

module.exports = {
    REPORTING_INTENT_HANDLERS,
    handleLaporPanduanIntent,
    handleLaporGangguanIntent,
    handleLaporGangguanMatiIntent,
    handleLaporGangguanLemotIntent
};
