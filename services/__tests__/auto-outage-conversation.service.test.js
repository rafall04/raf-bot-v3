/**
 * Header Doc
 * Purpose: Smoke test kontrak conversation service auto outage sebelum logic triage WhatsApp ditulis.
 * Caller: Jest targeted test Task 1 auto outage skeleton.
 * Deps: `services/auto-outage-conversation.service.js`.
 * MainFuncs: Memverifikasi export `createAutoOutageConversationService` dan method skeleton.
 * SideEffects: Tidak ada; dependency WA/ticket direplace stub.
 */
"use strict";

const { createAutoOutageConversationService } = require("../auto-outage-conversation.service");

describe("auto-outage-conversation.service skeleton", () => {
    test("exports conversation service contract", async () => {
        const service = createAutoOutageConversationService({
            repository: {},
            sendMessage: jest.fn(),
            renderResponseTemplate: jest.fn(),
            createCustomerReportTicket: jest.fn()
        });
        expect(typeof service.startConversation).toBe("function");
        expect(typeof service.handleCustomerReply).toBe("function");
        expect(typeof service.sendTicketConfirmation).toBe("function");
        expect(typeof service.finalizeTicketDecision).toBe("function");
        await expect(service.handleCustomerReply()).rejects.toThrow("AUTO_OUTAGE_CONVERSATION_NOT_IMPLEMENTED");
    });
});
