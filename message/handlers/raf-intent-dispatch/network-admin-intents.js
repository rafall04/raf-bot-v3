/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent admin jaringan dan provisioning profile/queue/binding.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `NETWORK_ADMIN_INTENT_HANDLERS`, `handleAddProfVoucherIntent`, `handleAddBindingIntent`, `handleAddPppIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleAddProfVoucherIntent(context) {
    const { handleAddProfVoucher, q, isOwner, reply, mess, checkprofvoucher, addvoucher } = context;
    await handleAddProfVoucher({ q, isOwner, reply, mess, checkprofvoucher, addvoucher });
}

async function handleDelProfVoucherIntent(context) {
    const { handleDelProfVoucher, q, isOwner, reply, mess, checkprofvoucher, voucher } = context;
    await handleDelProfVoucher({ q, isOwner, reply, mess, checkprofvoucher, voucher });
}

async function handleAddProfStatikIntent(context) {
    const { handleAddProfStatik, q, isOwner, reply, mess, checkStatik, addStatik } = context;
    await handleAddProfStatik({ q, isOwner, reply, mess, checkStatik, addStatik });
}

async function handleDelProfStatikIntent(context) {
    const { handleDelProfStatik, q, isOwner, reply, mess, checkStatik, statik } = context;
    await handleDelProfStatik({ q, isOwner, reply, mess, checkStatik, statik });
}

async function handleAddBindingIntent(context) {
    const {
        handleAddBinding,
        q,
        isOwner,
        reply,
        mess,
        global,
        checkStatik,
        checkLimitAt,
        checkMaxLimit,
        addbinding,
        addqueue
    } = context;
    await handleAddBinding({
        q,
        isOwner,
        reply,
        mess,
        global,
        checkStatik,
        checkLimitAt,
        checkMaxLimit,
        addbinding,
        addqueue
    });
}

async function handleAddPppIntent(context) {
    const { handleAddPPP, q, isOwner, reply, mess, addpppoe } = context;
    await handleAddPPP({ q, isOwner, reply, mess, addpppoe });
}

const NETWORK_ADMIN_INTENT_HANDLERS = Object.freeze({
    addprofvoucher: handleAddProfVoucherIntent,
    delprofvoucher: handleDelProfVoucherIntent,
    addprofstatik: handleAddProfStatikIntent,
    delprofstatik: handleDelProfStatikIntent,
    addbinding: handleAddBindingIntent,
    addppp: handleAddPppIntent
});

module.exports = {
    NETWORK_ADMIN_INTENT_HANDLERS,
    handleAddProfVoucherIntent,
    handleDelProfVoucherIntent,
    handleAddProfStatikIntent,
    handleDelProfStatikIntent,
    handleAddBindingIntent,
    handleAddPppIntent
};
