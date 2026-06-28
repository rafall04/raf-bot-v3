/**
 * Header Doc
 * Purpose: Settle pembayaran TAGIHAN bulanan yang SUDAH terverifikasi lunas oleh iPaymu —
 *   catat ke ledger (paid) lalu reaktivasi (un-isolir) bila pelanggan sedang di profil isolir.
 *   Fail-closed: catat-lunas wajib sukses (kalau gagal, caller balas 500 → iPaymu retry);
 *   reaktivasi best-effort (gagal → lunas TETAP, lapor admin, jangan gagalkan callback).
 * Caller: routes/public.js (POST /callback/payment, cabang tag 'tagihan').
 * Deps: lib/payment-finance-service (applyPaymentStatusChange), lib/services/isolir-service
 *   (executeProfileAction), lib/mikrotik (getPPPoEUserProfile), lib/myfunc (getProfileBySubscription).
 * MainFuncs: createBillPaymentSettlement, settleTagihanPayment, maybeReactivate.
 * SideEffects: Tulis ledger payment (paid), panggil MikroTik (ubah profil + disconnect) saat reaktivasi.
 */
"use strict";

function defaultDeps() {
    return {
        applyPaymentStatusChange: require("../payment-finance-service").applyPaymentStatusChange,
        executeProfileAction: require("./isolir-service").executeProfileAction,
        getPPPoEUserProfile: require("../mikrotik").getPPPoEUserProfile,
        getProfileBySubscription: require("../myfunc").getProfileBySubscription,
        logger: console,
    };
}

function createBillPaymentSettlement(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    /**
     * Reaktivasi HANYA bila profil LIVE pelanggan di MikroTik == isolir_profile.
     * Tidak melempar — selalu return envelope status. Kalau profil tak bisa dibaca,
     * pilih AMAN: jangan ubah profil (hindari memutus pelanggan aktif), tandai perlu cek admin.
     */
    async function maybeReactivate(user) {
        const isolirProfile = global.config && global.config.isolir_profile;
        if (!user.pppoe_username) return { attempted: false, reason: "no_pppoe" };
        if (!isolirProfile) return { attempted: false, reason: "no_isolir_profile_config" };

        let liveProfile;
        try {
            const live = await deps.getPPPoEUserProfile(user.pppoe_username, { caller: "bill-settlement.detect" });
            if (!live || live.ok === false) {
                return { attempted: false, reason: "profile_read_failed", error: live && live.message };
            }
            liveProfile = live.data?.profile ?? live.profile;
        } catch (err) {
            return { attempted: false, reason: "profile_read_failed", error: err.message };
        }

        if (liveProfile !== isolirProfile) {
            return { attempted: false, reason: "not_isolated", liveProfile };
        }

        const targetProfile = deps.getProfileBySubscription(user.subscription);
        if (!targetProfile) return { attempted: false, reason: "no_target_profile" };

        try {
            const result = await deps.executeProfileAction(user, {
                targetProfile,
                disconnect: true,
                caller: "callback.tagihan.reaktivasi",
            });
            return { attempted: true, ok: !!(result && result.ok), targetProfile, result };
        } catch (err) {
            // Reaktivasi gagal TIDAK menggagalkan lunas — lapor saja.
            if (deps.logger && deps.logger.error) deps.logger.error("[BILL_SETTLE] Reaktivasi gagal:", err.message);
            return { attempted: true, ok: false, targetProfile, error: err.message };
        }
    }

    /**
     * @param {{user, amountPaid, periodMonth, periodYear, paymentMethod?, reffId?}} input
     * @returns {Promise<{ok, ledger, reactivation}>}
     * @throws kalau applyPaymentStatusChange gagal (caller balas 500 → iPaymu retry; lunas belum tercatat).
     */
    async function settleTagihanPayment({ user, amountPaid, periodMonth, periodYear, paymentMethod = "QRIS", reffId = null }) {
        if (!user || !user.id) throw new Error("settleTagihanPayment: user wajib.");

        // 1) Catat lunas ke ledger (idempoten: already_fully_paid → action no_change, tak double).
        const ledger = await deps.applyPaymentStatusChange({
            user,
            paid: true,
            periodMonth,
            periodYear,
            amountPaid,
            paymentMethod,
            createdBy: "ipaymu.tagihan",
            notes: `Bayar tagihan via ${paymentMethod}${reffId ? ` (ref ${reffId})` : ""}`,
        });

        // 2) Reaktivasi bila terisolir — best-effort, tak menggagalkan lunas.
        const reactivation = await maybeReactivate(user);

        return { ok: true, ledger, reactivation };
    }

    return { settleTagihanPayment, maybeReactivate };
}

module.exports = { createBillPaymentSettlement, defaultDeps };
