/**
 * Header Doc
 * Purpose: Guardrail test untuk facade domain saldo/payment.
 * Caller: Jest test runner.
 * Deps: `../handlers/domains/saldo-payment.domain`.
 * MainFuncs: Memverifikasi facade saldo/payment menjadi owner intent payment prioritas.
 * SideEffects: Tidak ada.
 */
"use strict";

const mockHandleTopupSaldoPayment = jest.fn();
const mockHandleBeliVoucher = jest.fn();

jest.mock("../handlers/payment-processor-handler", () => ({
    handleTopupSaldoPayment: (...args) => mockHandleTopupSaldoPayment(...args),
    handleBeliVoucher: (...args) => mockHandleBeliVoucher(...args)
}));

const { handleSaldoPaymentIntent } = require("../handlers/domains/saldo-payment.domain");

describe("saldo payment domain", () => {
    beforeEach(() => {
        mockHandleTopupSaldoPayment.mockReset();
        mockHandleBeliVoucher.mockReset();
    });

    test("saldo payment domain owns BELI_VOUCHER", async () => {
        mockHandleBeliVoucher.mockResolvedValue(undefined);

        const result = await handleSaldoPaymentIntent({
            intent: "BELI_VOUCHER",
            sender: "6281@s.whatsapp.net",
            reply: jest.fn(),
            helpers: {}
        });

        expect(result).toEqual(expect.objectContaining({ handled: true }));
        expect(mockHandleBeliVoucher).toHaveBeenCalled();
    });
});
