/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent agent umum, transaksi, voucher, dan profil outlet.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `AGENT_INTENT_HANDLERS`, `handleListAgentsIntent`, `handleAgentVoucherIntent`, `handleAgentProfileIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleAccessManagementIntent(context) {
    const { sender, args, users, reply, global, db, msg, raf, handleAccessManagement } = context;
    await handleAccessManagement({
        sender,
        args,
        users: global.users || users,
        reply,
        global,
        db: db || global.db,
        msg,
        raf
    });
}

async function handleListAgentsIntent(context) {
    const { q, handleAgentByArea, msg, sender, reply, handleListAgents, pushname, format } = context;

    try {
        if (q && q.trim()) {
            await handleAgentByArea(msg, sender, reply, q.trim());
        } else {
            await handleListAgents(msg, sender, reply, pushname);
        }
    } catch (error) {
        console.error('[LIST_AGENTS] Error:', error);
        await reply(format('error_agent_data_failed'));
    }
}

async function handleAgentServicesIntent(context) {
    const { handleAgentServices, msg, sender, reply } = context;
    await handleAgentServices(msg, sender, reply);
}

async function handleSearchAgentIntent(context) {
    const { q, handleSearchAgent, msg, sender, reply } = context;
    const searchQuery = q && q.trim() ? q.trim() : '';
    await handleSearchAgent(msg, sender, reply, searchQuery);
}

async function handleAgentDetailIntent(context) {
    const { q, reply, renderResponseTemplate, handleViewAgentDetail, msg, sender } = context;
    const agentId = q && q.trim() ? q.trim().toUpperCase() : '';
    if (!agentId) {
        await reply(renderResponseTemplate(
            'dispatch_agent_detail_missing_id',
            '❌ Masukkan ID agent.\n\nFormat: *detail agent [ID]*\nContoh: *detail agent AGT001*\n\nKetik *agent* untuk melihat daftar agent.'
        ));
    } else {
        await handleViewAgentDetail(msg, sender, reply, agentId);
    }
}

async function handleAgentTransactionsIntent(context) {
    const { handleAgentTodayTransactions, msg, sender, reply, raf } = context;
    await handleAgentTodayTransactions(msg, sender, reply, raf);
}

async function handleCheckTopupStatusIntent(context) {
    const { handleCheckTopupStatus, msg, normalizedSenderForSaldo, reply } = context;
    await handleCheckTopupStatus(msg, normalizedSenderForSaldo, reply);
}

async function handleAgentSelfProfileIntent(context) {
    const { handleAgentSelfProfile, msg, sender, reply, raf } = context;
    await handleAgentSelfProfile(msg, sender, reply, raf);
}

async function handleAgentChangePinIntent(context) {
    const { handleAgentPinChange, msg, sender, reply, args, raf } = context;
    await handleAgentPinChange(msg, sender, reply, args, raf);
}

async function handleAgentPurchaseVoucherIntent(context) {
    const { handleAgentVoucherIntent, intentOwner } = context;
    await handleAgentVoucherIntent({
        ...context,
        intentOwner
    });
}

async function handleAgentSellVoucherIntent(context) {
    const { handleAgentVoucherIntent, intentOwner } = context;
    await handleAgentVoucherIntent({
        ...context,
        intentOwner
    });
}

async function handleAgentCheckInventoryIntent(context) {
    const { handleAgentVoucherIntent, intentOwner } = context;
    await handleAgentVoucherIntent({
        ...context,
        intentOwner
    });
}

async function handleAgentPurchaseHistoryIntent(context) {
    const { handleAgentVoucherIntent, intentOwner } = context;
    await handleAgentVoucherIntent({
        ...context,
        intentOwner
    });
}

async function handleAgentSalesHistoryIntent(context) {
    const { handleAgentVoucherIntent, intentOwner } = context;
    await handleAgentVoucherIntent({
        ...context,
        intentOwner
    });
}

async function handleAgentUpdateAddressIntent(context) {
    const { handleAgentProfileUpdate, msg, sender, reply, args, raf } = context;
    await handleAgentProfileUpdate(msg, sender, reply, args, 'address', raf);
}

async function handleAgentUpdateHoursIntent(context) {
    const { handleAgentProfileUpdate, msg, sender, reply, args, raf } = context;
    await handleAgentProfileUpdate(msg, sender, reply, args, 'hours', raf);
}

async function handleAgentUpdatePhoneIntent(context) {
    const { handleAgentProfileUpdate, msg, sender, reply, args, raf } = context;
    await handleAgentProfileUpdate(msg, sender, reply, args, 'phone', raf);
}

async function handleAgentCloseTemporaryIntent(context) {
    const { handleAgentStatusToggle, msg, sender, reply, raf } = context;
    await handleAgentStatusToggle(msg, sender, reply, 'close', raf);
}

async function handleAgentOpenAgainIntent(context) {
    const { handleAgentStatusToggle, msg, sender, reply, raf } = context;
    await handleAgentStatusToggle(msg, sender, reply, 'open', raf);
}

const AGENT_INTENT_HANDLERS = Object.freeze({
    ACCESS_MANAGEMENT: handleAccessManagementIntent,
    LIST_AGENTS: handleListAgentsIntent,
    AGENT_SERVICES: handleAgentServicesIntent,
    SEARCH_AGENT: handleSearchAgentIntent,
    AGENT_DETAIL: handleAgentDetailIntent,
    AGENT_TRANSACTIONS: handleAgentTransactionsIntent,
    CHECK_TOPUP_STATUS: handleCheckTopupStatusIntent,
    AGENT_SELF_PROFILE: handleAgentSelfProfileIntent,
    AGENT_CHANGE_PIN: handleAgentChangePinIntent,
    AGENT_PURCHASE_VOUCHER: handleAgentPurchaseVoucherIntent,
    AGENT_SELL_VOUCHER: handleAgentSellVoucherIntent,
    AGENT_CHECK_INVENTORY: handleAgentCheckInventoryIntent,
    AGENT_PURCHASE_HISTORY: handleAgentPurchaseHistoryIntent,
    AGENT_SALES_HISTORY: handleAgentSalesHistoryIntent,
    AGENT_UPDATE_ADDRESS: handleAgentUpdateAddressIntent,
    AGENT_UPDATE_HOURS: handleAgentUpdateHoursIntent,
    AGENT_UPDATE_PHONE: handleAgentUpdatePhoneIntent,
    AGENT_CLOSE_TEMPORARY: handleAgentCloseTemporaryIntent,
    AGENT_OPEN_AGAIN: handleAgentOpenAgainIntent
});

module.exports = {
    AGENT_INTENT_HANDLERS,
    handleAccessManagementIntent,
    handleListAgentsIntent,
    handleAgentServicesIntent,
    handleSearchAgentIntent,
    handleAgentDetailIntent,
    handleAgentTransactionsIntent,
    handleCheckTopupStatusIntent,
    handleAgentSelfProfileIntent,
    handleAgentChangePinIntent,
    handleAgentPurchaseVoucherIntent,
    handleAgentSellVoucherIntent,
    handleAgentCheckInventoryIntent,
    handleAgentPurchaseHistoryIntent,
    handleAgentSalesHistoryIntent,
    handleAgentUpdateAddressIntent,
    handleAgentUpdateHoursIntent,
    handleAgentUpdatePhoneIntent,
    handleAgentCloseTemporaryIntent,
    handleAgentOpenAgainIntent
};
