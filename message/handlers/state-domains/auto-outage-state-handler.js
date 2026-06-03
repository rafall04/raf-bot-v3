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

function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
}

function resolveUser(context = {}) {
    if (context.user) return context.user;
    const userId = context.userState?.user_id || context.teknisiState?.user_id || null;
    const senderPhone = normalizePhone(context.plainSenderNumber || context.sender || context.stateSender);
    const users = Array.isArray(context.users) ? context.users : [];
    return users.find((user) => {
        if (userId && String(user.id) === String(userId)) return true;
        const phones = String(user.phone_number || user.phone || "").split("|").map(normalizePhone);
        return senderPhone && phones.includes(senderPhone);
    }) || null;
}

async function handleAutoOutageState(context = {}) {
    const service = context.autoOutageConversationService || createAutoOutageConversationService(context.deps || {});
    const user = resolveUser(context);
    if (!user) {
        return { handled: false, reason: "auto_outage_user_not_found" };
    }
    const result = await service.handleCustomerReply({
        ...context,
        user,
        text: context.text || context.chats || "",
        media: context.media || []
    });
    if ((result.closed || result.ticketCreated) && context.deleteUserState && context.stateSender) {
        context.deleteUserState(context.stateSender);
    }
    return { handled: result.handled !== false, ...result };
}

module.exports = { handleAutoOutageState };
