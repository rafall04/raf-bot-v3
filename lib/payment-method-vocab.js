/**
 * Header Doc
 * Purpose: Satu pemilik kosakata metode pembayaran — menormalkan ejaan yang beragam di
 *          kolom `payment_method` menjadi ember baku, dan memetakan balik ember → semua
 *          ejaannya untuk keperluan penyaringan.
 * Caller: `routes/rekap-keuangan.js` (kartu ringkasan + filter), `lib/financial-ledger.js`.
 * Deps: tidak ada (murni).
 * MainFuncs: `normalisasiMetode`, `ejaanUntukEmber`, `EMBER_BAKU`, `LABEL_EMBER`.
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — kolom `payment_method` diisi oleh banyak penulis yang kosakatanya
 * TIDAK PERNAH diseragamkan, dan itu tak bisa diperbaiki dengan mendisiplinkan penulis
 * saja karena data lama sudah telanjur beragam. Terukur di produksi 2026-08-15:
 *
 *   payment_history / approval  → "CASH", "TRANSFER_BANK"
 *   topup & ledger internal     → "cash", "transfer", "SALDO", "AGENT"
 *   pengeluaran rutin           → "TUNAI", "TRANSFER"   (lib/recurring-expense.js:129
 *                                 memaksa .toUpperCase() atas istilah Indonesia)
 *   gateway                     → "qris", "va", "cstore", "Mayar", "iPaymu (hosted)", "MPM"
 *   pembalikan                  → "REVERSAL"
 *
 * DUA cacat lahir dari situ, keduanya terukur:
 *  1. Kartu "per metode" di /rekap-keuangan MENIMPA ember yang bertabrakan. Di
 *     Tanjungharjo "TRANSFER_BANK" (69 transaksi, Rp8.985.000) ditimpa "transfer"
 *     (1 transaksi, Rp10.000) — layar menampilkan Rp10.000.
 *  2. Filter "Metode" hanya mencocokkan SATU ejaan persis, jadi memilih "Cash" tak
 *     menemukan baris "cash" maupun "TUNAI".
 *
 * Karena itu normalisasi HARUS dipakai bersama oleh peringkas dan penyaring: kalau
 * keduanya punya peta sendiri, keduanya akan menyimpang lagi.
 */
"use strict";

// Ember baku yang punya arti bisnis. Urutannya = urutan tampil di kartu ringkasan.
const EMBER_BAKU = ["cash", "transfer", "topup", "saldo", "agent", "payroll", "online", "reversal"];

const LABEL_EMBER = {
    cash: "Tunai",
    transfer: "Transfer Bank",
    topup: "Topup",
    saldo: "Saldo",
    agent: "Agen",
    payroll: "Payroll Internal",
    online: "Pembayaran Online",
    reversal: "Pembalikan",
};

// Ejaan yang BENAR-BENAR pernah tersimpan → ember. Ditulis huruf kecil; pencocokan
// dilakukan setelah trim + lowercase, sehingga "CASH"/"Cash"/"cash" cukup satu baris.
const PETA_EJAAN = {
    // tunai
    cash: "cash",
    tunai: "cash",
    // transfer bank
    transfer: "transfer",
    transfer_bank: "transfer",
    bank_transfer: "transfer",
    "transfer bank": "transfer",
    // saldo & agen
    saldo: "saldo",
    topup: "topup",
    agent: "agent",
    agen: "agent",
    internal_payroll: "payroll",
    payroll: "payroll",
    // gateway / pembayaran online — semuanya satu ember supaya tak berserak
    qris: "online",
    va: "online",
    cstore: "online",
    mpm: "online",
    mayar: "online",
    tripay: "online",
    ipaymu: "online",
    "ipaymu (hosted)": "online",
    // pembalikan
    reversal: "reversal",
};

/**
 * Mengembalikan ember baku untuk sebuah nilai `payment_method`.
 * Nilai kosong/null → `null` (pemanggil yang memutuskan cara menampilkannya).
 * Ejaan tak dikenal dikembalikan apa adanya (lowercase) — SENGAJA tidak dipaksa ke
 * ember "lain-lain", supaya metode baru tetap terlihat oleh pemilik usaha alih-alih
 * lenyap ke dalam satu keranjang yang tak bisa ditelusuri.
 */
function normalisasiMetode(nilai) {
    if (nilai === undefined || nilai === null) return null;
    const teks = String(nilai).trim().toLowerCase();
    if (teks === "") return null;
    return PETA_EJAAN[teks] || teks;
}

/**
 * Kebalikannya: semua ejaan mentah yang menormal ke ember tertentu. Dipakai penyaring
 * agar memilih "Tunai" ikut menangkap "CASH", "cash", dan "TUNAI".
 * Ejaan di luar peta dikembalikan sebagai dirinya sendiri.
 */
function ejaanUntukEmber(ember) {
    const kunci = String(ember || "").trim().toLowerCase();
    if (!kunci) return [];
    const hasil = Object.keys(PETA_EJAAN).filter((e) => PETA_EJAAN[e] === kunci);
    if (!hasil.includes(kunci)) hasil.push(kunci);
    return hasil;
}

module.exports = {
    EMBER_BAKU,
    LABEL_EMBER,
    normalisasiMetode,
    ejaanUntukEmber,
};
