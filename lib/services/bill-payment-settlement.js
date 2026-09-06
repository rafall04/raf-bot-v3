/**
 * Header Doc
 * Purpose: Settle pembayaran TAGIHAN bulanan yang SUDAH terverifikasi lunas oleh iPaymu —
 *   catat ke ledger (paid) lalu reaktivasi (un-isolir) bila pelanggan sedang di profil isolir.
 *   Fail-closed: catat-lunas wajib sukses (kalau gagal, caller balas 500 → iPaymu retry);
 *   reaktivasi best-effort (gagal → lunas TETAP, lapor admin, jangan gagalkan callback).
 * Caller: routes/public.js (POST /callback/payment, cabang tag 'tagihan'), routes/bill-payment.js,
 *   services/payment-proof.service.js.
 * Deps: lib/payment-finance-service (applyPaymentStatusChange), lib/services/isolir-service
 *   (executeProfileAction), lib/mikrotik (getPPPoEUserProfile), lib/myfunc (getProfileBySubscription)
 *   — semuanya di-require LAZY, lihat DEFAULT_DEP_LOADERS.
 * MainFuncs: createBillPaymentSettlement, settleTagihanPayment, maybeReactivate.
 * SideEffects: Tulis ledger payment (paid), panggil MikroTik (ubah profil + disconnect) saat reaktivasi.
 */
"use strict";

/**
 * Dep default di-resolve LAZY: `require` baru jalan saat dep DIPAKAI, bukan saat modul di-import.
 * Caller membuat instance di scope modul (`const billSettlement = createBillPaymentSettlement()`),
 * jadi require eager di sini menyeret isolir-service — dan lewat dia mikrotik/wifi/genieacs — ke
 * dalam graf impor SETIAP importer, termasuk router portal pelanggan yang tak pernah mengisolir
 * siapa pun. Selain berat, itu bikin graf modulnya rapuh: isolir-service `extends BaseService`,
 * sehingga test yang mem-mock base-service (POJO) langsung pecah saat impor.
 * `require` Node ter-cache, jadi resolve saat pakai tetap murah.
 */
const DEFAULT_DEP_LOADERS = {
    applyPaymentStatusChange: () => require("../payment-finance-service").applyPaymentStatusChange,
    executeProfileAction: () => require("./isolir-service").executeProfileAction,
    getPPPoEUserProfile: () => require("../mikrotik").getPPPoEUserProfile,
    getProfileBySubscription: () => require("../myfunc").getProfileBySubscription,
    logger: () => console,
};

/** Snapshot eager semua dep default — hanya untuk caller yang memang butuh objeknya. */
function defaultDeps() {
    return Object.fromEntries(
        Object.entries(DEFAULT_DEP_LOADERS).map(([name, load]) => [name, load()])
    );
}

function createBillPaymentSettlement(overrides = {}) {
    // Override menang; sisanya baru di-require saat dipanggil (lihat DEFAULT_DEP_LOADERS).
    const dep = (name) => (
        Object.prototype.hasOwnProperty.call(overrides, name)
            ? overrides[name]
            : DEFAULT_DEP_LOADERS[name]()
    );

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
            const live = await dep("getPPPoEUserProfile")(user.pppoe_username, { caller: "bill-settlement.detect" });
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

        const targetProfile = dep("getProfileBySubscription")(user.subscription);
        if (!targetProfile) return { attempted: false, reason: "no_target_profile" };

        try {
            const result = await dep("executeProfileAction")(user, {
                targetProfile,
                disconnect: true,
                caller: "callback.tagihan.reaktivasi",
            });
            return { attempted: true, ok: !!(result && result.ok), targetProfile, result };
        } catch (err) {
            // Reaktivasi gagal TIDAK menggagalkan lunas — lapor saja.
            const logger = dep("logger");
            if (logger && logger.error) logger.error("[BILL_SETTLE] Reaktivasi gagal:", err.message);
            return { attempted: true, ok: false, targetProfile, error: err.message };
        }
    }

    /**
     * @param {{user, amountPaid, periodMonth, periodYear, paymentMethod?, reffId?, markPaid?}} input
     *        markPaid: callback dipanggil SEGERA setelah ledger commit (sebelum reaktivasi lambat) —
     *        biasanya `() => updateStatusPayment(reff, true)` supaya idempotency fast-check menyala.
     * @returns {Promise<{ok, ledger, reactivation}>}
     * @throws kalau applyPaymentStatusChange gagal (caller balas 500 → gateway retry; lunas belum tercatat).
     */
    async function settleTagihanPayment({ user, amountPaid, periodMonth, periodYear, paymentMethod = "QRIS", reffId = null, markPaid = null }) {
        if (!user || !user.id) throw new Error("settleTagihanPayment: user wajib.");

        // 1) Catat lunas ke ledger (idempoten: already_fully_paid → action no_change, tak double).
        const ledger = await dep("applyPaymentStatusChange")({
            user,
            paid: true,
            periodMonth,
            periodYear,
            amountPaid,
            paymentMethod,
            createdBy: "ipaymu.tagihan",
            notes: `Bayar tagihan via ${paymentMethod}${reffId ? ` (ref ${reffId})` : ""}`,
        });

        // Tandai transaksi LUNAS SEGERA setelah ledger commit — SEBELUM reaktivasi MikroTik yang bisa
        // >30s (retry 12s×3). Kalau ditunda sampai sesudah reaktivasi, webhook retry yang tiba selama
        // reaktivasi berjalan (dan lock callback keburu di-cleanup di 30s) lolos idempotency
        // (checkStatusPayment masih false) → applyPaymentStatusChange KEDUA baca periode SUDAH lunas →
        // aftercare vonis 'kelebihan bayar' PALSU + pesan ganda ke pelanggan yang bayar SEKALI.
        if (typeof markPaid === "function") {
            try { markPaid(); } catch (_e) { /* best-effort; jangan gagalkan settle */ }
        }

        // 2) Reaktivasi bila terisolir — best-effort, tak menggagalkan lunas.
        const reactivation = await maybeReactivate(user);

        return { ok: true, ledger, reactivation };
    }

    return { settleTagihanPayment, maybeReactivate };
}

module.exports = { createBillPaymentSettlement, defaultDeps };
