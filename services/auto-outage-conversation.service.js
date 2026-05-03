/**
 * Header Doc
 * Purpose: Mengelola percakapan WhatsApp auto outage, triage jawaban pelanggan, media, dan konfirmasi tiket.
 * Caller: `message/handlers/state-domains/auto-outage-state-handler.js`, `routes/admin-auto-outage-routes.js`.
 * Deps: `repositories/auto-outage.repository.js`, response template helper, WhatsApp delivery service, ticket/report orchestration service.
 * MainFuncs: `createAutoOutageConversationService`, `startConversation`, `handleCustomerReply`, `sendTicketConfirmation`, `finalizeTicketDecision`.
 * SideEffects: Mengirim WhatsApp, menyimpan conversation state, dan membuat tiket setelah konfirmasi pelanggan.
 */
"use strict";

function optionalRequire(path, exportName, fallback) {
    try {
        const loaded = require(path);
        return loaded?.[exportName] || fallback;
    } catch (_error) {
        return fallback;
    }
}

function defaultDeps() {
    return {
        repository: require("../repositories/auto-outage.repository").createAutoOutageRepository(),
        sendMessage: optionalRequire("../lib/whatsapp-delivery-service", "sendMessage", null),
        renderResponseTemplate: optionalRequire("../lib/response-template-helper", "renderResponseTemplate", null),
        createCustomerReportTicket: optionalRequire("../lib/report-orchestration-service", "createCustomerReportTicket", null),
        now: () => new Date()
    };
}

function createAutoOutageConversationService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    return {
        deps,
        async startConversation() { throw new Error("AUTO_OUTAGE_CONVERSATION_NOT_IMPLEMENTED"); },
        async handleCustomerReply() { throw new Error("AUTO_OUTAGE_CONVERSATION_NOT_IMPLEMENTED"); },
        async sendTicketConfirmation() { throw new Error("AUTO_OUTAGE_CONVERSATION_NOT_IMPLEMENTED"); },
        async finalizeTicketDecision() { throw new Error("AUTO_OUTAGE_CONVERSATION_NOT_IMPLEMENTED"); }
    };
}

module.exports = { createAutoOutageConversationService };
