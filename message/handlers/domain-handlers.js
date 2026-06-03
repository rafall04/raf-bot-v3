/**
 * Header Doc
 * Purpose: Facade handler domain untuk mereduksi import surface `message/raf.js` selama konsolidasi handler bot.
 * Caller: `message/raf.js`.
 * Deps: Handler existing lintas domain dan facade owner domain prioritas.
 * MainFuncs: Re-export handler prioritas dan facade owner domain.
 * SideEffects: Tidak ada; hanya re-export dependency.
 */
"use strict";

const { startReportFlow, handleMenuSelection } = require("./smart-report-text-menu");
const { handleTopupSaldoPayment, handleBeliVoucher } = require("./payment-processor-handler");
const { handleGantiNamaWifi, handleGantiSandiWifi } = require("./wifi-management-handler");
const {
    handleAgentPurchaseVoucher,
    handleAgentSellVoucher,
    handleAgentCheckInventory,
    handleAgentPurchaseHistory,
    handleAgentSalesHistory
} = require("./agent-voucher-handler");
const { handleReportingIntent } = require("./domains/reporting.domain");
const { handleWifiIntent } = require("./domains/wifi.domain");
const { handleAgentVoucherIntent } = require("./domains/agent-voucher.domain");
const { handleSaldoPaymentIntent } = require("./domains/saldo-payment.domain");

module.exports = {
    startReportFlow,
    handleMenuSelection,
    handleTopupSaldoPayment,
    handleBeliVoucher,
    handleGantiNamaWifi,
    handleGantiSandiWifi,
    handleAgentPurchaseVoucher,
    handleAgentSellVoucher,
    handleAgentCheckInventory,
    handleAgentPurchaseHistory,
    handleAgentSalesHistory,
    handleReportingIntent,
    handleWifiIntent,
    handleAgentVoucherIntent,
    handleSaldoPaymentIntent
};
