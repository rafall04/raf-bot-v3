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
        reply,
        chats,
        raf,
        global,
        agentVoucherConversationHandlers
    } = context;

    if (stateStep && stateStep.startsWith("AGENT_VOUCHER_PURCHASE_")) {
        return {
            handled: !!(await agentVoucherConversationHandlers.handleAgentVoucherPurchaseConversation(msg, sender, reply, chats, raf))
        };
    }

    if (stateStep && stateStep.startsWith("AGENT_VOUCHER_SALE_")) {
        return {
            handled: !!(await agentVoucherConversationHandlers.handleAgentVoucherSaleConversation(msg, sender, reply, chats, raf, global))
        };
    }

    return { handled: false };
}

module.exports = {
    handleAgentVoucherConversationState
};
