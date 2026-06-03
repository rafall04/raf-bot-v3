/**
 * Header Doc
 * Purpose: Repository payment/topup untuk membungkus concern request, pending lookup, dan update bukti pembayaran selama normalisasi Wave 2.
 * Caller: `message/handlers/topup-handler.js`, `message/handlers/payment-processor-handler.js`, dan service payment flow yang akan dinormalisasi.
 * Deps: `lib/payment` dan `lib/saldo-manager`.
 * MainFuncs: `createPaymentRepository`, `createPaymentRequest`, `getUserTopupRequests`, `getPendingTransferTopupRequests`, `saveTopupProofUpdate`.
 * SideEffects: Menulis request payment JSON dan memperbarui topup request/proof via helper persistence yang sudah ada.
 */
"use strict";

function createPaymentRepository(options = {}) {
    const addPayment = options.addPayment || require("../lib/payment").addPayment;
    const saldoManager = options.saldoManager || require("../lib/saldo-manager");

    return {
        createPaymentRequest(reffId, trxId, sender, tag, amount, method, ket, opts = {}) {
            return addPayment(reffId, trxId, sender, tag, amount, method, ket, opts);
        },

        getUserTopupRequests(userId) {
            const requests = saldoManager.getUserTopupRequests(userId);
            return Array.isArray(requests) ? requests : [];
        },

        getPendingTransferTopupRequests(userId) {
            return this.getUserTopupRequests(userId)
                .filter((request) =>
                    (request.status === "pending" || request.status === "waiting_verification") &&
                    request.paymentMethod === "transfer"
                );
        },

        saveTopupProofUpdate(request, { fileName, uploadedAt, status = "waiting_verification" }) {
            request.paymentProof = fileName;
            request.proofUploadedAt = uploadedAt;
            request.status = status;
            saldoManager.saveTopupRequests();
            return request;
        }
    };
}

module.exports = {
    createPaymentRepository
};
