/**
 * Header Doc
 * Purpose: REGISTRI feature-flag terkurasi — gate perilaku `config.<...>.enabled` yang selama ini
 *   "deploy gelap" (default OFF) TAPI tak punya toggle web, sehingga hanya bisa dinyalakan lewat SSH
 *   edit config.json (melanggar aturan config-web-not-file → fitur terbayar tak pernah dipetik). Panel
 *   Feature Flags (/feature-flags) membaca + menoggle gate ini lewat jalur config yang aman (atomik +
 *   setConfig hot-reload + re-init cron). SENGAJA TIDAK memuat gate yang SUDAH punya halaman sendiri
 *   (oltLosBroadcast, broadcastGuard, csatSurvey, cctvMonitor, repairNotif, psbIntake, komisi, upstream)
 *   agar tak ada dua sumber kebenaran; juga tak memuat gate infra (butuh kredensial/topologi).
 * Caller: routes/admin-config-routes.js (GET/POST /api/feature-flags), static/js/feature-flags.js.
 * Deps: Tidak ada.
 * MainFuncs: readFlags(config), flagByKey(key), applyFlag(config, key, enabled), getFlagEnabled.
 * SideEffects: Tidak ada (murni; pemanggil yang menulis config).
 */
"use strict";

// path = jalur bersarang menuju boolean gate. label/desc utk UI. restartHint bila perubahan tak hot-reload.
const FEATURE_FLAGS = [
    { key: "teknisiPrefs", path: ["teknisiPrefs", "enabled"], kategori: "Teknisi", label: "Pengaturan Teknisi (self-service)", desc: "Teknisi atur alert/area/kanal sendiri + halaman Pengaturan Saya + `setelan saya`/`alert ...` di WA." },
    { key: "redamanWatch", path: ["redamanWatch", "enabled"], kategori: "Teknisi", label: "Pantau Redaman Live", desc: "Teknisi `pantau redaman` saat perbaikan → update pintar berkala + auto-log tiket." },
    { key: "redamanTerdampak", path: ["redamanTerdampak", "enabled"], kategori: "Teknisi", label: "Daftar Redaman Terdampak", desc: "WA `redaman terdampak` — daftar ONU/pelanggan bermasalah berperingkat." },
    { key: "paymentRequestWa", path: ["paymentRequestWa", "enabled"], kategori: "Pembayaran", label: "Otorisasi Bayar via WA", desc: "Admin `otorisasi`/`setujui`/`tolak`/`setujui semua` pengajuan bayar langsung dari WA." },
    // `worker` = gate ini menggerakkan WORKER latar (bukan cron) yang HANYA distart saat boot; toggle
    // via panel WAJIB memicu resyncWorkerForFlag, kalau tidak job antre selamanya (lihat resyncWorkerForFlag).
    { key: "bulkApprovalJob", path: ["bulkApprovalJob", "enabled"], kategori: "Pembayaran", label: "Otorisasi Massal Tanpa Batas", desc: "Otorisasi seluruh pengajuan (bukan cuma 20) lewat pekerjaan latar — untuk WA & halaman web.", worker: "bulkApprovalJob" },
    { key: "paymentRequestDigest", path: ["paymentRequestDigest", "enabled"], kategori: "Pembayaran", label: "Digest Notif Pengajuan", desc: "Anti-spam: notif pengajuan pertama instan, sisanya diringkas per jendela." },
    { key: "packageChangeDeferred", path: ["packageChangeDeferred", "enabled"], kategori: "Pembayaran", label: "Ganti Paket Berlaku Bulan Depan", desc: "Harga & kecepatan paket baru berlaku siklus berikutnya (bukan seketika)." },
    { key: "postRepairReport", path: ["postRepairReport", "enabled"], kategori: "Teknisi", label: "Laporan Pasca-Perbaikan", desc: "Verifikasi redaman sebelum/sesudah perbaikan + laporan ke grup/teknisi." },
    { key: "rebootAssist", path: ["rebootAssist", "enabled"], kategori: "Pelanggan", label: "Pandu Reboot Modem", desc: "Bot memandu pelanggan reboot modem + verifikasi via uptime PPPoE + eskalasi bila tak pulih." },
    { key: "complaintSignals", path: ["complaintSignals", "enabled"], kategori: "Pelanggan", label: "Deteksi Lonjakan Keluhan", desc: "Alarm dini ke admin bila ≥N pelanggan berbeda mengeluh dalam satu jendela (indikasi gangguan area)." },
    { key: "customerAssistFallback", path: ["customerAssist", "fallback", "enabled"], kategori: "Pelanggan", label: "Balasan Anti-Diam AI", desc: "Jawaban fallback ramah saat pesan pelanggan tak dikenali (menutup pesan 'undefined')." },
    { key: "customerLocationSelfService", path: ["customerLocationSelfService", "enabled"], kategori: "Pelanggan", label: "Pelanggan Kirim Titik Lokasi", desc: "Pelanggan bisa mengirim titik lokasi (share location) untuk pemetaan." },
    { key: "voucherSaleNotif", path: ["voucherSaleNotif", "enabled"], kategori: "Voucher", label: "Notif Penjualan Voucher", desc: "Notifikasi ke admin tiap voucher terjual." },
];

const _byKey = new Map(FEATURE_FLAGS.map((f) => [f.key, f]));

function flagByKey(key) { return _byKey.get(String(key)) || null; }

function getFlagEnabled(config, flag) {
    let cur = config || {};
    for (const seg of flag.path) {
        if (cur == null || typeof cur !== "object") return false;
        cur = cur[seg];
    }
    return cur === true;
}

/** Daftar flag + status enabled saat ini (utk UI). */
function readFlags(config = (typeof global !== "undefined" ? global.config : {})) {
    return FEATURE_FLAGS.map((f) => ({
        key: f.key,
        label: f.label,
        desc: f.desc,
        kategori: f.kategori,
        enabled: getFlagEnabled(config || {}, f),
    }));
}

/** Kembalikan SALINAN config dengan gate flag di-set ke `enabled` (immutable; deep-clone jalur). */
function applyFlag(config, key, enabled) {
    const flag = flagByKey(key);
    if (!flag) throw new Error(`Feature flag tak dikenal: ${key}`);
    const next = { ...(config || {}) };
    let cur = next;
    for (let i = 0; i < flag.path.length - 1; i++) {
        const seg = flag.path[i];
        cur[seg] = { ...(cur[seg] && typeof cur[seg] === "object" ? cur[seg] : {}) };
        cur = cur[seg];
    }
    cur[flag.path[flag.path.length - 1]] = enabled === true;
    return next;
}

/**
 * Setelah gate di-toggle via panel, SINKRONKAN worker latar yang digerakkannya. `startBulkApprovalWorker`
 * hanya dipanggil saat boot (lib/app-runtime.js); tanpa resync ini, menyalakan `bulkApprovalJob` lewat
 * panel membuat rute mengantre job (aktif()=true) padahal TIMER worker tak pernah jalan → job "queued"
 * selamanya + enqueue berikutnya 409 permanen (pembayaran massal mati diam-diam). Fungsi start-nya
 * idempoten & dua-arah: ia clear timer lama, lalu start bila gate ON atau berhenti (return null) bila OFF.
 * LAZY require: jangan tarik service ke graf load feature-flags. never-throw diserahkan ke pemanggil.
 * @returns {boolean} true bila key ini punya worker & sudah di-resync.
 */
function resyncWorkerForFlag(key) {
    const flag = flagByKey(key);
    if (!flag || !flag.worker) return false;
    if (flag.worker === "bulkApprovalJob") {
        const svc = require("../services/bulk-approval-job.service");
        if (svc && typeof svc.startBulkApprovalWorker === "function") svc.startBulkApprovalWorker();
        return true;
    }
    return false;
}

module.exports = { FEATURE_FLAGS, flagByKey, getFlagEnabled, readFlags, applyFlag, resyncWorkerForFlag };
