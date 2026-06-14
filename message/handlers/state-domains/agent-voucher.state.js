/**
 * Header Doc
 * Purpose: Owner state domain agent-voucher untuk flow purchase/sale berbasis prefix state.
 * Caller: `conversation-state-router`.
 * Deps: `agent-voucher-handler`.
 * MainFuncs: `handleAgentVoucherConversationState`.
 * SideEffects: Menjalankan percakapan agent voucher dan mengirim balasan melalui callback yang diberikan.
 */
"use strict";

async function handleAgentVoucherConversationState(context) {
    const {
        stateStep,
        msg,
        sender,
        stateSender,
        reply,
        chats,
        raf,
        global,
        agentVoucherConversationHandlers
    } = context;

    if (stateStep && stateStep.startsWith("AGENT_VOUCHER_PURCHASE_")) {
        return {
            // stateSender (JID kanonik) wajib agar read/write state pakai key yang sama
            // dengan yang diset saat memulai flow (anti-mati untuk pengirim @lid).
            handled: !!(await agentVoucherConversationHandlers.handleAgentVoucherPurchaseConversation(msg, sender, reply, chats, raf, stateSender))
        };
    }

    if (stateStep && stateStep.startsWith("AGENT_VOUCHER_SALE_")) {
        return {
            handled: !!(await agentVoucherConversationHandlers.handleAgentVoucherSaleConversation(msg, sender, reply, chats, raf, global, stateSender))
        };
    }

    return { handled: false };
}

module.exports = {
    handleAgentVoucherConversationState
};
