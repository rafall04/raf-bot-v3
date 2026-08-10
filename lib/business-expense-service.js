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
 * MainFuncs: `KATEGORI_KAS`, `inferKategoriKas`, `parseBusinessExpenseCommand`, `parsePerintahRutin`,
 *            `buildKasReport`.
 * SideEffects: Tidak ada (fungsi murni).
 */
"use strict";

const { parseAmount, formatRupiah, dayRange, weekRange, monthRange } = require("./personal-finance-service");

/** Kata pemicu kas USAHA. Sengaja beda dari dompet pribadi (`uang`/`duit`/`dompet`). */
const TRIGGER_KAS = Object.freeze(["kas", "biaya", "pengeluaran"]);

/**
 * Pemicu RINGKASAN UANG usaha.
 *
 * SENGAJA TIDAK memuat `uang`/`duit`/`dompet`: ketiganya sudah milik dompet PRIBADI
 * (`personal-finance-service.UMBRELLA_WORDS`), dan pemisahan itu disengaja sejak awal.
 * Memakainya di sini akan membuat satu kata bermakna dua hal tergantung grup — persis
 * jenis kebingungan yang paling mahal di jalur uang. `omset` tak dipakai dompet pribadi,
 * jadi aman; untuk yang ragu, `kas ringkasan` selalu tersedia dan tak mungkin ambigu.
 */
const TRIGGER_RINGKASAN = Object.freeze(["omset", "omzet"]);

/**
 * Balasan konfirmasi biaya rutin. Dipisah dari TRIGGER_KAS karena kata-kata ini HANYA
 * bermakna saat ada tagihan yang menunggu — di luar itu harus diabaikan, supaya "ok" biasa
 * di grup tidak diam-diam mencatat pengeluaran.
 */
const KATA_KONFIRMASI = Object.freeze(["ok", "oke", "ya", "sip", "gas", "catat"]);
const KATA_LEWATI = Object.freeze(["lewati", "skip", "lewat", "batal"]);

/**
 * Urai balasan konfirmasi: `ok`, `ok 620rb`, `ok 3 620rb` (dgn id), `lewati`, `lewati 3`.
 * @returns {{aksi:'catat'|'lewati', id:number|null, nominal:number|null}|null} null = bukan balasan konfirmasi
 */
function parseKonfirmasiRutin(text) {
    const token = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!token.length) return null;

    const kepala = token[0].toLowerCase();
    const aksi = KATA_KONFIRMASI.includes(kepala) ? "catat" : KATA_LEWATI.includes(kepala) ? "lewati" : null;
    if (!aksi) return null;

    let id = null;
    let nominal = null;
    for (const t of token.slice(1)) {
        // Angka polos <= 3 digit dianggap ID item, selebihnya nominal. "ok 3" = item 3,
        // "ok 620rb"/"ok 620000" = nominal. Ambigu hanya untuk nominal < Rp1.000 yang
        // tak realistis sebagai tagihan rutin.
        if (/^\d{1,3}$/.test(t) && id === null) {
            id = Number(t);
            continue;
        }
        const n = parseAmount(t);
        if (n) nominal = n;
    }
    return { aksi, id, nominal };
}

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
/**
 * Urai sub-perintah BIAYA RUTIN: `kas rutin`, `kas rutin tambah 850rb listrik tgl 20`,
 * `kas rutin hapus 3`.
 *
 * Tanggal WAJIB ditulis eksplisit (`tgl 20` / `tanggal 20` / `tg 20`). Menebaknya dari angka
 * bebas berbahaya: `kas rutin tambah 850rb listrik 20` bisa berarti tanggal 20 ATAU judul
 * "listrik 20" — dan salah tebak menghasilkan tagihan yang jatuh tempo di hari yang salah
 * setiap bulan, diam-diam, selamanya.
 * @param {string[]} sisa token setelah kata `rutin`
 */
function parsePerintahRutin(sisa) {
    const aksi = (sisa[0] || "").toLowerCase();

    if (!aksi || ["lihat", "daftar", "list"].includes(aksi)) return { action: "rutin_list" };

    if (["hapus", "buang", "delete"].includes(aksi)) {
        const id = Number(sisa[1]);
        return Number.isInteger(id) && id > 0
            ? { action: "rutin_hapus", id }
            : { action: "unknown", reason: "rutin_id_tidak_valid" };
    }

    if (!["tambah", "baru", "add"].includes(aksi)) return { action: "unknown", reason: "rutin_sub_tak_dikenal" };

    const token = sisa.slice(1);
    const amount = parseAmount(token[0]);
    if (!amount) return { action: "unknown", reason: "rutin_nominal_tidak_terbaca" };

    // Pisahkan penanda tanggal dari judul, di mana pun posisinya.
    let tanggal = null;
    const kataJudul = [];
    for (let i = 1; i < token.length; i += 1) {
        const kata = String(token[i] || "").toLowerCase();
        if (["tgl", "tanggal", "tg", "tiap", "setiap"].includes(kata)) {
            const n = Number(String(token[i + 1] || "").replace(/[^0-9]/g, ""));
            if (Number.isInteger(n) && n >= 1 && n <= 31) {
                tanggal = n;
                i += 1;
                continue;
            }
            return { action: "unknown", reason: "rutin_tanggal_tidak_valid" };
        }
        kataJudul.push(token[i]);
    }

    const nama = kataJudul.join(" ").trim();
    if (!nama) return { action: "unknown", reason: "rutin_nama_kosong" };
    if (tanggal == null) return { action: "unknown", reason: "rutin_tanggal_wajib" };

    return { action: "rutin_tambah", amount, nama, tanggal, category: inferKategoriKas(nama) };
}

function parseBusinessExpenseCommand(text) {
    const isi = String(text || "").trim();
    if (!isi) return { action: "unknown", reason: "kosong" };

    const token = isi.split(/\s+/);
    const kepala = token[0].toLowerCase();
    // `uang` / `omset` berdiri sendiri = minta ringkasan, tanpa perlu diawali `kas`.
    if (TRIGGER_RINGKASAN.includes(kepala)) return { action: "ringkasan" };
    if (!TRIGGER_KAS.includes(kepala)) return { action: "unknown", reason: "bukan_perintah_kas" };

    const sub = (token[1] || "").toLowerCase();
    // `kas ringkasan` / `kas uang` / `kas omset` — bentuk berprefiks, tak mungkin ambigu dengan
    // dompet pribadi karena diawali kata `kas`. (`rekap` SENGAJA tidak di sini: ia sudah berarti
    // laporan pengeluaran hari ini sejak awal, dan mengubah artinya akan mengagetkan pemakainya.)
    if (["ringkasan", "uang", "omset", "omzet"].includes(sub)) return { action: "ringkasan" };
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
    if (["rutin", "tetap", "bulanan"].includes(sub)) {
        return parsePerintahRutin(token.slice(2));
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
    TRIGGER_RINGKASAN,
    KATA_KONFIRMASI,
    KATA_LEWATI,
    parseKonfirmasiRutin,
    KATEGORI_KAS,
    KATEGORI_BAWAAN,
    inferKategoriKas,
    parseBusinessExpenseCommand,
    resolveRentangKas,
    buildKasReport
};
