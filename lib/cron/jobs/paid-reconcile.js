/**
 * Header Doc
 * Purpose: Cron harian "jaring pengaman" — menyamakan flag `users.paid` dengan ledger periode berjalan
 *   via `reconcilePaidFlags`. Melengkapi `set-unpaid` (yang hanya jalan tgl 1 dan bisa terlewat kalau
 *   bot mati saat itu) + reconcile-saat-boot; dengan ini drift status bayar terkoreksi maksimal 24 jam
 *   walau tick bulanan terlewat. State holder `cronTaskPaidReconcile` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initPaidReconcileTask`.
 * Deps: `node-cron`, `../shared` (isValidCron), `../../paid-flag-reconcile` (reconcilePaidFlags).
 * MainFuncs: `initPaidReconcileTask(config)` — schedule/restart task reconcile harian.
 * SideEffects: Jadwalkan job background; set flag users.paid via finance service (tanpa WA/ledger write).
 */
"use strict";

const cron = require('node-cron');

const { isValidCron } = require('../shared');
const { reconcilePaidFlags } = require('../../paid-flag-reconcile');

// Default harian 03:00 — sengaja beda jam dari set-unpaid (00:00) & reminder (08:00) agar tak menumpuk.
const DEFAULT_SCHEDULE = '0 3 * * *';

let cronTaskPaidReconcile = null;
let paidReconcileRunning = false;

function initPaidReconcileTask(config = {}) {
    if (cronTaskPaidReconcile) cronTaskPaidReconcile.stop();

    // Safety net: AKTIF secara default (tak butuh key config). Hanya nonaktif bila di-set eksplisit false.
    if (config && config.paid_reconcile_enabled === false) {
        console.log('[CRON_PAID_RECONCILE] Dinonaktifkan via config (paid_reconcile_enabled=false).');
        return;
    }

    // Guard: JANGAN teruskan undefined ke isValidCron — cron-validator memanggil .trim()
    // (throw pada undefined). Key `paid_reconcile_schedule` opsional & default tak ada di cron.json.
    const configured = config && config.paid_reconcile_schedule;
    const schedule = (typeof configured === "string" && configured.trim() && isValidCron(configured))
        ? configured
        : DEFAULT_SCHEDULE;

    console.log('[CRON_PAID_RECONCILE] Starting/Restarting paid-reconcile task with schedule:', schedule);
    cronTaskPaidReconcile = cron.schedule(schedule, async () => {
        // Overlap guard — cegah dua siklus jalan bersamaan.
        if (paidReconcileRunning) {
            console.warn('[CRON_PAID_RECONCILE_SKIPPED] Previous reconcile cycle still running, skipping this tick.');
            return;
        }
        if (!global.db) {
            console.warn('[CRON_PAID_RECONCILE_SKIPPED] global.db belum siap.');
            return;
        }

        paidReconcileRunning = true;
        try {
            const result = await reconcilePaidFlags();
            if (result.toPaid > 0 || result.toUnpaid > 0 || result.failed > 0) {
                console.log(
                    `[CRON_PAID_RECONCILE] periode ${result.period.periodMonth}/${result.period.periodYear}: ` +
                    `+${result.toPaid} lunas, +${result.toUnpaid} belum bayar, ${result.failed} gagal ` +
                    `(dari ${result.checked} pelanggan)`
                );
            }
        } catch (error) {
            console.error('[CRON_PAID_RECONCILE_ERROR]', error.message);
        } finally {
            paidReconcileRunning = false;
        }
    });
}

module.exports = {
    initPaidReconcileTask
};
