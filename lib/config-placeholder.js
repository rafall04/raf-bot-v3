/**
 * Header Doc
 * Purpose: Mengenali nilai config yang masih berupa TEKS CONTEKAN dari `config.example.json`
 *          (pola `ISI_*`) sehingga tak pernah tercetak ke dokumen atau pesan pelanggan.
 * Caller: `lib/invoice-payment-methods.js`, `lib/invoice-generator.js`,
 *          `lib/pdf-invoice-generator.js`.
 * Deps: tidak ada (murni).
 * MainFuncs: `adalahPlaceholder`, `bersihkanPlaceholder`.
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — terukur di produksi Dander 2026-08-15, `config.json` masih menyimpan 11
 * nilai contekan yang belum diisi, dan dua di antaranya SUDAH bocor ke dokumen invoice:
 *   • `company.phone = ISI_PHONE`            → kop tagihan mencetak "Telp: ISI_PHONE"
 *   • `pdfCustomization.logoUrl = ISI_LOGOURL` → invoice merender <img src="ISI_LOGOURL">
 * Yang kedua lebih jahat daripada sekadar jelek: `logoUrl` MENDAHULUI logo yang diunggah,
 * jadi placeholder ini mematikan logo perusahaan yang sudah benar.
 *
 * Sengaja HANYA pola `ISI_*` — pola yang mustahil jadi data asli. Menebak "ini pasti
 * contekan" dari isi nilai (mis. nomor rekening 1234567890) bisa menolak data yang sah;
 * pertahanan terhadap nilai karangan adalah menghapus kode yang mengarangnya.
 */
"use strict";

const POLA_CONTEKAN = /^isi[_\s-]/i;

function adalahPlaceholder(nilai) {
    if (typeof nilai !== "string") return false;
    return POLA_CONTEKAN.test(nilai.trim());
}

/**
 * Mengembalikan nilainya, atau `bawaan` (default string kosong) bila nilai itu
 * masih teks contekan. Pemanggil memakai hasilnya seolah field itu belum diisi.
 */
function bersihkanPlaceholder(nilai, bawaan = "") {
    return adalahPlaceholder(nilai) ? bawaan : nilai;
}

module.exports = { adalahPlaceholder, bersihkanPlaceholder };
