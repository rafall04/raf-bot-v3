"use strict";

/**
 * Header Doc
 * Purpose: Pemilik TUNGGAL tabel `technician_collection_ledger` — buku besar komisi penarikan
 *   teknisi (Rp/penarikan). Mengkredit saat pelanggan dinyatakan lunas, mendebit saat pembayaran
 *   dibatalkan, dan menutup komisi historis yang sudah diserahkan di luar sistem. Tak ada jalur
 *   lain yang boleh menulis tabel ini: penulisan lewat SQL mentah melewatkan sinkronisasi
 *   `financial_ledger` di `insertSettlementEntry`.
 * Caller: `lib/technician-finance-service` (payroll), jalur konfirmasi pembayaran, `routes/gaji.js`.
 * Deps: `global.db` (sqlite utama), `./database` (loadJSON requests), `./financial-ledger`.
 * MainFuncs: `evaluateCollectionSettlement`, `insertSettlementEntry`, `writeOffCollectionPeriods`,
 *   `getCloseoutHistory`, `getSettlementReport`.
 * SideEffects: Menulis `technician_collection_ledger` dan memicu sinkronisasi `financial_ledger`.
 */

const { loadJSON } = require('./database');
const { syncFinancialLedgerSources } = require('./financial-ledger');

let initializationPromise = null;

async function ensureMainDbReady() {
    if (global.db) {
        return global.db;
    }
    if (global.__dbInitPromise) {
        await global.__dbInitPromise;
    }
    if (!global.db) {
        throw new Error('Database not initialized');
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

async function ensureSettlementTable() {
    if (!initializationPromise) {
        initializationPromise = (async () => {
            await dbRun(`
                CREATE TABLE IF NOT EXISTS technician_collection_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teknisi_id TEXT NOT NULL,
                    teknisi_name TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    user_name TEXT NOT NULL,
                    period_month INTEGER NOT NULL,
                    period_year INTEGER NOT NULL,
                    commission_amount INTEGER NOT NULL,
                    direction TEXT NOT NULL CHECK(direction IN ('credit', 'debit')),
                    reason TEXT NOT NULL CHECK(reason IN ('customer_paid_final', 'customer_reverted_unpaid', 'manual_adjustment')),
                    source_request_id TEXT,
                    source_payment_history_id INTEGER,
                    event_key TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    created_by TEXT NOT NULL
                )
            `);
            await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_technician_collection_event_key ON technician_collection_ledger(event_key)');
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_period ON technician_collection_ledger(period_year, period_month)');
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_user_period ON technician_collection_ledger(user_id, period_year, period_month)');
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_teknisi_period ON technician_collection_ledger(teknisi_id, period_year, period_month)');
            const columns = await dbAll("PRAGMA table_info(technician_collection_ledger)");
            const punyaKolom = (nama) => columns.some((column) => column.name === nama);
            if (!punyaKolom('payroll_id')) {
                await dbRun("ALTER TABLE technician_collection_ledger ADD COLUMN payroll_id INTEGER");
            }
            if (!punyaKolom('payroll_locked_at')) {
                await dbRun("ALTER TABLE technician_collection_ledger ADD COLUMN payroll_locked_at TEXT");
            }
            // Penutupan komisi historis: komisi yang sudah diserahkan ke teknisi DI LUAR sistem
            // (mis. hasil backfill saat fitur dinyalakan) ditandai di sini, bukan dihapus. Menandai
            // membuat pengecualiannya STRUKTURAL — baris bertanda tak pernah lagi jadi kandidat
            // payroll — bukan sekadar aritmetis "kebetulan netnya nol sekarang".
            if (!punyaKolom('closed_out_at')) {
                await dbRun("ALTER TABLE technician_collection_ledger ADD COLUMN closed_out_at TEXT");
            }
            if (!punyaKolom('closed_out_by')) {
                await dbRun("ALTER TABLE technician_collection_ledger ADD COLUMN closed_out_by TEXT");
            }
            if (!punyaKolom('closed_out_note')) {
                await dbRun("ALTER TABLE technician_collection_ledger ADD COLUMN closed_out_note TEXT");
            }
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_payroll_id ON technician_collection_ledger(payroll_id)');
            await dbRun('CREATE INDEX IF NOT EXISTS idx_technician_collection_closed_out ON technician_collection_ledger(closed_out_at)');
        })().catch((error) => {
            initializationPromise = null;
            throw error;
        });
    }
    return initializationPromise;
}

function normalizeBoolean(value, defaultValue = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    return defaultValue;
}

function getCommissionConfig() {
    const enabled = normalizeBoolean(global.config?.teknisiCollectionCommissionEnabled, false);
    const amountRaw = parseInt(global.config?.teknisiCollectionCommissionAmount ?? 0, 10);
    return {
        enabled,
        amount: Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 0
    };
}

function getPeriodParts(input = {}) {
    if (Number.isInteger(input.periodMonth) && Number.isInteger(input.periodYear)) {
        return { periodMonth: input.periodMonth, periodYear: input.periodYear };
    }

    const sourceDate = input.date || input.paidDate || input.createdAt || new Date();
    const date = sourceDate instanceof Date ? sourceDate : new Date(sourceDate);
    return {
        periodMonth: date.getMonth() + 1,
        periodYear: date.getFullYear()
    };
}

async function hasAnyCommissionCreditForUserPeriod(userId, periodMonth, periodYear) {
    await ensureSettlementTable();
    const row = await dbGet(
        `SELECT COUNT(*) as total
         FROM technician_collection_ledger
         WHERE user_id = ? AND period_month = ? AND period_year = ? AND direction = 'credit'`,
        [String(userId), periodMonth, periodYear]
    );
    return (row?.total || 0) > 0;
}

async function getNetForTechnicianPeriodUser(teknisiId, userId, periodMonth, periodYear) {
    await ensureSettlementTable();
    // Debit PENUTUPAN sengaja tak dihitung di sini. Pemanggilnya (`evaluateCollectionSettlement`)
    // memakai net > 0 sebagai jawaban "sudah pernah dikredit"; kalau debit penutupan ikut
    // dihitung, net kembali nol dan pembayaran ulang periode lama akan mengkredit komisi yang
    // SUDAH diserahkan. Kreditnya tetap dihitung justru supaya jawabannya tetap "sudah".
    const rows = await dbAll(
        `SELECT direction, commission_amount
         FROM technician_collection_ledger
         WHERE teknisi_id = ? AND user_id = ? AND period_month = ? AND period_year = ?
           AND NOT (direction = 'debit' AND closed_out_at IS NOT NULL)`,
        [String(teknisiId), String(userId), periodMonth, periodYear]
    );
    return rows.reduce((sum, row) => sum + (row.direction === 'credit' ? row.commission_amount : -row.commission_amount), 0);
}


async function resolveTechnicianForSettlement({ teknisiId, teknisiName, userId, periodMonth, periodYear }) {
    if (teknisiId) {
        const account = (global.accounts || []).find((item) => String(item.id) === String(teknisiId));
        return {
            teknisiId: String(teknisiId),
            teknisiName: teknisiName || account?.name || account?.username || `Teknisi ${teknisiId}`
        };
    }

    let requests = [];
    try {
        requests = loadJSON('database/requests.json');
    } catch (_error) {
        requests = [];
    }

    const candidates = requests
        .filter((request) => String(request.userId) === String(userId))
        .filter((request) => request.status === 'approved' && request.newStatus === true && request.requested_by_teknisi_id)
        .filter((request) => {
            const requestPeriodMonth = parseInt(request.period_month, 10);
            const requestPeriodYear = parseInt(request.period_year, 10);
            if (Number.isInteger(requestPeriodMonth) && Number.isInteger(requestPeriodYear)) {
                return requestPeriodMonth === periodMonth && requestPeriodYear === periodYear;
            }
            const requestDate = new Date(request.updated_at || request.created_at || Date.now());
            return requestDate.getMonth() + 1 === periodMonth && requestDate.getFullYear() === periodYear;
        })
        .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));

    if (candidates.length > 0) {
        const latest = candidates[0];
        const account = (global.accounts || []).find((item) => String(item.id) === String(latest.requested_by_teknisi_id));
        return {
            teknisiId: String(latest.requested_by_teknisi_id),
            teknisiName: account?.name || account?.username || latest.requestorName || `Teknisi ${latest.requested_by_teknisi_id}`
        };
    }

    const ledgerRow = await dbGet(
        `SELECT teknisi_id, teknisi_name
         FROM technician_collection_ledger
         WHERE user_id = ? AND period_month = ? AND period_year = ?
         ORDER BY datetime(created_at) DESC, id DESC
         LIMIT 1`,
        [String(userId), periodMonth, periodYear]
    );

    if (ledgerRow) {
        return {
            teknisiId: String(ledgerRow.teknisi_id),
            teknisiName: ledgerRow.teknisi_name
        };
    }

    return null;
}

async function getLatestOutstandingCredit(userId, periodMonth, periodYear) {
    await ensureSettlementTable();
    const rows = await dbAll(
        `SELECT *
         FROM technician_collection_ledger
         WHERE user_id = ? AND period_month = ? AND period_year = ?
         ORDER BY datetime(created_at) ASC, id ASC`,
        [String(userId), periodMonth, periodYear]
    );

    const balances = new Map();
    const latestCredit = new Map();

    for (const row of rows) {
        const key = String(row.teknisi_id);
        const current = balances.get(key) || 0;
        if (row.direction === 'credit') {
            balances.set(key, current + row.commission_amount);
            latestCredit.set(key, row);
        } else {
            balances.set(key, current - row.commission_amount);
        }
    }

    let selected = null;
    for (const [key, balance] of balances.entries()) {
        if (balance > 0) {
            const candidate = latestCredit.get(key);
            if (!selected || new Date(candidate.created_at) > new Date(selected.created_at)) {
                selected = candidate;
            }
        }
    }

    return selected;
}

function buildEventKey({ direction, teknisiId, userId, periodMonth, periodYear, sourceRequestId, sourcePaymentHistoryId, fallbackKey }) {
    return [direction, teknisiId, userId, periodYear, periodMonth, sourceRequestId || 'no-request', sourcePaymentHistoryId || 'no-payment-history', fallbackKey || 'state'].join(':');
}

/**
 * @param {boolean} [opts.skipLedgerSync] Lewati sinkronisasi buku besar untuk penyisipan INI.
 *   Sinkronisasi membaca SELURUH tabel tiap kali dipanggil, jadi memanggilnya per-baris pada
 *   operasi massal berubah jadi kuadratik — terukur: menutup 315 baris memakan menit, bukan detik.
 *   Pemanggil massal wajib menyinkronkan SEKALI di akhir.
 */
async function insertSettlementEntry({ teknisiId, teknisiName, user, periodMonth, periodYear, commissionAmount, direction, reason, sourceRequestId = null, sourcePaymentHistoryId = null, createdBy = 'system', fallbackKey = 'state', skipLedgerSync = false }) {
    await ensureSettlementTable();
    const eventKey = buildEventKey({
        direction,
        teknisiId,
        userId: user.id,
        periodMonth,
        periodYear,
        sourceRequestId,
        sourcePaymentHistoryId,
        fallbackKey
    });

    try {
        const result = await dbRun(
            `INSERT INTO technician_collection_ledger (
                teknisi_id, teknisi_name, user_id, user_name, period_month, period_year,
                commission_amount, direction, reason, source_request_id, source_payment_history_id,
                event_key, created_by, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(teknisiId),
                teknisiName,
                String(user.id),
                user.name || `User ${user.id}`,
                periodMonth,
                periodYear,
                commissionAmount,
                direction,
                reason,
                sourceRequestId ? String(sourceRequestId) : null,
                sourcePaymentHistoryId || null,
                eventKey,
                createdBy,
                new Date().toISOString()
            ]
        );
        if (!skipLedgerSync) {
            try {
                await syncFinancialLedgerSources({ domains: ['technician_collection'] });
            } catch (ledgerSyncError) {
                console.error('[TECHNICIAN_COLLECTION_LEDGER_SYNC_ERROR]', ledgerSyncError.message);
            }
        }

        return {
            inserted: true,
            id: result.lastID,
            eventKey
        };
    } catch (error) {
        if (String(error.message || '').includes('UNIQUE')) {
            return {
                inserted: false,
                duplicate: true,
                eventKey
            };
        }
        throw error;
    }
}

async function evaluateCollectionSettlement({ user, paid, periodMonth, periodYear, teknisiId = null, teknisiName = null, sourceRequestId = null, sourcePaymentHistoryId = null, createdBy = 'system' }) {
    if (!user || !user.id) {
        return { applied: false, reason: 'missing_user' };
    }

    const config = getCommissionConfig();
    if (!config.enabled || config.amount <= 0) {
        return { applied: false, reason: 'commission_disabled' };
    }

    await ensureSettlementTable();

    if (paid) {
        const resolvedTechnician = await resolveTechnicianForSettlement({ teknisiId, teknisiName, userId: user.id, periodMonth, periodYear });
        if (!resolvedTechnician?.teknisiId) {
            return { applied: false, reason: 'no_technician_context' };
        }

        const net = await getNetForTechnicianPeriodUser(resolvedTechnician.teknisiId, user.id, periodMonth, periodYear);
        if (net > 0) {
            return { applied: false, reason: 'already_credited', teknisiId: resolvedTechnician.teknisiId };
        }

        const inserted = await insertSettlementEntry({
            teknisiId: resolvedTechnician.teknisiId,
            teknisiName: resolvedTechnician.teknisiName,
            user,
            periodMonth,
            periodYear,
            commissionAmount: config.amount,
            direction: 'credit',
            reason: 'customer_paid_final',
            sourceRequestId,
            sourcePaymentHistoryId,
            createdBy,
            fallbackKey: sourceRequestId || sourcePaymentHistoryId || 'paid'
        });

        return {
            applied: inserted.inserted,
            direction: 'credit',
            amount: config.amount,
            teknisiId: resolvedTechnician.teknisiId,
            teknisiName: resolvedTechnician.teknisiName,
            duplicate: inserted.duplicate === true,
            reason: inserted.inserted ? 'credited' : 'duplicate'
        };
    }

    const outstandingCredit = await getLatestOutstandingCredit(user.id, periodMonth, periodYear);
    if (!outstandingCredit) {
        return { applied: false, reason: 'no_credit_to_reverse' };
    }

    const inserted = await insertSettlementEntry({
        teknisiId: String(outstandingCredit.teknisi_id),
        teknisiName: outstandingCredit.teknisi_name,
        user,
        periodMonth,
        periodYear,
        commissionAmount: outstandingCredit.commission_amount,
        direction: 'debit',
        reason: 'customer_reverted_unpaid',
        sourceRequestId,
        sourcePaymentHistoryId,
        createdBy,
        fallbackKey: sourceRequestId || sourcePaymentHistoryId || outstandingCredit.id
    });

    return {
        applied: inserted.inserted,
        direction: 'debit',
        amount: outstandingCredit.commission_amount,
        teknisiId: String(outstandingCredit.teknisi_id),
        teknisiName: outstandingCredit.teknisi_name,
        duplicate: inserted.duplicate === true,
        reason: inserted.inserted ? 'debited' : 'duplicate'
    };
}

/** Baris komisi yang masih boleh disentuh: belum terkunci payroll DAN belum pernah ditutup. */
async function getOpenEntriesForPeriod(teknisiId, periodMonth, periodYear) {
    await ensureSettlementTable();
    return dbAll(
        `SELECT id, user_id, user_name, commission_amount, direction
         FROM technician_collection_ledger
         WHERE CAST(teknisi_id AS TEXT) = CAST(? AS TEXT)
           AND period_month = ? AND period_year = ?
           AND payroll_id IS NULL
           AND closed_out_at IS NULL
         ORDER BY id ASC`,
        [String(teknisiId), Number(periodMonth), Number(periodYear)]
    );
}

/**
 * Menutup komisi periode lama yang uangnya SUDAH diserahkan ke teknisi di luar sistem.
 *
 * Ini BUKAN pembayaran: tak ada rupiah berpindah, tak ada struk, tak ada pesan WhatsApp.
 * Yang terjadi hanyalah pembukuan menyusul kenyataan. Karena itu barisnya tidak dihapus —
 * tiap kredit yang ditutup diberi tanda `closed_out_at` + alasan, dan satu debit penyeimbang
 * disisipkan pada PERIODE ASLI supaya laporan bulan itu netnya nol, bukan bulan berjalan
 * yang tiba-tiba kelihatan seperti pengeluaran.
 *
 * Dobel-bayar tertutup dari dua arah: baris bertanda tak lagi jadi kandidat payroll
 * (pengecualian struktural, bukan aritmetika), dan baris yang sudah terkunci payroll tak
 * pernah masuk daftar kandidat penutupan.
 *
 * @param {object} opts
 * @param {string|number} opts.teknisiId
 * @param {Array<{month:number, year:number}>} opts.periods Periode yang dicentang operator.
 * @param {string} opts.keterangan WAJIB — satu-satunya penjelasan yang tersisa enam bulan lagi.
 * @param {string} opts.actor Nama/username admin yang menutup.
 * @param {number|null} opts.expectedTotal Nominal yang DILIHAT operator di layar; beda = tolak.
 */
async function writeOffCollectionPeriods({ teknisiId, periods = [], keterangan = '', actor = 'system', expectedTotal = null }) {
    await ensureSettlementTable();

    const catatan = String(keterangan || '').trim();
    if (catatan.length < 10) {
        return { ok: false, reason: 'keterangan_wajib' };
    }
    if (!teknisiId || !Array.isArray(periods) || periods.length === 0) {
        return { ok: false, reason: 'periode_kosong' };
    }

    // Hitung dulu SELURUH kandidat sebelum menulis apa pun, supaya nominal yang divalidasi
    // sama persis dengan nominal yang akan ditutup.
    const rencana = [];
    const dilewati = [];
    for (const periode of periods) {
        const bulan = Number(periode.month);
        const tahun = Number(periode.year);
        if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12 || !Number.isInteger(tahun)) {
            dilewati.push({ periode: `${periode.month}/${periode.year}`, alasan: 'periode_tidak_valid' });
            continue;
        }
        const rows = await getOpenEntriesForPeriod(teknisiId, bulan, tahun);
        if (rows.length === 0) {
            dilewati.push({ periode: `${bulan}/${tahun}`, alasan: 'tidak_ada_baris_terbuka' });
            continue;
        }

        // Per pelanggan: buku besar ini berpasangan kredit/debit per pelanggan, jadi penyeimbangnya
        // harus per pelanggan juga — bukan satu debit gemuk atas nama pelanggan sembarang.
        const perUser = new Map();
        for (const row of rows) {
            const kunci = String(row.user_id);
            const saat = perUser.get(kunci) || { userId: kunci, userName: row.user_name, net: 0, ids: [], maxCreditId: null };
            saat.net += row.direction === 'credit' ? Number(row.commission_amount) : -Number(row.commission_amount);
            saat.ids.push(row.id);
            if (row.direction === 'credit') {
                saat.maxCreditId = row.id;
            }
            perUser.set(kunci, saat);
        }

        const bucket = [...perUser.values()].filter((b) => b.net > 0 && b.maxCreditId !== null);
        if (bucket.length === 0) {
            dilewati.push({ periode: `${bulan}/${tahun}`, alasan: 'net_nol_atau_negatif' });
            continue;
        }
        rencana.push({
            bulan,
            tahun,
            bucket,
            total: bucket.reduce((s, b) => s + b.net, 0),
            ids: bucket.flatMap((b) => b.ids)
        });
    }

    const totalRencana = rencana.reduce((s, r) => s + r.total, 0);
    if (expectedTotal !== null && Number(expectedTotal) !== totalRencana) {
        // Layar operator sudah basi (mis. tab dibiarkan terbuka lalu ada pembayaran masuk).
        // Menutup jumlah yang BERBEDA dari yang disetujui mata adalah persetujuan palsu.
        return { ok: false, reason: 'nominal_berubah', totalSekarang: totalRencana, totalDiharapkan: Number(expectedTotal) };
    }
    if (rencana.length === 0) {
        return { ok: true, ditutup: [], dilewati, total: 0, entryIds: [] };
    }

    const saatIni = new Date().toISOString();
    const ditutup = [];
    const entryIds = [];

    for (const item of rencana) {
        const teknisiRow = await dbGet(
            `SELECT teknisi_name FROM technician_collection_ledger
              WHERE CAST(teknisi_id AS TEXT) = CAST(? AS TEXT) LIMIT 1`,
            [String(teknisiId)]
        );
        const namaTeknisi = teknisiRow?.teknisi_name || `Teknisi ${teknisiId}`;

        for (const b of item.bucket) {
            const hasil = await insertSettlementEntry({
                teknisiId,
                teknisiName: namaTeknisi,
                user: { id: b.userId, name: b.userName },
                periodMonth: item.bulan,
                periodYear: item.tahun,
                commissionAmount: b.net,
                direction: 'debit',
                reason: 'manual_adjustment',
                sourceRequestId: null,
                sourcePaymentHistoryId: null,
                createdBy: `tutup-historis:${actor}`,
                // Kunci idempotensi: id kredit terakhir di kantong ini. Klik ganda menghasilkan
                // event_key yang sama -> INSERT kedua ditolak UNIQUE, bukan debit kedua.
                fallbackKey: `closeout:${b.maxCreditId}`,
                skipLedgerSync: true // disinkronkan SEKALI di akhir fungsi ini
            });
            if (hasil.inserted) {
                entryIds.push(hasil.id);
                await dbRun(
                    `UPDATE technician_collection_ledger
                        SET closed_out_at = ?, closed_out_by = ?, closed_out_note = ?
                      WHERE id = ?`,
                    [saatIni, String(actor), catatan, hasil.id]
                );
            }
        }

        // Tandai kredit aslinya SETELAH debitnya ada, supaya proses yang putus di tengah
        // menyisakan keadaan yang aman: baris masih terlihat, bukan hilang tanpa penyeimbang.
        const placeholders = item.ids.map(() => '?').join(', ');
        await dbRun(
            `UPDATE technician_collection_ledger
                SET closed_out_at = ?, closed_out_by = ?, closed_out_note = ?
              WHERE id IN (${placeholders}) AND closed_out_at IS NULL`,
            [saatIni, String(actor), catatan, ...item.ids]
        );

        ditutup.push({ periode: `${item.bulan}/${item.tahun}`, total: item.total, baris: item.ids.length });
    }

    try {
        await syncFinancialLedgerSources({ domains: ['technician_collection'] });
    } catch (error) {
        console.error('[TECHNICIAN_COLLECTION_CLOSEOUT_SYNC_ERROR]', error.message);
    }

    return { ok: true, ditutup, dilewati, total: totalRencana, entryIds };
}

/** Riwayat penutupan — supaya keputusannya tetap terbaca setelah angkanya jadi nol di layar. */
async function getCloseoutHistory({ teknisiId = null, limit = 50 } = {}) {
    await ensureSettlementTable();
    const params = [];
    let filter = "WHERE closed_out_at IS NOT NULL AND direction = 'debit'";
    if (teknisiId) {
        filter += ' AND CAST(teknisi_id AS TEXT) = CAST(? AS TEXT)';
        params.push(String(teknisiId));
    }
    params.push(Number(limit) || 50);
    return dbAll(
        `SELECT closed_out_at, closed_out_by, closed_out_note, teknisi_id, teknisi_name,
                period_month, period_year, SUM(commission_amount) AS total, COUNT(*) AS baris
           FROM technician_collection_ledger
           ${filter}
          GROUP BY closed_out_at, teknisi_id, period_year, period_month
          ORDER BY closed_out_at DESC, period_year DESC, period_month DESC
          LIMIT ?`,
        params
    );
}

async function paymentHistoryTableExists() {
    try {
        const row = await dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_history'");
        return !!row;
    } catch (_e) {
        return false;
    }
}

async function getSettlementEntries({ month, year, teknisiId = null, dateFrom = null, dateTo = null }) {
    await ensureSettlementTable();

    const where = [];
    const params = [];

    if (month && year) {
        where.push('l.period_month = ? AND l.period_year = ?');
        params.push(parseInt(month, 10), parseInt(year, 10));
    }
    if (teknisiId) {
        where.push('l.teknisi_id = ?');
        params.push(String(teknisiId));
    }
    if (dateFrom) {
        where.push("datetime(l.created_at) >= datetime(?)");
        params.push(dateFrom);
    }
    if (dateTo) {
        where.push("datetime(l.created_at) <= datetime(?)");
        params.push(dateTo);
    }

    // `collected_amount` = nominal uang yang BENAR-BENAR ditarik dari pelanggan (payment_history.amount_paid),
    // ditautkan via source_payment_history_id — untuk totalan kas admin↔teknisi (bukan cuma komisi). LEFT JOIN
    // supaya entri lama/backfill tanpa tautan tetap muncul (collected_amount null). Guard bila tabel absen (test).
    const hasPH = await paymentHistoryTableExists();
    const selectCollected = hasPH ? ", ph.amount_paid AS collected_amount" : "";
    const joinClause = hasPH ? "LEFT JOIN payment_history ph ON ph.id = l.source_payment_history_id" : "";

    const sql = `
        SELECT l.*${selectCollected}
        FROM technician_collection_ledger l
        ${joinClause}
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY datetime(l.created_at) DESC, l.id DESC
    `;

    return dbAll(sql, params);
}

function summarizeEntries(entries) {
    const summaryByTechnician = new Map();

    for (const entry of entries) {
        const key = String(entry.teknisi_id);
        if (!summaryByTechnician.has(key)) {
            summaryByTechnician.set(key, {
                teknisi_id: key,
                teknisi_name: entry.teknisi_name,
                total_credit: 0,
                total_debit: 0,
                net_total: 0,
                total_collected: 0,
                collected_count: 0,
                entry_count: 0,
                latest_entry_at: entry.created_at,
                unique_paid_customers: new Set(),
                positive_customer_periods: new Map()
            });
        }

        const bucket = summaryByTechnician.get(key);
        bucket.entry_count += 1;
        bucket.latest_entry_at = bucket.latest_entry_at > entry.created_at ? bucket.latest_entry_at : entry.created_at;

        const customerPeriodKey = `${entry.user_id}:${entry.period_year}:${entry.period_month}`;
        const currentPeriodNet = bucket.positive_customer_periods.get(customerPeriodKey) || 0;
        const delta = entry.direction === 'credit' ? entry.commission_amount : -entry.commission_amount;
        const nextPeriodNet = currentPeriodNet + delta;
        bucket.positive_customer_periods.set(customerPeriodKey, nextPeriodNet);

        const collected = entry.collected_amount != null ? Number(entry.collected_amount) || 0 : null;
        if (entry.direction === 'credit') {
            bucket.total_credit += entry.commission_amount;
            if (collected != null) { bucket.total_collected += collected; bucket.collected_count += 1; }
        } else {
            bucket.total_debit += entry.commission_amount;
            if (collected != null) { bucket.total_collected -= collected; }
        }
        bucket.net_total = bucket.total_credit - bucket.total_debit;
    }

    return Array.from(summaryByTechnician.values())
        .map((bucket) => {
            let uniquePaidCustomers = 0;
            for (const value of bucket.positive_customer_periods.values()) {
                if (value > 0) {
                    uniquePaidCustomers += 1;
                }
            }
            return {
                teknisi_id: bucket.teknisi_id,
                teknisi_name: bucket.teknisi_name,
                total_credit: bucket.total_credit,
                total_debit: bucket.total_debit,
                net_total: bucket.net_total,
                total_collected: bucket.total_collected,
                collected_count: bucket.collected_count,
                entry_count: bucket.entry_count,
                latest_entry_at: bucket.latest_entry_at,
                unique_paid_customers: uniquePaidCustomers
            };
        })
        .sort((a, b) => b.net_total - a.net_total || a.teknisi_name.localeCompare(b.teknisi_name));
}

async function getSettlementReport({ month, year, teknisiId = null, dateFrom = null, dateTo = null }) {
    const entries = await getSettlementEntries({ month, year, teknisiId, dateFrom, dateTo });
    const summary = summarizeEntries(entries);
    const config = getCommissionConfig();

    return {
        commission_per_customer: config.amount,
        entries,
        summary,
        totals: {
            total_credit: entries.filter((entry) => entry.direction === 'credit').reduce((sum, entry) => sum + entry.commission_amount, 0),
            total_debit: entries.filter((entry) => entry.direction === 'debit').reduce((sum, entry) => sum + entry.commission_amount, 0),
            net_total: entries.reduce((sum, entry) => sum + (entry.direction === 'credit' ? entry.commission_amount : -entry.commission_amount), 0),
            total_collected: entries.reduce((sum, entry) => {
                const collected = entry.collected_amount != null ? Number(entry.collected_amount) || 0 : 0;
                return sum + (entry.direction === 'credit' ? collected : -collected);
            }, 0)
        }
    };
}

module.exports = {
    ensureSettlementTable,
    getCommissionConfig,
    getPeriodParts,
    hasAnyCommissionCreditForUserPeriod,
    evaluateCollectionSettlement,
    getSettlementEntries,
    getSettlementReport,
    writeOffCollectionPeriods,
    getCloseoutHistory
};
