"use strict";

/**
 * Header Doc
 * Purpose: Menjalankan otorisasi massal sebagai PEKERJAAN LATAR. Sebelumnya seluruh proses
 *   berjalan di dalam satu permintaan HTTP yang diblokir, dibatasi 20 pelanggan sekali klik —
 *   dan tiap pelanggan menembak MikroTik (ubah profil + putus sesi PPPoE) secara berurutan,
 *   jadi operator menatap spinner lalu harus mengklik lagi untuk 20 berikutnya.
 *
 *   Yang berubah: permintaan balik SEKETIKA, seluruh pending diantre, dan hasil per pelanggan
 *   ditulis SEGERA sehingga halaman otorisasi bisa menampilkannya sebagai log. Kegagalan satu
 *   pelanggan tak menghentikan sisanya.
 *
 *   TIDAK diparalelkan: tiap item menyentuh router yang sama dan mencatat uang. Percepatannya
 *   datang dari operator yang tak lagi menunggu, bukan dari menembak router berbarengan.
 * Caller: `routes/requests.js` (enqueue + baca log), `lib/app-runtime.js` (start worker).
 * Deps: `repositories/approval-job.repository`, `services/payment-approval.service`,
 *   `lib/database` (loadJSON), `lib/env-config`.
 * MainFuncs: `enqueueBulkApproval`, `tickOnce`, `startBulkApprovalWorker`, `aktif`.
 * SideEffects: Menulis `database/approval_jobs.sqlite`; memproses persetujuan (uang + MikroTik +
 *   WhatsApp) lewat jalur `paymentApprovalService` yang SAMA dengan alur lama.
 */

const repo = require("../repositories/approval-job.repository");

let berjalan = false;
let timer = null;

function setelan() {
    const cfg = (global.config && global.config.bulkApprovalJob) || {};
    return {
        enabled: cfg.enabled === true,
        tickMs: Number(cfg.tickMs) > 0 ? Number(cfg.tickMs) : 5000,
        itemDelayMs: Number(cfg.itemDelayMs) >= 0 ? Number(cfg.itemDelayMs) : 0,
        maxItemsPerJob: Number(cfg.maxItemsPerJob) > 0 ? Number(cfg.maxItemsPerJob) : 500
    };
}

function aktif() {
    return setelan().enabled;
}

function buatIdJob() {
    return `BAJ-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/**
 * Mengantre pekerjaan. Berjalan di dalam siklus HTTP tapi hanya menulis baris antrean, jadi
 * selesai dalam hitungan milidetik — tak ada lagi penantian di depan spinner.
 */
async function enqueueBulkApproval({ requestIds, actor, deps = {} }) {
    const cfg = setelan();
    const aktifSekarang = await repo.getActiveJob();
    if (aktifSekarang) {
        // Jangan pernah membuat pekerjaan kedua: dua worker yang menyetujui daftar yang sama
        // adalah cara paling mudah membuat pelanggan diproses dua kali.
        return { ok: false, reason: "sedang_berjalan", job: aktifSekarang };
    }

    const loadJSON = deps.loadJSON || require("../lib/database").loadJSON;
    const semua = loadJSON("database/requests.json") || [];
    const peta = new Map(semua.map((r) => [String(r.id), r]));
    const users = (global.users || []);

    const items = [];
    for (const id of requestIds.slice(0, cfg.maxItemsPerJob)) {
        const req = peta.get(String(id));
        if (!req) {
            items.push({ requestId: id, userName: null, status: "skipped" });
            continue;
        }
        const user = users.find((u) => String(u.id) === String(req.userId));
        const nama = (user && user.name) || `Pelanggan #${req.userId}`;
        // Status dibaca ULANG di sini, bukan dipercaya dari layar: daftar di browser bisa
        // sudah basi beberapa menit.
        items.push({
            requestId: id,
            userName: nama,
            status: req.status === "pending" ? "pending" : "skipped"
        });
    }

    if (items.length === 0) {
        return { ok: false, reason: "kosong" };
    }

    const id = buatIdJob();
    const job = await repo.createJob({ id, actorUsername: actor && actor.username, items });
    const dilewati = items.filter((i) => i.status !== "pending").length;
    console.log(`[OTORISASI_JOB] ${id} diantre: ${items.length} item (${dilewati} langsung dilewati) oleh ${actor && actor.username}`);
    return { ok: true, job, total: items.length, antre: items.length - dilewati };
}

/**
 * Satu putaran worker: ambil pekerjaan, kerjakan item-itemnya satu per satu sampai habis.
 *
 * Tiap item ditandai `processing` SEBELUM dikerjakan dan hasilnya ditulis SEGERA sesudahnya.
 * Kalau proses mati di tengah, item itu tertinggal `processing` dan `markInterruptedItems`
 * menandainya sebagai perlu-diperiksa-manusia — BUKAN mengulangnya otomatis, karena item yang
 * terputus bisa saja sudah mencatat uang tapi belum sempat menutup requestnya.
 */
async function tickOnce({ approvalService = null, jeda = null } = {}) {
    if (berjalan) return { ok: false, alasan: "tick sebelumnya masih jalan" };
    berjalan = true;
    try {
        const cfg = setelan();
        const job = await repo.claimNextJob();
        if (!job) return { ok: true, idle: true };

        const svc = approvalService || require("./payment-approval.service").createPaymentApprovalService();
        const tidur = jeda || ((ms) => new Promise((r) => setTimeout(r, ms)));
        const disetujui = [];

        for (;;) {
            const item = await repo.nextPendingItem(job.id);
            if (!item) break;

            await repo.markItemProcessing(item.id);
            try {
                // Memanggil jalur persetujuan yang SAMA dengan alur lama, satu id sekali jalan.
                // Tak ada implementasi uang kedua yang bisa menyimpang dari yang pertama.
                const hasil = await svc.bulkApproveRequests({
                    requestIds: [item.request_id],
                    actor: { username: job.actor_username, id: null },
                    skipTechnicianSummary: true
                });
                const r = (hasil && hasil.results) || {};

                if ((r.approved || []).length > 0) {
                    disetujui.push(...r.approved);
                    await repo.finishItem({ jobId: job.id, itemId: item.id, status: "ok", message: "Disetujui" });
                } else if ((r.failed || []).length > 0) {
                    await repo.finishItem({ jobId: job.id, itemId: item.id, status: "failed", message: r.failed[0].reason || "gagal" });
                } else if ((r.notFound || []).length > 0) {
                    await repo.finishItem({ jobId: job.id, itemId: item.id, status: "skipped", message: "Pengajuan tidak ditemukan lagi" });
                } else {
                    await repo.finishItem({ jobId: job.id, itemId: item.id, status: "skipped", message: "Tidak ada perubahan" });
                }
            } catch (error) {
                // Satu pelanggan gagal TIDAK menghentikan sisanya — itu inti dari log ini.
                console.error("[OTORISASI_JOB_ITEM_ERROR]", item.request_id, error && error.message);
                await repo.finishItem({ jobId: job.id, itemId: item.id, status: "failed", message: (error && error.message) || "kesalahan tak terduga" });
            }

            if (cfg.itemDelayMs > 0) await tidur(cfg.itemDelayMs);
        }

        await kirimRingkasanTeknisi(svc, disetujui);
        await repo.finishJob(job.id, "done");
        console.log(`[OTORISASI_JOB] ${job.id} selesai`);
        return { ok: true, jobId: job.id, disetujui: disetujui.length };
    } catch (error) {
        console.error("[OTORISASI_JOB_ERROR]", error && error.message);
        return { ok: false, alasan: error && error.message };
    } finally {
        berjalan = false;
    }
}

/**
 * SATU ringkasan per teknisi di akhir pekerjaan.
 *
 * Kalau dikirim per item, teknisi menerima puluhan pesan beruntun untuk satu klik operator —
 * perilaku anti-spam yang sudah ada di jalur lama harus tetap berlaku di sini.
 */
async function kirimRingkasanTeknisi(svc, disetujui) {
    const digestOn = !!(global.config && global.config.paymentRequestDigest && global.config.paymentRequestDigest.enabled === true);
    if (!digestOn || disetujui.length === 0) return;
    const kirim = svc && svc.__deps && svc.__deps.sendTechnicianBulkSummary;
    if (typeof kirim !== "function") return;

    const perTeknisi = new Map();
    for (const item of disetujui) {
        if (!item.teknisiId) continue;
        if (!perTeknisi.has(item.teknisiId)) perTeknisi.set(item.teknisiId, []);
        perTeknisi.get(item.teknisiId).push({ userName: item.userName });
    }
    for (const [teknisiId, items] of perTeknisi) {
        try {
            await kirim(teknisiId, items);
        } catch (error) {
            console.error("[OTORISASI_JOB_SUMMARY_ERROR]", teknisiId, error && error.message);
        }
    }
}

function startBulkApprovalWorker() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    if (!aktif()) {
        console.log("[OTORISASI_JOB] Pekerjaan latar MATI (config.bulkApprovalJob.enabled)");
        return null;
    }

    // Item yang tertinggal `processing` dari proses sebelumnya ditandai perlu-diperiksa
    // SEBELUM worker mulai lagi.
    repo.markInterruptedItems()
        .then((n) => {
            if (n > 0) console.warn(`[OTORISASI_JOB] ${n} item TERPUTUS oleh restart — ditandai perlu diperiksa manual.`);
        })
        .catch((e) => console.error("[OTORISASI_JOB] Gagal menandai item terputus:", e.message));
    repo.pruneOldJobs().catch(() => {});

    const cfg = setelan();
    timer = setInterval(() => {
        tickOnce().catch((e) => console.error("[OTORISASI_JOB_TICK_ERROR]", e && e.message));
    }, cfg.tickMs);
    if (typeof timer.unref === "function") timer.unref();
    console.log(`[OTORISASI_JOB] Worker aktif — tick tiap ${cfg.tickMs}ms`);
    return timer;
}

module.exports = {
    enqueueBulkApproval,
    tickOnce,
    startBulkApprovalWorker,
    kirimRingkasanTeknisi,
    aktif,
    setelan
};
