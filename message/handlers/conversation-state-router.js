/**
 * Header Doc
 * Purpose: Router state percakapan untuk mendispatch `state.step` aktif ke owner domain tunggal.
 * Caller: `message/raf.js`.
 * Deps: Owner map state dan state domain handlers (termasuk `payment-proof` untuk `PAYPROOF_*` dan `package-request` untuk `PKGREQ_*`).
 * MainFuncs: `routeConversationState`.
 * SideEffects: Tidak ada langsung; mendelegasikan side effect ke owner domain yang dipanggil.
 */
"use strict";

const { resolveConversationStateOwner } = require("./conversation-state-owner-map");
const { handleReportingConversationState } = require("./state-domains/reporting.state");
const { handleWifiConversationState } = require("./state-domains/wifi.state");
const { handleTeknisiConversationState } = require("./state-domains/teknisi.state");
const { handlePaymentConversationState } = require("./state-domains/payment.state");
const { handleAgentVoucherConversationState } = require("./state-domains/agent-voucher.state");
const { handleAutoOutageState } = require("./state-domains/auto-outage-state-handler");
const { handlePsbConversationState } = require("./state-domains/psb.state");
const { handlePsbScheduleConversationState } = require("./state-domains/psb-schedule.state");
const { handleCustomerLocationState } = require("./state-domains/customer-location.state");
const { handleWanSwitchConversationState } = require("./state-domains/wan-switch.state");
const { handleOperJalurConversationState } = require("./state-domains/oper-jalur.state");
const { handlePaymentProofAdminState } = require("./state-domains/payment-proof-admin.state");
const { handlePackageRequestAdminState } = require("./state-domains/package-request-admin.state");
const { handleNetworkAssetConversationState } = require("./state-domains/network-asset.state");

async function routeConversationState(context) {
    const stateStep = context.stateStep || context.userState?.step || context.smartReportState?.step || context.teknisiState?.step || null;
    const owner = resolveConversationStateOwner(stateStep);

    if (!owner) {
        return { handled: false, owner: null };
    }

    const domainContext = {
        ...context,
        stateStep
    };

    if (owner === "reporting") {
        return { owner, ...(await handleReportingConversationState(domainContext)) };
    }
    if (owner === "wifi") {
        return { owner, ...(await handleWifiConversationState(domainContext)) };
    }
    if (owner === "teknisi") {
        return { owner, ...(await handleTeknisiConversationState(domainContext)) };
    }
    if (owner === "payment") {
        return { owner, ...(await handlePaymentConversationState(domainContext)) };
    }
    if (owner === "agent-voucher") {
        return { owner, ...(await handleAgentVoucherConversationState(domainContext)) };
    }
    if (owner === "auto-outage") {
        return { owner, ...(await handleAutoOutageState(domainContext)) };
    }
    if (owner === "psb") {
        return { owner, ...(await handlePsbConversationState(domainContext)) };
    }
    if (owner === "psb-schedule") {
        return { owner, ...(await handlePsbScheduleConversationState(domainContext)) };
    }
    if (owner === "customer-location") {
        return { owner, ...(await handleCustomerLocationState(domainContext)) };
    }
    if (owner === "wan-switch") {
        return { owner, ...(await handleWanSwitchConversationState(domainContext)) };
    }
    if (owner === "oper-jalur") {
        return { owner, ...(await handleOperJalurConversationState(domainContext)) };
    }
    if (owner === "payment-proof") {
        return { owner, ...(await handlePaymentProofAdminState(domainContext)) };
    }
    if (owner === "package-request") {
        return { owner, ...(await handlePackageRequestAdminState(domainContext)) };
    }
    if (owner === "network-asset") {
        return { owner, ...(await handleNetworkAssetConversationState(domainContext)) };
    }

    return { handled: false, owner };
}

module.exports = {
    routeConversationState
};
