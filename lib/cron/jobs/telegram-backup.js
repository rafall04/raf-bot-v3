/**
 * Header Doc
 * Purpose: Cron job backup Telegram — periodically eksekusi `performDatabaseBackup` untuk kirim file backup ke chat Telegram. Default schedule jam 4 pagi (`0 4 * * *`). State holder `cronTaskTelegramBackup` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initTelegramBackupTask`.
 * Deps: `node-cron`, `../shared` (isValidCron), `../../telegram-backup` (performDatabaseBackup, getTelegramConfig).
 * MainFuncs: `initTelegramBackupTask(config)` — schedule/restart task backup Telegram berdasarkan config.
 * SideEffects: Jadwalkan job background, panggil `performDatabaseBackup` (write file + push ke Telegram bot).
 */
"use strict";

const cron = require('node-cron');

const { isValidCron } = require('../shared');
const { performDatabaseBackup, getTelegramConfig } = require('../../telegram-backup');

let cronTaskTelegramBackup = null;

function initTelegramBackupTask(config) {
    if (cronTaskTelegramBackup) {
        cronTaskTelegramBackup.stop();
        cronTaskTelegramBackup = null;
    }

    // Get schedule from cron config, default jam 4 pagi
    const schedule = config.schedule_telegram_backup || '0 4 * * *';
    const isEnabled = config.status_telegram_backup === true;

    // Check if disabled
    if (!isEnabled || schedule.startsWith('#')) {
        console.log(`[CRON_TELEGRAM_BACKUP] Telegram backup task is DISABLED`);
        return;
    }

    // Validate the schedule
    if (!isValidCron(schedule)) {
        console.error(`[CRON_TELEGRAM_BACKUP_ERROR] Invalid cron expression: "${schedule}". Job not started.`);
        return;
    }

    // Check Telegram config
    const telegramConfig = getTelegramConfig();
    if (!telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId) {
        console.log(`[CRON_TELEGRAM_BACKUP] Telegram backup tidak aktif atau belum dikonfigurasi`);
        return;
    }

    console.log(`[CRON_TELEGRAM_BACKUP] Starting backup task with schedule: ${schedule}`);

    cronTaskTelegramBackup = cron.schedule(schedule, async () => {
        console.log(`[CRON_TELEGRAM_BACKUP] Executing scheduled backup at ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);

        try {
            const result = await performDatabaseBackup();
            if (result.success) {
                console.log(`[CRON_TELEGRAM_BACKUP] ✅ Backup completed successfully`);
            } else {
                console.error(`[CRON_TELEGRAM_BACKUP] ⚠️ Backup completed with issues: ${result.message}`);
            }
        } catch (error) {
            console.error(`[CRON_TELEGRAM_BACKUP] ❌ Backup failed:`, error.message);
        }
    }, {
        scheduled: true,
        timezone: "Asia/Jakarta"
    });

    cronTaskTelegramBackup.start();
    console.log(`[CRON_TELEGRAM_BACKUP] ✅ Task started successfully!`);
}

module.exports = {
    initTelegramBackupTask
};
