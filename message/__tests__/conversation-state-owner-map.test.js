/**
 * Header Doc
 * Purpose: Guardrail contract test untuk owner map state percakapan bot.
 * Caller: Jest test runner.
 * Deps: `../handlers/conversation-state-owner-map`.
 * MainFuncs: Memverifikasi representative step aktif punya owner domain tunggal.
 * SideEffects: Tidak ada.
 */
"use strict";

const {
    CONVERSATION_STATE_OWNER_MAP,
    resolveConversationStateOwner
} = require("../handlers/conversation-state-owner-map");

describe("conversation state owner map", () => {
    test("representative active steps resolve to one owner domain", () => {
        expect(CONVERSATION_STATE_OWNER_MAP.REPORT_MENU).toBe("reporting");
        expect(CONVERSATION_STATE_OWNER_MAP.ASK_NEW_PASSWORD).toBe("wifi");
        expect(CONVERSATION_STATE_OWNER_MAP.AWAITING_LOCATION_FOR_JOURNEY).toBe("teknisi");
        expect(CONVERSATION_STATE_OWNER_MAP.AWAITING_COMPLETION_PHOTOS).toBe("teknisi");
        expect(CONVERSATION_STATE_OWNER_MAP.ASK_VOUCHER_CHOICE).toBe("payment");
        expect(resolveConversationStateOwner("AGENT_VOUCHER_PURCHASE_PICK_PACKAGE")).toBe("agent-voucher");
        expect(resolveConversationStateOwner("PAYPROOF_SELECT")).toBe("payment-proof");
        expect(resolveConversationStateOwner("PKGREQ_SELECT")).toBe("package-request");
    });
});
