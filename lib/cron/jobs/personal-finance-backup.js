/**
 * Header Doc
 * Purpose: Menjadwalkan backup LOKAL data keuangan pribadi. Ada karena DB ini SENGAJA
 *          dikeluarkan dari backup Telegram (tujuannya grup multi-anggota), sehingga tanpa
 *          salinan lokal satu kesalahan menghapusnya PERMANEN — terbukti 2026-07-23 ketika
 *          catatan pemilik ikut terhapus oleh skrip pembersih data uji dan tak ada apa pun
 *          untuk memulihkannya.
 *          Salinan tak pernah meninggalkan server; itu justru syaratnya.
 * Caller: `lib/cron.js` (`initializeAllCronTasks`).
 * Deps: `node-cron`, `../shared.isValidCron`, `../../personal-finance-backup`.
 * MainFuncs: `initPersonalFinanceBackupTask`.
 * SideEffects: Menjadwalkan cron; menulis berkas di `backups/keuangan-pribadi/`.
 */
"use strict";
const log = require('../../logger').logger.child('PERSONAL_FINANCE_BACKUP');


const cron = require("node-cron");
const { isValidCron } = require("../shared");
const { jalankanBackupDompet } = require("../../personal-finance-backup");

// Tiap 6 jam. Catatan keuangan ditulis beberapa kali sehari, jadi kehilangan maksimal
// beberapa jam — cukup rapat tanpa membuat puluhan berkas per hari.
const JADWAL_BAWAAN = "17 */6 * * *";

let task = null;
let sedangJalan = false;

/** Aman dipanggil berkali-kali (task lama di-stop dulu), seperti job cron lain di repo ini. */
function initPersonalFinanceBackupTask() {
    if (task) {
        task.stop();
        task = null;
    }

    const cfg = (global.config && global.config.personalFinance) || {};
    // Ikut gate fiturnya: kalau dompet tak dipakai, tak ada yang perlu dibackup.
    if (cfg.enabled !== true) {
        log.info("[CRON_PF_BACKUP] Dompet pribadi OFF — backup tidak dijadwalkan");
        return;
    }

    const jadwal = typeof cfg.backupSchedule === "string" && cfg.backupSchedule.trim()
        ? cfg.backupSchedule.trim()
        : JADWAL_BAWAAN;

    if (!isValidCron(jadwal)) {
        log.error(`[CRON_PF_BACKUP_ERROR] Jadwal tidak valid: "${jadwal}". Job tidak dijalankan.`);
        return;
    }

    log.info(`[CRON_PF_BACKUP] Backup lokal dompet aktif, jadwal: ${jadwal}`);
    task = cron.schedule(jadwal, async () => {
        if (sedangJalan) {
            log.warn("[CRON_PF_BACKUP] Siklus sebelumnya masih berjalan — dilewati");
            return;
        }
        sedangJalan = true;
        try {
            // NON-THROWING di dalam: kegagalan backup tak boleh menjatuhkan proses bot.
            const hasil = await jalankanBackupDompet();
            if (hasil.ok) log.info(`[CRON_PF_BACKUP] OK → ${hasil.berkas}`);
            else log.warn(`[CRON_PF_BACKUP] Dilewati: ${hasil.alasan}`);
        } finally {
            sedangJalan = false;
        }
    });
}

module.exports = { initPersonalFinanceBackupTask, JADWAL_BAWAAN };
