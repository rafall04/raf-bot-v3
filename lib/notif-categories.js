/**
 * Header Doc
 * Purpose: REGISTRI kategori notifikasi operasional (pola lib/feature-flags) — kontrak KIRIM, bukan
 *   input operator. Dipakai lib/notif-router untuk me-resolve TUJUAN tiap kategori (grup WA vs DM
 *   admin) dan halaman /notif-routing untuk menampilkan pilihannya. Menambah kategori = commit kode
 *   (disengaja: kategori adalah kontrak, sama seperti FEATURE_FLAGS).
 * Caller: lib/notif-router.js, routes/notif-routing-routes.js, static/js/notif-routing.js (via API).
 * Deps: Tidak ada.
 * MainFuncs: listCategories(), categoryByKey(key).
 * SideEffects: Tidak ada.
 */
"use strict";

// defaultSeverity: 'critical' → kirim via sendCritical (retry+dead-letter); 'info' → sendMessage biasa.
const NOTIF_CATEGORIES = [
    { key: "otorisasi_gagal", label: "Otorisasi Bayar Gagal", desc: "Item pengajuan yang GAGAL saat otorisasi massal — butuh tindakan admin.", defaultSeverity: "critical" },
    { key: "payment_request", label: "Pengajuan Pembayaran", desc: "Notifikasi pengajuan pembayaran baru dari teknisi/agen.", defaultSeverity: "info" },
    { key: "network_quality", label: "Kualitas Jaringan", desc: "Alarm kestabilan: upstream/WAN failover, jitter/loss, keluhan area, steering drift.", defaultSeverity: "info" },
    { key: "los_alarm", label: "Alarm LOS / Gangguan", desc: "OLT LOS / mati total / pulih — gangguan fiber/area.", defaultSeverity: "critical" },
    { key: "voucher_sale", label: "Voucher (jual/gagal)", desc: "Voucher terjual atau gagal diproses.", defaultSeverity: "info" },
    { key: "billing_isolir", label: "Billing / Isolir", desc: "Kegagalan cron isolir/set-unpaid/rollover + reaktivasi gagal.", defaultSeverity: "info" },
];

const _byKey = new Map(NOTIF_CATEGORIES.map((c) => [c.key, c]));

function listCategories() {
    return NOTIF_CATEGORIES.map((c) => ({ ...c }));
}

function categoryByKey(key) {
    return _byKey.get(String(key)) || null;
}

module.exports = { NOTIF_CATEGORIES, listCategories, categoryByKey };
