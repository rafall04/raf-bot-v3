/**
 * Header Doc
 * Purpose: SUMBER TUNGGAL teks struk "tagihan LUNAS" yang dibaca pelanggan. Sebelum modul ini ada,
 *   empat jalur pelunasan (konfirmasi bukti foto, admin tandai lunas di dashboard, bayar online
 *   Tripay/Mayar, callback iPaymu) masing-masing merangkai pesannya sendiri — tiga template berbeda,
 *   dua store template berbeda, bahkan dua format rupiah berbeda ("Rp 125.000" vs "Rp. 125.000,00").
 *   Pelanggan yang sama bisa menerima dua bentuk struk yang tak mirip. Semua jalur kini memanggil
 *   `buildPaidReceiptText` dan merender template TUNGGAL `tagihan_struk_lunas`.
 * Caller: services/payment-proof.service.js, lib/approval-logic.js, routes/bill-payment.js,
 *   routes/public.js.
 * Deps: lib/templating (renderTemplate → database/message_templates.json).
 * MainFuncs: buildPaidReceiptText, formatRupiah, formatPeriode, formatWaktu, resolveStatusLayanan.
 * SideEffects: Tidak ada (murni merangkai string).
 */
"use strict";

const { renderTemplate } = require("../templating");

const TEMPLATE_KEY = "tagihan_struk_lunas";
const STATUS_REAKTIVASI = "⚡ Layanan Anda sudah aktif kembali.";

/** Format rupiah kanonik: "Rp 125.000" (tanpa sen — jangan pakai rupiah-format yang memberi ",00"). */
function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

/** "Juli 2026". Tanpa periode → bulan berjalan. */
function formatPeriode(periodMonth, periodYear) {
    const date = (periodMonth && periodYear)
        ? new Date(periodYear, periodMonth - 1, 1)
        : new Date();
    return date.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}

/** "10 Juli 2026 14.31 WIB" (TZ proses dipaksa Asia/Jakarta di index.js). */
function formatWaktu(paidAt) {
    const parsed = paidAt ? new Date(paidAt) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    return `${date.toLocaleString("id-ID", {
        day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
    })} WIB`;
}

/**
 * Baris status layanan hanya diisi bila reaktivasi BENAR-BENAR berhasil — jangan mengklaim
 * "aktif kembali" untuk pelanggan yang memang tak pernah terisolir, atau saat reaktivasi gagal.
 * Menerima objek reaktivasi (`{attempted, ok}` dari bill-payment-settlement) atau boolean.
 */
function resolveStatusLayanan(reactivation) {
    if (reactivation === true) return STATUS_REAKTIVASI;
    if (!reactivation || typeof reactivation !== "object") return "";
    return reactivation.attempted && reactivation.ok ? STATUS_REAKTIVASI : "";
}

/**
 * @param {object} input
 * @param {object} input.user - butuh `name` + `subscription`.
 * @param {number} input.amount - nominal yang dibayar.
 * @param {number} [input.periodMonth]
 * @param {number} [input.periodYear]
 * @param {string} input.method - "Transfer Bank" | "Tunai" | "QRIS" | "Tripay" | "Mayar" | ...
 * @param {string|Date} [input.paidAt] - default: sekarang.
 * @param {string} [input.refId] - nomor rujukan yang bisa disebut pelanggan (kode bukti, reffId,
 *   id payment_history). "-" bila memang tak ada.
 * @param {object|boolean} [input.reactivation]
 * @returns {string} teks struk siap kirim.
 */
function buildPaidReceiptText({
    user,
    amount,
    periodMonth,
    periodYear,
    method,
    paidAt,
    refId,
    reactivation
} = {}) {
    const account = user || {};
    return renderTemplate(TEMPLATE_KEY, {
        // Nama pemilik akun dari DB — BUKAN pushname WhatsApp, karena ini dokumen tagihan.
        nama_pelanggan: account.name || "Pelanggan",
        nama_paket: account.subscription || "-",
        harga: formatRupiah(amount),
        metode: method || "-",
        periode: formatPeriode(periodMonth, periodYear),
        waktu: formatWaktu(paidAt),
        no_ref: refId ? String(refId) : "-",
        status_layanan: resolveStatusLayanan(reactivation)
    });
}

/**
 * Struk CICILAN — untuk pembayaran SEBAGIAN.
 *
 * `buildPaidReceiptText` hanya untuk periode yang LUNAS PENUH, dan notifikasi pelanggan memang
 * cuma dipasang di callback `onFinalPaid`. Akibatnya pelanggan yang membayar sebagian tidak
 * menerima apa pun: tak ada tanda terima, tak ada sisa tagihan. Besoknya ia mengetik "cek tagihan"
 * dan melihat "BELUM LUNAS" dengan nominal PENUH — dari sisinya, uangnya seperti hilang.
 *
 * Dipisah dari struk lunas karena isinya beda secara semantik (ada SISA yang masih harus dibayar),
 * tapi memakai formatter yang sama supaya bentuk rupiah/periode/waktu tetap seragam.
 */
function buildPartialPaymentReceiptText({
    user,
    amountPaid,
    amountRemaining,
    periodMonth,
    periodYear,
    method,
    paidAt,
    refId
} = {}) {
    const account = user || {};
    const data = {
        nama_pelanggan: account.name || "Pelanggan",
        nama_paket: account.subscription || "-",
        jumlah_dibayar: formatRupiah(amountPaid),
        sisa_tagihan: formatRupiah(amountRemaining),
        metode: method || "-",
        periode: formatPeriode(periodMonth, periodYear),
        waktu: formatWaktu(paidAt),
        no_ref: refId ? String(refId) : "-"
    };

    const teks = renderTemplate("tagihan_struk_cicilan", data);

    // PENJAGA: `renderTemplate` TIDAK memulangkan string kosong saat key tak ada — ia memulangkan
    // kalimat `Error: Template "..." not found. Please check message_templates.json.` (templating.js).
    // `database/message_templates.json` di produksi adalah berkas MERGE-KEY, jadi key baru belum tentu
    // sudah ada di sana saat kode ini jalan. Tanpa penjaga ini, pelanggan yang baru menyerahkan uang
    // menerima teks error mentah sebagai "struk" — lebih buruk daripada tidak dikirim sama sekali.
    if (!teks || /^Error: Template/i.test(String(teks))) {
        return [
            "✅ *PEMBAYARAN DITERIMA*",
            "",
            `Halo Kak *${data.nama_pelanggan}*, pembayaran Anda sudah kami terima. Terima kasih! 🙏`,
            "",
            `• Periode : ${data.periode}`,
            `• Dibayar : *${data.jumlah_dibayar}*`,
            `• *Sisa tagihan* : *${data.sisa_tagihan}*`,
            `• Metode  : ${data.metode}`,
            `• No. Ref : ${data.no_ref}`,
            "",
            "Sisa tagihan di atas masih perlu dilunasi ya Kak. Kalau sudah dibayar, kirimkan foto buktinya di sini."
        ].join("\n");
    }

    return teks;
}

module.exports = {
    buildPaidReceiptText,
    buildPartialPaymentReceiptText,
    formatRupiah,
    formatPeriode,
    formatWaktu,
    resolveStatusLayanan,
    TEMPLATE_KEY
};
