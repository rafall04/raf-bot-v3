/**
 * Header Doc
 * Purpose: Facade owner intent saldo/payment untuk topup saldo dan pembelian voucher.
 * Caller: `message/handlers/domain-handlers.js` dan `message/handlers/raf-intent-dispatch.js`.
 * Deps: Handler payment processor existing.
 * MainFuncs: `handleSaldoPaymentIntent`.
 * SideEffects: Menjalankan flow payment existing melalui adapter domain.
 */
"use strict";

const { handleTopupSaldoPayment, handleBeliVoucher } = require("../payment-processor-handler");

async function handleSaldoPaymentIntent(context) {
    const {
        intent,
        sender,
        normalizedSenderForSaldo,
        pushname,
        command,
        q,
        from,
        msg,
        reply,
        runtimeSocket,
        pay,
        checkprofvc,
        checkhargavoucher,
        checkhargavc,
        addPayment,
        entities,
        temp,
        global,
        checkdurasivc,
        checkATMuser,
        confirmATM,
        getvoucher
    } = context;

    if (intent === "TOPUP_SALDO" || intent === "buynow") {
        await handleTopupSaldoPayment({
            sender: normalizedSenderForSaldo || sender,
            pushname,
            command,
            q,
            from,
            msg,
            reply,
            raf: runtimeSocket,
            pay,
            checkprofvc,
            checkhargavoucher,
            checkhargavc,
            addPayment
        });
        return { handled: true };
    }

    if (intent === "BELI_VOUCHER") {
        await handleBeliVoucher({
            sender: normalizedSenderForSaldo || sender,
            pushname,
            entities,
            q,
            reply,
            temp,
            global,
            helpers: {
                checkhargavoucher,
                checkprofvc,
                checkdurasivc,
                checkhargavc,
                checkATMuser,
                confirmATM,
                getvoucher
            }
        });
        return { handled: true };
    }

    return { handled: false };
}

module.exports = {
    handleSaldoPaymentIntent
};
