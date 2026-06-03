/**
 * Header Doc
 * Purpose: Service billing untuk memisahkan business logic approval payment dan bulk update payment status dari router admin.
 * Caller: `controllers/admin.controller.js`.
 * Deps: `repositories/billing.repository`, `lib/error-handler`, approval logic, settlement, dan activity logger.
 * MainFuncs: `createBillingService`, `bulkApprovePaymentRequests`, `bulkUpdatePaymentStatus`, `buildPaymentAuditContext`.
 * SideEffects: Mengubah paid status user, persist approval request, evaluasi settlement, activity log, dan notifikasi payment.
 */
"use strict";

const { createBillingRepository } = require("../repositories/billing.repository");
const { createError, ErrorTypes } = require("../lib/error-handler");
const { handlePaidStatusChange, sendTechnicianNotification } = require("../lib/approval-logic");
const { getPeriodParts } = require("../lib/technician-collection-settlement");
const {
    applyPaymentStatusChange,
    getEffectivePrice,
    normalizeUserPaymentMethod
} = require("../lib/payment-finance-service");
const { logActivity } = require("../lib/activity-logger");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

function requireAdminRole(actorCtx) {
    if (!actorCtx || !ADMIN_ROLES.includes(actorCtx.role)) {
        throw createError(ErrorTypes.AUTHORIZATION_ERROR, "Akses ditolak.", 403);
    }
}

function buildPaymentAuditContext(user, req) {
    return {
        id: user && user.id,
        username: user && user.username,
        name: user && user.name,
        role: user && user.role,
        ipAddress: req && (req.ip || req.connection && req.connection.remoteAddress || req.headers && req.headers["x-forwarded-for"]),
        userAgent: req && req.headers && req.headers["user-agent"]
    };
}

function buildAuditPayload(actorCtx, overrides) {
    return {
        userId: actorCtx.id,
        username: actorCtx.username,
        role: actorCtx.role,
        ipAddress: actorCtx.ipAddress,
        userAgent: actorCtx.userAgent,
        ...overrides
    };
}

function mapDatabaseUserForNotification(row) {
    let bulk = [];
    if (row.bulk) {
        try {
            bulk = JSON.parse(row.bulk);
        } catch (error) {
            bulk = [];
        }
    }

    return {
        id: row.id,
        name: row.name,
        phone_number: row.phone_number,
        device_id: row.device_id,
        subscription: row.subscription,
        send_invoice: row.send_invoice,
        pppoe_username: row.pppoe_username,
        address: row.address,
        bulk
    };
}

function defaultDeps() {
    return {
        repository: createBillingRepository(),
        handlePaidStatusChange,
        sendTechnicianNotification,
        applyPaymentStatusChange,
        getEffectivePrice,
        normalizeUserPaymentMethod,
        getPeriodParts,
        logActivity
    };
}

function createBillingService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        buildPaymentAuditContext,

        async bulkApprovePaymentRequests(input, actorCtx) {
            requireAdminRole(actorCtx);

            if (!Array.isArray(input.requestIds) || input.requestIds.length === 0) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "Array 'requestIds' diperlukan.", 400);
            }

            deps.repository.ensureDatabaseReady();

            const requests = deps.repository.loadApprovalRequests();
            const results = { approved: [], failed: [], notFound: [] };

            for (const requestId of input.requestIds) {
                const requestIndex = requests.findIndex(
                    (item) => String(item.id) === String(requestId) && item.status === "pending"
                );

                if (requestIndex === -1) {
                    const existingRequest = requests.find((item) => String(item.id) === String(requestId));
                    if (existingRequest) {
                        results.failed.push({
                            id: requestId,
                            reason: `Status bukan 'pending' (current: ${existingRequest.status})`
                        });
                    } else {
                        results.notFound.push(requestId);
                    }
                    continue;
                }

                const request = requests[requestIndex];
                request.status = "approved";
                request.updated_at = new Date().toISOString();
                request.updated_by = actorCtx.id;

                const user = deps.repository.getCachedUserById(request.userId);
                if (!user) {
                    results.failed.push({
                        id: requestId,
                        reason: `User dengan ID ${request.userId} tidak ditemukan.`
                    });
                    continue;
                }

                try {
                    const oldPaidStatus = Boolean(user.paid);
                    let financeResult;

                    if (request.newStatus === true) {
                        let paymentMethod = deps.normalizeUserPaymentMethod(request.payment_method);
                        if (!paymentMethod && request.requested_by_teknisi_id) {
                            paymentMethod = "CASH";
                        }
                        if (!paymentMethod) {
                            paymentMethod = "TRANSFER_BANK";
                        }

                        request.payment_method = paymentMethod;
                        const { periodMonth, periodYear } = deps.getPeriodParts({
                            periodMonth: parseInt(request.period_month, 10),
                            periodYear: parseInt(request.period_year, 10),
                            date: request.updated_at || request.created_at
                        });
                        const amountPaid = request.amount_paid || deps.getEffectivePrice(user);
                        const amountDue = request.amount_due || deps.getEffectivePrice(user);
                        const isPartial = request.is_partial_payment || false;

                        financeResult = await deps.applyPaymentStatusChange({
                            user,
                            paid: true,
                            periodMonth,
                            periodYear,
                            amountPaid,
                            amountDue,
                            isPartial,
                            paymentMethod,
                            notes: request.notes || `Pembayaran via bulk approval request #${request.id}`,
                            createdBy: actorCtx.username || "admin",
                            sourceRequestId: request.id,
                            teknisiId: request.requested_by_teknisi_id ? String(request.requested_by_teknisi_id) : null,
                            onFinalPaid: async () => {
                                await deps.handlePaidStatusChange(user, {
                                    paidDate: new Date().toISOString(),
                                    method: paymentMethod,
                                    approvedBy: actorCtx.username || "Admin",
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
                            periodMonth: parseInt(request.period_month, 10),
                            periodYear: parseInt(request.period_year, 10),
                            date: request.updated_at || request.created_at
                        });

                        financeResult = await deps.applyPaymentStatusChange({
                            user,
                            paid: false,
                            periodMonth,
                            periodYear,
                            amountDue: request.amount_due || deps.getEffectivePrice(user),
                            notes: request.notes || `Reversal bulk approval request #${request.id}`,
                            createdBy: actorCtx.username || "admin",
                            sourceRequestId: request.id
                        });
                        if (financeResult.action !== "reversed") {
                            results.failed.push({
                                id: requestId,
                                reason: financeResult.reason || financeResult.action || "reversal_not_applied"
                            });
                            continue;
                        }
                    }

                    try {
                        await deps.logActivity(buildAuditPayload(actorCtx, {
                            actionType: "UPDATE",
                            resourceType: "payment",
                            resourceId: String(user.id),
                            resourceName: user.name,
                            description: `Approved payment request for user ${user.name} (bulk approve)`,
                            oldValue: { paid: oldPaidStatus },
                            newValue: { paid: user.paid }
                        }));
                    } catch (error) {
                        console.error("[ACTIVITY_LOG_ERROR] Failed to log payment approval:", error);
                    }

                    requests[requestIndex] = request;
                    await Promise.resolve(deps.sendTechnicianNotification(true, request, user));
                    results.approved.push(requestId);
                } catch (error) {
                    results.failed.push({
                        id: requestId,
                        reason: `Proses persetujuan gagal: ${error.message}`
                    });
                }
            }

            deps.repository.persistApprovalRequests(requests);

            let message = "";
            if (results.approved.length > 0) {
                message += `${results.approved.length} permintaan berhasil disetujui.`;
            }
            if (results.failed.length > 0) {
                message += `${message ? " " : ""}${results.failed.length} gagal.`;
            }
            if (results.notFound.length > 0) {
                message += `${message ? " " : ""}${results.notFound.length} tidak ditemukan.`;
            }

            return {
                status: 200,
                message: message || "Proses approve massal selesai.",
                results
            };
        },

        async bulkUpdatePaymentStatus(input, actorCtx) {
            requireAdminRole(actorCtx);

            if (!Array.isArray(input.userIds) || input.userIds.length === 0) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "userIds must be a non-empty array", 400);
            }
            if (typeof input.paid !== "boolean") {
                throw createError(ErrorTypes.VALIDATION_ERROR, "paid must be a boolean value", 400);
            }

            deps.repository.ensureDatabaseReady();
            const shouldTriggerNotification = input.triggerNotification !== false;
            const normalizedMethod = input.paid ? deps.normalizeUserPaymentMethod(input.paymentMethod) : null;

            if (input.paid && shouldTriggerNotification && !normalizedMethod) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "paymentMethod wajib CASH atau TRANSFER_BANK.",
                    400
                );
            }

            let successCount = 0;
            let failedCount = 0;
            const errors = [];

            for (const userId of input.userIds) {
                try {
                    const userRow = await deps.repository.getUserFromDatabase(userId);
                    if (!userRow) {
                        errors.push({ userId, error: "User not found in database" });
                        failedCount += 1;
                        continue;
                    }

                    const previousPaidStatus = userRow.paid === 1;
                    const user = deps.repository.getCachedUserById(userId) || mapDatabaseUserForNotification(userRow);
                    const { periodMonth, periodYear } = deps.getPeriodParts({
                        periodMonth: parseInt(input.period_month, 10),
                        periodYear: parseInt(input.period_year, 10),
                        date: new Date()
                    });
                    const financeResult = await deps.applyPaymentStatusChange({
                        user,
                        paid: input.paid,
                        periodMonth,
                        periodYear,
                        amountPaid: input.amount_paid || deps.getEffectivePrice(user),
                        amountDue: input.amount_due || deps.getEffectivePrice(user),
                        isPartial: false,
                        paymentMethod: normalizedMethod,
                        notes: input.notes || (input.paid ? "Status pembayaran diperbarui oleh admin" : "Status pembayaran dibalik oleh admin"),
                        createdBy: actorCtx.username || "Admin",
                        sourceAdminAction: `${input.request_action_id || "bulk-payment-status"}:${userId}:${input.paid ? "paid" : "unpaid"}`,
                        onFinalPaid: shouldTriggerNotification ? async () => {
                            await deps.handlePaidStatusChange(user, {
                                paidDate: new Date().toISOString(),
                                method: normalizedMethod,
                                approvedBy: actorCtx.username || "Admin",
                                notes: input.notes || "Status pembayaran diperbarui oleh admin"
                            });
                        } : null
                    });

                    const isPaymentSuccess = input.paid
                        ? financeResult.action === "paid"
                        : financeResult.action === "reversed";
                    if (!isPaymentSuccess) {
                        errors.push({ userId, error: financeResult.reason || financeResult.action || "no_change" });
                        failedCount += 1;
                        continue;
                    }

                    if (previousPaidStatus !== input.paid) {
                        try {
                            const cachedUser = deps.repository.getCachedUserById(userId) || user;
                            await deps.logActivity(buildAuditPayload(actorCtx, {
                                actionType: "UPDATE",
                                resourceType: "payment",
                                resourceId: String(userId),
                                resourceName: cachedUser ? cachedUser.name : `User ID ${userId}`,
                                description: `Bulk updated payment status for user ${cachedUser ? cachedUser.name : userId}: ${previousPaidStatus ? "paid" : "unpaid"} -> ${input.paid ? "paid" : "unpaid"}`,
                                oldValue: { paid: previousPaidStatus },
                                newValue: { paid: input.paid }
                            }));
                        } catch (error) {
                            console.error(`[ACTIVITY_LOG_ERROR] Failed to log bulk payment update for user ${userId}:`, error);
                        }
                    }

                    successCount += 1;
                } catch (error) {
                    errors.push({ userId, error: error.message });
                    failedCount += 1;
                }
            }

            return {
                status: 200,
                message: `Bulk update completed. Success: ${successCount}, Failed: ${failedCount}`,
                updated: successCount,
                failed: failedCount,
                errors: errors.length > 0 ? errors : undefined
            };
        }
    };
}

module.exports = {
    createBillingService,
    buildPaymentAuditContext
};
