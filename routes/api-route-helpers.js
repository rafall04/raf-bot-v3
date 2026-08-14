/**
 * Header Doc
 * Purpose: Middleware & helper otorisasi yang dipakai bersama router API — gerbang peran
 *          (`ensureAuthenticated`/`ensureAdmin`/`ensureAuthenticatedStaff`) dan gerbang
 *          KEPEMILIKAN (`assertBolehAksesPelanggan`) untuk endpoint ber-`userId`.
 * Caller: `routes/api-users-routes.js`, `routes/packages.js`, `routes/stats.js`,
 *         `routes/invoice.js`, `routes/olt.js`, dan router API lain.
 * Deps: `req.user` / `req.customer` yang diisi middleware auth global
 *       (`lib/http-auth-bootstrap.js`).
 * MainFuncs: `ensureAuthenticated`, `ensureAdmin`, `ensureAuthenticatedStaff`,
 *            `assertBolehAksesPelanggan`, `normalizeQueryStringParam`, `redactPppoeFilter`,
 *            `buildMikrotikSyncResult`.
 * SideEffects: Mengirim respons 401/403 saat menolak; selebihnya murni.
 * INVARIAN: `ensureAuthenticated` HANYA memastikan ada `req.user` — ia TIDAK memeriksa peran
 *           dan TIDAK memeriksa kepemilikan data. Endpoint yang menerima `userId` dari klien
 *           WAJIB memakai `assertBolehAksesPelanggan`, kalau tidak datanya bisa dienumerasi.
 */
function ensureAuthenticated(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ status: 401, message: 'Unauthorized' });
    }

    next();
}

function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
    }

    next();
}

function ensureAuthenticatedStaff(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ status: 401, message: 'Unauthorized' });
    }

    if (!['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
        return res.status(403).json({
            status: 403,
            message: 'Akses ditolak. Hanya teknisi dan admin yang dapat mengakses.'
        });
    }

    next();
}

const PERAN_STAF = ['admin', 'owner', 'superadmin', 'teknisi'];

/**
 * Gerbang KEPEMILIKAN untuk endpoint yang menerima `userId` dari klien.
 *
 * Middleware auth global meloloskan `req.user || req.customer`, jadi endpoint yang hanya
 * memeriksa "ada sesi" bisa dienumerasi: pelanggan A memanggil endpoint dengan userId B
 * dan menerima data pelanggan lain (nama, alamat, HP, harga langganan, PPPoE). Helper ini
 * memutuskan siapa boleh melihat userId mana.
 *
 * - Staf (admin/owner/superadmin/teknisi) → boleh userId mana pun.
 * - Sesi PELANGGAN → HANYA dirinya sendiri.
 * - Tanpa sesi → ditolak.
 *
 * @returns {{ok: true}|{ok: false, status: number, message: string}}
 */
function assertBolehAksesPelanggan(req, userIdDiminta) {
    if (req.user && PERAN_STAF.includes(req.user.role)) {
        return { ok: true };
    }

    if (req.customer) {
        const milikSendiri = String(req.customer.id) === String(userIdDiminta);
        // 404 (bukan 403) untuk pelanggan yang mengintip milik orang lain: membedakan
        // "ada tapi bukan milikmu" dari "tidak ada" itu sendiri sudah alat enumerasi ID.
        return milikSendiri
            ? { ok: true }
            : { ok: false, status: 404, message: 'Data tidak ditemukan.' };
    }

    return { ok: false, status: 401, message: 'Unauthorized' };
}

function normalizeQueryStringParam(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const rawValue = Array.isArray(value) ? value[0] : value;
    const normalized = String(rawValue).trim();
    return normalized || null;
}

function redactPppoeFilter(value) {
    if (!value) {
        return null;
    }

    if (value.length <= 4) {
        return `${value[0]}***`;
    }

    return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function buildMikrotikSyncResult(status, message, extra = {}) {
    return {
        status,
        message,
        ...extra,
    };
}

module.exports = {
    ensureAuthenticated,
    ensureAdmin,
    ensureAuthenticatedStaff,
    assertBolehAksesPelanggan,
    normalizeQueryStringParam,
    redactPppoeFilter,
    buildMikrotikSyncResult,
};
