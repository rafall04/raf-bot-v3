/**
 * Header Doc
 * Purpose: Waiver pembayaran (GRATIS) — record ke `payment_waivers` + applyFreeMonth.
 * Caller: facade `lib/payment-finance-service.js` (re-export; jangan require langsung kecuali test).
 * Deps: ./ledger.
 * MainFuncs: `recordPaymentWaiverEntry`, `applyFreeMonth`.
 * SideEffects: sama seperti lib/payment-finance-service.js asli (split #b394 — murni pemindahan kode).
 */
"use strict";

const { dbRun, dbGet, toInteger, buildNowIso, getEffectivePrice, ensurePaymentFinanceTables, getPaymentPositionForPeriod, syncUserPaidStatusForCurrentPeriod } = require('./ledger');

async function recordPaymentWaiverEntry({
    userId,
    periodMonth,
    periodYear,
    amountWaived = 0,
    reason,
    createdBy,
    idempotencyKey = null
}) {
    await ensurePaymentFinanceTables();

    const eventKey = idempotencyKey || `payment_waiver:${userId}:${periodYear}:${periodMonth}`;

    try {
        const result = await dbRun(
            `INSERT INTO payment_waivers (
                user_id, period_month, period_year, amount_waived, reason, created_by, created_at, status, event_key
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
            [
                userId,
                periodMonth,
                periodYear,
                Math.abs(toInteger(amountWaived)),
                reason || "Gratis",
                createdBy || "system",
                buildNowIso(),
                eventKey
            ]
        );
        return { created: true, duplicate: false, id: result.lastID, eventKey };
    } catch (error) {
        if (!String(error.message || "").includes("UNIQUE")) {
            throw error;
        }
        const row = await dbGet("SELECT id FROM payment_waivers WHERE event_key = ?", [eventKey]);
        return { created: false, duplicate: true, id: row?.id || null, eventKey };
    }
}


/**
 * Tandai sebuah periode sebagai GRATIS (dibebaskan dari tagihan) untuk satu pelanggan.
 * Mencatat waiver di tabel terpisah → periode dihitung lunas (is_fully_paid) sehingga aman dari
 * isolir & ikut tersinkron saat rollover, TANPA menambah pemasukan (waiver tak masuk gross_paid).
 * Idempoten via event_key per (user, periode).
 * @param {{user, periodMonth, periodYear, reason?, createdBy?}} input
 * @returns {Promise<{action, waiverId, positionBefore, positionAfter, currentPeriodPosition}>}
 */
async function applyFreeMonth({
    user,
    periodMonth,
    periodYear,
    reason = "Gratis",
    createdBy = "system"
}) {
    if (!user || !user.id) {
        throw new Error("user wajib diisi");
    }
    await ensurePaymentFinanceTables();

    const amountDue = Math.max(0, getEffectivePrice(user));
    const positionBefore = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue });

    if (positionBefore.is_waived) {
        return { action: "no_change", reason: "already_waived", positionBefore, positionAfter: positionBefore };
    }

    const waiver = await recordPaymentWaiverEntry({
        userId: user.id,
        periodMonth,
        periodYear,
        amountWaived: amountDue,
        reason,
        createdBy
    });

    const positionAfter = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue });
    const currentPeriodPosition = await syncUserPaidStatusForCurrentPeriod({ user });

    return {
        action: waiver.created ? "waived" : "duplicate_retry",
        waiverId: waiver.id || null,
        positionBefore,
        positionAfter,
        currentPeriodPosition
    };
}


module.exports = {
    recordPaymentWaiverEntry,
    applyFreeMonth,
};
