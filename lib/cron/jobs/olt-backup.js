/**
 * Header Doc
 * Purpose: Cron job auto-backup konfigurasi OLT — eksekusi `runBackupAll` sesuai jadwal di
 *          config.json `olt.backup.schedule` (default 02:30 WIB). Guard anti-overlap: backup
 *          OLT via SSH bisa lama; run berikutnya di-skip bila run sebelumnya masih jalan.
 * Caller: `lib/cron.js` (composer, saat startup), `routes/olt-provisioning.js`
 *         (restartOltBackupTask saat admin ubah setting).
 * Deps: node-cron, ../shared (isValidCron), ../../olt-backup (runBackupAll, getBackupSettings).
 * MainFuncs: initOltBackupTask, restartOltBackupTask.
 * SideEffects: jadwalkan job background; job menulis file backup + kirim Telegram.
 */
'use strict';

const cron = require('node-cron');

const { isValidCron } = require('../shared');
const { getBackupSettings, runBackupAll } = require('../../olt-backup');

let cronTaskOltBackup = null;
let isRunning = false;

/**
 * Jadwalkan (ulang) task auto-backup OLT berdasarkan config.json olt.backup.
 * Aman dipanggil berkali-kali (task lama di-stop dulu).
 */
function initOltBackupTask() {
    if (cronTaskOltBackup) {
        cronTaskOltBackup.stop();
        cronTaskOltBackup = null;
    }

    const settings = getBackupSettings();
    if (!settings.enabled) {
        console.log('[CRON_OLT_BACKUP] Auto-backup OLT DISABLED');
        return;
    }
    if (!isValidCron(settings.schedule)) {
        console.error(`[CRON_OLT_BACKUP_ERROR] Cron expression tidak valid: "${settings.schedule}". Job tidak dijalankan.`);
        return;
    }

    console.log(`[CRON_OLT_BACKUP] Auto-backup OLT aktif, jadwal: ${settings.schedule}`);
    cronTaskOltBackup = cron.schedule(settings.schedule, async () => {
        if (isRunning) {
            console.warn('[CRON_OLT_BACKUP] Run sebelumnya masih berjalan — skip siklus ini');
            return;
        }
        isRunning = true;
        console.log(`[CRON_OLT_BACKUP] Mulai backup OLT terjadwal ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        try {
            const { okCount, failCount } = await runBackupAll();
            console.log(`[CRON_OLT_BACKUP] Selesai: ✅ ${okCount} • ❌ ${failCount}`);
        } catch (error) {
            console.error('[CRON_OLT_BACKUP] ❌ Gagal:', error.message);
        } finally {
            isRunning = false;
        }
    }, { scheduled: true, timezone: 'Asia/Jakarta' });
    cronTaskOltBackup.start();
}

/** Alias eksplisit untuk route setting (semantik "restart setelah config berubah"). */
function restartOltBackupTask() {
    initOltBackupTask();
}

module.exports = { initOltBackupTask, restartOltBackupTask };
