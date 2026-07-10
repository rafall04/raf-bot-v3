/**
 * Header Doc
 * Purpose: Menjaga konsistensi antara flag `users.paid` (dipakai dashboard) dan ledger
 *   `payment_history` (dipakai halaman Status Pembayaran). Saat DB legacy yang hanya
 *   punya flag `paid` dimigrasi ke skema v3 yang berbasis ledger, flag tetap ikut tetapi
 *   ledger kosong sehingga kedua halaman menampilkan angka berbeda. Modul ini membackfill
 *   entri `payment_history` untuk periode berjalan dari flag `paid` sehingga ledger
 *   mencerminkan kenyataan, lalu menandai marker agar tidak berjalan dua kali.
 * Caller: `lib/database.js` (sekali saat DB siap, best-effort) dan CLI manual.
 * Deps: `sqlite3`, `./payment-finance-service` (applyPaymentStatusChange, getPaymentPositionForPeriod,
 *   getEffectivePrice, getCurrentBillingPeriod, listPaymentHistoryUserIdsForPeriod),
 *   runtime `global.db`/`global.users`/`global.packages`.
 * MainFuncs: `backfillPaidLedgerFromFlag`, `runStartupBackfillSafe`.
 * SideEffects: Menulis baris `payment_history` (tanpa notifikasi WA) dan baris marker
 *   `data_backfill_markers` pada users.sqlite via koneksi utama `global.db`.
 */
"use strict";

const {
    applyPaymentStatusChange,
    getCurrentBillingPeriod,
    getEffectivePrice,
    getPaymentPositionForPeriod,
    listPaymentHistoryUserIdsForPeriod
} = require("./payment-finance-service");

const BACKFILL_MARKER_KEY = "paid_ledger_from_flag_v1";
// Ditulis ke kolom `payment_history.created_by` supaya baris hasil backfill bisa
// dikenali lagi pada run berikutnya (lihat catatan idempotensi di bawah).
const BACKFILL_CREATED_BY = "system-backfill";

function getMainDb() {
    if (!global.db) {
        throw new Error("global.db belum siap");
    }
    return global.db;
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row || null);
        });
    });
}

async function ensureMarkerTable(db) {
    await dbRun(db, `
        CREATE TABLE IF NOT EXISTS data_backfill_markers (
            marker_key TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL,
            details TEXT
        )
    `);
}

async function isMarkerApplied(db, key) {
    const row = await dbGet(db, "SELECT marker_key FROM data_backfill_markers WHERE marker_key = ?", [key]);
    return Boolean(row);
}

async function markApplied(db, key, details) {
    await dbRun(
        db,
        "INSERT OR IGNORE INTO data_backfill_markers (marker_key, applied_at, details) VALUES (?, ?, ?)",
        [key, new Date().toISOString(), details || null]
    );
}

function isPaidFlag(user) {
    return user && (user.paid === true || user.paid === 1 || user.paid === "1");
}

function getWhitelistedPackageNames() {
    return new Set(
        (global.packages || [])
            .filter((pkg) => pkg && pkg.whitelist === true)
            .map((pkg) => pkg.name)
    );
}

/**
 * Backfill payment_history untuk periode berjalan dari flag users.paid.
 * Idempoten: melewati user yang ledger-nya sudah lunas ATAU sudah pernah di-backfill,
 * dan secara default hanya berjalan sekali (dijaga marker). Lewati notifikasi WA
 * (tanpa onFinalPaid).
 *
 * Catatan idempotensi (jangan pakai `users.paid` untuk mendeteksi run sebelumnya):
 * setiap `applyPaymentStatusChange` menutup dengan `syncUserPaidStatusForCurrentPeriod`,
 * yang men-derive ulang flag dari ledger PERIODE BERJALAN — sesuai invarian bahwa
 * `users.paid` cuma cache turunan. Jadi setelah backfill periode lampau (mis. CLI
 * `--month 6` di bulan Juli), flag pelanggan yang barusan dicatat justru kembali 0.
 * Karena itu run berikutnya mengenali pekerjaannya lewat LEDGER (`created_by`), bukan flag.
 */
async function backfillPaidLedgerFromFlag({
    periodMonth,
    periodYear,
    force = false,
    logger = console
} = {}) {
    const db = getMainDb();
    await ensureMarkerTable(db);

    if (!force && await isMarkerApplied(db, BACKFILL_MARKER_KEY)) {
        return { skipped: true, reason: "already_applied" };
    }

    const period = (Number.isInteger(periodMonth) && Number.isInteger(periodYear))
        ? { periodMonth, periodYear }
        : getCurrentBillingPeriod();

    const whitelisted = getWhitelistedPackageNames();
    // User yang barisnya sudah pernah ditulis backfill untuk periode ini. Mereka wajib ikut
    // dipertimbangkan walau flag-nya sudah 0, supaya run ulang melapor "sudah lunas"
    // alih-alih menganggap tak ada pekerjaan (dan supaya tak pernah menulis baris kedua).
    const seeded = new Set(
        await listPaymentHistoryUserIdsForPeriod(period.periodMonth, period.periodYear, {
            createdBy: BACKFILL_CREATED_BY
        })
    );

    const candidates = (global.users || []).filter(
        (user) => !whitelisted.has(user.subscription) && (isPaidFlag(user) || seeded.has(String(user.id)))
    );

    const result = {
        skipped: false,
        period,
        candidates: candidates.length,
        created: [],
        alreadyPaid: [],
        failed: []
    };

    for (const user of candidates) {
        try {
            if (seeded.has(String(user.id))) {
                // Sudah pernah dibackfill. Jangan tulis ulang meski ledger tampak belum lunas:
                // itu berarti harga efektif berubah (diskon terpakai) atau admin sengaja
                // me-reverse pembayarannya — dua-duanya bukan urusan backfill migrasi.
                result.alreadyPaid.push({ id: user.id, name: user.name, reason: "backfill_seeded" });
                continue;
            }

            const amountDue = getEffectivePrice(user);
            const position = await getPaymentPositionForPeriod(user, period.periodMonth, period.periodYear, { amountDue });
            if (position.is_fully_paid) {
                result.alreadyPaid.push({ id: user.id, name: user.name });
                continue;
            }

            const change = await applyPaymentStatusChange({
                user,
                paid: true,
                periodMonth: period.periodMonth,
                periodYear: period.periodYear,
                amountPaid: amountDue,
                amountDue,
                isPartial: false,
                paymentMethod: "CASH",
                notes: "Backfill ledger dari status lunas (migrasi)",
                createdBy: BACKFILL_CREATED_BY
                // sengaja tanpa onFinalPaid: jangan kirim notifikasi WA saat backfill
            });

            if (change.action === "paid") {
                result.created.push({ id: user.id, name: user.name, amount: amountDue });
            } else {
                result.alreadyPaid.push({ id: user.id, name: user.name, reason: change.reason || change.action });
            }
        } catch (error) {
            result.failed.push({ id: user.id, name: user.name, reason: error.message });
        }
    }

    // Hanya tandai selesai bila tidak ada kegagalan, agar error transien bisa dicoba ulang
    // pada boot berikutnya alih-alih terkunci permanen.
    if (result.failed.length === 0) {
        await markApplied(db, BACKFILL_MARKER_KEY, JSON.stringify({
            period,
            created: result.created.length,
            already_paid: result.alreadyPaid.length
        }));
        result.markerWritten = true;
    } else {
        result.markerWritten = false;
        if (logger && typeof logger.warn === "function") {
            logger.warn(`[PAID_LEDGER_BACKFILL] ${result.failed.length} user gagal di-backfill; marker tidak ditulis agar dicoba ulang.`);
        }
    }

    return result;
}

/**
 * Wrapper aman untuk dipanggil saat startup. Tidak pernah melempar error supaya
 * tidak menggagalkan boot aplikasi.
 */
async function runStartupBackfillSafe(options = {}) {
    try {
        if (!global.db) {
            return { skipped: true, reason: "db_not_ready" };
        }
        const result = await backfillPaidLedgerFromFlag(options);
        if (result && !result.skipped && (result.created.length > 0 || result.failed.length > 0)) {
            console.log(
                `[PAID_LEDGER_BACKFILL] periode ${result.period.periodMonth}/${result.period.periodYear} ` +
                `created=${result.created.length} already_paid=${result.alreadyPaid.length} failed=${result.failed.length}`
            );
        }
        return result;
    } catch (error) {
        console.error("[PAID_LEDGER_BACKFILL_ERROR]", error.message);
        return { error: error.message };
    }
}

module.exports = {
    BACKFILL_MARKER_KEY,
    BACKFILL_CREATED_BY,
    backfillPaidLedgerFromFlag,
    runStartupBackfillSafe
};

if (require.main === module) {
    // Jalankan manual: node lib/payment-status-backfill.js [--force] [--month M --year Y]
    const args = process.argv.slice(2);
    const options = { force: args.includes("--force") };
    const monthIdx = args.indexOf("--month");
    const yearIdx = args.indexOf("--year");
    if (monthIdx !== -1) options.periodMonth = parseInt(args[monthIdx + 1], 10);
    if (yearIdx !== -1) options.periodYear = parseInt(args[yearIdx + 1], 10);

    const { initializeDatabase } = require("./database");
    initializeDatabase()
        .then(() => backfillPaidLedgerFromFlag(options))
        .then((result) => {
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        })
        .catch((error) => {
            console.error("[PAID_LEDGER_BACKFILL_CLI_ERROR]", error);
            process.exit(1);
        });
}
