/**
 * Header Doc
 * Purpose: Mengirim RINGKASAN UANG terjadwal ke grup kas usaha (pemasukan, perkiraan omset,
 *          tunggakan, pengeluaran, sisa bersih) — supaya pemilik tak perlu membuka halaman
 *          untuk tahu keadaan kas.
 *          Angkanya DIBACA dari `lib/services/money-summary` (yang membaca owner-cockpit +
 *          buku besar). Job ini tidak menghitung dan tidak menulis apa pun.
 * Caller: `lib/cron.js` (`initializeAllCronTasks`) dan endpoint sakelar kas usaha
 *         (`routes/admin-kas-usaha-routes.js`) yang menjadwalkan ulang saat setelan berubah.
 * Deps: `node-cron`, `../shared` (isValidCron + safeSendMessage), `../../services/money-summary`.
 * MainFuncs: `initMoneyDigestTask`, `kirimRingkasan`.
 * SideEffects: Mengirim satu pesan WA ke grup kas. Tidak menyentuh DB.
 */
"use strict";

const cron = require("node-cron");
const { isValidCron, safeSendMessage } = require("../shared");

// Pagi, setelah pengingat biaya rutin (08:05) supaya dua pesan tak menumpuk di detik yang sama.
const JADWAL_BAWAAN = "20 8 * * *";

let task = null;
let sedangJalan = false;

/**
 * Kirim satu ringkasan. Dipisah dari penjadwal supaya bisa dipanggil manual/diuji.
 * NON-THROWING: kegagalan di sini tak boleh menjatuhkan cron lain.
 */
async function kirimRingkasan(deps = {}) {
    const cfg = (global.config && global.config.businessExpense) || {};
    if (cfg.enabled !== true || !cfg.groupId) {
        return { ok: false, alasan: "kas usaha OFF atau grup belum dipilih" };
    }

    const kirim = deps.safeSendMessage || safeSendMessage;
    const ms = deps.moneySummary || require("../../services/money-summary");

    try {
        const data = await ms.buildMoneySummary();
        const teks = ms.buildMoneySummaryText(data, { judul: "HARI INI" });
        const hasil = await kirim(cfg.groupId, teks, { skipDuplicateCheck: true });
        // Ringkasan hari berikutnya isinya berbeda, jadi tak ada yang perlu ditandai —
        // gagal kirim cukup dilaporkan, bukan diulang (besok ada ringkasan baru).
        return { ok: !(hasil && hasil.success === false), terkirim: !(hasil && hasil.success === false) };
    } catch (e) {
        console.error("[CRON_RINGKASAN_UANG_ERROR]", e && e.message);
        return { ok: false, alasan: e && e.message };
    }
}

/** Aman dipanggil berkali-kali (task lama di-stop dulu). */
function initMoneyDigestTask() {
    if (task) {
        task.stop();
        task = null;
    }

    const cfg = (global.config && global.config.businessExpense) || {};
    // Sengaja OPT-IN terpisah dari `enabled`: sebagian pemilik mau mencatat kas di grup tapi
    // tak mau menerima ringkasan harian.
    if (cfg.enabled !== true || cfg.digest !== true) {
        console.log("[CRON_RINGKASAN_UANG] Ringkasan uang tidak dijadwalkan (kas OFF atau digest OFF)");
        return;
    }

    const jadwal = typeof cfg.digestSchedule === "string" && cfg.digestSchedule.trim()
        ? cfg.digestSchedule.trim()
        : JADWAL_BAWAAN;

    if (!isValidCron(jadwal)) {
        console.error(`[CRON_RINGKASAN_UANG_ERROR] Jadwal tidak valid: "${jadwal}". Job tidak dijalankan.`);
        return;
    }

    console.log(`[CRON_RINGKASAN_UANG] Ringkasan uang aktif, jadwal: ${jadwal}`);
    task = cron.schedule(jadwal, async () => {
        if (sedangJalan) {
            console.warn("[CRON_RINGKASAN_UANG] Siklus sebelumnya masih berjalan — dilewati");
            return;
        }
        sedangJalan = true;
        try {
            const r = await kirimRingkasan();
            if (r.terkirim) console.log("[CRON_RINGKASAN_UANG] Ringkasan terkirim");
        } catch (e) {
            console.error("[CRON_RINGKASAN_UANG_ERROR]", e && e.message);
        } finally {
            sedangJalan = false;
        }
    });
}

module.exports = { initMoneyDigestTask, kirimRingkasan, JADWAL_BAWAAN };
