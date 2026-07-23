/**
 * Header Doc
 * Purpose: Otak perintah KAS USAHA di WhatsApp — parsing perintah `kas`, pemetaan teks bebas ke
 *          9 kategori TETAP milik `lib/expense-manager`, dan perakit teks laporan.
 *          Sengaja TIDAK punya penyimpanan sendiri: seluruh tulis/baca memakai expense-manager
 *          supaya angka WhatsApp, halaman `/pengeluaran`, dan `/rekap-keuangan` selalu satu
 *          sumber. Membuat ledger kedua = angka yang tak pernah cocok.
 * Caller: `message/handlers/business-expense-wa.js`.
 * Deps: `./personal-finance-service` (parseAmount/formatRupiah/rentang — penerjemah nominal yang
 *       SAMA dengan dompet pribadi supaya "150rb" berarti sama di mana pun).
 * MainFuncs: `KATEGORI_KAS`, `inferKategoriKas`, `parseBusinessExpenseCommand`, `buildKasReport`.
 * SideEffects: Tidak ada (fungsi murni).
 */
"use strict";

const { parseAmount, formatRupiah, dayRange, weekRange, monthRange } = require("./personal-finance-service");

/** Kata pemicu kas USAHA. Sengaja beda dari dompet pribadi (`uang`/`duit`/`dompet`). */
const TRIGGER_KAS = Object.freeze(["kas", "biaya", "pengeluaran"]);

/**
 * Peta kata → kategori TETAP milik expense-manager. Daftar kategorinya tak boleh dikarang:
 * `createExpense` menolak kategori di luar `EXPENSE_CATEGORIES`, jadi tebakan yang meleset
 * harus jatuh ke kategori yang PASTI valid.
 */
const KATEGORI_KAS = Object.freeze({
    transport: ["bensin", "solar", "pertalite", "pertamax", "parkir", "tol", "ojek", "bus", "travel", "kirim", "ongkir"],
    maintenance: ["kabel", "konektor", "dropcore", "splicer", "adaptor", "modem", "router", "olt", "perbaikan", "servis", "ganti", "tiang", "odp", "odc", "las", "alat", "tang"],
    internet_utilities: ["listrik", "token", "pdam", "air", "internet", "upstream", "bandwidth", "sewa ip", "domain", "server", "vps"],
    office_supply: ["atk", "kertas", "tinta", "printer", "materai", "map", "spidol"],
    marketing: ["brosur", "spanduk", "banner", "iklan", "promo", "pamflet", "kartu nama"],
    gaji_payroll: ["gaji", "upah", "thr", "bonus", "lembur"],
    kasbon_outflow: ["kasbon", "panjar", "pinjaman"],
    operasional: ["makan", "minum", "kopi", "rokok", "konsumsi", "galon", "sabun", "pulsa", "kuota"]
});

/** Fallback WAJIB kategori yang valid — `other` ada di daftar resmi expense-manager. */
const KATEGORI_BAWAAN = "operasional";

/** Tebak kategori usaha dari judul. Cocokkan frasa dulu, lalu per-kata. */
function inferKategoriKas(teks) {
    const s = String(teks || "").toLowerCase();
    if (!s.trim()) return KATEGORI_BAWAAN;
    const kata = s.split(/[^a-z0-9]+/).filter(Boolean);

    for (const [kategori, kunci] of Object.entries(KATEGORI_KAS)) {
        for (const k of kunci) {
            if (k.includes(" ") ? s.includes(k) : kata.includes(k)) return kategori;
        }
    }
    return KATEGORI_BAWAAN;
}

/**
 * Urai perintah kas usaha.
 *
 *   kas 150rb kabel dropcore   → { action:'add', amount:150000, title:'kabel dropcore', category }
 *   kas                        → { action:'report', scope:'day' }
 *   kas kemarin | minggu | bulan [YYYY-MM] | bulan lalu | minggu lalu
 *   kas batal 12               → { action:'cancel', id:12 }
 *   kas bantuan                → { action:'help' }
 */
function parseBusinessExpenseCommand(text) {
    const isi = String(text || "").trim();
    if (!isi) return { action: "unknown", reason: "kosong" };

    const token = isi.split(/\s+/);
    if (!TRIGGER_KAS.includes(token[0].toLowerCase())) return { action: "unknown", reason: "bukan_perintah_kas" };

    const sub = (token[1] || "").toLowerCase();
    if (!sub || ["lapor", "laporan", "rekap", "hari"].includes(sub)) return { action: "report", scope: "day", geser: 0 };
    if (["bantuan", "help", "panduan", "?"].includes(sub)) return { action: "help" };
    if (["kemarin", "kmrn"].includes(sub)) return { action: "report", scope: "day", geser: -1 };
    if (["minggu", "mingguan", "pekan"].includes(sub)) {
        return { action: "report", scope: "week", geser: (token[2] || "").toLowerCase() === "lalu" ? -1 : 0 };
    }
    if (["bulan", "bulanan"].includes(sub)) {
        const sesudah = (token[2] || "").toLowerCase();
        if (sesudah === "lalu") return { action: "report", scope: "month", geser: -1 };
        return { action: "report", scope: "month", month: /^\d{4}-\d{2}$/.test(token[2] || "") ? token[2] : null };
    }
    if (["batal", "hapus", "cancel"].includes(sub)) {
        const id = Number(token[2]);
        return Number.isInteger(id) && id > 0 ? { action: "cancel", id } : { action: "unknown", reason: "id_tidak_valid" };
    }

    // Sisanya dianggap pencatatan: `kas <nominal> <judul…>`
    const amount = parseAmount(token[1]);
    if (!amount) return { action: "unknown", reason: "nominal_tidak_terbaca" };
    const title = token.slice(2).join(" ").trim();
    if (!title) return { action: "unknown", reason: "judul_kosong" };

    return { action: "add", amount, title, category: inferKategoriKas(title) };
}

/** Terjemahkan aksi report jadi rentang tanggal + judul. */
function resolveRentangKas(perintah) {
    if (perintah.scope === "week") {
        const r = weekRange(perintah.geser || 0);
        return { ...r, judul: perintah.geser === -1 ? "MINGGU LALU" : "MINGGU INI" };
    }
    if (perintah.scope === "month") {
        if (perintah.geser === -1) {
            const d = new Date();
            const lalu = new Date(d.getFullYear(), d.getMonth() - 1, 1);
            const r = monthRange(`${lalu.getFullYear()}-${String(lalu.getMonth() + 1).padStart(2, "0")}`);
            return { ...r, judul: `BULAN ${r.month}` };
        }
        const r = monthRange(perintah.month);
        return { ...r, judul: `BULAN ${r.month}` };
    }
    const r = dayRange(perintah.geser || 0);
    return { ...r, judul: perintah.geser === -1 ? "KEMARIN" : "HARI INI" };
}

/**
 * Rakit data siap-render laporan kas. `entries` adalah baris dari `listExpenses`
 * (sudah dipetakan `mapExpenseRow`), bukan bentuk dompet pribadi.
 */
function buildKasReport(entries, rentang) {
    const aktif = (entries || []).filter((e) => e.status !== "cancelled");
    const total = aktif.reduce((s, e) => s + Number(e.amount || 0), 0);

    const perKategori = {};
    for (const e of aktif) {
        const k = e.category || "lain";
        if (!perKategori[k]) perKategori[k] = { jumlah: 0, total: 0 };
        perKategori[k].jumlah += 1;
        perKategori[k].total += Number(e.amount || 0);
    }
    const urut = Object.entries(perKategori).sort((a, b) => b[1].total - a[1].total);

    return {
        judul: rentang.judul,
        rentang: rentang.from === rentang.to ? rentang.from : `${rentang.from} s/d ${rentang.to}`,
        totalRp: formatRupiah(total),
        jumlah: aktif.length,
        rincianKategori: urut.length
            ? urut.map(([k, v]) => `• ${k}: ${formatRupiah(v.total)} (${v.jumlah}x)`).join("\n")
            : "• belum ada pengeluaran",
        daftar: aktif.length
            ? aktif
                  .slice(0, 20)
                  .map((e) => `${e.id}. ${formatRupiah(e.amount)} — ${e.title}${e.category ? ` [${e.category}]` : ""}`)
                  .join("\n")
            : "belum ada catatan",
        terbesar: aktif.length
            ? [...aktif].sort((a, b) => b.amount - a.amount).slice(0, 3)
                  .map((e) => `• ${formatRupiah(e.amount)} — ${e.title}`).join("\n")
            : "-"
    };
}

module.exports = {
    TRIGGER_KAS,
    KATEGORI_KAS,
    KATEGORI_BAWAAN,
    inferKategoriKas,
    parseBusinessExpenseCommand,
    resolveRentangKas,
    buildKasReport
};
