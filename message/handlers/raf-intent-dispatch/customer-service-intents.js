/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent layanan pelanggan seperti tagihan, paket, keluhan, dan speed boost.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `CUSTOMER_SERVICE_INTENT_HANDLERS`, `handleCekTagihanIntent`, `handleCekKoneksiIntent`, `handleUbahPaketIntent`, `handleRequestSpeedBoostIntent`.
 * SideEffects: Tidak ada.
 */
'use strict';

async function handleCekTagihanIntent(context) {
    const { handleCekTagihan, plainSenderNumber, pushname, reply, mess, global, renderTemplate, msg, raf, sender } =
        context;
    await handleCekTagihan({
        plainSenderNumber,
        pushname,
        reply,
        mess,
        global,
        renderTemplate,
        msg,
        raf,
        sender
    });
}

async function handleCekPaketIntent(context) {
    const { findUserWithLidSupport, global, msg, plainSenderNumber, handleCheckPackage, pushname, reply, raf } =
        context;
    const user = await findUserWithLidSupport(global.users, msg, plainSenderNumber, raf);
    const result = handleCheckPackage({ user, pushname });
    await reply(result.message);
}

async function handleKeluhanSaranIntent(context) {
    const {
        findUserWithLidSupport,
        global,
        msg,
        plainSenderNumber,
        chats,
        handleComplaint,
        pushname,
        reply,
        raf,
        sender,
        stateSender
    } = context;
    const user = await findUserWithLidSupport(global.users, msg, plainSenderNumber, raf);
    const keluhanText = chats.replace(/^(keluhan|saran|kritik|komplain)\s*/i, '').trim();
    const result = handleComplaint({ sender, stateSender, user, pushname, complaint: keluhanText });
    await reply(result.message);
}

async function handleInfoLayananIntent(context) {
    const { handleServiceInfo, reply } = context;
    const result = handleServiceInfo();
    await reply(result.message);
}

async function handleUbahPaketIntent(context) {
    const { handleUbahPaket, sender, stateSender, plainSenderNumber, pushname, reply, mess, global, temp, msg, raf } =
        context;
    await handleUbahPaket({
        sender,
        stateSender,
        plainSenderNumber,
        pushname,
        reply,
        mess,
        global,
        temp,
        msg,
        raf
    });
}

async function handleRequestSpeedBoostIntent(context) {
    const {
        handleRequestSpeedBoost,
        sender,
        stateSender,
        plainSenderNumber,
        pushname,
        reply,
        mess,
        global,
        temp,
        msg,
        raf
    } = context;
    await handleRequestSpeedBoost({
        sender,
        stateSender,
        plainSenderNumber,
        pushname,
        reply,
        mess,
        global,
        temp,
        msg,
        raf
    });
}

async function handleCekStatusSpeedIntent(context) {
    const { findUserWithLidSupport, global, msg, plainSenderNumber, reply, mess, sender, raf } = context;
    const { checkSpeedBoostStatus } = require('../speed-status-handler');
    const user = await findUserWithLidSupport(global.users, msg, plainSenderNumber, raf);
    if (!user) {
        return reply(mess.userNotRegister);
    }
    await checkSpeedBoostStatus(msg, user, sender, false);
}

async function handleCekKoneksiIntent(context) {
    const { sender, msg, raf, users, reply, global, mess, pushname } = context;
    const { handleCekKoneksi } = require('../connection-check-handler');
    await handleCekKoneksi({ sender, msg, raf, users, reply, global, mess, pushname });
}

const CUSTOMER_SERVICE_INTENT_HANDLERS = Object.freeze({
    CEK_TAGIHAN: handleCekTagihanIntent,
    CEK_KONEKSI: handleCekKoneksiIntent,
    CEK_PAKET: handleCekPaketIntent,
    KELUHAN_SARAN: handleKeluhanSaranIntent,
    INFO_LAYANAN: handleInfoLayananIntent,
    UBAH_PAKET: handleUbahPaketIntent,
    REQUEST_SPEED_BOOST: handleRequestSpeedBoostIntent,
    CEK_STATUS_SPEED: handleCekStatusSpeedIntent
});

module.exports = {
    CUSTOMER_SERVICE_INTENT_HANDLERS,
    handleCekKoneksiIntent,
    handleCekTagihanIntent,
    handleCekPaketIntent,
    handleKeluhanSaranIntent,
    handleInfoLayananIntent,
    handleUbahPaketIntent,
    handleRequestSpeedBoostIntent,
    handleCekStatusSpeedIntent
};
