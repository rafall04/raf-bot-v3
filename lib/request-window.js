/**
 * Header Doc
 * Purpose: Pemangkas payload GET /api/requests — window `sinceMonths` (pending SELALU ikut, resolved
 *   hanya N bulan terakhir) + hitung status atas himpunan penuh (untuk kartu statistik FE). Dipisah
 *   agar teruji: halaman otorisasi dulu mengunduh SELURUH arsip pengajuan ke browser (berat).
 * Caller: routes/requests.js (GET '/').
 * Deps: Tidak ada.
 * MainFuncs: applyRequestWindow(requests, sinceMonths, nowMs), countByStatus(requests).
 * SideEffects: Tidak ada (murni).
 */
"use strict";

const MS_PER_MONTH = 31 * 24 * 60 * 60 * 1000; // ~1 bulan; sengaja longgar (batas atas, tak memotong terlalu ketat)

/**
 * Kembalikan subset requests dalam window. Tanpa sinceMonths valid (>0) → kembalikan semua (perilaku
 * lama). Pending TAK PERNAH dipangkas (umur berapa pun) supaya otorisasi massal & aksi bulan berjalan
 * tetap lengkap. Resolved (approved/rejected) tanpa tanggal = fail-open (ikut ditampilkan).
 */
function applyRequestWindow(requests, sinceMonths, nowMs = Date.now()) {
    const list = Array.isArray(requests) ? requests : [];
    const n = parseInt(sinceMonths, 10);
    if (!Number.isFinite(n) || n <= 0) return list;
    const cutoff = nowMs - n * MS_PER_MONTH;
    return list.filter((r) => {
        if (!r) return false;
        if (r.status === "pending") return true;
        const t = Date.parse(r.updated_at || r.created_at || "");
        return !Number.isFinite(t) || t >= cutoff;
    });
}

/** Hitung status atas SELURUH himpunan (bukan window) — untuk kartu statistik yang harus akurat. */
function countByStatus(requests) {
    const c = { total: 0, pending: 0, approved: 0, rejected: 0 };
    (Array.isArray(requests) ? requests : []).forEach((r) => {
        if (!r) return;
        c.total += 1;
        if (r.status === "pending") c.pending += 1;
        else if (r.status === "approved") c.approved += 1;
        else if (r.status === "rejected") c.rejected += 1;
    });
    return c;
}

module.exports = { applyRequestWindow, countByStatus };
