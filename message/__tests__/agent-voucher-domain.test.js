/**
 * Header Doc
 * Purpose: Guardrail test untuk facade domain agent voucher.
 * Caller: Jest test runner.
 * Deps: `../handlers/domains/agent-voucher.domain`.
 * MainFuncs: Memverifikasi facade agent voucher menjadi owner intent voucher agent.
 * SideEffects: Tidak ada.
 */
"use strict";

const mockHandleAgentPurchaseVoucher = jest.fn();

jest.mock("../handlers/agent-voucher-handler", () => ({
    handleAgentPurchaseVoucher: (...args) => mockHandleAgentPurchaseVoucher(...args),
    handleAgentSellVoucher: jest.fn(),
    handleAgentCheckInventory: jest.fn(),
    handleAgentPurchaseHistory: jest.fn(),
    handleAgentSalesHistory: jest.fn()
}));

const { handleAgentVoucherIntent } = require("../handlers/domains/agent-voucher.domain");

describe("agent voucher domain", () => {
    beforeEach(() => {
        mockHandleAgentPurchaseVoucher.mockReset();
    });

    test("agent voucher domain owns AGENT_PURCHASE_VOUCHER", async () => {
        mockHandleAgentPurchaseVoucher.mockResolvedValue(undefined);

        const result = await handleAgentVoucherIntent({
            intent: "AGENT_PURCHASE_VOUCHER",
            msg: {},
            sender: "6281@s.whatsapp.net",
            reply: jest.fn(),
            temp: {},
            raf: {}
        });

        expect(result).toEqual(expect.objectContaining({ handled: true }));
        expect(mockHandleAgentPurchaseVoucher).toHaveBeenCalled();
    });
});
