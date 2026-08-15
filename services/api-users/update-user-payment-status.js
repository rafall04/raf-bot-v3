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

        // KUNCI IDEMPOTENSI harus membedakan PERISTIWA, bukan hanya pelanggan.
        //
        // Bentuk lamanya `legacy-users-update:<id>:unpaid` KONSTAN per pelanggan selamanya,
        // sehingga `event_key` (UNIQUE index di payment_reversals) selalu sama. Urutan nyata
        // yang menggigit: (1) admin salah tandai lunas → payment_history 150k, (2) admin
        // batalkan → reversal tercatat, (3) pelanggan benar-benar bayar → history lagi,
        // (4) admin batalkan lagi → INSERT menabrak UNIQUE, dikembalikan `duplicate_retry`,
        // dan kode di bawah memperlakukannya sebagai SUKSES. Pembalikan kedua tak pernah
        // terjadi tapi admin diberi tahu berhasil; ledger dan tampilan berbeda selamanya.
        //
        // Periode + JUMLAH pembalikan yang sudah ada membuat setiap peristiwa punya kunci
        // sendiri, SEKALIGUS mempertahankan idempotensi yang memang diinginkan: klik ganda
        // pada keadaan yang sama menghasilkan hitungan yang sama, jadi tetap dedupe.
        // Tahan bila dep belum disuntikkan (mis. suite lama yang memakai deps tiruan minimal):
        // jatuh ke 0 berarti perilakunya sama dengan sebelumnya untuk pembalikan PERTAMA, dan
        // hanya kehilangan pembeda untuk yang kedua — bukan melempar di jalur uang.
        let urutanPembalikan = 0;
        if (typeof deps.getPaymentPositionForPeriod === "function") {
            const posisiSebelum = await deps.getPaymentPositionForPeriod(user, periodMonth, periodYear, {
                amountDue: deps.getEffectivePrice(user)
            });
            urutanPembalikan = Math.max(0, Number(posisiSebelum?.total_reversal || 0));
        }

        const financeResult = await deps.applyPaymentStatusChange({
            user,
            paid: false,
            periodMonth,
            periodYear,
            amountDue: deps.getEffectivePrice(user),
            notes: "Status pembayaran dibalik oleh admin",
            createdBy: username,
            sourceAdminAction: `legacy-users-update:${id}:${periodYear}-${periodMonth}:unpaid:${urutanPembalikan}`
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
