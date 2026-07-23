/**
 * Header Doc
 * Purpose: Otak domain KEUANGAN PRIBADI owner — parsing perintah `#U`, penerjemah nominal
 *          gaya Indonesia (50rb / 2jt / 50.000), inferensi kategori, dan perakit laporan
 *          harian/bulanan. Seluruh isi file ini fungsi MURNI (tanpa I/O) supaya bisa diuji
 *          tanpa DB dan tanpa koneksi WhatsApp.
 * Caller: `message/handlers/personal-finance-wa.js`, `routes/admin-personal-finance-routes.js`.
 * Deps: Tidak ada (sengaja bebas dependensi).
 * MainFuncs: `parseAmount`, `inferCategory`, `parsePersonalFinanceCommand`, `formatRupiah`,
 *            `todayStr`, `monthRange`, `buildReportData`.
 * SideEffects: Tidak ada.
 */
"use strict";

/** Kata pemicu jenis catatan. Ditulis longgar karena pengetiknya satu orang yang buru-buru. */
const KIND_ALIASES = {
    out: ["keluar", "kluar", "k", "beli", "bayar", "belanja", "pakai", "-"],
    in: ["masuk", "msk", "m", "terima", "dapat", "dpt", "+"]
};

/**
 * Peta kategori → kata kunci. Inferensi dibuat TRANSPARAN: hasilnya selalu ditampilkan di
 * balasan, jadi kalau salah tebak pemakainya langsung tahu (dan bisa `#U hapus <id>`).
 * Bisa ditimpa lewat `config.personalFinance.categories`.
 */
const DEFAULT_CATEGORIES = {
    makan: ["makan", "jajan", "kopi", "warung", "nasi", "sarapan", "minum", "bakso", "soto", "es"],
    transport: ["bensin", "solar", "pertalite", "pertamax", "parkir", "tol", "servis", "oli", "ban", "ojek", "bus"],
    tagihan: ["listrik", "token", "pdam", "air", "internet", "wifi", "pulsa", "kuota", "paket data"],
    belanja: ["belanja", "pasar", "sabun", "galon", "beras", "gas", "baju", "sandal"],
    kesehatan: ["obat", "dokter", "rs", "apotek", "periksa", "vitamin"],
    pendidikan: ["sekolah", "spp", "buku", "les", "kuliah", "seragam"],
    sosial: ["sumbangan", "kondangan", "amal", "zakat", "infaq", "sedekah", "arisan"],
    gaji: ["gaji", "upah", "bonus", "thr"],
    lain: []
};

const ORDER_KATEGORI = Object.keys(DEFAULT_CATEGORIES);

/**
 * Terjemahkan nominal gaya Indonesia ke rupiah bulat.
 *
 * Aturan pemisah yang bikin ini tidak sepele: `50.000` itu lima puluh ribu (titik =
 * pemisah ribuan), tapi `1,5jt` itu satu setengah juta (koma = desimal). Pembedanya
 * adalah ADA-TIDAKNYA satuan di belakang — kalau ada satuan (rb/k/jt), pemisah
 * diperlakukan desimal; kalau tidak ada, diperlakukan pemisah ribuan.
 *
 * @param {string} raw
 * @returns {number|null} rupiah bulat > 0, atau null bila tak terbaca
 */
function parseAmount(raw) {
    const teks = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!teks) return null;

    const m = teks.match(/^(rp)?([0-9][0-9.,]*)(jt|juta|rb|ribu|k)?$/);
    if (!m) return null;

    const angkaRaw = m[2];
    const satuan = m[3] || "";

    let angka;
    if (satuan) {
        // Ada satuan → pemisah terakhir dianggap DESIMAL ("1,5jt", "2.5jt").
        const normal = angkaRaw.replace(/\./g, ".").replace(/,/g, ".");
        const bagian = normal.split(".");
        angka = bagian.length > 1 ? Number(`${bagian.slice(0, -1).join("")}.${bagian[bagian.length - 1]}`) : Number(normal);
    } else {
        // Tanpa satuan → titik/koma dianggap pemisah RIBUAN ("50.000", "1.500.000").
        angka = Number(angkaRaw.replace(/[.,]/g, ""));
    }
    if (!Number.isFinite(angka) || angka <= 0) return null;

    const pengali = satuan === "jt" || satuan === "juta" ? 1000000 : satuan === "rb" || satuan === "ribu" || satuan === "k" ? 1000 : 1;
    const hasil = Math.round(angka * pengali);
    return hasil > 0 ? hasil : null;
}

/**
 * Pilih peta kategori yang dipakai. `config.personalFinance.categories` defaultnya `{}` —
 * objek KOSONG yang truthy, sehingga `categories || DEFAULT` dulu meloloskannya dan MEMATIKAN
 * seluruh inferensi diam-diam (semua catatan jadi "lain") di WA maupun web. Kosong/bukan objek
 * ⇒ pakai default, jangan pernah pakai peta kosong.
 */
function resolveCategories(categories) {
    if (!categories || typeof categories !== "object" || Array.isArray(categories)) return DEFAULT_CATEGORIES;
    return Object.keys(categories).length ? categories : DEFAULT_CATEGORIES;
}

/** Tebak kategori dari catatan. Cocokkan per-KATA supaya "kopi" tak kena di "fotokopi". */
function inferCategory(note, categoriesInput = DEFAULT_CATEGORIES) {
    const categories = resolveCategories(categoriesInput);
    const teks = String(note || "").toLowerCase();
    if (!teks.trim()) return "lain";
    const kata = teks.split(/[^a-z0-9]+/).filter(Boolean);

    const urutan = Object.keys(categories).length ? Object.keys(categories) : ORDER_KATEGORI;
    for (const kategori of urutan) {
        const kunci = categories[kategori] || [];
        for (const k of kunci) {
            const kl = String(k).toLowerCase();
            if (kl.includes(" ") ? teks.includes(kl) : kata.includes(kl)) return kategori;
        }
    }
    return "lain";
}

function resolveKind(token) {
    const t = String(token || "").toLowerCase();
    if (KIND_ALIASES.out.includes(t)) return "out";
    if (KIND_ALIASES.in.includes(t)) return "in";
    return null;
}

/**
 * Kata payung untuk perintah SELAIN mencatat (rekap, hapus, bantuan).
 *
 * SENGAJA bukan `lapor`/`laporan`: kata itu sudah dipakai jalur keluhan pelanggan dan
 * interceptor global (`message/handlers/raf-interceptors.js`, `raf-state-routing.js`), jadi
 * memakainya sebagai pemicu telanjang akan menelan perintah lain milik pemilik sendiri.
 * `uang`/`duit`/`kas`/`dompet` nol tabrakan di seluruh repo.
 */
// `kas` SENGAJA TIDAK di sini — kata itu milik KAS USAHA (`lib/business-expense-service`,
// perintah `kas 150rb kabel`). Membiarkannya di dua tempat membuat pengeluaran usaha
// tercatat di dompet pribadi, persis pencampuran yang seluruh desain ini hindari.
const UMBRELLA_WORDS = ["uang", "duit", "dompet"];

/**
 * Kata PEMICU WhatsApp. TANPA prefix — mengetik `#U` dulu terasa ribet untuk sesuatu yang
 * dipakai beberapa kali sehari. Aman tanpa prefix karena gerbangnya berbasis IDENTITAS lebih
 * dulu: hanya nomor pemilik yang pernah sampai ke parser ini.
 *
 * SENGAJA jauh lebih sempit dari `KIND_ALIASES`. Alias seperti `bayar`, `beli`, `belanja`,
 * `pakai`, `terima`, `dapat`, `k`, `m`, `+`, `-` aman sebagai kata KEDUA di balik prefix, tapi
 * sebagai pemicu telanjang akan menelan percakapan pemilik yang sama sekali tak berhubungan
 * dengan dompet ("bayar tagihan pelanggan…", "beli modem…"). Hanya kata yang tak bermakna lain
 * dalam konteks bot ini yang boleh memicu.
 */
const TRIGGER_WORDS = Object.freeze(["keluar", "kluar", "masuk", "msk", ...UMBRELLA_WORDS]);

/**
 * Urai satu perintah keuangan pribadi menjadi aksi terstruktur.
 *
 * Bentuk yang dikenali (semua tanpa prefix):
 *   keluar 50rb bensin     → { action:'add', kind:'out', amount:50000, note:'bensin' }
 *   masuk 2jt gaji         → { action:'add', kind:'in',  amount:2000000, note:'gaji' }
 *   uang                   → { action:'report', scope:'day' }
 *   uang bulan [YYYY-MM]   → { action:'report', scope:'month', month }
 *   uang hapus 12          → { action:'delete', id:12 }
 *   uang bantuan           → { action:'help' }
 *
 * @returns {{action:string}&Record<string,any>} selalu objek; `action:'unknown'` bila tak cocok.
 */
function parsePersonalFinanceCommand(text, options = {}) {
    const categories = resolveCategories(options.categories);
    const isi = String(text || "").trim();
    if (!isi) return { action: "unknown", reason: "kosong" };

    const token = isi.split(/\s+/);
    const kepala = token[0].toLowerCase();

    // ── Jalur payung: "uang ..." ────────────────────────────────────────────────
    if (UMBRELLA_WORDS.includes(kepala)) {
        const sub = (token[1] || "").toLowerCase();
        if (!sub || ["lapor", "laporan", "rekap", "hari"].includes(sub)) {
            return { action: "report", scope: "day" };
        }
        if (["bantuan", "help", "panduan", "tutorial", "?"].includes(sub)) {
            return { action: "help" };
        }
        if (["bulan", "bulanan"].includes(sub)) {
            const sesudah = (token[2] || "").toLowerCase();
            if (sesudah === "lalu" || sesudah === "kemarin") {
                return { action: "report", scope: "month", geser: -1 };
            }
            const bulan = (token[2] || "").match(/^\d{4}-\d{2}$/) ? token[2] : null;
            return { action: "report", scope: "month", month: bulan };
        }
        if (["minggu", "mingguan", "pekan"].includes(sub)) {
            const sesudah = (token[2] || "").toLowerCase();
            return { action: "report", scope: "week", geser: sesudah === "lalu" ? -1 : 0 };
        }
        if (["kemarin", "kmrn"].includes(sub)) {
            return { action: "report", scope: "day", geser: -1 };
        }
        if (["hapus", "batal", "del"].includes(sub)) {
            const id = Number(token[2]);
            return Number.isInteger(id) && id > 0
                ? { action: "delete", id }
                : { action: "unknown", reason: "id_tidak_valid" };
        }
        // "uang <sesuatu>" yang tak dikenal → tunjukkan kartu bantuan, jangan diam.
        return { action: "help" };
    }

    // ── Jalur catat: "keluar/masuk <nominal> <catatan>" ─────────────────────────
    const kind = resolveKind(kepala);
    if (!kind) return { action: "unknown", reason: "jenis_tidak_dikenal" };

    const amount = parseAmount(token[1]);
    if (!amount) return { action: "unknown", reason: "nominal_tidak_terbaca" };

    const note = token.slice(2).join(" ").trim();
    return { action: "add", kind, amount, note: note || null, category: inferCategory(note, categories) };
}

/** "Rp50.000" — pemisah ribuan titik, tanpa desimal (rupiah selalu bulat di sini). */
function formatRupiah(n) {
    const angka = Math.round(Number(n) || 0);
    const tanda = angka < 0 ? "-" : "";
    return `${tanda}Rp${Math.abs(angka).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Tanggal lokal `YYYY-MM-DD` (proses dipaksa TZ Asia/Jakarta). */
function todayStr(date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Rentang tanggal awal–akhir untuk sebuah bulan `YYYY-MM`. */
function monthRange(month, date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    const ym = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month) : `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
    const [tahun, bulan] = ym.split("-").map(Number);
    const akhir = new Date(tahun, bulan, 0).getDate();
    return { month: ym, from: `${ym}-01`, to: `${ym}-${p(akhir)}` };
}

/** Rentang satu hari. `geser` -1 = kemarin. */
function dayRange(geser = 0, date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + Number(geser || 0));
    const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return { from: s, to: s, label: geser === 0 ? "hari ini" : geser === -1 ? "kemarin" : s };
}

/**
 * Rentang satu minggu SENIN–MINGGU (konvensi Indonesia), bukan "7 hari terakhir".
 * `geser` -1 = minggu lalu. Memakai getDay() dengan Minggu=0 → digeser supaya Senin jadi awal.
 */
function weekRange(geser = 0, date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    const hari = date.getDay(); // 0=Minggu
    const mundur = hari === 0 ? 6 : hari - 1; // ke Senin
    const senin = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mundur + Number(geser || 0) * 7);
    const minggu = new Date(senin.getFullYear(), senin.getMonth(), senin.getDate() + 6);
    const f = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return { from: f(senin), to: f(minggu), label: geser === 0 ? "minggu ini" : geser === -1 ? "minggu lalu" : f(senin) };
}

/**
 * Tentukan periode PEMBANDING tepat sebelum `{from,to}`.
 *
 * Bulan penuh dibandingkan dengan BULAN KALENDER sebelumnya, bukan "N hari sebelumnya".
 * Kalau tidak, Maret (31 hari) akan dibandingkan dengan 29 Jan–28 Feb — bukan Februari —
 * dan angkanya jadi omong kosong. Rentang bebas tetap digeser sepanjang jumlah harinya.
 *
 * @returns {{from:string,to:string,label:string}|null}
 */
function previousRange(from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to))) return null;
    const p = (n) => String(n).padStart(2, "0");
    const [fy, fm, fd] = String(from).split("-").map(Number);
    const [ty, tm, td] = String(to).split("-").map(Number);

    const akhirBulanFrom = new Date(fy, fm, 0).getDate();
    const bulanPenuh = fd === 1 && fy === ty && fm === tm && td === akhirBulanFrom;
    if (bulanPenuh) {
        const sebelum = new Date(fy, fm - 2, 1); // fm-1 = bulan ini (0-based), −1 lagi = bulan lalu
        const ym = `${sebelum.getFullYear()}-${p(sebelum.getMonth() + 1)}`;
        const akhir = new Date(sebelum.getFullYear(), sebelum.getMonth() + 1, 0).getDate();
        return { from: `${ym}-01`, to: `${ym}-${p(akhir)}`, label: "bulan lalu" };
    }

    const mulai = new Date(fy, fm - 1, fd);
    const selesai = new Date(ty, tm - 1, td);
    const jumlahHari = Math.round((selesai - mulai) / 86400000) + 1;
    if (jumlahHari <= 0) return null;

    const akhirSebelum = new Date(fy, fm - 1, fd - 1);
    const mulaiSebelum = new Date(fy, fm - 1, fd - jumlahHari);
    const f = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    // Label yang enak dibaca untuk rentang yang sering dipakai. "vs 1 hari sebelumnya"
    // secara teknis benar tapi janggal dibaca di chat.
    const label = jumlahHari === 1 ? "kemarin" : jumlahHari === 7 ? "minggu lalu" : `${jumlahHari} hari sebelumnya`;
    return { from: f(mulaiSebelum), to: f(akhirSebelum), label };
}

/**
 * Tren satu angka terhadap pembandingnya.
 * `naikItuBuruk` membalik makna: pengeluaran naik = memburuk, pemasukan naik = membaik.
 */
function hitungTren(sekarang, sebelumnya, naikItuBuruk = false) {
    const a = Number(sekarang || 0);
    const b = Number(sebelumnya || 0);
    const selisih = a - b;
    // Dari nol ke sesuatu bukan "naik tak hingga persen" — tandai tanpa persen.
    const persen = b > 0 ? Math.round((selisih / b) * 1000) / 10 : null;
    const arah = selisih === 0 ? "tetap" : selisih > 0 ? "naik" : "turun";
    const membaik = selisih === 0 ? null : naikItuBuruk ? selisih < 0 : selisih > 0;
    return { sekarang: a, sebelumnya: b, selisih, persen, arah, membaik };
}

/**
 * Susun baris CSV. Nilai yang memuat pemisah/kutip/baris-baru dibungkus kutip ganda dan
 * kutipnya digandakan (RFC 4180). Dipakai ekspor — jangan rakit CSV dengan join biasa.
 */
function toCsvRow(values, pemisah = ",") {
    return values
        .map((v) => {
            const s = v == null ? "" : String(v);
            return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(pemisah);
}

/**
 * Rakit CSV lengkap dari daftar catatan.
 * Diawali BOM UTF-8: tanpa itu Excel di Windows membaca "Rp" dan huruf beraksen sebagai
 * mojibake. Pemisah `;` mengikuti Excel dengan lokal Indonesia (koma = pemisah desimal).
 */
function toCsv(rows, options = {}) {
    const pemisah = options.pemisah || ";";
    const header = ["id", "tanggal", "waktu", "jenis", "nominal", "kategori", "catatan", "asal"];
    const baris = [toCsvRow(header, pemisah)];
    for (const r of rows || []) {
        baris.push(
            toCsvRow(
                [
                    r.id,
                    r.tanggal,
                    String(r.ts || "").slice(11, 16),
                    r.kind === "in" ? "masuk" : "keluar",
                    r.amount,
                    r.category,
                    r.note || "",
                    r.source
                ],
                pemisah
            )
        );
    }
    return `﻿${baris.join("\r\n")}\r\n`;
}

/**
 * Rakit deret HARIAN penuh untuk sebuah rentang tanggal.
 *
 * `dailyTotals()` hanya mengembalikan tanggal yang punya catatan. Untuk grafik/daftar per
 * hari itu tidak cukup: hari tanpa pengeluaran harus tetap muncul sebagai nol, kalau tidak
 * batangnya bolong dan "tanggal berapa saya boros" jadi salah baca (11 Juli tampak
 * bersebelahan dengan 3 Juli).
 *
 * @param {Array<{tanggal:string,kind:string,total:number,jumlah:number}>} rows
 * @param {string} from `YYYY-MM-DD`
 * @param {string} to   `YYYY-MM-DD`
 * @returns {Array<{tanggal:string,hari:number,masuk:number,keluar:number,selisih:number,jumlah:number}>}
 */
function buildDailySeries(rows, from, to) {
    const peta = new Map();
    for (const r of rows || []) {
        const k = String(r.tanggal);
        if (!peta.has(k)) peta.set(k, { masuk: 0, keluar: 0, jumlah: 0 });
        const e = peta.get(k);
        if (r.kind === "in") e.masuk += Number(r.total || 0);
        else e.keluar += Number(r.total || 0);
        e.jumlah += Number(r.jumlah || 0);
    }

    const hasil = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to))) return hasil;

    const p = (n) => String(n).padStart(2, "0");
    const [ty, tm, td] = String(from).split("-").map(Number);
    const akhir = String(to);
    // Iterasi kalender lokal — bukan penambahan 86.400.000 ms, yang meleset di hari
    // pergantian DST. Asia/Jakarta memang tanpa DST, tapi helper ini tak perlu tahu itu.
    const kursor = new Date(ty, tm - 1, td);
    let jaga = 0;
    while (jaga++ < 400) {
        const tgl = `${kursor.getFullYear()}-${p(kursor.getMonth() + 1)}-${p(kursor.getDate())}`;
        if (tgl > akhir) break;
        const e = peta.get(tgl) || { masuk: 0, keluar: 0, jumlah: 0 };
        hasil.push({
            tanggal: tgl,
            hari: kursor.getDate(),
            masuk: e.masuk,
            keluar: e.keluar,
            selisih: e.masuk - e.keluar,
            jumlah: e.jumlah
        });
        kursor.setDate(kursor.getDate() + 1);
    }
    return hasil;
}

/**
 * Rakit data siap-render untuk laporan (dipakai template WA dan halaman web).
 * Tidak menyusun kalimat di sini — teks user-facing tetap milik template.
 */
function buildReportData(summary, entries = [], options = {}) {
    const perKategoriKeluar = (summary.perKategori || [])
        .filter((r) => r.kind === "out")
        .map((r) => ({ category: r.category, total: Number(r.total || 0), jumlah: Number(r.jumlah || 0) }))
        .sort((a, b) => b.total - a.total);

    return {
        from: summary.from,
        to: summary.to,
        masuk: Number(summary.masuk || 0),
        keluar: Number(summary.keluar || 0),
        selisih: Number(summary.selisih || 0),
        masukRp: formatRupiah(summary.masuk || 0),
        keluarRp: formatRupiah(summary.keluar || 0),
        selisihRp: formatRupiah(summary.selisih || 0),
        jumlahCatatan: Number(summary.jumlahCatatan || 0),
        perKategoriKeluar,
        rincianKategori: perKategoriKeluar.length
            ? perKategoriKeluar.map((r) => `• ${r.category}: ${formatRupiah(r.total)} (${r.jumlah}x)`).join("\n")
            : "• belum ada pengeluaran",
        // Sama seperti di atas TAPI menyertakan status pagu. Dipisah supaya template lama
        // yang cuma memakai ${rincianKategori} tak berubah artinya.
        rincianKategoriPagu: perKategoriKeluar.length
            ? perKategoriKeluar
                  .map((r) => {
                      const pagu = Number((options.pagu || {})[r.category] || 0);
                      if (!pagu) return `• ${r.category}: ${formatRupiah(r.total)} (${r.jumlah}x)`;
                      const persen = Math.round((r.total / pagu) * 100);
                      return `• ${r.category}: ${formatRupiah(r.total)} / ${formatRupiah(pagu)} — ${persen}%${persen > 100 ? " ⚠️ lewat" : ""}`;
                  })
                  .join("\n")
            : "• belum ada pengeluaran",
        daftarCatatan: entries.length
            ? entries
                  .map((e) => `${e.id}. ${e.kind === "in" ? "masuk" : "keluar"} ${formatRupiah(e.amount)} — ${e.note || e.category}`)
                  .join("\n")
            : "belum ada catatan",
        // Baris banding SATU KALIMAT untuk WhatsApp — di chat, tabel tren tak terbaca.
        // Kosong (bukan "0%") bila tak ada pembanding, supaya template tak menyisakan
        // baris menggantung yang membingungkan.
        bandingRingkas: options.banding
            ? `keluar ${arahTeks(options.banding.keluar)} · masuk ${arahTeks(options.banding.masuk)} vs ${options.banding.label || "sebelumnya"}`
            : "",
        rentang: options.rentang || "",
        rataKeluarRp: options.hari > 0 ? formatRupiah(Math.round(Number(summary.keluar || 0) / options.hari)) : formatRupiah(0),
        hariTerborosTeks: options.hariTerboros
            ? `${options.hariTerboros.tanggal.slice(8)}/${options.hariTerboros.tanggal.slice(5, 7)} (${formatRupiah(options.hariTerboros.keluar)})`
            : "-"
    };
}

/** "▼12%" / "▲5%" / "baru" / "tetap" — dipakai baris banding ringkas di WhatsApp. */
function arahTeks(t) {
    if (!t || t.arah === "tetap") return "tetap";
    if (t.persen == null) return t.arah === "naik" ? "baru" : "tetap";
    return (t.arah === "naik" ? "▲" : "▼") + Math.abs(t.persen) + "%";
}

module.exports = {
    DEFAULT_CATEGORIES,
    KIND_ALIASES,
    UMBRELLA_WORDS,
    TRIGGER_WORDS,
    parseAmount,
    resolveCategories,
    inferCategory,
    parsePersonalFinanceCommand,
    formatRupiah,
    todayStr,
    monthRange,
    dayRange,
    weekRange,
    previousRange,
    hitungTren,
    toCsvRow,
    toCsv,
    buildDailySeries,
    buildReportData
};
