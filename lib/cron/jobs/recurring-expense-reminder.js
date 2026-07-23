/**
 * Header Doc
 * Purpose: Mengirim PENGINGAT biaya rutin usaha ke grup kas pada tanggal jatuh temponya.
 *          Bot TIDAK memposting pengeluaran sendiri — satu baris pengeluaran adalah pernyataan
 *          bahwa uang benar-benar keluar, dan nominal yang meleset menghasilkan pembukuan salah
 *          yang tampak meyakinkan. Pencatatan sebenarnya menunggu balasan `ok` / `ok <nominal>`
 *          / `lewati` di grup (ditangani `message/handlers/business-expense-wa.js`).
 * Caller: `lib/cron.js` (`initializeAllCronTasks`).
 * Deps: `node-cron`, `../shared` (isValidCron + safeSendMessage), `../../recurring-expense`,
 *       `../../../message/handlers/template-helpers` untuk teks yang bisa diedit admin.
 * MainFuncs: `initRecurringExpenseReminderTask`, `kirimPengingat`.
 * SideEffects: Mengirim pesan WA ke grup kas; menandai `last_reminded_period`.
 */
"use strict";

const cron = require("node-cron");
const { isValidCron, safeSendMessage } = require("../shared");
const recurring = require("../../recurring-expense");

// Pagi hari, sekali. Tagihan jatuh tempo tak perlu diingatkan tengah malam.
const JADWAL_BAWAAN = "5 8 * * *";

let task = null;
let sedangJalan = false;

function rupiah(n) {
    return "Rp" + (Number(n) || 0).toLocaleString("id-ID");
}

/**
 * Kirim satu siklus pengingat. Dipisah dari penjadwal supaya bisa dipanggil manual/diuji.
 * NON-THROWING: kegagalan di sini tak boleh menjatuhkan cron lain.
 */
async function kirimPengingat(deps = {}) {
    const cfg = (global.config && global.config.businessExpense) || {};
    if (cfg.enabled !== true || !cfg.groupId) return { ok: false, alasan: "kas usaha OFF atau grup belum dipilih" };

    const kirim = deps.safeSendMessage || safeSendMessage;
    const jatuhTempo = await recurring.jatuhTempoHariIni();
    if (!jatuhTempo.length) return { ok: true, jumlah: 0 };

    const { renderResponseTemplate } = require("../../../message/handlers/template-helpers");
    let terkirim = 0;

    for (const item of jatuhTempo) {
        const teks = renderResponseTemplate(
            "be_pengingat_rutin",
            "🔔 *JATUH TEMPO HARI INI*\n\n" +
                "📌 ${nama}\n💰 Perkiraan ${perkiraan}\n📂 ${kategori}\n\n" +
                "Balas *ok* untuk mencatat sejumlah itu\n" +
                "atau *ok ${contoh}* kalau nominalnya berbeda\n" +
                "atau *lewati* kalau bulan ini tidak ada.",
            {
                nama: item.nama,
                perkiraan: rupiah(item.perkiraan),
                kategori: item.kategori,
                contoh: "620rb",
                id: item.id
            }
        );

        const hasil = await kirim(cfg.groupId, teks, { skipDuplicateCheck: true });
        // Tandai HANYA bila benar-benar terkirim. Kalau WA sedang putus, biarkan tertunda
        // supaya siklus berikutnya mencoba lagi — bukan hilang diam-diam.
        if (hasil && hasil.success !== false) {
            await recurring.tandaiDiingatkan(item.id);
            terkirim += 1;
        }
        if (hasil && hasil.shouldStop) break;
    }
    return { ok: true, jumlah: terkirim, dariTotal: jatuhTempo.length };
}

/** Aman dipanggil berkali-kali (task lama di-stop dulu). */
function initRecurringExpenseReminderTask() {
    if (task) {
        task.stop();
        task = null;
    }

    const cfg = (global.config && global.config.businessExpense) || {};
    if (cfg.enabled !== true) {
        console.log("[CRON_KAS_RUTIN] Kas usaha OFF — pengingat biaya rutin tidak dijadwalkan");
        return;
    }

    const jadwal = typeof cfg.reminderSchedule === "string" && cfg.reminderSchedule.trim()
        ? cfg.reminderSchedule.trim()
        : JADWAL_BAWAAN;

    if (!isValidCron(jadwal)) {
        console.error(`[CRON_KAS_RUTIN_ERROR] Jadwal tidak valid: "${jadwal}". Job tidak dijalankan.`);
        return;
    }

    console.log(`[CRON_KAS_RUTIN] Pengingat biaya rutin aktif, jadwal: ${jadwal}`);
    task = cron.schedule(jadwal, async () => {
        if (sedangJalan) {
            console.warn("[CRON_KAS_RUTIN] Siklus sebelumnya masih berjalan — dilewati");
            return;
        }
        sedangJalan = true;
        try {
            const r = await kirimPengingat();
            if (r.jumlah) console.log(`[CRON_KAS_RUTIN] ${r.jumlah}/${r.dariTotal} pengingat terkirim`);
        } catch (e) {
            console.error("[CRON_KAS_RUTIN_ERROR]", e.message);
        } finally {
            sedangJalan = false;
        }
    });
}

module.exports = { initRecurringExpenseReminderTask, kirimPengingat, JADWAL_BAWAAN };
