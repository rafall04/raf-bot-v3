/**
 * Header Doc
 * Purpose: Facade owner intent agent voucher untuk pembelian, penjualan, dan histori voucher agent.
 * Caller: `message/handlers/domain-handlers.js` dan `message/handlers/raf-intent-dispatch.js`.
 * Deps: Handler agent voucher existing.
 * MainFuncs: `handleAgentVoucherIntent`.
 * SideEffects: Menjalankan flow voucher agent melalui handler existing.
 */
"use strict";

const {
    handleAgentPurchaseVoucher,
    handleAgentSellVoucher,
    handleAgentCheckInventory,
    handleAgentPurchaseHistory,
    handleAgentSalesHistory
} = require("../agent-voucher-handler");

async function handleAgentVoucherIntent(context) {
    const {
        intent,
        msg,
        sender,
        stateSender,
        reply,
        temp,
        raf,
        users,
        global
    } = context;

    if (intent === "AGENT_PURCHASE_VOUCHER") {
        // stateSender (JID kanonik) diteruskan agar state percakapan agent voucher
        // di-key konsisten dengan pembacaan router (anti-mati untuk pengirim @lid).
        await handleAgentPurchaseVoucher(msg, sender, reply, temp, raf, stateSender);
        return { handled: true };
    }

    if (intent === "AGENT_SELL_VOUCHER") {
        await handleAgentSellVoucher(msg, sender, reply, temp, raf, users, global, stateSender);
        return { handled: true };
    }

    if (intent === "AGENT_CHECK_INVENTORY") {
        await handleAgentCheckInventory(msg, sender, reply, raf);
        return { handled: true };
    }

    if (intent === "AGENT_PURCHASE_HISTORY") {
        await handleAgentPurchaseHistory(msg, sender, reply, raf);
        return { handled: true };
    }

    if (intent === "AGENT_SALES_HISTORY") {
        await handleAgentSalesHistory(msg, sender, reply, raf);
        return { handled: true };
    }

    return { handled: false };
}

module.exports = {
    handleAgentVoucherIntent
};
