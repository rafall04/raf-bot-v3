/**
 * Header Doc
 * Purpose: Helper MURNI untuk penjadwalan ganti paket TERTUNDA (BAGIAN 1, opsi B: harga & kecepatan
 *   paket baru mulai SIKLUS BERIKUTNYA, bukan seketika). Menghitung tanggal-berlaku = awal bulan
 *   kalender berikutnya (Asia/Jakarta) — batas yang sama dengan reset periode billing (set-unpaid tgl 1
 *   & rollover akhir-bulan). TANPA efek samping; keputusan apply ada di cron rollover + admin.service.
 * Caller: services/admin.service.js (cabang approve), routes/change-package.js (ubah langsung),
 *   lib/cron/jobs/package-change-rollover.js (cek jatuh tempo).
 * Deps: Tidak ada (TZ proses = Asia/Jakarta, index.js).
 * MainFuncs: isDeferEnabled, computeNextCycleEffective, isDue, formatTanggalWIB.
 * SideEffects: Tidak ada.
 */
"use strict";

/** Gate fitur. OFF (default) = perilaku lama (apply seketika). */
function isDeferEnabled(config = (typeof global !== "undefined" ? global.config : null)) {
    const c = (config && config.packageChangeDeferred) || {};
    return c.enabled === true;
}

/**
 * Tanggal-berlaku paket baru = awal bulan KALENDER berikutnya, 00:00 waktu Jakarta.
 * TZ proses dipaksa Asia/Jakarta (index.js), jadi konstruksi Date lokal = WIB.
 * @param {Date} [now]
 * @returns {string} ISO instant (mis. "2026-09-30T17:00:00.000Z" = 1 Okt 00:00 WIB)
 */
function computeNextCycleEffective(now = new Date()) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    return d.toISOString();
}

/** Apakah tanggal-berlaku sudah tiba (instant-based; aman lintas TZ). */
function isDue(effectiveDateISO, now = Date.now()) {
    const t = Date.parse(effectiveDateISO);
    return Number.isFinite(t) && t <= (typeof now === "number" ? now : now.getTime());
}

/** "1 Oktober 2026" (WIB) untuk pesan ke pelanggan/teknisi. */
function formatTanggalWIB(effectiveDateISO) {
    const t = Date.parse(effectiveDateISO);
    if (!Number.isFinite(t)) return "-";
    return new Date(t).toLocaleDateString("id-ID", {
        day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta",
    });
}

module.exports = { isDeferEnabled, computeNextCycleEffective, isDue, formatTanggalWIB };
