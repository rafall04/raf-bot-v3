/**
 * Header Doc
 * Purpose: Ledger pembayaran periodik — infra runtime/DB/reader bersama, schema self-heal, harga efektif, konsumsi diskon, record history/reversal, posisi bayar, applyPaymentStatusChange.
 * Caller: facade `lib/payment-finance-service.js` (re-export; jangan require langsung kecuali test).
 * Deps: crypto, ./database, ./env-config, ./sqlite-shared-reader, ./financial-ledger, ./technician-collection-settlement, ./agen-collection-settlement.
 * MainFuncs: `applyPaymentStatusChange`, `ensurePaymentFinanceTables`, `getPaymentPositionForPeriod`, `getEffectivePrice`, `withPaymentReadContext`.
 * SideEffects: sama seperti lib/payment-finance-service.js asli (split #b394 — murni pemindahan kode).
 */
"use strict";


const { randomUUID: _randomUUID } = require("crypto");

const { loadJSON } = require("../database");

const { getDatabasePath } = require("../env-config");

const { getSharedReader, dropSharedReader } = require("../sqlite-shared-reader");

const { syncFinancialLedgerSources } = require("../financial-ledger");

const {
    evaluateCollectionSettlement,
    // `hasAnyCommissionCreditForUserPeriod` SENGAJA tak lagi diimpor: dulu dipakai sebagai
    // penanda idempotensi diskon, dan itulah akar diskon yang tak pernah habis. Diskon kini
    // punya tabel penandanya sendiri (`discount_consumption`).
    getPeriodParts
} = require("../technician-collection-settlement");

const {
    evaluateAgenCollectionSettlement
} = require("../agen-collection-settlement");

let initializationPromise = null;


function getRuntime() {
    return global.__appRuntime || null;
}


function getRuntimeRepository(name) {
    const runtime = getRuntime();
    if (!runtime || typeof runtime.getRepository !== "function") {
        return null;
    }

    try {
        return runtime.getRepository(name);
    } catch (__error) {
        return null;
    }
}


async function ensureMainDbReady() {
    const runtime = getRuntime();
    if (runtime && typeof runtime.getDb === "function") {
        const runtimeDb = runtime.getDb();
        if (runtimeDb) {
            return runtimeDb;
        }
    }
    if (global.db) {
        return global.db;
    }
    if (global.__dbInitPromise) {
        await global.__dbInitPromise;
    }
    if (runtime && typeof runtime.getDb === "function" && runtime.getDb()) {
        return runtime.getDb();
    }
    if (!global.db) {
        throw new Error("Database not initialized");
    }
    return global.db;
}


function dbRun(sql, params = []) {
    return ensureMainDbReady().then((db) => new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    }));
}


function dbGet(sql, params = []) {
    return ensureMainDbReady().then((db) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row || null);
        });
    }));
}


function dbAll(sql, params = []) {
    return ensureMainDbReady().then((db) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    }));
}


function getReaderDbPath() {
    return getDatabasePath("users.sqlite");
}


function getReaderDb() {
    // Koneksi baca BERSAMA & berumur panjang. Dulu di sini dibuka koneksi BARU tiap
    // pemanggilan lalu ditutup — pola itu membuat `-wal`/`-shm` users.sqlite yatim dan
    // memunculkan `SQLITE_IOERR` acak pada jalur tulis pembayaran. Lihat lib/sqlite-shared-reader.
    return getSharedReader(getReaderDbPath());
}


/**
 * Buang koneksi baca bersama bila query gagal dengan error tingkat-file, supaya
 * panggilan berikutnya memakai koneksi segar alih-alih koneksi yang sudah rusak.
 */
function handleReaderError(error) {
    if (error && typeof error.code === "string" && error.code.startsWith("SQLITE_IOERR")) {
        console.error(`[PAYMENT_FINANCE_READER_IOERR] ${error.message} — koneksi baca dibuang, panggilan berikutnya membuka koneksi segar.`);
        dropSharedReader(getReaderDbPath());
    }
}


function createReaderContext() {
    const db = getReaderDb();
    return {
        db,
        // NO-OP DISENGAJA: koneksi ini dipakai bersama seluruh jalur baca. Menutupnya
        // di akhir tiap operasi adalah persis pola yang me-yatimkan `-wal`/`-shm`.
        close() {
            return Promise.resolve();
        }
    };
}


function readerGet(sql, params = [], context = createReaderContext()) {
    return new Promise((resolve, reject) => {
        const { db } = context;
        db.get(sql, params, (err, row) => {
            if (err) {
                handleReaderError(err);
                reject(err);
                return;
            }
            resolve(row || null);
        });
    });
}


function readerAll(sql, params = [], context = createReaderContext()) {
    return new Promise((resolve, reject) => {
        const { db } = context;
        db.all(sql, params, (err, rows) => {
            if (err) {
                handleReaderError(err);
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}


async function withReaderContext(operation) {
    const context = createReaderContext();
    try {
        return await operation(context);
    } finally {
        await context.close();
    }
}


async function withPaymentReadContext(operation) {
    return withReaderContext(operation);
}


function toInteger(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}


function buildNowIso() {
    return new Date().toISOString();
}


function getCurrentBillingPeriod(options = {}) {
    const { periodMonth, periodYear } = getPeriodParts({
        date: options.date || new Date()
    });
    return { periodMonth, periodYear };
}


function normalizeUserPaymentMethod(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const normalized = String(value).trim().toUpperCase();
    return ["CASH", "TRANSFER_BANK"].includes(normalized) ? normalized : null;
}


function getPackagePrice(packageName) {
    if (!packageName || typeof packageName !== "string") {
        return 0;
    }

    const packagesRepo = getRuntimeRepository("packages");
    const packagesDb = packagesRepo ? packagesRepo.getAll() : loadJSON("database/packages.json");
    const packageData = packagesDb.find((pkg) => pkg.name === packageName);
    if (packageData && packageData.price) {
        return toInteger(packageData.price);
    }

    const patterns = [
        /([0-9]+)K/i,
        /([0-9]+)000/,
        /([0-9]+)[.,]000/
    ];

    for (const pattern of patterns) {
        const match = packageName.match(pattern);
        if (match) {
            return toInteger(match[1]) * 1000;
        }
    }

    return 0;
}


function getEffectivePrice(user) {
    const basePrice = toInteger(user?.subscription_price) || getPackagePrice(user?.subscription);
    if (!user) {
        return basePrice;
    }

    let isDiscountValid = true;
    const discountMonths = toInteger(user.discount_months);
    const discountMonthsUsed = toInteger(user.discount_months_used);

    if (user.discount_valid_until) {
        isDiscountValid = new Date(user.discount_valid_until) >= new Date();
    }
    if (discountMonths > 0) {
        isDiscountValid = discountMonthsUsed < discountMonths;
    }
    if (!isDiscountValid) {
        return basePrice;
    }

    let discountValue = 0;
    if (toInteger(user.discount_percentage) > 0) {
        discountValue = Math.round(basePrice * toInteger(user.discount_percentage) / 100);
    } else if (toInteger(user.discount_amount) > 0) {
        discountValue = toInteger(user.discount_amount);
    }

    return Math.max(0, basePrice - discountValue);
}


/**
 * Nominal tagihan untuk PESAN penagihan, dengan pembeda antara "nol yang SAH" dan "nol karena
 * tidak bisa dihitung".
 *
 * Kenapa perlu: `getEffectivePrice` membaca katalog paket dari runtime repository / `packages.json`,
 * BUKAN dari `global.packages` milik pemanggil. Kalau katalog itu belum siap (atau nama paket tak
 * ada di sana), ia memulangkan 0 — dan memperlakukan 0 itu sebagai "tak ada tagihan" akan
 * MENGHENTIKAN penagihan diam-diam untuk semua orang. Itu kegagalan yang jauh lebih mahal daripada
 * salah nominal.
 *
 * @param {object} user
 * @param {number} hargaPaketFallback harga paket dari katalog milik pemanggil (`global.packages`).
 * @returns {{amount:number, zeroIsReal:boolean, reason:string}}
 */
function resolveBillingAmount(user, hargaPaketFallback) {
    const efektif = toInteger(getEffectivePrice(user));
    if (efektif > 0) return { amount: efektif, zeroIsReal: false, reason: "harga-efektif" };

    const fallback = toInteger(hargaPaketFallback);
    const adaDiskon = toInteger(user?.discount_percentage) > 0 || toInteger(user?.discount_amount) > 0;
    const hargaKhususNol =
        user?.subscription_price !== undefined &&
        user?.subscription_price !== null &&
        toInteger(user.subscription_price) === 0 &&
        String(user.subscription_price).trim() !== "";

    // Nol yang SAH: memang digratiskan, atau paketnya memang berharga 0.
    if (adaDiskon || hargaKhususNol || fallback === 0) {
        return { amount: 0, zeroIsReal: true, reason: adaDiskon ? "diskon-penuh" : "paket-nol" };
    }

    // Nol BUTA: katalog tak terbaca oleh price-owner padahal pemanggil punya harga paket.
    // Jangan diam — pakai harga paket dan tandai supaya terlihat di log.
    return { amount: fallback, zeroIsReal: false, reason: "katalog-tak-terbaca" };
}


async function syncPaymentHistorySchema() {
    const paymentHistoryColumnSpecs = [
        { name: "user_name", sql: "ALTER TABLE payment_history ADD COLUMN user_name TEXT" },
        { name: "request_id", sql: "ALTER TABLE payment_history ADD COLUMN request_id INTEGER" },
        { name: "amount_remaining", sql: "ALTER TABLE payment_history ADD COLUMN amount_remaining INTEGER NOT NULL DEFAULT 0" },
        { name: "teknisi_id", sql: "ALTER TABLE payment_history ADD COLUMN teknisi_id INTEGER" },
        { name: "teknisi_name", sql: "ALTER TABLE payment_history ADD COLUMN teknisi_name TEXT" },
        { name: "approved_by", sql: "ALTER TABLE payment_history ADD COLUMN approved_by INTEGER" },
        { name: "approved_by_name", sql: "ALTER TABLE payment_history ADD COLUMN approved_by_name TEXT" },
        { name: "updated_at", sql: "ALTER TABLE payment_history ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))" },
        { name: "created_by", sql: "ALTER TABLE payment_history ADD COLUMN created_by TEXT" }
    ];
    await dbRun(`
        CREATE TABLE IF NOT EXISTS payment_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT,
            request_id INTEGER,
            amount_due INTEGER NOT NULL,
            amount_paid INTEGER NOT NULL,
            amount_remaining INTEGER NOT NULL DEFAULT 0,
            payment_method TEXT DEFAULT 'CASH',
            is_partial INTEGER DEFAULT 0,
            teknisi_id INTEGER,
            teknisi_name TEXT,
            approved_by INTEGER,
            approved_by_name TEXT,
            period_month INTEGER,
            period_year INTEGER,
            notes TEXT,
            created_by TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    const paymentHistoryColumns = await dbAll("PRAGMA table_info(payment_history)");
    const paymentHistoryColumnNames = new Set(paymentHistoryColumns.map((column) => column.name));
    for (const columnSpec of paymentHistoryColumnSpecs) {
        if (!paymentHistoryColumnNames.has(columnSpec.name)) {
            await dbRun(columnSpec.sql);
        }
    }
    await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_history_user ON payment_history(user_id)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_history_period ON payment_history(period_month, period_year)");
    await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_history_teknisi ON payment_history(teknisi_id)");
}

/**
 * Pastikan kolom `discount_*` ada di tabel `users`.
 *
 * AKAR (ditemukan 2026-08-03): skema diskon dulu HANYA hidup di skrip sekali-jalan
 * `scripts/run-new-features-migration.js`, tak pernah masuk `CREATE TABLE users`
 * (`lib/database.js`) maupun sistem migrasi durabel. Skrip itu dihapus di commit `e90f191`
 * dengan asumsi "sudah diterapkan" — padahal di DB produksi kolomnya TIDAK PERNAH ada, jadi

 * `/api/discount/*` selalu 500 dan menu Diskon di sidebar mati tanpa ada yang sadar.
 *
 * Ditaruh di modul ini karena modul inilah yang MEMBACA `discount_*` untuk harga efektif
 * (`getEffectivePrice`) dan MENULIS `discount_months_used` — pemilik kolom = pemakainya.
 * Idempoten: hanya menambah kolom yang belum ada, tak pernah menyentuh data.
 */
async function syncUserDiscountSchema() {
    const discountColumnSpecs = [
        { name: "discount_amount", sql: "ALTER TABLE users ADD COLUMN discount_amount INTEGER DEFAULT 0" },
        { name: "discount_percentage", sql: "ALTER TABLE users ADD COLUMN discount_percentage INTEGER DEFAULT 0" },
        { name: "discount_reason", sql: "ALTER TABLE users ADD COLUMN discount_reason TEXT" },
        { name: "discount_valid_until", sql: "ALTER TABLE users ADD COLUMN discount_valid_until TEXT" },
        { name: "discount_months", sql: "ALTER TABLE users ADD COLUMN discount_months INTEGER DEFAULT 0" },
        { name: "discount_months_used", sql: "ALTER TABLE users ADD COLUMN discount_months_used INTEGER DEFAULT 0" },
        { name: "discount_created_by", sql: "ALTER TABLE users ADD COLUMN discount_created_by TEXT" },
        { name: "discount_created_at", sql: "ALTER TABLE users ADD COLUMN discount_created_at TEXT" }
    ];

    const userColumns = await dbAll("PRAGMA table_info(users)");
    // Tabel `users` dimiliki `lib/database.js`. Kalau belum ada (PRAGMA balas kosong),
    // JANGAN membuatnya di sini — cukup mundur, pemiliknya yang akan membuat lengkap.
    if (!userColumns.length) {
        return;
    }

    const existing = new Set(userColumns.map((column) => column.name));
    for (const columnSpec of discountColumnSpecs) {
        if (!existing.has(columnSpec.name)) {
            await dbRun(columnSpec.sql);
            console.log(`[PAYMENT_FINANCE_SCHEMA] Kolom users.${columnSpec.name} ditambahkan (self-heal diskon).`);
        }
    }
}


async function ensurePaymentFinanceTables() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await dbRun(`
                CREATE TABLE IF NOT EXISTS payment_reversals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    amount_reversed INTEGER NOT NULL,
                    source_request_id TEXT,
                    source_admin_action TEXT,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'completed',
                    event_key TEXT NOT NULL
                )
            `);
            await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_reversals_event_key ON payment_reversals(event_key)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_reversals_period ON payment_reversals(period_year, period_month)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_reversals_user_period ON payment_reversals(user_id, period_year, period_month)");
            // Waiver = pembebasan tagihan (GRATIS/kompensasi). Tabel TERPISAH dari payment_history
            // agar TIDAK pernah ikut dijumlahkan sebagai pemasukan; hanya memengaruhi is_fully_paid.
            await dbRun(`
                CREATE TABLE IF NOT EXISTS payment_waivers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    amount_waived INTEGER NOT NULL DEFAULT 0,
                    reason TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    event_key TEXT NOT NULL
                )
            `);
            await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_waivers_event_key ON payment_waivers(event_key)");
            await dbRun("CREATE INDEX IF NOT EXISTS idx_payment_waivers_user_period ON payment_waivers(user_id, period_year, period_month)");
            // Penanda pemakaian diskon MILIK DOMAIN DISKON SENDIRI.
            //
            // Sebelumnya `consumeDiscountForPeriod` memakai keberadaan kredit komisi teknisi
            // pada (user, periode) sebagai penanda "sudah dihitung" — padahal kredit itu
            // disisipkan beberapa baris SEBELUMNYA dalam pemanggilan yang sama
            // (`evaluateCollectionSettlement` → lalu `consumeDiscountForPeriod`). Jadi ketika
            // `teknisiCollectionCommissionEnabled` menyala, gerbangnya SELALU tertutup:
            // `discount_months_used` tak pernah naik dan diskon berlaku SELAMANYA. Pelanggan
            // dengan diskon Rp50.000/3 bulan tetap dipotong Rp50.000 di bulan ke-12, sementara
            // halaman Diskon tetap menampilkan "sisa 3 bulan".
            //
            // UNIQUE(user_id, period_month, period_year) = satu periode hanya bisa memakai
            // jatah diskon sekali, terlepas dari ada/tidaknya kolektor.
            await dbRun(`
                CREATE TABLE IF NOT EXISTS discount_consumption (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                )
            `);
            await dbRun("CREATE UNIQUE INDEX IF NOT EXISTS idx_discount_consumption_user_period ON discount_consumption(user_id, period_month, period_year)");
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }
    await initializationPromise;
    await syncPaymentHistorySchema();
    await syncUserDiscountSchema();
}


async function syncPaymentLedgerDomains() {
    try {
        await syncFinancialLedgerSources({ domains: ["payment_history", "payment_reversal", "technician_collection"] });
    } catch (error) {
        console.error("[PAYMENT_FINANCE_LEDGER_SYNC_ERROR]", error.message);
    }
}


async function setUserPaidStatus(user, isPaid) {
    const paidValue = isPaid ? 1 : 0;
    await dbRun("UPDATE users SET paid = ? WHERE id = ?", [paidValue, user.id]);

    const usersRepo = getRuntimeRepository("users");
    if (usersRepo) {
        usersRepo.update((items) => items.map((item) => (
            String(item.id) === String(user.id)
                ? { ...item, paid: paidValue }
                : item
        )));
    } else {
        const memoryUser = (global.users || []).find((item) => String(item.id) === String(user.id));
        if (memoryUser) {
            memoryUser.paid = paidValue;
        }
    }
    user.paid = paidValue;
}


function normalizePaymentRequestScope(request) {
    const { periodMonth, periodYear } = getPeriodParts({
        periodMonth: parseInt(request?.period_month, 10),
        periodYear: parseInt(request?.period_year, 10),
        date: request?.updated_at || request?.created_at || new Date()
    });
    return {
        ...request,
        period_month: periodMonth,
        period_year: periodYear,
        request_type: request?.request_type || (request?.is_partial_payment ? "partial_payment" : "payment_status_change")
    };
}


// !! `request_type` SENGAJA TIDAK IKUT JADI KUNCI (#b254).
// Dulu ikut, dan itu membuat penjaga duplikat tersegmentasi per tipe: satu pelanggan + satu
// periode bisa punya DUA pengajuan menunggu sekaligus — cicilan Rp50.000 DAN pelunasan penuh.
// Kalau admin menyetujui keduanya, ledger dikredit dua kali (pengajuan "penuh" tak menyimpan
// `amount_paid`, jadi jatuh ke HARGA PAKET PENUH), dan `outstanding = max(0, ...)` menyembunyikan
// kelebihannya di angka 0 sehingga tak ada yang sadar. Ini alur NORMAL, bukan penyalahgunaan.
//
// Satu pelanggan + satu periode = SATU keputusan pembayaran yang menunggu. Mau ganti dari cicilan
// ke lunas? Batalkan dulu (`/api/requests/cancel`).
function isSamePaymentRequestScope(left, right) {
    const normalizedLeft = normalizePaymentRequestScope(left);
    const normalizedRight = normalizePaymentRequestScope(right);
    return String(normalizedLeft.userId) === String(normalizedRight.userId)
        && toInteger(normalizedLeft.period_month) === toInteger(normalizedRight.period_month)
        && toInteger(normalizedLeft.period_year) === toInteger(normalizedRight.period_year);
}


async function consumeDiscountForPeriod(user, periodMonth, periodYear) {
    if (!user || !(toInteger(user.discount_months) > 0) || toInteger(user.discount_months_used) >= toInteger(user.discount_months)) {
        return false;
    }

    // Penanda idempotensi MILIK DOMAIN DISKON. Dulu memakai
    // `hasAnyCommissionCreditForUserPeriod` — ledger komisi teknisi — sebagai proxy, padahal
    // kredit itu baru saja disisipkan oleh `evaluateCollectionSettlement` di pemanggilan yang
    // SAMA. Gerbangnya selalu menyala, `discount_months_used` tak pernah naik, dan diskon
    // berlaku selamanya (bocor sebesar nominal diskon setiap bulan, per pelanggan, tanpa
    // peringatan apa pun). Ledger komisi bukan peristiwa diskon — jangan dipakai lagi sebagai
    // proxy-nya.
    //
    // INSERT OR IGNORE + UNIQUE index: bila periode ini sudah pernah memakai jatah diskon,
    // barisnya tak bertambah dan `changes === 0`, jadi keputusannya diambil dari DATABASE,
    // bukan dari pembacaan yang bisa balapan dengan penulis lain.
    const now = new Date().toISOString();
    const penanda = await dbRun(
        "INSERT OR IGNORE INTO discount_consumption (user_id, period_month, period_year, created_at) VALUES (?, ?, ?, ?)",
        [user.id, toInteger(periodMonth), toInteger(periodYear), now]
    );
    const sudahDipakaiPeriodeIni = !penanda || toInteger(penanda.changes) === 0;
    if (sudahDipakaiPeriodeIni) {
        return false;
    }

    const newDiscountMonthsUsed = toInteger(user.discount_months_used) + 1;
    await dbRun("UPDATE users SET discount_months_used = ? WHERE id = ?", [newDiscountMonthsUsed, user.id]);
    user.discount_months_used = newDiscountMonthsUsed;

    if (newDiscountMonthsUsed >= toInteger(user.discount_months)) {
        await dbRun(`UPDATE users SET
            discount_amount = 0,
            discount_percentage = 0,
            discount_reason = NULL,
            discount_valid_until = NULL,
            discount_created_by = NULL,
            discount_created_at = NULL
            WHERE id = ?`, [user.id]);
        user.discount_amount = 0;
        user.discount_percentage = 0;
        user.discount_reason = null;
        user.discount_valid_until = null;
        user.discount_created_by = null;
        user.discount_created_at = null;
    }

    return true;
}


/**
 * Kebalikan `consumeDiscountForPeriod`: mengembalikan jatah diskon saat pembayaran DIBALIKKAN.
 *
 * Tanpa ini, admin yang salah menandai lunas lalu membatalkannya membuat pelanggan kehilangan
 * satu bulan diskon PERMANEN — `discount_months_used` sudah naik, dan bila itu jatah terakhir
 * seluruh kolom diskon sudah dinolkan. Pelanggan lalu ditagih harga penuh untuk bulan yang
 * seharusnya masih berdiskon, tanpa jejak apa pun.
 *
 * CATATAN JUJUR: `discount_amount`/`discount_percentage` yang sudah dinolkan saat jatah habis
 * TIDAK bisa dipulihkan otomatis — nilainya tak disimpan di mana pun. Yang dikembalikan adalah
 * KUOTA-nya (`discount_months_used` turun) plus penanda periodenya, sehingga admin bisa
 * mengisi ulang nominalnya lewat halaman Diskon. Itu dicatat ke log supaya tak senyap.
 *
 * @returns {Promise<boolean>} true bila jatah benar-benar dikembalikan.
 */
async function releaseDiscountForPeriod(user, periodMonth, periodYear) {
    if (!user || !user.id) return false;

    // Hanya kembalikan bila penandanya MEMANG ada untuk periode ini — supaya pembalikan
    // berulang tak menambah jatah dari udara. `changes` dari DELETE adalah kebenarannya.
    const hapus = await dbRun(
        "DELETE FROM discount_consumption WHERE user_id = ? AND period_month = ? AND period_year = ?",
        [user.id, toInteger(periodMonth), toInteger(periodYear)]
    );
    if (!hapus || toInteger(hapus.changes) === 0) {
        return false;
    }

    const dipakaiSekarang = Math.max(0, toInteger(user.discount_months_used) - 1);
    await dbRun("UPDATE users SET discount_months_used = ? WHERE id = ?", [dipakaiSekarang, user.id]);
    user.discount_months_used = dipakaiSekarang;

    console.warn(
        `[DISKON] Jatah diskon periode ${periodMonth}/${periodYear} dikembalikan untuk user ${user.id} ` +
        `(dipakai: ${dipakaiSekarang}/${toInteger(user.discount_months)}). ` +
        `Bila nominal diskon sempat dinolkan karena jatah habis, isi ulang lewat halaman Diskon — ` +
        `nilai lamanya tidak disimpan di mana pun.`
    );

    return true;
}


async function recordPaymentHistoryEntry({
    userId,
    amountPaid,
    amountDue,
    isPartial,
    periodMonth,
    periodYear,
    paymentMethod,
    notes,
    createdBy
}) {
    const result = await dbRun(
        `INSERT INTO payment_history (
            user_id, amount_paid, amount_due, is_partial, period_month, period_year,
            payment_method, notes, created_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            Math.abs(toInteger(amountPaid)),
            Math.abs(toInteger(amountDue)),
            isPartial ? 1 : 0,
            periodMonth,
            periodYear,
            paymentMethod || null,
            notes || "",
            createdBy || "system",
            buildNowIso()
        ]
    );

    await syncPaymentLedgerDomains();
    return { id: result.lastID };
}


async function recordPaymentReversalEntry({
    userId,
    periodMonth,
    periodYear,
    amountReversed,
    sourceRequestId = null,
    sourceAdminAction = null,
    createdBy,
    reason,
    idempotencyKey = null
}) {
    await ensurePaymentFinanceTables();

    const normalizedAmount = Math.abs(toInteger(amountReversed));
    if (!normalizedAmount) {
        return { created: false, reason: "no_amount" };
    }

    const eventKey = idempotencyKey
        || `payment_reversal:${userId}:${periodYear}:${periodMonth}:${sourceRequestId || "no-request"}:${sourceAdminAction || "no-admin-action"}`;

    try {
        const result = await dbRun(
            `INSERT INTO payment_reversals (
                user_id, period_month, period_year, amount_reversed, source_request_id, source_admin_action,
                created_by, created_at, reason, status, event_key
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
            [
                userId,
                periodMonth,
                periodYear,
                normalizedAmount,
                sourceRequestId ? String(sourceRequestId) : null,
                sourceAdminAction || null,
                createdBy || "system",
                buildNowIso(),
                reason || "payment_reversal",
                eventKey
            ]
        );
        await syncPaymentLedgerDomains();
        return {
            created: true,
            duplicate: false,
            id: result.lastID,
            eventKey
        };
    } catch (error) {
        if (!String(error.message || "").includes("UNIQUE")) {
            throw error;
        }
        const row = await dbGet("SELECT id FROM payment_reversals WHERE event_key = ?", [eventKey]);
        return {
            created: false,
            duplicate: true,
            id: row?.id || null,
            eventKey
        };
    }
}


async function getPaymentPositionForPeriod(user, periodMonth, periodYear, options = {}) {
    await ensurePaymentFinanceTables();
    const userId = typeof user === "object" ? user.id : user;
    const amountDue = Math.abs(toInteger(options.amountDue || (typeof user === "object" ? getEffectivePrice(user) : 0)));

    const { paidRow, reversalRow, waiverRow } = await withReaderContext(async (context) => ({
        paidRow: await readerGet(
            `SELECT COALESCE(SUM(amount_paid), 0) AS gross_paid
             FROM payment_history
             WHERE user_id = ? AND period_month = ? AND period_year = ?`,
            [userId, periodMonth, periodYear],
            context
        ),
        reversalRow: await readerGet(
            `SELECT COALESCE(SUM(amount_reversed), 0) AS total_reversal
             FROM payment_reversals
             WHERE user_id = ? AND period_month = ? AND period_year = ? AND status = 'completed'`,
            [userId, periodMonth, periodYear],
            context
        ),
        // Waiver (GRATIS/kompensasi) — TIDAK masuk gross_paid (bukan pemasukan), hanya menandai
        // periode ini "dibebaskan" sehingga dihitung lunas (aman isolir + sinkron rollover).
        waiverRow: await readerGet(
            `SELECT COUNT(*) AS waiver_count, COALESCE(SUM(amount_waived), 0) AS total_waived
             FROM payment_waivers
             WHERE user_id = ? AND period_month = ? AND period_year = ? AND status = 'active'`,
            [userId, periodMonth, periodYear],
            context
        )
    }));

    const grossPaid = Math.abs(toInteger(paidRow?.gross_paid));
    const totalReversal = Math.abs(toInteger(reversalRow?.total_reversal));
    const netPaid = Math.max(0, grossPaid - totalReversal);
    const isWaived = toInteger(waiverRow?.waiver_count) > 0;
    const totalWaived = Math.abs(toInteger(waiverRow?.total_waived));
    // Tagihan Rp0 (pelanggan gratis / paket whitelist) = tak ada yang harus dibayar → otomatis LUNAS.
    // Dulu cabang `netPaid > 0` menuntut adanya pembayaran, sehingga pelanggan gratis (yang memang tak
    // pernah bayar) selalu ter-vonis "belum bayar" walau outstanding=0. Itu akar badge "Belum Bayar"
    // keliru di halaman Status Pembayaran — read-model men-derive `paid` LANGSUNG dari is_fully_paid ini.
    const paidByPayment = amountDue > 0 ? netPaid >= amountDue : true;
    const outstanding = isWaived ? 0 : Math.max(0, amountDue - netPaid);

    return {
        user_id: String(userId),
        period_month: periodMonth,
        period_year: periodYear,
        amount_due: amountDue,
        gross_paid: grossPaid,
        total_reversal: totalReversal,
        net_paid: netPaid,
        is_waived: isWaived,
        total_waived: totalWaived,
        outstanding,
        is_fully_paid: isWaived || paidByPayment
    };
}


/**
 * Daftar user_id yang punya baris `payment_history` pada satu periode.
 * Dipakai pemanggil yang butuh mengenali baris ledger yang SUDAH ditulis (idempotensi)
 * tanpa bergantung pada cache turunan `users.paid` — flag itu selalu di-derive ulang ke
 * periode berjalan, jadi tidak bisa dipakai menandai periode lain.
 * @param {number} periodMonth
 * @param {number} periodYear
 * @param {{createdBy?: string|null}} [options] Saring per penulis baris, mis. "system-backfill".
 * @returns {Promise<string[]>} user_id sebagai string (aman dibanding-bandingkan lintas tipe).
 */
async function listPaymentHistoryUserIdsForPeriod(periodMonth, periodYear, options = {}) {
    await ensurePaymentFinanceTables();
    const { createdBy = null } = options;

    const params = [periodMonth, periodYear];
    let sql = `SELECT DISTINCT user_id
               FROM payment_history
               WHERE period_month = ? AND period_year = ?`;
    if (createdBy) {
        sql += " AND created_by = ?";
        params.push(createdBy);
    }

    const rows = await withReaderContext((context) => readerAll(sql, params, context));
    return rows.map((row) => String(row.user_id));
}


async function syncUserPaidStatusForPeriod({ user, periodMonth, periodYear, amountDue = null }) {
    const position = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue });
    await setUserPaidStatus(user, position.is_fully_paid);
    return position;
}


async function syncUserPaidStatusForCurrentPeriod({ user, amountDue = null, date = null } = {}) {
    const { periodMonth, periodYear } = getCurrentBillingPeriod({ date });
    const resolvedAmountDue = amountDue !== null ? amountDue : getEffectivePrice(user);
    const position = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: resolvedAmountDue });
    await setUserPaidStatus(user, position.is_fully_paid);
    return position;
}


async function applyPaymentStatusChange({
    user,
    paid,
    periodMonth,
    periodYear,
    amountPaid = null,
    amountDue = null,
    isPartial = false,
    paymentMethod = null,
    notes = "",
    createdBy = "system",
    sourceRequestId = null,
    sourceAdminAction = null,
    teknisiId = null,
    teknisiName = null,
    agenId = null,
    agenName = null,
    onFinalPaid = null
}) {
    if (!user || !user.id) {
        throw new Error("user wajib diisi");
    }

    await ensurePaymentFinanceTables();

    const resolvedAmountDue = Math.max(0, toInteger(amountDue) || getEffectivePrice(user));
    const positionBefore = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: resolvedAmountDue });

    if (paid) {
        if (positionBefore.is_fully_paid) {
            return {
                action: "no_change",
                reason: "already_fully_paid",
                positionBefore,
                positionAfter: positionBefore
            };
        }

        const diminta = Math.max(0, toInteger(amountPaid) || resolvedAmountDue);
        if (!diminta) {
            throw new Error("amountPaid wajib lebih besar dari 0");
        }

        // !! PLAFON SISA TAGIHAN (#b254) — jaring kedua, dan yang paling menentukan.
        // Rem `is_fully_paid` di atas hanya menyala kalau periode SUDAH lunas; ia tidak menahan
        // kredit yang MELEBIHI sisa. Terbukti: cicilan Rp50.000 disetujui (belum lunas → lolos),
        // lalu pelunasan penuh disetujui (masih belum lunas → lolos lagi, dan karena pengajuan
        // "penuh" tak menyimpan `amount_paid` ia jatuh ke harga paket) → ledger dikredit
        // Rp125.000 untuk tagihan Rp75.000. `outstanding = max(0, ...)` lalu MENYEMBUNYIKAN
        // kelebihannya di angka 0, jadi tak ada yang sadar sampai rekap keuangan membengkak.
        //
        // Dipotong ke sisa, BUKAN ditolak: menolak akan menghentikan pelunasan sah yang angkanya
        // meleset sedikit. Tapi pemotongannya WAJIB berisik — selisih yang didiamkan adalah cara
        // kesalahan operator berubah jadi angka keuangan yang salah.
        // !! TANPA SYARAT, termasuk saat sisa = 0.
        // Godaannya adalah menulis `sisa > 0 ? min(...) : diminta` dengan alasan "sisa 0 berarti
        // sudah lunas, dan rem `is_fully_paid` di atas yang menanganinya". DATA PRODUKSI
        // MEMBANTAHNYA: Tanjungharjo user 57 periode 7/2026 punya DUA kredit Rp110.000 berselang
        // 4 menit untuk tagihan Rp110.000 — keduanya lewat fungsi ini, jadi rem itu TIDAK menyala.
        // Rem yang terbukti bisa gagal tidak boleh jadi satu-satunya penjaga uang.
        const sisa = Math.max(0, toInteger(positionBefore.outstanding));
        if (sisa <= 0) {
            console.warn(
                `[BAYAR_DITOLAK_TAK_ADA_SISA] user=${user && user.id} periode=${periodMonth}/${periodYear}` +
                ` diminta=${diminta} tapi sisa tagihan 0 — kredit DIBATALKAN (anti pemasukan hantu).`
            );
            return {
                action: "no_change",
                reason: "tidak_ada_sisa_tagihan",
                positionBefore,
                positionAfter: positionBefore
            };
        }
        const resolvedAmountPaid = Math.min(diminta, sisa);
        if (resolvedAmountPaid < diminta) {
            console.warn(
                `[BAYAR_DIPOTONG_KE_SISA] user=${user && user.id} periode=${periodMonth}/${periodYear}` +
                ` diminta=${diminta} sisa=${sisa} dikredit=${resolvedAmountPaid}` +
                " — kemungkinan ada pengajuan kembar (cicilan + pelunasan) untuk periode yang sama."
            );
        }

        const paymentHistory = await recordPaymentHistoryEntry({
            userId: user.id,
            amountPaid: resolvedAmountPaid,
            amountDue: resolvedAmountDue,
            isPartial,
            periodMonth,
            periodYear,
            paymentMethod,
            notes,
            createdBy
        });

        const positionAfter = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: resolvedAmountDue });
        const currentPeriodPosition = await syncUserPaidStatusForCurrentPeriod({ user });

        const becameFullyPaid = !positionBefore.is_fully_paid && positionAfter.is_fully_paid;
        let settlement = { applied: false, reason: "not_final_paid" };
        let agenSettlement = { applied: false, reason: "not_final_paid" };

        if (becameFullyPaid) {
            settlement = await evaluateCollectionSettlement({
                user,
                paid: true,
                periodMonth,
                periodYear,
                teknisiId,
                teknisiName,
                sourceRequestId,
                sourcePaymentHistoryId: paymentHistory.id,
                createdBy
            });
            // Komisi agen: jalur terpisah dari teknisi. Pembayaran ditagih oleh teknisi
            // ATAU agen (tak pernah keduanya), jadi hanya yang punya konteks yang mengkredit.
            agenSettlement = await evaluateAgenCollectionSettlement({
                user,
                paid: true,
                periodMonth,
                periodYear,
                agenId,
                agenName,
                sourceRequestId,
                sourcePaymentHistoryId: paymentHistory.id,
                createdBy
            });
            await consumeDiscountForPeriod(user, periodMonth, periodYear);
            if (typeof onFinalPaid === "function") {
                await onFinalPaid({
                    user,
                    periodMonth,
                    periodYear,
                    positionBefore,
                    positionAfter,
                    paymentHistoryId: paymentHistory.id
                });
            }
        }

        return {
            action: "paid",
            paymentHistoryId: paymentHistory.id,
            settlement,
            agenSettlement,
            becameFullyPaid,
            positionBefore,
            positionAfter,
            currentPeriodPosition,
            // #b329: selisih yang DIPOTONG ke sisa (bayar > sisa, mis. cicilan lalu pelunasan penuh).
            // Aftercare mencatatnya sbg kelebihan_bayar + alarm — kalau tidak, uang ini masuk tanpa jejak.
            droppedExcess: Math.max(0, diminta - sisa)
        };
    }

    if (positionBefore.net_paid <= 0) {
        // #b329: JANGAN paksa unpaid — periode bisa LUNAS via WAIVER / zero-bill (net_paid=0 tapi
        // is_fully_paid=true). Turunkan flag dari verdict is_fully_paid NYATA; kalau di-hardcode false,
        // pelanggan gratis/waiver bisa kena reminder & isolir padahal sah tersettel (fail-open).
        const settled = positionBefore.is_fully_paid === true;
        await setUserPaidStatus(user, settled);
        return {
            action: "no_change",
            reason: "no_paid_position",
            positionBefore,
            positionAfter: { ...positionBefore, is_fully_paid: settled }
        };
    }

    const reversalAmount = Math.max(0, toInteger(amountPaid) || positionBefore.net_paid);
    const reversal = await recordPaymentReversalEntry({
        userId: user.id,
        periodMonth,
        periodYear,
        amountReversed: reversalAmount,
        sourceRequestId,
        sourceAdminAction,
        createdBy,
        reason: notes || "payment_reversal"
    });

    const positionAfter = await getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue: resolvedAmountDue });
    const currentPeriodPosition = await syncUserPaidStatusForCurrentPeriod({ user });

    const settlement = await evaluateCollectionSettlement({
        user,
        paid: false,
        periodMonth,
        periodYear,
        teknisiId,
        teknisiName,
        sourceRequestId,
        createdBy
    });

    const agenSettlement = await evaluateAgenCollectionSettlement({
        user,
        paid: false,
        periodMonth,
        periodYear,
        agenId,
        agenName,
        sourceRequestId,
        createdBy
    });

    // Kembalikan jatah diskon periode ini. Tanpa ini, salah-tandai-lunas lalu dibatalkan
    // membuat pelanggan kehilangan satu bulan diskonnya PERMANEN: `consumeDiscountForPeriod`
    // menaikkan `discount_months_used`, dan bila itu jatah terakhir seluruh kolom diskon
    // dinolkan — pembalikan tak mengembalikan apa pun. Pelanggan lalu ditagih harga penuh
    // untuk bulan yang seharusnya masih berdiskon, tanpa satu pun jejak.
    //
    // Hanya dikembalikan bila penandanya BENAR-BENAR ada untuk periode ini (changes > 0),
    // supaya pembalikan berulang tak menambah jatah dari udara.
    const dikembalikan = await releaseDiscountForPeriod(user, periodMonth, periodYear);

    return {
        action: reversal.created ? "reversed" : "duplicate_retry",
        discountReleased: dikembalikan,
        reversalId: reversal.id || null,
        reversal,
        settlement,
        agenSettlement,
        positionBefore,
        positionAfter,
        currentPeriodPosition
    };
}


module.exports = {
    initializationPromise,
    getRuntime,
    getRuntimeRepository,
    ensureMainDbReady,
    dbRun,
    dbGet,
    dbAll,
    getReaderDbPath,
    getReaderDb,
    handleReaderError,
    createReaderContext,
    readerGet,
    readerAll,
    withReaderContext,
    withPaymentReadContext,
    toInteger,
    buildNowIso,
    getCurrentBillingPeriod,
    normalizeUserPaymentMethod,
    getPackagePrice,
    getEffectivePrice,
    resolveBillingAmount,
    syncPaymentHistorySchema,
    syncUserDiscountSchema,
    ensurePaymentFinanceTables,
    syncPaymentLedgerDomains,
    setUserPaidStatus,
    normalizePaymentRequestScope,
    isSamePaymentRequestScope,
    consumeDiscountForPeriod,
    releaseDiscountForPeriod,
    recordPaymentHistoryEntry,
    recordPaymentReversalEntry,
    getPaymentPositionForPeriod,
    listPaymentHistoryUserIdsForPeriod,
    syncUserPaidStatusForPeriod,
    syncUserPaidStatusForCurrentPeriod,
    applyPaymentStatusChange,
};
