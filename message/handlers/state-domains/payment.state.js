/**
 * Header Doc
 * Purpose: Owner state domain payment untuk flow voucher-choice payment dan fallback state pembayaran legacy ringan.
 * Caller: `conversation-state-router`.
 * Deps: `payment-processor-handler`, `lib/template-service`, dan callback reply/state manager.
 * MainFuncs: `handlePaymentConversationState`.
 * SideEffects: Mengirim reply dan memanipulasi state flow pembayaran/voucher saat diperlukan.
 */
"use strict";

const { renderCategoryTemplate } = require("../../../lib/template-service");

function renderResponseTemplate(key, data = {}) {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found ? result.text : key;
}

async function handlePaymentConversationState(context) {
    const {
        stateStep,
        isGlobalCommand,
        stateSender,
        pushname,
        chats,
        reply,
        global,
        domainServices,
        getvoucher,
        handleVoucherChoiceState,
        deleteUserState
    } = context;

    if (stateStep === "AWAITING_QUESTION") {
        deleteUserState(stateSender);
        await reply(renderResponseTemplate("payment_state_qa_unavailable"));
        return { handled: true };
    }

    if (stateStep === "ASK_VOUCHER_CHOICE" && !isGlobalCommand) {
        const helpers = {
            checkhargavoucher: domainServices.checkhargavoucher,
            checkprofvc: domainServices.checkprofvc,
            checkdurasivc: domainServices.checkdurasivc,
            checkhargavc: domainServices.checkhargavc,
            checkATMuser: domainServices.checkATMuser,
            confirmATM: domainServices.confirmATM,
            getvoucher
        };

        const voucherStateResult = await handleVoucherChoiceState({
            sender: stateSender,
            pushname,
            chats,
            reply,
            helpers,
            global
        });

        return voucherStateResult.handled ? { handled: true } : { handled: false };
    }

    return { handled: false };
}

module.exports = {
    handlePaymentConversationState
};
