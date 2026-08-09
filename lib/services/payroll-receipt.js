/**
 * Header Doc
 * Purpose: SUMBER TUNGGAL teks struk GAJI yang dibaca TEKNISI saat payroll-nya dibayar. Sebelum ini
 *   payroll punya seluruh angkanya (gaji pokok, komisi penarikan, bonus, potongan kasbon) tapi
 *   teknisi tidak pernah diberi tahu apa pun — uang masuk rekeningnya tanpa rincian, sehingga
 *   selisih sekecil apa pun berujung tanya-jawab manual.
 *   Rinciannya sengaja LENGKAP: potongan adalah bagian yang paling sering dipertanyakan, jadi ia
 *   harus tampil bersama angka bersihnya, bukan disembunyikan.
 * Caller: `routes/gaji.js` (PUT /:id/pay).
 * Deps: `../templating` (renderTemplate → database/message_templates.json), `rupiah-format`.
 * MainFuncs: `buildPayrollReceiptText`, `resolveTechnicianPhones`.
 * SideEffects: Tidak ada (murni merangkai string).
 */
"use strict";

const convertRupiah = require("rupiah-format");
const { renderTemplate } = require("../templating");

const TEMPLATE_KEY = "gaji_struk_teknisi";

const BULAN = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

function rupiah(n) {
    const angka = Number.parseInt(n, 10);
    return convertRupiah.convert(Number.isFinite(angka) ? angka : 0);
}

function periode(bulan, tahun) {
    const b = Number.parseInt(bulan, 10);
    const t = Number.parseInt(tahun, 10);
    if (!Number.isFinite(b) || b < 1 || b > 12 || !Number.isFinite(t)) return "-";
    return `${BULAN[b - 1]} ${t}`;
}

/**
 * Nomor WA teknisi dari akun (`database/accounts.json` → `global.accounts`).
 * Field `phone_number` bisa memuat >1 nomor dipisah `|` — semuanya dikembalikan.
 */
function resolveTechnicianPhones(teknisiId, accounts) {
    const list = Array.isArray(accounts) ? accounts : (global.accounts || []);
    const akun = list.find((a) => a && String(a.id) === String(teknisiId));
    if (!akun || !akun.phone_number) return [];
    return String(akun.phone_number)
        .split("|")
        .map((p) => p.trim())
        .filter(Boolean);
}

/**
 * Baris potongan hanya ditampilkan bila ADA potongannya — supaya struk teknisi tanpa kasbon
 * tidak penuh baris "Rp 0" yang membingungkan.
 */
function barisPotongan(row) {
    const baris = [];
    const kasbon = Number.parseInt(row.potongan_kasbon, 10) || 0;
    const lain = Number.parseInt(row.potongan_lain, 10) || 0;
    if (kasbon > 0) baris.push(`• Potongan kasbon : ${rupiah(kasbon)}`);
    if (lain > 0) {
        const ket = String(row.potongan_lain_keterangan || "").trim();
        baris.push(`• Potongan lain   : ${rupiah(lain)}${ket ? ` (${ket})` : ""}`);
    }
    return baris.join("\n");
}

function barisPendapatan(row) {
    const baris = [`• Gaji pokok      : ${rupiah(row.gaji_pokok)}`];
    const komisi = Number.parseInt(row.komisi_collection, 10) || 0;
    const bonus = (Number.parseInt(row.bonus, 10) || 0) + (Number.parseInt(row.bonus_manual, 10) || 0);
    if (komisi > 0) baris.push(`• Komisi penarikan: ${rupiah(komisi)}`);
    if (bonus > 0) baris.push(`• Bonus           : ${rupiah(bonus)}`);
    return baris.join("\n");
}

/**
 * @param {object} row baris `technician_gaji` (hasil `getPayrollRecord`).
 * @returns {string} teks siap kirim. TIDAK PERNAH memulangkan teks error template.
 */
function buildPayrollReceiptText(row = {}) {
    const data = {
        nama_teknisi: row.teknisi_name || "Teknisi",
        periode: periode(row.period_month, row.period_year),
        rincian_pendapatan: barisPendapatan(row),
        rincian_potongan: barisPotongan(row),
        total_potongan: rupiah(row.total_potongan),
        gaji_bersih: rupiah(row.net_amount != null ? row.net_amount : row.total_gaji),
        no_ref: row.id != null ? String(row.id) : "-"
    };

    const teks = renderTemplate(TEMPLATE_KEY, data);

    // PENJAGA: `renderTemplate` memulangkan kalimat `Error: Template "..." not found` (bukan string
    // kosong) untuk key yang belum ada. `message_templates.json` produksi adalah berkas MERGE-KEY,
    // jadi key baru belum tentu sudah ada di sana. Teknisi tak boleh menerima teks error sebagai
    // struk gajinya.
    if (!teks || /^Error: Template/i.test(String(teks))) {
        return [
            "💰 *GAJI SUDAH DITRANSFER*",
            "",
            `Halo *${data.nama_teknisi}*, gaji periode *${data.periode}* sudah kami transfer.`,
            "",
            "🧾 *RINCIAN*",
            "━━━━━━━━━━━━━━",
            data.rincian_pendapatan,
            data.rincian_potongan || null,
            `• *Gaji bersih*   : *${data.gaji_bersih}*`,
            "━━━━━━━━━━━━━━",
            `No. Ref : ${data.no_ref}`,
            "",
            "Kalau ada yang tidak sesuai, kabari admin ya."
        ].filter((b) => b !== null).join("\n");
    }

    return teks;
}

module.exports = {
    buildPayrollReceiptText,
    resolveTechnicianPhones,
    // Internal — test.
    _rupiah: rupiah,
    _periode: periode
};
