/**
 * Header Doc
 * Purpose: Source of truth ownership state percakapan bot agar setiap `state.step` aktif punya owner domain tunggal.
 * Caller: `conversation-state-router`, Jest guardrail tests, dan pengembang saat tracing flow state.
 * Deps: Tidak ada.
 * MainFuncs: `CONVERSATION_STATE_OWNER_MAP`, `CONVERSATION_STATE_PREFIX_OWNER_MAP`, dan `resolveConversationStateOwner`.
 * SideEffects: Tidak ada.
 */
"use strict";

const CONVERSATION_STATE_OWNER_MAP = {
    REPORT_MENU: "reporting",
    REPORT_LEMOT_ANALYSIS: "reporting",
    TROUBLESHOOT_LEMOT: "reporting",
    CONFIRM_MATI_REPORT: "reporting",
    REPORT_LEMOT_CONFIRM: "reporting",
    REPORT_MATI_TROUBLESHOOT: "reporting",
    MATI_TROUBLESHOOT_OPTIONS: "reporting",
    REPORT_MATI_PHOTO: "reporting",
    MATI_AWAITING_PHOTO: "reporting",
    LEMOT_AWAITING_PHOTO: "reporting",
    CONFIRM_DIRECT_MATI: "reporting",
    DIRECT_LEMOT_TROUBLESHOOT: "reporting",
    GANGGUAN_MATI_AWAITING_PHOTO: "reporting",
    GANGGUAN_MATI_DEVICE_OFFLINE: "reporting",
    GANGGUAN_MATI_DEVICE_ONLINE: "reporting",
    GANGGUAN_LEMOT_ANALYSIS: "reporting",
    GANGGUAN_LEMOT_AWAITING_RESPONSE: "reporting",
    GANGGUAN_LEMOT_CONFIRM_TICKET: "reporting",
    TICKET_RESOLVE_UPLOAD_PHOTOS: "reporting",
    TICKET_VERIFIED_AWAITING_PHOTOS: "reporting",
    TICKET_RESOLVE_ASK_NOTES: "reporting",
    TICKET_RESOLVE_CONFIRM: "reporting",
    SELECT_CHANGE_MODE_FIRST: "wifi",
    SELECT_CHANGE_MODE: "wifi",
    SELECT_SSID_TO_CHANGE: "wifi",
    ASK_NEW_NAME_FOR_SINGLE: "wifi",
    ASK_NEW_NAME_FOR_SINGLE_BULK: "wifi",
    ASK_NEW_NAME_FOR_BULK: "wifi",
    ASK_NEW_NAME_FOR_BULK_AUTO: "wifi",
    CONFIRM_GANTI_NAMA: "wifi",
    CONFIRM_GANTI_NAMA_BULK: "wifi",
    SELECT_CHANGE_PASSWORD_MODE: "wifi",
    SELECT_CHANGE_PASSWORD_MODE_FIRST: "wifi",
    SELECT_SSID_PASSWORD: "wifi",
    SELECT_SSID_PASSWORD_FIRST: "wifi",
    ASK_NEW_PASSWORD: "wifi",
    ASK_NEW_PASSWORD_BULK: "wifi",
    ASK_NEW_PASSWORD_BULK_AUTO: "wifi",
    CONFIRM_GANTI_SANDI: "wifi",
    CONFIRM_GANTI_SANDI_BULK: "wifi",
    AWAITING_COMPLETION_PHOTOS: "teknisi",
    AWAITING_PHOTO_CATEGORY_1: "teknisi",
    AWAITING_PHOTO_CATEGORY_2: "teknisi",
    AWAITING_PHOTO_CATEGORY_3: "teknisi",
    AWAITING_PHOTO_EXTRA: "teknisi",
    AWAITING_LOCATION_FOR_JOURNEY: "teknisi",
    AWAITING_PHOTO_EXTRA_CONFIRM: "teknisi",
    AWAITING_RESOLUTION_NOTES: "teknisi",
    AWAITING_CONFIRMATION: "teknisi",
    ASK_VOUCHER_CHOICE: "payment",
    AWAITING_QUESTION: "payment",
    TRANSFER_CONFIRM: "payment",
    AUTO_OUTAGE_TRIAGE: "auto-outage"
};

const CONVERSATION_STATE_PREFIX_OWNER_MAP = {
    AGENT_VOUCHER_PURCHASE_: "agent-voucher",
    AGENT_VOUCHER_SALE_: "agent-voucher",
    PSB_: "psb",
    PSBJADWAL_: "psb-schedule",
    CUSTLOC_: "customer-location", // wizard WA `lokasi <nama>` — set titik rumah pelanggan (staf)
    ASSET_: "network-asset", // wizard WA #ODC/#ODP (pemetaan aset oleh teknisi)
    WANSW_: "wan-switch",
    OPERJALUR_: "oper-jalur",
    PAYPROOF_: "payment-proof",
    PKGREQ_: "package-request",
    REBOOTFU_: "reboot-followup",
    COPOT_: "customer-removal", // wizard WA `copot <nama/HP/ID>` — copot pelanggan (admin)
    SODB_: "speed-boost" // Speed on Demand pelanggan (menggantikan step SOD legacy di other-state-handler)
};

function resolveConversationStateOwner(step) {
    if (!step) {
        return null;
    }

    if (CONVERSATION_STATE_OWNER_MAP[step]) {
        return CONVERSATION_STATE_OWNER_MAP[step];
    }

    const matchedPrefix = Object.keys(CONVERSATION_STATE_PREFIX_OWNER_MAP)
        .find((prefix) => String(step).startsWith(prefix));

    return matchedPrefix ? CONVERSATION_STATE_PREFIX_OWNER_MAP[matchedPrefix] : null;
}

module.exports = {
    CONVERSATION_STATE_OWNER_MAP,
    CONVERSATION_STATE_PREFIX_OWNER_MAP,
    resolveConversationStateOwner
};
