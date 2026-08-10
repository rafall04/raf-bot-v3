/**
 * Header Doc
 * Purpose: Membuat DRAFT payroll bulan berjalan untuk teknisi yang gaji pokoknya tetap, supaya
 *          nominal yang sama tiap bulan tak perlu diketik ulang 12x setahun. Berhenti di draft —
 *          finalisasi dan pembayaran tetap klik manusia, karena di situlah uang berpindah dan
 *          struk WhatsApp terkirim.
 * Caller: `lib/cron.js` (`initializeAllCronTasks`), dan `routes/gaji.js` saat sakelar diubah
 *          (penjadwalan ulang — tanpa itu sakelarnya sukses semu sampai `pm2 restart`).
 * Deps: `node-cron`, `../shared` (isValidCron), `../../technician-salary-plan`.
 * MainFuncs: `initTechnicianSalaryDraftTask`, `JADWAL_BAWAAN`.
 * SideEffects: Menulis baris draft `technician_gaji` + penanda periode; kabar ke grup kas.
 */
"use strict";

const cron = require("node-cron");
const { isValidCron } = require("../shared");
const salaryPlan = require("../../technician-salary-plan");

// HARIAN, bukan bulanan. Gerbang tanggalnya ada di dalam fungsi inti dan berbunyi ">= tanggal
// pemicu", jadi satu restart tepat di menitnya tak menghilangkan satu bulan penuh — node-cron
// tidak mengejar tick yang terlewat, dan produksi ini restart 7-13x/hari.
const JADWAL_BAWAAN = "20 7 * * *";

let task = null;
let sedangJalan = false;

async function jalankanSiklus() {
    if (sedangJalan) return { ok: false, alasan: "siklus sebelumnya masih berjalan" };
    sedangJalan = true;
    try {
        const hasil = await salaryPlan.createDraftsForPeriod({});
        if (hasil.dijalankan) {
            console.log(`[CRON_GAJI_TETAP] ${hasil.periode}: ${hasil.dibuat} dibuat, ${hasil.sudahAda} sudah ada, ${hasil.dilewati} dilewati`);
        }
        return hasil;
    } catch (error) {
        console.error("[CRON_GAJI_TETAP_ERROR]", error.message);
        return { ok: false, alasan: error.message };
    } finally {
        sedangJalan = false;
    }
}

function initTechnicianSalaryDraftTask() {
    // Hentikan dulu supaya penjadwalan ulang saat sakelar diubah tak meninggalkan task kembar.
    if (task) {
        task.stop();
        task = null;
    }

    const cfg = salaryPlan.setelan();
    if (!cfg.autoDraft) {
        console.log("[CRON_GAJI_TETAP] Draft otomatis MATI (config.technicianSalary.autoDraft)");
        return null;
    }

    const jadwal = isValidCron(cfg.draftSchedule) ? cfg.draftSchedule : JADWAL_BAWAAN;
    task = cron.schedule(jadwal, jalankanSiklus, { timezone: "Asia/Jakarta" });
    console.log(`[CRON_GAJI_TETAP] Aktif — jadwal '${jadwal}', pemicu tanggal ${cfg.draftDay}`);
    return task;
}

module.exports = { initTechnicianSalaryDraftTask, jalankanSiklus, JADWAL_BAWAAN };
