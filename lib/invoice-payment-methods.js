/**
 * Header Doc
 * Purpose: Satu pemilik untuk dua keputusan metode pembayaran di invoice —
 *          (a) METODE MANA yang boleh ditampilkan, dan (b) REKENING MANA yang dipakai.
 * Caller: `lib/pdf-invoice-generator.js` (render), `lib/invoice-generator.js` (snapshot saat
 *          invoice dibuat), `routes/invoice.js` & `lib/approval-logic.js` (perakit data).
 * Deps: tidak ada (murni; sengaja tanpa `global.config` agar renderer tetap bebas efek samping).
 * MainFuncs: `resolveMetodeDitampilkan`, `resolveDaftarRekening`, `NILAI_METODE_SAH`.
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — dua cacat nyata yang terukur di produksi 2026-08-15:
 *
 * 1. SETELAN YANG TAK MENGENDALIKAN APA PUN. Blok "Metode Pembayaran yang Diterima"
 *    menulis "Tunai" sebagai literal telanjang dan mencetak "Transfer Bank" di KEDUA
 *    cabang ternary-nya, sehingga `customization.paymentMethods` hanya menggerbangi teks
 *    "Pembayaran Online". Diukur dengan merender invoice sungguhan INV-20260815-0001:
 *    nilai `cash` (tunai saja) tetap mencetak "Transfer Bank", dan `transfer` (transfer
 *    saja) tetap mencetak "Tunai". Dropdown-nya pun cuma menyediakan 2 dari 4 kombinasi.
 *
 * 2. DUA GUDANG REKENING, INVOICE MEMBACA YANG MATI. Admin mengisi rekening lewat
 *    halaman /config yang menulis `config.bankAccounts` (JAMAK, field `bank`/`number`/`name`)
 *    — dibaca seluruh handler WhatsApp. Invoice justru membaca `config.bankAccount`
 *    (TUNGGAL, field `bankName`/`accountNumber`/`accountName`) yang punya form terpisah dan
 *    hampir tak pernah diisi. Terukur: Tanjungharjo tunggal KOSONG sementara jamak berisi
 *    3 rekening asli (BRI/BCA/DANA) → invoice menyuruh "Transfer Bank" TANPA nomor rekening.
 *    Dander lebih buruk: tunggal masih berisi teks contekan `ISI_BANKNAME` dari
 *    config.example.json, yang akan tercetak apa adanya ke tagihan pelanggan.
 *
 * Karena itu placeholder `ISI_*` dan `Bank Default`/`1234567890` diperlakukan sebagai
 * KOSONG, bukan sebagai data — nilai contekan tak boleh pernah sampai ke pelanggan.
 */
"use strict";

// Nilai sah untuk `pdfCustomization.paymentMethods`. `cash_transfer` dipertahankan sebagai
// bawaan demi config lama yang sudah menyimpannya.
const NILAI_METODE_SAH = ["cash", "transfer", "cash_transfer", "online", "all"];

// Ejaan lain yang pernah/masih mungkin tersimpan. Dipetakan, bukan ditolak, supaya config
// lama tidak diam-diam jatuh ke bawaan tanpa ada yang tahu.
const ALIAS_METODE = {
    tunai: "cash",
    transfer_bank: "transfer",
    bank_transfer: "transfer",
    cash_only: "cash",
    transfer_only: "transfer",
    semua: "all",
};

const { adalahPlaceholder } = require("./config-placeholder");

// Bawaan karangan lama yang pernah dipakai sebagai nilai "aman" — bukan data.
const POLA_BAWAAN_KARANGAN = /^bank default$/i;

// Nomor karangan seperti '1234567890' SENGAJA tidak disaring di sini: menebak
// "ini pasti dummy" dari isinya bisa menolak rekening yang sah, dan pertahanan
// yang benar terhadap nomor karangan adalah MENGHAPUS fallback yang mengarangnya
// (sudah dilakukan di lib/invoice-generator.js dan
// message/handlers/steps/saldo-steps.js), bukan mencocokkan string di hilir.
function kosong(nilai) {
    if (nilai === undefined || nilai === null) return true;
    const teks = String(nilai).trim();
    if (teks === "") return true;
    return adalahPlaceholder(teks) || POLA_BAWAAN_KARANGAN.test(teks);
}

/**
 * Menerjemahkan nilai setelan menjadi tiga sakelar yang benar-benar dipakai renderer.
 * Nilai tak dikenal (atau kosong) jatuh ke bawaan `cash_transfer` — TIDAK PERNAH
 * mengembalikan ketiganya mati, karena invoice tanpa satu pun metode pembayaran
 * lebih menyesatkan daripada invoice dengan bawaan.
 */
function resolveMetodeDitampilkan(nilai) {
    const mentah = String(nilai === undefined || nilai === null ? "" : nilai).trim().toLowerCase();
    const kunci = ALIAS_METODE[mentah] || mentah;

    switch (kunci) {
        case "cash":
            return { tunai: true, transfer: false, online: false };
        case "transfer":
            return { tunai: false, transfer: true, online: false };
        case "online":
            return { tunai: false, transfer: false, online: true };
        case "all":
            return { tunai: true, transfer: true, online: true };
        case "cash_transfer":
        default:
            return { tunai: true, transfer: true, online: false };
    }
}

// Bentuk JAMAK memakai {bank, number, name}; bentuk TUNGGAL memakai
// {bankName, accountNumber, accountName}. Keduanya dinormalkan ke bentuk TUNGGAL,
// karena itulah yang sudah dipahami template invoice.
function normalisasiSatuRekening(sumber) {
    if (!sumber || typeof sumber !== "object") return null;

    const bankName = sumber.bankName !== undefined ? sumber.bankName : sumber.bank;
    const accountNumber = sumber.accountNumber !== undefined ? sumber.accountNumber : sumber.number;
    const accountName = sumber.accountName !== undefined ? sumber.accountName : sumber.name;

    // Rekening tanpa nama bank ATAU tanpa nomor tak berguna bagi pelanggan — perlakukan
    // sebagai tidak ada, jangan cetak setengah data.
    if (kosong(bankName) || kosong(accountNumber)) return null;

    const hasil = {
        bankName: String(bankName).trim(),
        accountNumber: String(accountNumber).trim(),
    };
    if (!kosong(accountName)) hasil.accountName = String(accountName).trim();
    if (!kosong(sumber.branch)) hasil.branch = String(sumber.branch).trim();
    if (!kosong(sumber.paymentInstructions)) {
        hasil.paymentInstructions = String(sumber.paymentInstructions).trim();
    }
    return hasil;
}

/**
 * Mengembalikan DAFTAR rekening yang layak dicetak di invoice, dengan urutan prioritas:
 *   1. `bankAccount` tunggal (form khusus invoice) bila benar-benar diisi;
 *   2. `bankAccounts` jamak (form /config yang dipakai bot WhatsApp) sebagai cadangan.
 *
 * Selalu mengembalikan array (mungkin kosong). Array kosong berarti "tak ada rekening" —
 * pemanggil WAJIB memakai itu untuk memutuskan, bukan mencetak "Transfer Bank" telanjang.
 */
function resolveDaftarRekening(tunggal, jamak) {
    const dariTunggal = normalisasiSatuRekening(tunggal);
    if (dariTunggal) return [dariTunggal];

    // Terima array maupun objek berkunci angka — config.json yang pernah disunting tangan
    // bisa berubah bentuk, dan diam-diam menganggapnya kosong persis cacat yang diperbaiki.
    let daftar = [];
    if (Array.isArray(jamak)) {
        daftar = jamak;
    } else if (jamak && typeof jamak === "object") {
        daftar = Object.keys(jamak)
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => jamak[k]);
    }

    return daftar.map(normalisasiSatuRekening).filter(Boolean);
}

module.exports = {
    NILAI_METODE_SAH,
    resolveMetodeDitampilkan,
    resolveDaftarRekening,
    // Diekspor untuk diuji langsung: perlakuan placeholder adalah inti perbaikan ini.
    normalisasiSatuRekening,
};
