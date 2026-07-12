/**
 * Header Doc
 * Purpose: Method `updateUserPaymentStatus` — update flag `paid` user pada periode berjalan via finance boundary (`applyPaymentStatusChange`). Jika `paid=true`, validate `payment_method` (CASH/TRANSFER_BANK) lalu trigger `handlePaidStatusChange` lewat `onFinalPaid` callback (notifikasi WA + ledger). Jika `paid=false`, panggil reverse path. Tidak menyentuh repository langsung — finance boundary yang mengelola persistensi status `paid`.
 * Caller: `services/api-users.service.js` (composer wraps menjadi method `service.updateUserPaymentStatus(args)`).
 * Deps: `deps.repository.findUserById`, `deps.normalizeUserPaymentMethod`, `deps.applyPaymentStatusChange`, `deps.handlePaidStatusChange`, `deps.getPeriodParts`, `deps.getEffectivePrice`, `deps.logger`.
 * MainFuncs: `updateUserPaymentStatus(deps, { id, paid, paymentMethodInput, username })`.
 * SideEffects: Validasi input → finance boundary update → notifikasi paid (via callback) → log audit. Tidak melakukan mutasi database langsung di service ini.
 */
"use strict";

async function updateUserPaymentStatus(deps, { id, paid, paymentMethodInput, username }) {
    if (!id) {
        return {
            status: 400,
            body: {
                status: 400,
                message: "User ID is required"
            }
        };
    }

    if (typeof paid !== "boolean") {
        return {
            status: 400,
            body: {
                status: 400,
                message: "paid must be a boolean value"
            }
        };
    }

    const user = deps.repository.findUserById(id);
    if (!user) {
        return {
            status: 404,
            body: {
                status: 404,
                message: "User not found"
            }
        };
    }

    const { periodMonth, periodYear } = deps.getPeriodParts({ date: new Date() });
    const oldPaidStatus = Boolean(user.paid);
    const paymentMethodInputPresent = paymentMethodInput !== undefined
        && paymentMethodInput !== null
        && String(paymentMethodInput).trim() !== "";
    const method = deps.normalizeUserPaymentMethod(paymentMethodInput);

    if (paymentMethodInputPresent && !method) {
        return {
            status: 400,
            body: {
                status: 400,
                message: "payment_method wajib CASH atau TRANSFER_BANK"
            }
        };
    }

    if (paid === true) {
        if (!method) {
            return {
                status: 400,
                body: {
                    status: 400,
                    message: "Metode pembayaran wajib dipilih saat menandai pelanggan sebagai sudah membayar."
                }
            };
        }

        const financeResult = await deps.applyPaymentStatusChange({
            user,
            paid: true,
            periodMonth,
            periodYear,
            amountPaid: deps.getEffectivePrice(user),
            amountDue: deps.getEffectivePrice(user),
            isPartial: false,
            paymentMethod: method,
            notes: `Status pembayaran diperbarui (${method === "CASH" ? "Tunai" : "Transfer Bank"})`,
            createdBy: username,
            sourceAdminAction: `legacy-users-update:${id}:paid`,
            onFinalPaid: async () => {
                await deps.handlePaidStatusChange(user, {
                    paidDate: new Date().toISOString(),
                    method,
                    approvedBy: username,
                    notes: `Status pembayaran diperbarui (${method === "CASH" ? "Tunai" : "Transfer Bank"})`
                });
            }
        });

        // no_change/already_fully_paid = idempoten (sudah lunas) → BUKAN kegagalan. Kegagalan nyata di-throw.
        const paidApplied = financeResult.action === "paid"
            || (financeResult.action === "no_change" && financeResult.reason === "already_fully_paid");
        if (!paidApplied) {
            return {
                status: 409,
                body: {
                    status: 409,
                    message: financeResult.reason || financeResult.action || "Status pembayaran tidak berubah"
                }
            };
        }
    } else {
        if (oldPaidStatus === paid) {
            return {
                status: 200,
                body: {
                    status: 200,
                    message: "Status pembayaran berhasil diperbarui",
                    data: user
                }
            };
        }

        const financeResult = await deps.applyPaymentStatusChange({
            user,
            paid: false,
            periodMonth,
            periodYear,
            amountDue: deps.getEffectivePrice(user),
            notes: "Status pembayaran dibalik oleh admin",
            createdBy: username,
            sourceAdminAction: `legacy-users-update:${id}:unpaid`
        });

        // no_change/no_paid_position (tak ada bayaran utk dibalik) & duplicate_retry = idempoten → BUKAN kegagalan.
        const reversalApplied = financeResult.action === "reversed"
            || financeResult.action === "duplicate_retry"
            || (financeResult.action === "no_change" && financeResult.reason === "no_paid_position");
        if (!reversalApplied) {
            return {
                status: 409,
                body: {
                    status: 409,
                    message: financeResult.reason || financeResult.action || "Status pembayaran tidak berubah"
                }
            };
        }
    }

    deps.logger.log?.(`[USER_UPDATE] User ${user.name} (ID: ${id}) payment status updated to ${paid}`);
    return {
        status: 200,
        body: {
            status: 200,
            message: "Status pembayaran berhasil diperbarui",
            data: user
        }
    };
}

module.exports = {
    updateUserPaymentStatus
};
