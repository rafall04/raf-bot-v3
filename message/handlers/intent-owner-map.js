/**
 * Header Doc
 * Purpose: Peta owner intent prioritas untuk konsolidasi domain handler bot.
 * Caller: `message/raf.js`, `message/handlers/raf-intent-dispatch.js`, dan test guardrail bot.
 * Deps: Tidak ada.
 * MainFuncs: `INTENT_OWNER_MAP`.
 * SideEffects: Tidak ada; konstanta statis.
 */
"use strict";

const INTENT_OWNER_MAP = {
    LAPOR_GANGGUAN: "reporting",
    LAPOR_GANGGUAN_MATI: "reporting",
    GANTI_NAMA_WIFI: "wifi",
    GANTI_SANDI_WIFI: "wifi",
    AGENT_PURCHASE_VOUCHER: "agent-voucher",
    AGENT_SELL_VOUCHER: "agent-voucher",
    AGENT_CHECK_INVENTORY: "agent-voucher",
    AGENT_PURCHASE_HISTORY: "agent-voucher",
    AGENT_SALES_HISTORY: "agent-voucher",
    TOPUP_SALDO: "saldo-payment",
    BELI_VOUCHER: "saldo-payment",
    buynow: "saldo-payment"
};

module.exports = {
    INTENT_OWNER_MAP
};
