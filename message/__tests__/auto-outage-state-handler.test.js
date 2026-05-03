/**
 * Header Doc
 * Purpose: Smoke test kontrak handler state WhatsApp auto outage sebelum routing state aktif ditulis.
 * Caller: Jest targeted test Task 1 auto outage skeleton.
 * Deps: `message/handlers/state-domains/auto-outage-state-handler.js`.
 * MainFuncs: Memverifikasi `handleAutoOutageState` mendelegasikan context ke conversation service.
 * SideEffects: Tidak ada; conversation service direplace stub.
 */
"use strict";

const { handleAutoOutageState } = require("../handlers/state-domains/auto-outage-state-handler");

describe("auto-outage-state-handler skeleton", () => {
    test("delegates customer reply to injected conversation service", async () => {
        const autoOutageConversationService = {
            handleCustomerReply: jest.fn().mockResolvedValue({ handled: true })
        };
        const context = { autoOutageConversationService, text: "aman" };
        const result = await handleAutoOutageState(context);
        expect(result).toEqual({ handled: true });
        expect(autoOutageConversationService.handleCustomerReply).toHaveBeenCalledWith(context);
    });
});
