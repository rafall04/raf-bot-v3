/**
 * Header Doc
 * Purpose: Handler state percakapan WhatsApp untuk balasan pelanggan pada flow auto outage.
 * Caller: `message/handlers/conversation-state-router.js`.
 * Deps: `services/auto-outage-conversation.service.js`, runtime reply helper/context state.
 * MainFuncs: `handleAutoOutageState`.
 * SideEffects: Mendelegasikan balasan pelanggan ke conversation service dan mengirim respons WhatsApp via service boundary.
 */
"use strict";

const { createAutoOutageConversationService } = require("../../../services/auto-outage-conversation.service");

async function handleAutoOutageState(context = {}) {
    const service = context.autoOutageConversationService || createAutoOutageConversationService(context.deps || {});
    return service.handleCustomerReply(context);
}

module.exports = { handleAutoOutageState };
