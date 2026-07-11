/**
 * Header Doc
 * Purpose: Memusatkan business logic approval payment request agar seluruh write-path bayar konsisten memakai ledger payment domain.
 * Caller: `routes/requests.js` dan calon controller approval payment lain.
 * Deps: `lib/database`, `lib/payment-finance-service`, `lib/approval-logic`, activity logger, dan delivery WhatsApp.
 * MainFuncs: `createPaymentApprovalService`, `bulkApproveRequests`.
 * SideEffects: Menulis status request JSON, sinkronisasi `send_invoice`, mencatat payment ledger, activity log, dan notifikasi teknisi.
 */
"use strict";

const { loadJSON, saveJSON } = require("../lib/database");
const { handlePaidStatusChange, sendTechnicianNotification, sendTechnicianBulkSummary } = require("../lib/approval-logic");
const {
    getPeriodParts
} = require("../lib/technician-collection-settlement");
const {
    applyPaymentStatusChange,
    getEffectivePrice,
    normalizeUserPaymentMethod,
    normalizePaymentRequestScope
} = require("../lib/payment-finance-service");
const { createRuntimeCacheRepository } = require("../repositories/runtime-cache.repository");

function defaultDeps() {
    const runtime = global.__appRuntime || null;
    const runtimeScope = runtime?.globalScope || global;
    const runtimeCacheRepository = createRuntimeCacheRepository(runtime);
    return {
        loadJSON,
        saveJSON,
        handlePaidStatusChange,
        sendTechnicianNotification,
        sendTechnicianBulkSummary,
        getPeriodParts,
        applyPaymentStatusChange,
        getEffectivePrice,
        normalizeUserPaymentMethod,
        getDb() {
            return runtime?.getDb?.() || runtimeScope.db || null;
        },
        userRepository: runtimeCacheRepository.users,
        accountRepository: runtimeCacheRepository.accounts
    };
}

function createPaymentApprovalService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    async function checkSendInvoiceColumn() {
        return new Promise((resolve) => {
            deps.getDb().all("PRAGMA table_info(users)", (err, columns) => {
                if (err) {
                    console.error("[BULK_APPROVE_PRAGMA_ERROR]", err);
                    resolve(false);
                    return;
                }
                resolve(columns.some((column) => column.name === "send_invoice"));
            });
        });
    }

    return {
        async bulkApproveRequests({ requestIds, actor }) {
            const maxPerBatch = 20;
            const totalRequested = requestIds.length;
            const requestIdsToProcess = requestIds.slice(0, maxPerBatch);
            const remainingCount = Math.max(0, totalRequested - maxPerBatch);
            const allRequests = deps.loadJSON("database/requests.json").map(normalizePaymentRequestScope);
            const results = {
                approved: [],
                failed: [],
                notFound: [],
                remaining: remainingCount,
                totalRequested,
                processed: requestIdsToProcess.length
            };
            const hasSendInvoiceColumn = await checkSendInvoiceColumn();

            console.log(`[BULK_APPROVE] Processing ${requestIdsToProcess.length} of ${totalRequested} requests by ${actor.username}`);
            const startTime = Date.now();

            for (const requestId of requestIdsToProcess) {
                const requestIndex = allRequests.findIndex((item) => String(item.id) === String(requestId));
                if (requestIndex === -1) {
                    results.notFound.push(requestId);
                    continue;
                }

                const request = allRequests[requestIndex];
                if (request.status !== "pending") {
                    results.failed.push({
                        id: requestId,
                        reason: `Status bukan pending (status: ${request.status})`
                    });
                    continue;
                }

                const user = deps.userRepository.getById(request.userId);
                if (!user) {
                    results.failed.push({
                        id: requestId,
                        reason: "User tidak ditemukan"
                    });
                    continue;
                }

                try {
                    const approvedRequest = {
                        ...request,
                        status: "approved",
                        updated_at: new Date().toISOString(),
                        updated_by: actor.username
                    };
                    const sendInvoiceValue = user.send_invoice ? 1 : 0;

                    if (request.newStatus === true) {
                        // Kolektor: teknisi ATAU agen (tak pernah keduanya) → komisi ke ledger yang tepat.
                        const isAgenRequest = approvedRequest.collector_role === "agen" || !!approvedRequest.requested_by_agen_id;
                        const collectorId = isAgenRequest ? approvedRequest.requested_by_agen_id : approvedRequest.requested_by_teknisi_id;
                        const collectorAccount = collectorId ? deps.accountRepository.getById(collectorId) : null;
                        let paymentMethod = deps.normalizeUserPaymentMethod(approvedRequest.payment_method);
                        if (!paymentMethod && collectorId && approvedRequest.newStatus === true) {
                            paymentMethod = "CASH";
                        }
                        if (!paymentMethod) {
                            paymentMethod = "TRANSFER_BANK";
                        }

                        approvedRequest.payment_method = paymentMethod;
                        const { periodMonth, periodYear } = deps.getPeriodParts({
                            periodMonth: parseInt(approvedRequest.period_month, 10),
                            periodYear: parseInt(approvedRequest.period_year, 10),
                            date: approvedRequest.updated_at || approvedRequest.created_at
                        });
                        const amountPaid = approvedRequest.amount_paid || deps.getEffectivePrice(user);
                        const amountDue = approvedRequest.amount_due || deps.getEffectivePrice(user);
                        const isPartial = approvedRequest.is_partial_payment || false;
                        const createdBy = collectorAccount?.username || (isAgenRequest ? "agen" : (approvedRequest.requested_by_teknisi_id ? "teknisi" : (actor.username || "admin")));

                        const financeResult = await deps.applyPaymentStatusChange({
                            user,
                            paid: true,
                            periodMonth,
                            periodYear,
                            amountPaid,
                            amountDue,
                            isPartial,
                            paymentMethod,
                            notes: approvedRequest.notes || `Pembayaran via bulk approval request #${approvedRequest.id}`,
                            createdBy,
                            sourceRequestId: approvedRequest.id,
                            teknisiId: (!isAgenRequest && approvedRequest.requested_by_teknisi_id) ? String(approvedRequest.requested_by_teknisi_id) : null,
                            agenId: (isAgenRequest && approvedRequest.requested_by_agen_id) ? String(approvedRequest.requested_by_agen_id) : null,
                            agenName: isAgenRequest ? (collectorAccount?.name || collectorAccount?.username || null) : null,
                            onFinalPaid: async () => {
                                await deps.handlePaidStatusChange(user, {
                                    paidDate: new Date().toISOString(),
                                    method: paymentMethod,
                                    approvedBy: actor.username,
                                    notes: `Status pembayaran diperbarui (${paymentMethod === "CASH" ? "Tunai" : "Transfer Bank"})`
                                });
                            }
                        });
                        if (financeResult.action !== "paid") {
                            results.failed.push({
                                id: requestId,
                                reason: financeResult.reason || financeResult.action || "payment_not_applied"
                            });
                            continue;
                        }
                    } else {
                        const { periodMonth, periodYear } = deps.getPeriodParts({
                            periodMonth: parseInt(approvedRequest.period_month, 10),
                            periodYear: parseInt(approvedRequest.period_year, 10),
                            date: approvedRequest.updated_at || approvedRequest.created_at
                        });
                        const financeResult = await deps.applyPaymentStatusChange({
                            user,
                            paid: false,
                            periodMonth,
                            periodYear,
                            amountDue: approvedRequest.amount_due || deps.getEffectivePrice(user),
                            notes: approvedRequest.notes || `Reversal bulk approval request #${approvedRequest.id}`,
                            createdBy: actor.username,
                            sourceRequestId: approvedRequest.id
                        });
                        if (financeResult.action !== "reversed") {
                            results.failed.push({
                                id: requestId,
                                reason: financeResult.reason || financeResult.action || "reversal_not_applied"
                            });
                            continue;
                        }
                    }

                        if (hasSendInvoiceColumn) {
                            await new Promise((resolve, reject) => {
                                deps.getDb().run(
                                    "UPDATE users SET send_invoice = ? WHERE id = ?",
                                    [sendInvoiceValue, user.id],
                                    function onUpdate(err) {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    resolve();
                                }
                            );
                        });
                    }

                    allRequests[requestIndex] = approvedRequest;
                    // Anti-spam: JANGAN notifikasi per-item saat bulk. Kumpulkan lalu kirim SATU
                    // ringkasan per teknisi setelah loop (lihat sendTechnicianBulkSummary di bawah).
                    // Fallback ke perilaku lama (per-item) hanya bila digest dimatikan.
                    const digestOn = !!(global.config && global.config.paymentRequestDigest && global.config.paymentRequestDigest.enabled === true);
                    if (!digestOn) {
                        await Promise.resolve(deps.sendTechnicianNotification(true, approvedRequest, user));
                    }
                    results.approved.push({
                        id: requestId,
                        userName: user.name,
                        newStatus: request.newStatus,
                        teknisiId: approvedRequest.requested_by_teknisi_id || null
                    });
                } catch (error) {
                    console.error(`[BULK_APPROVE_ERROR] Failed to approve request ${requestId}:`, error);
                    results.failed.push({
                        id: requestId,
                        reason: error.message
                    });
                }
            }

            deps.saveJSON("database/requests.json", allRequests);
            const elapsedTime = Date.now() - startTime;
            console.log(`[BULK_APPROVE] Completed in ${elapsedTime}ms. Approved: ${results.approved.length}, Failed: ${results.failed.length}, Not Found: ${results.notFound.length}, Remaining: ${remainingCount}`);

            // SATU ringkasan per teknisi (bukan N pesan). Hanya saat digest aktif; never-throw.
            const digestOn = !!(global.config && global.config.paymentRequestDigest && global.config.paymentRequestDigest.enabled === true);
            if (digestOn && results.approved.length > 0 && typeof deps.sendTechnicianBulkSummary === "function") {
                const perTeknisi = new Map();
                for (const item of results.approved) {
                    if (!item.teknisiId) continue;
                    if (!perTeknisi.has(item.teknisiId)) perTeknisi.set(item.teknisiId, []);
                    perTeknisi.get(item.teknisiId).push({ userName: item.userName });
                }
                for (const [teknisiId, items] of perTeknisi) {
                    try {
                        await deps.sendTechnicianBulkSummary(teknisiId, items);
                    } catch (summaryErr) {
                        console.error(`[BULK_APPROVE_SUMMARY_ERROR] teknisi ${teknisiId}: ${summaryErr.message}`);
                    }
                }
            }

            let message = "";
            if (results.approved.length > 0) {
                message += `✅ ${results.approved.length} permintaan berhasil disetujui.`;
            }
            if (results.failed.length > 0) {
                message += ` ❌ ${results.failed.length} gagal.`;
            }
            if (results.notFound.length > 0) {
                message += ` ⚠️ ${results.notFound.length} tidak ditemukan.`;
            }
            if (remainingCount > 0) {
                message += ` 📋 Sisa ${remainingCount} request pending. Klik lagi untuk approve batch berikutnya.`;
            }

            const normalizedMessage = [
                results.approved.length > 0 ? `${results.approved.length} permintaan berhasil disetujui.` : "",
                results.failed.length > 0 ? `${results.failed.length} gagal.` : "",
                results.notFound.length > 0 ? `${results.notFound.length} tidak ditemukan.` : "",
                remainingCount > 0 ? `Sisa ${remainingCount} request pending. Klik lagi untuk approve batch berikutnya.` : ""
            ].filter(Boolean).join(" ").trim();

            return {
                status: 200,
                message: normalizedMessage || message.trim(),
                results
            };
        }
    };
}

module.exports = {
    createPaymentApprovalService
};
