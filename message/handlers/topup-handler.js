"use strict";

/**
 * Header Doc
 * Purpose: Menangani upload bukti topup saldo dan notifikasi verifikasi lewat boundary runtime WhatsApp, dengan orchestration proof upload aktif turun ke `services/payment-flow.service.js`.
 * Caller: Router bot `message/raf.js` dan flow topup saldo.
 * Deps: `../../services/payment-flow.service`, `../../repositories/payment.repository`, `../../lib/saldo-manager`, `../../lib/whatsapp-delivery-service`, `../../lib/whatsapp.adapter`, dan helper ledger/template.
 * MainFuncs: `handleTopupPaymentProof`, `handleTopupVerification`, `notifyAdminsWithProof`, dan `getAdminRecipients`.
 * SideEffects: Proof upload didelegasikan ke service payment, sedangkan verifikasi admin tetap memperbarui saldo/ledger dan mengirim notifikasi WA.
 */

const saldoManager = require("../../lib/saldo-manager");
const { createPaymentRepository } = require("../../repositories/payment.repository");
const { createPaymentFlowService } = require("../../services/payment-flow.service");
const { logger } = require("../../lib/logger");
const { renderTemplate } = require("../../lib/templating");
const { normalizeJidForSaldo } = require("../../lib/jid-utils");
const { sendMessage, sendMessageToMany } = require("../../lib/whatsapp-delivery-service");
const { downloadMedia } = require("../../lib/whatsapp.adapter");
const { getSocket, getConnectionState } = require("../../lib/whatsapp-gateway");
const { syncFinancialLedgerSources } = require("../../lib/financial-ledger");

const paymentRepository = createPaymentRepository();
const paymentFlowService = createPaymentFlowService({
    paymentRepository,
    renderTemplate,
    sendMessage,
    sendMessageToMany,
    downloadMedia,
    normalizeJidForSaldo,
    getSocket,
    getConnectionState,
    logger
});

async function handleTopupPaymentProof(msg, user, pushname = "") {
    return paymentFlowService.handleTopupPaymentProof(msg, user, pushname, global);
}

async function notifyAdminsWithProof(request, proofPath, user, pushname = "") {
    return paymentFlowService.notifyAdminsWithProof(request, proofPath, user, pushname, global);
}

async function getAdminRecipients() {
    return paymentFlowService.getAdminRecipients(global);
}

async function handleTopupVerification(requestId, approved, adminName, notes = "") {
    try {
        const requests = saldoManager.getAllTopupRequests();
        const request = requests.find((item) => item.id === requestId);

        if (!request) {
            throw new Error("Request not found");
        }

        if (request.status !== "waiting_verification" && request.status !== "pending") {
            throw new Error("Request is not waiting for verification");
        }

        const userJid = request.userId;

        if (approved) {
            request.status = "verified";
            request.verifiedAt = new Date().toISOString();
            request.verifiedBy = adminName;
            request.verificationNotes = notes;

            const customerName = request.customerName || null;

            await saldoManager.createUserSaldo(userJid, customerName);
            await saldoManager.addSaldo(
                userJid,
                request.amount,
                `Topup verified - ${request.paymentMethod}`,
                customerName,
                requestId
            );

            saldoManager.saveTopupRequests();
            try {
                await syncFinancialLedgerSources({ domains: ["topup"] });
            } catch (ledgerSyncError) {
                logger.warn("[TOPUP_LEDGER_SYNC_ERROR]", { message: ledgerSyncError.message });
            }

            try {
                const currentSaldo = await saldoManager.getSaldo(userJid);
                const successMsg = renderTemplate("topup_verified_success", {
                    request_id: request.id,
                    harga: `Rp ${request.amount.toLocaleString("id-ID")}`,
                    formattedSaldo: `Rp ${currentSaldo.toLocaleString("id-ID")}`
                });
                const delivery = await sendMessage(userJid, { text: successMsg });
                if (!delivery.sent) {
                    logger.warn("Failed to send WhatsApp notification", { errorCode: delivery.errorCode });
                }
            } catch (waError) {
                logger.warn("Failed to send WhatsApp notification:", waError.message);
            }

            if (getConnectionState() !== "open") {
                logger.warn("Cannot send topup success notification - WhatsApp not connected");
            }

            logger.info("Topup verified and approved", {
                requestId,
                amount: request.amount,
                user: userJid,
                verifiedBy: adminName
            });

            return { success: true, message: "Topup berhasil diverifikasi dan saldo telah ditambahkan." };
        }

        request.status = "rejected";
        request.rejectedAt = new Date().toISOString();
        request.rejectedBy = adminName;
        request.rejectionReason = notes || "Bukti transfer tidak valid";

        saldoManager.saveTopupRequests();
        try {
            await syncFinancialLedgerSources({ domains: ["topup"] });
        } catch (ledgerSyncError) {
            logger.warn("[TOPUP_LEDGER_SYNC_ERROR]", { message: ledgerSyncError.message });
        }

        try {
            const rejectMsg = renderTemplate("topup_rejected", {
                request_id: request.id,
                harga: `Rp ${request.amount.toLocaleString("id-ID")}`,
                alasan: request.rejectionReason || "Bukti transfer tidak valid"
            });
            const delivery = await sendMessage(userJid, { text: rejectMsg });
            if (!delivery.sent) {
                logger.warn("Failed to send WhatsApp rejection notification", { errorCode: delivery.errorCode });
            }
        } catch (waError) {
            logger.warn("Failed to send WhatsApp rejection notification:", waError.message);
        }

        if (getConnectionState() !== "open") {
            logger.warn("Cannot send topup rejection notification - WhatsApp not connected");
        }

        logger.info("Topup rejected", {
            requestId,
            reason: request.rejectionReason,
            rejectedBy: adminName
        });

        return { success: true, message: "Topup telah ditolak." };
    } catch (error) {
        logger.error("Failed to verify topup", error);
        throw error;
    }
}

module.exports = {
    handleTopupPaymentProof,
    handleTopupVerification,
    notifyAdminsWithProof,
    getAdminRecipients
};
