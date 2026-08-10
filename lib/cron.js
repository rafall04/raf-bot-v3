/**
 * Header Doc
 * Purpose: Composer cron — thin index yang menggabungkan cron job billing & ops (reminder, grace-reminder/masa-tenggang, set-unpaid, isolir, isolir-notification, compensation-revert, speed-revert, redaman-check, telegram-backup, dst) plus shared helper. Mempertahankan kontrak module export yang sama dengan versi monolitik (`initializeAllCronTasks`, semua individual init function, `startCheck`, `isValidCron`, `__testHooks.safeSendMessage`) sehingga `index.js`, `routes/admin-config-routes.js`, dan test guardrail eksisting tidak perlu diubah.
 * Caller: `index.js` (`initializeAllCronTasks` saat startup), `routes/admin-config-routes.js` (`initializeAllCronTasks` + `isValidCron` saat admin update cron config), test `lib/__tests__/cron-whatsapp.test.js` (`__testHooks.safeSendMessage`).
 * Deps: `./cron/shared` (helpers + safeSendMessage + loadCronConfig + isValidCron), `./cron/jobs/*` (8 file job per domain).
 * MainFuncs: `initializeAllCronTasks` — load `cron.json` lalu trigger semua job initializer; lainnya di-re-export dari sub-modul.
 * SideEffects: Tidak ada di level composer; semua side-effect ada di sub-job.
 *
 * BOUNDARY MAP:
 *   lib/cron/shared.js                       : Shared helpers + safeSendMessage
 *   lib/cron/jobs/reminder.js                : Billing reminder pra-jatuh-tempo (initReminderTask, generateReminderData)
 *   lib/cron/jobs/grace-reminder.js          : Peringatan masa tenggang pasca jatuh tempo, pra-isolir (initGraceReminderTask)
 *   lib/cron/jobs/set-unpaid.js              : Reset paid status tgl 1 (initSetUnpaidTask)
 *   lib/cron/jobs/paid-reconcile.js          : Jaring pengaman harian flag↔ledger (initPaidReconcileTask)
 *   lib/cron/jobs/isolir.js                  : Isolir action (initIsolirTask)
 *   lib/cron/jobs/isolir-notification.js     : Notif isolir (initIsolirNotificationTask)
 *   lib/cron/jobs/compensation-revert.js     : Revert compensation (initCompensationRevertTask)
 *   lib/cron/jobs/speed-revert.js            : Revert SOD boost (initSpeedRevertTask)
 *   lib/cron/jobs/redaman-check.js           : Cek redaman GenieACS (startCheck)
 *   lib/cron/jobs/telegram-backup.js         : Backup Telegram (initTelegramBackupTask)
 *   lib/cron/jobs/auto-outage-check.js       : Auto outage scan PPPoE + broadcast (initAutoOutageCheckTask)
 *   lib/cron/jobs/olt-backup.js              : Auto-backup konfigurasi OLT via SSH (initOltBackupTask)
 *   lib/cron/jobs/rating-survey.js           : Survei kepuasan CSAT bulanan + digest owner (initRatingSurveyTask)
 */
"use strict";

const { isValidCron, loadCronConfig, safeSendMessage } = require('./cron/shared');
const { initReminderTask } = require('./cron/jobs/reminder');
const { initGraceReminderTask } = require('./cron/jobs/grace-reminder');
const { initSetUnpaidTask } = require('./cron/jobs/set-unpaid');
const { initIsolirTask } = require('./cron/jobs/isolir');
const { initIsolirNotificationTask } = require('./cron/jobs/isolir-notification');
const { initCompensationRevertTask } = require('./cron/jobs/compensation-revert');
const { initSpeedRevertTask } = require('./cron/jobs/speed-revert');
const { initTelegramBackupTask } = require('./cron/jobs/telegram-backup');
const { startCheck } = require('./cron/jobs/redaman-check');
const { initAutoOutageCheckTask } = require('./cron/jobs/auto-outage-check');
const { initOltBackupTask } = require('./cron/jobs/olt-backup');
const { initVoucherReconcileTask } = require('./cron/jobs/voucher-reconcile');
const { initPaidReconcileTask } = require('./cron/jobs/paid-reconcile');
const { initRatingSurveyTask } = require('./cron/jobs/rating-survey');
const { initRecurringExpenseReminderTask } = require('./cron/jobs/recurring-expense-reminder');
// Draft gaji tetap teknisi — berhenti di draft, tak pernah memfinalisasi/membayar.
const { initTechnicianSalaryDraftTask } = require('./cron/jobs/technician-salary-draft');
const { initMoneyDigestTask } = require('./cron/jobs/money-digest');

/**
 * Backup dompet pribadi — fitur OPSIONAL per-instance (hanya dipasang di instance yang memang
 * menumpangkan dompet pemilik), jadi berkasnya boleh tidak ada di instance lain. `require`
 * tingkat-atas membuat instance tanpa berkas itu GAGAL BOOT — seluruh cron ikut mati gara-gara
 * satu job opsional. Karena itu malas + bergerbang config.
 */
function initPersonalFinanceBackupTask() {
    if (!(global.config && global.config.personalFinance && global.config.personalFinance.enabled === true)) return;
    try {
        require('./cron/jobs/personal-finance-backup').initPersonalFinanceBackupTask();
    } catch (e) {
        // Aktif di config tapi modulnya tak terpasang = salah pasang yang harus TERLIHAT.
        console.error('[CRON] Dompet pribadi aktif tapi job backup-nya tak terpasang:', e && e.message);
    }
}

/**
 * Initializes all cron tasks on application startup.
 */
function initializeAllCronTasks() {
    const config = loadCronConfig();
    global.cronConfig = config; // Ensure global config is set

    initReminderTask(config);
    initGraceReminderTask(config);
    initSetUnpaidTask(config);
    initIsolirTask(config);
    initIsolirNotificationTask(config);
    initCompensationRevertTask(config);
    initSpeedRevertTask(config);
    initTelegramBackupTask(config);
    initAutoOutageCheckTask(config);
    initOltBackupTask(); // jadwal dibaca dari config.json olt.backup (bukan cron.json)
    initVoucherReconcileTask(config);
    initPaidReconcileTask(config); // jaring pengaman harian: samakan flag users.paid ↔ ledger
    initRatingSurveyTask(config);  // survei kepuasan (CSAT) + digest owner — gated config.csatSurvey.enabled
    // Backup LOKAL dompet pribadi. DB-nya sengaja di luar backup Telegram (tujuannya grup
    // multi-anggota), jadi tanpa ini satu kesalahan menghapusnya permanen.
    initPersonalFinanceBackupTask();
    // Pengingat biaya rutin usaha ke grup kas — bot MENGINGATKAN, pencatatan menunggu
    // konfirmasi `ok`/`lewati` di grup (bot tak pernah memposting sendiri).
    initRecurringExpenseReminderTask();
    initTechnicianSalaryDraftTask();
    // Ringkasan uang harian ke grup kas — opt-in terpisah (config.businessExpense.digest).
    initMoneyDigestTask();
    startCheck();
}

module.exports = {
    initializeAllCronTasks,
    initReminderTask,
    initGraceReminderTask,
    initSetUnpaidTask,
    initIsolirTask,
    initIsolirNotificationTask,
    initCompensationRevertTask,
    initSpeedRevertTask,
    initTelegramBackupTask,
    initAutoOutageCheckTask,
    initOltBackupTask,
    initVoucherReconcileTask,
    initPaidReconcileTask,
    initRatingSurveyTask,
    startCheck,
    isValidCron,
    __testHooks: {
        safeSendMessage
    }
};
