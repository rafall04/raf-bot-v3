/**
 * Header Doc
 * Purpose: Service "Bayar di Muka" (prabayar cash oleh admin) — catat pelunasan untuk N periode
 *   billing KE DEPAN ke ledger (idempoten), dengan syarat periode berjalan SUDAH lunas. Tidak
 *   menyentuh profil MikroTik (pelanggan masih aktif; ini untuk masa depan). Setelah tercatat,
 *   kirim SATU struk WA "prabayar" (best-effort, tak pernah menggagalkan pencatatan).
 * Caller: routes/payment-status.js (POST /api/payment-status/advance).
 * Deps: lib/payment-finance-service (applyPaymentStatusChange, getCurrentBillingPeriod,
 *   getEffectivePrice, getPaymentPositionForPeriod), lib/templating (renderTemplate),
 *   lib/whatsapp-delivery-service (sendMessage), lib/whatsapp-gateway (isReady), lib/utils
 *   (normalizePhoneNumber).
 * MainFuncs: createAdvancePaymentService, recordAdvancePayment, sendAdvanceReceipt.
 * SideEffects: Tulis ledger payment_history (paid) untuk periode masa depan + kirim struk WA.
 */
"use strict";

const MAX_ADVANCE_MONTHS = 12;

const MONTH_NAMES = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

function formatPeriodLabel(periodMonth, periodYear) {
    return `${MONTH_NAMES[periodMonth - 1]} ${periodYear}`;
}

// Geser periode N bulan ke depan dari (month, year). month 1-based.
function addMonths(periodMonth, periodYear, n) {
    const zeroIdx = (periodMonth - 1) + n;
    return {
        periodMonth: (((zeroIdx % 12) + 12) % 12) + 1,
        periodYear: periodYear + Math.floor(zeroIdx / 12)
    };
}

function defaultDeps() {
    const finance = require("../payment-finance-service");
    return {
        applyPaymentStatusChange: finance.applyPaymentStatusChange,
        getCurrentBillingPeriod: finance.getCurrentBillingPeriod,
        getEffectivePrice: finance.getEffectivePrice,
        getPaymentPositionForPeriod: finance.getPaymentPositionForPeriod,
        renderTemplate: require("../templating").renderTemplate,
        sendMessage: require("../whatsapp-delivery-service").sendMessage,
        isReady: require("../whatsapp-gateway").isReady,
        normalizePhoneNumber: require("../utils").normalizePhoneNumber,
        logger: console
    };
}

function createAdvancePaymentService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    /**
     * Catat pelunasan prabayar untuk `months` periode ke depan.
     * @param {{user:object, months:number, createdBy?:string}} input
     * @returns {Promise<{ok, reason?, currentPeriod, recorded, skipped, totalAmount, coverageUntil}>}
     *   ok:false reason 'current_unpaid' → periode berjalan belum lunas (caller balas 409).
     */
    async function recordAdvancePayment({ user, months, createdBy = "admin" }) {
        if (!user || !user.id) {
            throw new Error("recordAdvancePayment: user wajib.");
        }
        const monthCount = parseInt(months, 10);
        if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > MAX_ADVANCE_MONTHS) {
            throw new Error(`months wajib bilangan 1..${MAX_ADVANCE_MONTHS}.`);
        }

        const current = deps.getCurrentBillingPeriod();

        // Syarat: tagihan periode BERJALAN harus lunas dulu. Ini juga menjaga kebenaran cron
        // set-unpaid (yang hanya me-resync user paid=true saat rollover → prabayar terbaca).
        const currentDue = deps.getEffectivePrice(user);
        const currentPosition = await deps.getPaymentPositionForPeriod(
            user, current.periodMonth, current.periodYear, { amountDue: currentDue }
        );
        if (!currentPosition.is_fully_paid) {
            return {
                ok: false,
                reason: "current_unpaid",
                currentPeriod: current,
                recorded: [],
                skipped: [],
                totalAmount: 0,
                coverageUntil: current
            };
        }

        const recorded = [];
        const skipped = [];
        let totalAmount = 0;

        for (let i = 1; i <= monthCount; i += 1) {
            const period = addMonths(current.periodMonth, current.periodYear, i);
            const label = formatPeriodLabel(period.periodMonth, period.periodYear);
            const amount = deps.getEffectivePrice(user);

            let result;
            try {
                result = await deps.applyPaymentStatusChange({
                    user,
                    paid: true,
                    periodMonth: period.periodMonth,
                    periodYear: period.periodYear,
                    amountPaid: amount,
                    amountDue: amount,
                    isPartial: false,
                    paymentMethod: "CASH",
                    notes: `Bayar di muka (prabayar) — ${label}`,
                    createdBy,
                    sourceAdminAction: `advance-payment:${user.id}:${period.periodYear}-${period.periodMonth}`
                    // Sengaja TANPA onFinalPaid: ini periode masa depan, jangan revert isolir/reboot.
                });
            } catch (err) {
                if (deps.logger && deps.logger.error) {
                    deps.logger.error(`[ADVANCE_PAYMENT] Gagal catat ${label} utk user ${user.id}: ${err.message}`);
                }
                skipped.push({ ...period, label, reason: "error", error: err.message });
                continue;
            }

            if (result.action === "paid") {
                recorded.push({ ...period, label, amount });
                totalAmount += amount;
            } else {
                // 'no_change' (already_fully_paid) → periode ini memang sudah dibayar; lewati.
                skipped.push({ ...period, label, reason: result.reason || result.action });
            }
        }

        const coverageUntil = addMonths(current.periodMonth, current.periodYear, monthCount);

        return { ok: true, currentPeriod: current, recorded, skipped, totalAmount, coverageUntil };
    }

    /**
     * Kirim SATU struk prabayar ke semua nomor pelanggan. Best-effort — tak pernah throw.
     * Hanya dikirim bila ada periode yang BENAR-BENAR baru tercatat (recorded.length > 0).
     * @returns {Promise<{sent:boolean, reason?:string, count?:number}>}
     */
    async function sendAdvanceReceipt({ user, summary }) {
        try {
            if (!summary || !Array.isArray(summary.recorded) || summary.recorded.length === 0) {
                return { sent: false, reason: "nothing_recorded" };
            }
            if (!deps.isReady()) {
                return { sent: false, reason: "wa_not_ready" };
            }
            if (!user.phone_number) {
                return { sent: false, reason: "no_phone" };
            }

            const daftarPeriode = summary.recorded.map((p) => p.label).join(", ");
            const waktu = new Date().toLocaleString("id-ID", {
                day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
            }) + " WIB";

            const text = deps.renderTemplate("tagihan_prabayar_struk", {
                nama_pelanggan: user.name,
                nama_paket: user.subscription || "N/A",
                jumlah_bulan: summary.recorded.length,
                daftar_periode: daftarPeriode,
                harga: summary.totalAmount,
                metode: "Tunai",
                waktu,
                bebas_sampai: formatPeriodLabel(summary.coverageUntil.periodMonth, summary.coverageUntil.periodYear)
            });

            let count = 0;
            for (const rawNumber of String(user.phone_number).split("|")) {
                if (!rawNumber || rawNumber.trim() === "") continue;
                const normalized = deps.normalizePhoneNumber(rawNumber);
                if (!normalized || normalized.length <= 8) continue;
                const jid = `${normalized}@s.whatsapp.net`;
                const delivery = await deps.sendMessage(jid, { text });
                if (delivery && delivery.sent) count += 1;
            }

            return { sent: count > 0, count };
        } catch (err) {
            if (deps.logger && deps.logger.error) {
                deps.logger.error(`[ADVANCE_PAYMENT] Gagal kirim struk prabayar utk user ${user && user.id}: ${err.message}`);
            }
            return { sent: false, reason: "send_error", error: err.message };
        }
    }

    return { recordAdvancePayment, sendAdvanceReceipt };
}

module.exports = {
    createAdvancePaymentService,
    defaultDeps,
    formatPeriodLabel,
    addMonths,
    MAX_ADVANCE_MONTHS
};
