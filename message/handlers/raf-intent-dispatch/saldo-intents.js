/**
 * Header Doc
 * Purpose: Skeleton handler map untuk intent saldo, voucher, dan transaksi finansial bot WhatsApp.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` dan composer dispatcher intent.
 * Deps: Tidak ada; placeholder refactor tahap skeleton.
 * MainFuncs: `SALDO_INTENT_HANDLERS`, `handleTopupSaldoIntent`, `handleBeliVoucherIntent`, `handleTransferSaldoIntent`.
 * SideEffects: Tidak ada.
 */
"use strict";

async function handleTopupSaldoIntent(context) {
    const { handleSaldoPaymentIntent, intentOwner, runtimeSocket } = context;

    await handleSaldoPaymentIntent({
        ...context,
        intentOwner,
        runtimeSocket
    });
}

async function handleBeliVoucherIntent(context) {
    const { handleSaldoPaymentIntent, intentOwner, runtimeSocket } = context;

    await handleSaldoPaymentIntent({
        ...context,
        intentOwner,
        runtimeSocket
    });
}

async function handleCekSaldoIntent(context) {
    const { handleCekSaldo, normalizedSenderForSaldo, pushname, global, format, reply } = context;
    handleCekSaldo(normalizedSenderForSaldo, pushname, global.config, format, reply);
}

async function handleTransferSaldoIntent(context) {
    const { chats, reply, format, handleTransferSaldo, msg, normalizedSenderForSaldo } = context;
    let transferArgs = [];
    const transferText = chats.trim();

    if (transferText.includes('|')) {
        const parts = transferText.split('|');
        transferArgs = [parts[0].replace(/^transfer\s+/i, '').trim(), parts[1].trim()];
    } else {
        const parts = transferText.replace(/^transfer\s+/i, '').split(/\s+/);
        if (parts.length >= 2) {
            transferArgs = [parts[0], parts[1]];
        }
    }

    if (transferArgs.length < 2) {
        return await reply(format('error_format_transfer'));
    }

    await handleTransferSaldo(msg, normalizedSenderForSaldo, reply, transferArgs);
}

async function handleBatalTopupIntent(context) {
    const { handleCancelTopup, msg, normalizedSenderForSaldo, reply } = context;
    await handleCancelTopup(msg, normalizedSenderForSaldo, reply);
}

async function handleTanyaHargaVoucherIntent(context) {
    const {
        extractSenderInfo,
        msg,
        sender,
        agentTransactionManager,
        chats,
        handleAgentSellVoucher,
        reply,
        temp,
        raf,
        users,
        global,
        handleTanyaHargaVoucher,
        pushname,
        format
    } = context;
    const senderInfo = extractSenderInfo(msg, sender);
    const phoneNumberToSearch = senderInfo.phoneNumber || sender.split('@')[0];
    const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);

    if (agentCred && chats.toLowerCase().includes('jual')) {
        await handleAgentSellVoucher(msg, sender, reply, temp, raf, users, global);
    } else {
        handleTanyaHargaVoucher(pushname, global.config, global.voucher, format, reply);
    }
}

async function handleLegacyTopupIntent(context) {
    const {
        handleTopup,
        q,
        isOwner,
        normalizedSenderForSaldo,
        reply,
        msg,
        mess,
        raf,
        checkATMuser,
        addATM,
        addKoinUser
    } = context;
    await handleTopup({ q, isOwner, sender: normalizedSenderForSaldo, reply, msg, mess, raf, checkATMuser, addATM, addKoinUser });
}

async function handleLegacyDelSaldoIntent(context) {
    const { handleDelSaldo, q, isOwner, reply, mess, checkATMuser, checkRegisteredATM, delSaldo } = context;
    await handleDelSaldo({ q, isOwner, reply, mess, checkATMuser, checkRegisteredATM, delSaldo });
}

async function handleLegacyTransferIntent(context) {
    const {
        handleTransfer,
        q,
        normalizedSenderForSaldo,
        reply,
        msg,
        mess,
        raf,
        checkATMuser,
        addATM,
        addKoinUser,
        confirmATM,
        format
    } = context;
    await handleTransfer({ q, sender: normalizedSenderForSaldo, reply, msg, mess, raf, checkATMuser, addATM, addKoinUser, confirmATM, format });
}

const SALDO_INTENT_HANDLERS = Object.freeze({
    TOPUP_SALDO: handleTopupSaldoIntent,
    buynow: handleTopupSaldoIntent,
    BELI_VOUCHER: handleBeliVoucherIntent,
    CEK_SALDO: handleCekSaldoIntent,
    TRANSFER_SALDO: handleTransferSaldoIntent,
    BATAL_TOPUP: handleBatalTopupIntent,
    TANYA_HARGA_VOUCHER: handleTanyaHargaVoucherIntent,
    '<topup': handleLegacyTopupIntent,
    '<delsaldo': handleLegacyDelSaldoIntent,
    transfer: handleLegacyTransferIntent
});

module.exports = {
    SALDO_INTENT_HANDLERS,
    handleTopupSaldoIntent,
    handleBeliVoucherIntent,
    handleCekSaldoIntent,
    handleTransferSaldoIntent,
    handleBatalTopupIntent,
    handleTanyaHargaVoucherIntent,
    handleLegacyTopupIntent,
    handleLegacyDelSaldoIntent,
    handleLegacyTransferIntent
};
