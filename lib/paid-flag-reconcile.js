/**
 * Header Doc
 * Purpose: Menyamakan flag cache `users.paid` dengan LEDGER (`payment_history`/waiver) untuk periode
 *   berjalan — dua arah (paid↔unpaid). Ini pengaman "self-heal": kalau reset bulanan (`set-unpaid`,
 *   cron tgl 1) TERLEWAT karena bot mati saat itu, flag bisa nyangkut di potret bulan lalu sehingga
 *   Broadcast Tagihan / reminder / isolir memakai status basi. Reconcile menyamakan flag ke sumber
 *   kebenaran (ledger). READ-ONLY terhadap ledger — hanya set flag, TIDAK menulis pembayaran/pemasukan
 *   dan TIDAK mengirim WhatsApp.
 * Caller: `lib/database.js` (saat boot, best-effort) dan `lib/cron/jobs/paid-reconcile.js` (harian).
 * Deps: `./payment-finance-service` (syncUserPaidStatusForPeriod, getCurrentBillingPeriod),
 *   `./account-classification` (isInfrastructure), runtime `global.users`/`global.packages`/`global.db`.
 * MainFuncs: `reconcilePaidFlags`, `runStartupPaidReconcileSafe`.
 * SideEffects: UPDATE users.paid (flag + cache memori) via finance service; tanpa notifikasi/ledger write.
 */
"use strict";

const {
    syncUserPaidStatusForPeriod,
    getCurrentBillingPeriod
} = require("./payment-finance-service");
const { isInfrastructure, getWhitelistedPackageNames } = require("./account-classification");

function isPaidFlag(user) {
    return Boolean(user && (user.paid === true || user.paid === 1 || user.paid === "1"));
}

/**
 * Reconcile flag users.paid ke posisi ledger untuk periode berjalan (atau periode yang diminta).
 * Idempoten: menyetel flag = `is_fully_paid` ledger; hanya menghitung perubahan yang benar-benar terjadi.
 * Melewati akun infrastruktur (tak ditagih) dan paket whitelist (gratis/immun billing) — konsisten
 * dengan cron `set-unpaid` dan backfill migrasi.
 * @param {{periodMonth?:number, periodYear?:number, logger?:object}} [opts]
 * @returns {Promise<{period, checked:number, toPaid:number, toUnpaid:number, failed:number}>}
 */
async function reconcilePaidFlags({ periodMonth, periodYear, logger = console } = {}) {
    const period = (Number.isInteger(periodMonth) && Number.isInteger(periodYear))
        ? { periodMonth, periodYear }
        : getCurrentBillingPeriod();

    const whitelisted = getWhitelistedPackageNames();
    const users = global.users || [];
    const summary = { period, checked: 0, toPaid: 0, toUnpaid: 0, failed: 0 };

    // Sequential (bukan paralel) supaya tidak membanjiri koneksi SQLite reader — disiplin sama
    // dengan cron set-unpaid & isolir.
    for (const user of users) {
        if (isInfrastructure(user)) continue;
        if (whitelisted.has(user.subscription)) continue;

        summary.checked += 1;
        const before = isPaidFlag(user);
        try {
            const position = await syncUserPaidStatusForPeriod({
                user,
                periodMonth: period.periodMonth,
                periodYear: period.periodYear
            });
            const after = Boolean(position.is_fully_paid);
            if (before !== after) {
                if (after) summary.toPaid += 1; else summary.toUnpaid += 1;
            }
        } catch (error) {
            summary.failed += 1;
            if (logger && typeof logger.warn === "function") {
                logger.warn(`[PAID_RECONCILE] gagal reconcile user ${user.id}: ${error.message}`);
            }
        }
    }

    return summary;
}

/**
 * Wrapper aman untuk dipanggil saat startup. TIDAK pernah melempar supaya tidak menggagalkan boot.
 */
async function runStartupPaidReconcileSafe(options = {}) {
    try {
        if (!global.db) {
            return { skipped: true, reason: "db_not_ready" };
        }
        const result = await reconcilePaidFlags(options);
        if (result.toPaid > 0 || result.toUnpaid > 0 || result.failed > 0) {
            console.log(
                `[PAID_RECONCILE] periode ${result.period.periodMonth}/${result.period.periodYear}: ` +
                `flag disamakan ke ledger — +${result.toPaid} lunas, +${result.toUnpaid} belum bayar, ` +
                `${result.failed} gagal (dari ${result.checked} pelanggan)`
            );
        }
        return result;
    } catch (error) {
        console.error("[PAID_RECONCILE_ERROR]", error.message);
        return { error: error.message };
    }
}

module.exports = {
    reconcilePaidFlags,
    runStartupPaidReconcileSafe
};
