/**
 * Header Doc
 * Purpose: FUSI status koneksi pelanggan untuk self-service (WA) — gabungkan lapisan FISIK (state
 *          modem OLT: los/dying-gasp/online), SESI (PPPoE MikroTik), dan BILLING (isolir/tagihan)
 *          jadi satu jawaban yang JUJUR & KONSERVATIF. State OLT saja TAK cukup menjawab "kenapa
 *          internet saya mati" — harus difusikan. Lihat docs/olt-modem-state-blueprint.md §9.
 *          FUNGSI MURNI: pemanggil WAJIB memastikan input milik PENGIRIM sendiri (privasi) &
 *          mengambil status dari CACHE (jangan live-poll OLT dari permukaan pelanggan).
 * Caller: handler WA self-service pelanggan / cek-koneksi (menyuplai input yang sudah dikumpulkan).
 * Deps: tidak ada (murni).
 * MainFuncs: `buildCustomerConnectionSummary`.
 * SideEffects: Tidak ada.
 */
"use strict";

/**
 * @param {object} input
 * @param {object|null} input.oltDiagnosis  Hasil buildModemDiagnosis (current_state, verdict) — boleh null.
 * @param {boolean|null} input.pppoeActive  Sesi PPPoE aktif di MikroTik (null = tak diketahui).
 * @param {boolean} input.isolated          Pelanggan sedang isolir (profil ISOLIR).
 * @param {boolean} input.unpaid            Ada tagihan belum lunas (untuk nuansa pesan billing).
 * @returns {{layer, status, headline, detail, can_self_help}}
 */
function buildCustomerConnectionSummary({ oltDiagnosis = null, pppoeActive = null, isolated = false, unpaid = false } = {}) {
    const oltState = oltDiagnosis ? oltDiagnosis.current_state : "unknown";
    const oltDown = oltState === "los" || oltState === "dying_gasp";
    const verdict = oltDiagnosis ? oltDiagnosis.verdict : null;
    const areaAffected = !!(verdict && verdict.code === "area_affected");

    // 1) BILLING/ISOLIR — surface DULU. Bukan masalah jaringan; pelanggan bisa selesaikan dgn bayar.
    if (isolated) {
        return {
            layer: "billing",
            status: "billing",
            headline: "Layanan Anda saat ini dinonaktifkan sementara terkait tagihan.",
            detail: unpaid
                ? "Silakan selesaikan pembayaran; layanan aktif kembali otomatis setelah pembayaran terkonfirmasi."
                : "Bila Anda merasa sudah membayar, mohon kirim bukti pembayaran ke chat ini.",
            can_self_help: true,
        };
    }

    // 2) MODEM FISIK DOWN (LOS / dying-gasp dari OLT) — outage lapisan fisik.
    if (oltDown) {
        if (oltState === "dying_gasp") {
            return {
                layer: "power",
                status: "down",
                headline: areaAffected ? "Terpantau listrik padam di area Anda." : "Perangkat Anda terpantau mati — kemungkinan listrik padam.",
                detail: "Layanan akan pulih otomatis setelah listrik/perangkat menyala kembali.",
                can_self_help: true,
            };
        }
        return {
            layer: "fiber",
            status: "down",
            headline: areaAffected ? "Terpantau gangguan sinyal di area Anda." : "Perangkat Anda terpantau kehilangan sinyal.",
            detail: areaAffected ? "Tim kami sedang menangani gangguan area, mohon ditunggu." : "Teknisi kami akan memeriksa jaringan Anda.",
            can_self_help: false,
        };
    }

    // 3) MODEM UP tapi SESI PPPoE TIDAK aktif → masalah sesi/konfigurasi.
    if (pppoeActive === false) {
        return {
            layer: "session",
            status: "issue",
            headline: "Perangkat Anda menyala, tetapi sesi internet terputus.",
            detail: "Coba matikan lalu nyalakan kembali perangkat/router Anda. Bila tetap, hubungi kami.",
            can_self_help: true,
        };
    }

    // 4) SESI aktif & fisik OK → normal. (PPPoE aktif = sinyal positif terkuat.)
    if (pppoeActive === true) {
        if (verdict && verdict.health === "chronic" && verdict.confidence >= 0.7) {
            return {
                layer: "none",
                status: "ok",
                headline: "Koneksi Anda saat ini normal.",
                detail: verdict.headline_customer, // sudah konservatif (rendering pelanggan)
                can_self_help: true,
            };
        }
        return { layer: "none", status: "ok", headline: "Koneksi Anda terpantau normal.", detail: null, can_self_help: true };
    }

    // 5) Data tak cukup (OLT unknown & PPPoE tak diketahui) — jujur, jangan mengklaim.
    return {
        layer: "unknown",
        status: "unknown",
        headline: "Kami belum dapat memastikan status koneksi Anda saat ini.",
        detail: "Silakan coba beberapa saat lagi atau hubungi kami untuk pengecekan.",
        can_self_help: false,
    };
}

module.exports = { buildCustomerConnectionSummary };
