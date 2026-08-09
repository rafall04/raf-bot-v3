/**
 * Header Doc
 * Purpose: Owner BIAYA RUTIN usaha (internet upstream, listrik, sewa) — pos yang jumlah dan
 *          tanggalnya sudah diketahui sehingga tak perlu diketik ulang tiap bulan.
 *          Modul ini HANYA menyimpan definisi + status per periode; pengeluaran sebenarnya
 *          tetap dibuat lewat `lib/expense-manager.createExpense`, jadi tak ada pembukuan
 *          kedua (lihat #b177).
 *          SENGAJA tidak memposting sendiri: satu baris pengeluaran adalah pernyataan bahwa
 *          uang benar-benar keluar. Bot mengingatkan, manusia mengonfirmasi — kalau tidak,
 *          nominal yang meleset menghasilkan pembukuan salah yang tampak meyakinkan.
 * Caller: `lib/cron/jobs/recurring-expense-reminder.js`, `message/handlers/business-expense-wa.js`,
 *         `routes/admin-kas-usaha-routes.js`.
 * Deps: `global.db` (sqlite utama, sama dengan `expense_entries`), `./expense-manager`.
 * MainFuncs: `ensureTable`, `listAll`, `simpan`, `hapus`, `jatuhTempoHariIni`, `tandaiDiingatkan`,
 *            `tertunda`, `konfirmasi`, `lewati`, `periodeSekarang`.
 * SideEffects: Menulis tabel `recurring_expenses`; `konfirmasi` juga membuat `expense_entries`.
 */
"use strict";

let siap = null;

function db() {
    if (!global.db) throw new Error("Database belum siap");
    return global.db;
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db().run(sql, params, function cb(err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db().get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
    });
}

async function ensureTable() {
    if (!siap) {
        siap = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS recurring_expenses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nama TEXT NOT NULL,
                    perkiraan INTEGER NOT NULL CHECK (perkiraan > 0),
                    kategori TEXT NOT NULL,
                    tanggal INTEGER NOT NULL CHECK (tanggal BETWEEN 1 AND 31),
                    metode TEXT NOT NULL DEFAULT 'TUNAI',
                    aktif INTEGER NOT NULL DEFAULT 1,
                    -- Status disimpan sebagai PERIODE 'YYYY-MM', bukan boolean/timestamp:
                    -- prod restart 7-13x/hari, dan hanya penanda per-periode yang membuat
                    -- pengingat & posting idempoten tanpa bergantung pada state di memori.
                    last_reminded_period TEXT,
                    last_settled_period TEXT,
                    last_action TEXT,
                    catatan TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            `);
            await run("CREATE INDEX IF NOT EXISTS idx_recurring_aktif ON recurring_expenses(aktif, tanggal)");
        })().catch((e) => {
            siap = null;
            throw e;
        });
    }
    return siap;
}

/** Periode akuntansi 'YYYY-MM' — satuan idempotensi seluruh modul ini. */
function periodeSekarang(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function listAll() {
    await ensureTable();
    return all("SELECT * FROM recurring_expenses ORDER BY aktif DESC, tanggal ASC, nama ASC");
}

async function cari(id) {
    await ensureTable();
    return get("SELECT * FROM recurring_expenses WHERE id = ?", [Number(id)]);
}

/**
 * Urai nominal gaya Indonesia memakai penerjemah yang SAMA dengan jalur WhatsApp
 * (`lib/personal-finance-service.parseAmount`) — supaya "850rb" berarti hal yang sama di
 * grup maupun di halaman. Dua penerjemah berbeda untuk satu konsep adalah cara paling
 * pasti membuat angka di pembukuan tak cocok dengan yang diucapkan orang.
 * Angka murni (dari kolom yang sudah tervalidasi) tetap diterima apa adanya.
 * @param {string|number} nilai
 * @returns {number} rupiah bulat, atau NaN kalau tak terbaca (pemanggil yang menolak)
 */
function uraiNominal(nilai) {
    if (typeof nilai === "number") return Math.round(nilai);
    const { parseAmount } = require("./personal-finance-service");
    const hasil = parseAmount(nilai);
    return hasil == null ? NaN : hasil;
}

/** Buat atau perbarui satu definisi biaya rutin. */
async function simpan(data = {}) {
    await ensureTable();
    const nama = String(data.nama || "").trim();
    // Nominal diurai penerjemah yang SAMA dengan jalur WhatsApp — "850rb", "2,5jt", "Rp1.500.000"
    // semuanya sah. `Number()` polos memulangkan NaN untuk semua bentuk itu, sehingga halaman
    // menolak nominal yang petunjuknya sendiri contohkan.
    const perkiraan = uraiNominal(data.perkiraan);
    const kategori = String(data.kategori || "operasional").trim();
    const tanggal = Math.round(Number(data.tanggal));

    if (!nama) throw new Error("Nama biaya wajib diisi");
    if (!Number.isFinite(perkiraan) || perkiraan <= 0) throw new Error("Perkiraan nominal wajib lebih dari 0");
    if (!Number.isFinite(tanggal) || tanggal < 1 || tanggal > 31) throw new Error("Tanggal jatuh tempo harus 1-31");

    const { EXPENSE_CATEGORIES } = require("./expense-manager");
    if (!EXPENSE_CATEGORIES.includes(kategori)) throw new Error("Kategori tidak valid");

    const metode = String(data.metode || "TUNAI").trim().toUpperCase() || "TUNAI";
    const aktif = data.aktif === false || data.aktif === 0 ? 0 : 1;
    const catatan = String(data.catatan || "").trim() || null;

    if (data.id) {
        await run(
            `UPDATE recurring_expenses
                SET nama=?, perkiraan=?, kategori=?, tanggal=?, metode=?, aktif=?, catatan=?, updated_at=datetime('now')
              WHERE id=?`,
            [nama, perkiraan, kategori, tanggal, metode, aktif, catatan, Number(data.id)]
        );
        return cari(data.id);
    }
    const r = await run(
        `INSERT INTO recurring_expenses (nama, perkiraan, kategori, tanggal, metode, aktif, catatan)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [nama, perkiraan, kategori, tanggal, metode, aktif, catatan]
    );
    return cari(r.lastID);
}

async function hapus(id) {
    await ensureTable();
    const r = await run("DELETE FROM recurring_expenses WHERE id = ?", [Number(id)]);
    return { dihapus: r.changes > 0 };
}

/**
 * Item yang jatuh tempo HARI INI dan belum diingatkan pada periode berjalan.
 * Tanggal 29-31 pada bulan pendek jatuh ke hari terakhir bulan itu — kalau tidak,
 * tagihan bertanggal 31 tak pernah muncul di Februari.
 */
async function jatuhTempoHariIni(date = new Date()) {
    await ensureTable();
    const periode = periodeSekarang(date);
    const hariIni = date.getDate();
    const hariTerakhir = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

    const rows = await all(
        `SELECT * FROM recurring_expenses
          WHERE aktif = 1
            AND (last_reminded_period IS NULL OR last_reminded_period != ?)
            AND (last_settled_period IS NULL OR last_settled_period != ?)`,
        [periode, periode]
    );
    return rows.filter((r) => {
        const tgl = Math.min(Number(r.tanggal), hariTerakhir);
        return tgl === hariIni;
    });
}

async function tandaiDiingatkan(id, date = new Date()) {
    await ensureTable();
    await run("UPDATE recurring_expenses SET last_reminded_period=?, updated_at=datetime('now') WHERE id=?", [
        periodeSekarang(date),
        Number(id)
    ]);
}

/** Item yang sudah diingatkan periode ini tapi belum dituntaskan (dicatat/dilewati). */
async function tertunda(date = new Date()) {
    await ensureTable();
    const periode = periodeSekarang(date);
    return all(
        `SELECT * FROM recurring_expenses
          WHERE aktif = 1
            AND last_reminded_period = ?
            AND (last_settled_period IS NULL OR last_settled_period != ?)
          ORDER BY tanggal ASC, id ASC`,
        [periode, periode]
    );
}

/**
 * Konfirmasi: buat pengeluaran SUNGGUHAN lewat expense-manager lalu tandai periode tuntas.
 * `nominal` boleh berbeda dari perkiraan — justru itu alasan konfirmasi ada.
 * Urutannya sengaja: createExpense DULU, baru tandai. Kalau pencatatan gagal, item tetap
 * tertunda dan bisa dicoba lagi — lebih baik daripada tertandai tuntas tanpa entri apa pun.
 */
async function konfirmasi(id, { nominal, actor = "WhatsApp", date = new Date() } = {}) {
    const item = await cari(id);
    if (!item) throw new Error("Biaya rutin tidak ditemukan");

    const periode = periodeSekarang(date);
    if (item.last_settled_period === periode) throw new Error(`"${item.nama}" sudah dituntaskan periode ini`);

    // Nominal KOSONG = "pakai perkiraan" (itulah arti balasan `ok` polos). Tapi nominal yang
    // DIISI namun tak terbaca harus GAGAL KERAS: diam-diam memakai perkiraan berarti mencatat
    // angka yang bukan angka yang disebut orangnya — pembukuan salah yang tampak meyakinkan,
    // dan tak ada satu pun tanda bahwa ada yang meleset.
    const adaNominal = nominal !== undefined && nominal !== null && String(nominal).trim() !== "";
    let jumlah;
    if (adaNominal) {
        jumlah = uraiNominal(nominal);
        if (!Number.isFinite(jumlah) || jumlah <= 0) {
            throw new Error(`Nominal "${nominal}" tidak terbaca. Tulis seperti 620rb, 1,5jt, atau 620000.`);
        }
    } else {
        jumlah = Number(item.perkiraan);
    }

    const { createExpense } = require("./expense-manager");
    const dibuat = await createExpense(
        {
            title: item.nama,
            category: item.kategori,
            amount: jumlah,
            payment_method: item.metode || "TUNAI",
            notes: `Biaya rutin ${periode}${item.catatan ? ` — ${item.catatan}` : ""}`
        },
        { name: actor }
    );

    await run(
        "UPDATE recurring_expenses SET last_settled_period=?, last_action='dicatat', updated_at=datetime('now') WHERE id=?",
        [periode, Number(id)]
    );
    return { item, expense: dibuat, jumlah };
}

/** Lewati periode ini (mis. bulan ini memang tak ada tagihan). Tak membuat pengeluaran. */
async function lewati(id, date = new Date()) {
    const item = await cari(id);
    if (!item) throw new Error("Biaya rutin tidak ditemukan");
    await run(
        "UPDATE recurring_expenses SET last_settled_period=?, last_action='dilewati', updated_at=datetime('now') WHERE id=?",
        [periodeSekarang(date), Number(id)]
    );
    return { item };
}

module.exports = {
    ensureTable,
    periodeSekarang,
    listAll,
    cari,
    simpan,
    hapus,
    jatuhTempoHariIni,
    tandaiDiingatkan,
    tertunda,
    konfirmasi,
    lewati
};
