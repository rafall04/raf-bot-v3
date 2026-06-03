/**
 * Header Doc
 * Purpose: Menjadi adapter bot untuk create request payment/topup dan pembelian voucher, lalu mendelegasikan orchestration ke `services/payment-flow.service.js`.
 * Caller: Dispatcher intent bot dan flow payment state.
 * Deps: `./conversation-handler` untuk state voucher choice dan `../../services/payment-flow.service.js` sebagai owner orchestration aktif.
 * MainFuncs: `handleTopupSaldoPayment`, `handleBeliVoucher`, `processVoucherPurchase`, `handleVoucherChoiceState`.
 * SideEffects: Meneruskan create request QRIS, state voucher choice, dan purchase flow ke service payment.
 */
"use strict";

const { getUserState, setUserState, deleteUserState } = require("./conversation-handler");
const { createPaymentFlowService } = require("../../services/payment-flow.service");

const paymentFlowService = createPaymentFlowService();

module.exports = {
    handleTopupSaldoPayment(context) {
        return paymentFlowService.handleTopupSaldoPayment(context);
    },
    handleBeliVoucher(context) {
        return paymentFlowService.handleBeliVoucher({
            ...context,
            setUserState
        });
    },
    processVoucherPurchase(sender, pushname, price, replyFunc, helpers, global) {
        return paymentFlowService.processVoucherPurchase(sender, pushname, price, replyFunc, helpers, global);
    },
    async handleVoucherChoiceState(context) {
        return paymentFlowService.handleVoucherChoiceState({
            ...context,
            getUserState,
            deleteUserState
        });
    }
};
