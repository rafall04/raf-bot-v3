/**
 * Header Doc
 * Purpose: Guardrail test untuk router state percakapan agar step jatuh ke owner domain yang benar.
 * Caller: Jest test runner.
 * Deps: `../handlers/conversation-state-router`.
 * MainFuncs: Memverifikasi owner reporting, WiFi, teknisi, payment, dan agent-voucher dapat diresolusikan dari state step.
 * SideEffects: Tidak ada.
 */
"use strict";

const { routeConversationState } = require("../handlers/conversation-state-router");

describe("conversation state router", () => {
    test("returns owner metadata for representative state steps", async () => {
        const base = {
            reply: jest.fn(),
            deleteUserState: jest.fn(),
            setUserState: jest.fn(),
            handleConversationState: jest.fn(async () => ({ handled: true })),
            handleLegacyTeknisiStateTransitions: jest.fn(async () => ({ handled: false })),
            handleVoucherChoiceState: jest.fn(async () => ({ handled: true })),
            domainServices: {
                checkhargavoucher: jest.fn(),
                checkprofvc: jest.fn(),
                checkdurasivc: jest.fn(),
                checkhargavc: jest.fn(),
                checkATMuser: jest.fn(),
                confirmATM: jest.fn()
            },
            getvoucher: jest.fn(),
            agentVoucherConversationHandlers: {
                handleAgentVoucherPurchaseConversation: jest.fn(async () => true),
                handleAgentVoucherSaleConversation: jest.fn(async () => true)
            }
        };

        await expect(routeConversationState({ ...base, stateStep: "ASK_NEW_PASSWORD" })).resolves.toEqual(expect.objectContaining({ owner: "wifi" }));
        await expect(routeConversationState({ ...base, stateStep: "AGENT_VOUCHER_PURCHASE_PICK_PACKAGE" })).resolves.toEqual(expect.objectContaining({ owner: "agent-voucher" }));
        await expect(routeConversationState({ ...base, stateStep: "ASK_VOUCHER_CHOICE" })).resolves.toEqual(expect.objectContaining({ owner: "payment" }));
    });
});
