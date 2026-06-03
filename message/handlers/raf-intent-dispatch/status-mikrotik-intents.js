/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent monitoring status jaringan/MikroTik dan utilitas ringkas owner.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `STATUS_MIKROTIK_INTENT_HANDLERS`, `handleStatusPppIntent`, `handleStatusApIntent`, `handleMonitorWifiIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleStatusPppIntent(context) {
    const { handleStatusPpp, isOwner, isTeknisi, reply, mess, global } = context;
    await handleStatusPpp(isOwner, isTeknisi, reply, mess, global.config);
}

async function handleStatusHotspotIntent(context) {
    const { handleStatusHotspot, isOwner, isTeknisi, reply, mess, global } = context;
    await handleStatusHotspot(isOwner, isTeknisi, reply, mess, global.config);
}

async function handleListProfStatikIntent(context) {
    const { handleListProfStatik, isOwner, reply, mess, statik } = context;
    handleListProfStatik(isOwner, reply, mess, statik);
}

async function handleListProfVoucherIntent(context) {
    const { handleListProfVoucher, isOwner, reply, mess, voucher } = context;
    handleListProfVoucher(isOwner, reply, mess, voucher);
}

async function handleStatusApIntent(context) {
    const { handleStatusAp, isOwner, reply, mess } = context;
    await handleStatusAp(isOwner, reply, mess);
}

async function handleMonitorWifiIntent(context) {
    const { handleMonitorWifi, isOwner, isTeknisi, reply, mess } = context;
    handleMonitorWifi(isOwner, isTeknisi, reply, mess);
}

const STATUS_MIKROTIK_INTENT_HANDLERS = Object.freeze({
    statusppp: handleStatusPppIntent,
    statushotspot: handleStatusHotspotIntent,
    listprofstatik: handleListProfStatikIntent,
    listprofvoucher: handleListProfVoucherIntent,
    statusap: handleStatusApIntent,
    monitorwifi: handleMonitorWifiIntent
});

module.exports = {
    STATUS_MIKROTIK_INTENT_HANDLERS,
    handleStatusPppIntent,
    handleStatusHotspotIntent,
    handleListProfStatikIntent,
    handleListProfVoucherIntent,
    handleStatusApIntent,
    handleMonitorWifiIntent
};
