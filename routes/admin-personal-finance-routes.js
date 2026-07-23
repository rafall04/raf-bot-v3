/**
 * Header Doc
 * Purpose: API domain KEUANGAN PRIBADI owner — daftar catatan, rekap periode, tambah, dan hapus.
 *          Dipakai halaman `/keuangan-pribadi`. Gate SENGAJA memakai allowlist username
 *          (`config.personalFinance.webUsers`), BUKAN role: di `accounts.json` role `owner`
 *          tidak ada dan kedua akun admin tak terbedakan, sehingga gate berbasis role akan
 *          membuka dompet pribadi untuk admin lain.
 * Caller: `routes/admin-router.js`.
 * Deps: `ensureAuthenticatedStaff` (dari deps), `lib/error-handler.asyncHandler`,
 *       `repositories/personal-finance.repository`, `lib/personal-finance-service`.
 * MainFuncs: `registerAdminPersonalFinanceRoutes`, `isPersonalFinanceWebUser`.
 * SideEffects: Menulis/menghapus baris di `personal_finance.sqlite`.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const { parseAmount, todayStr, monthRange, buildReportData } = require("../lib/personal-finance-service");

let repoSingleton = null;
function getRepo() {
    if (!repoSingleton) {
        const { createPersonalFinanceRepository } = require("../repositories/personal-finance.repository");
        repoSingleton = createPersonalFinanceRepository();
    }
    return repoSingleton;
}

/**
 * Apakah user login ini boleh melihat dompet pribadi?
 * GAGAL-TERTUTUP: fitur mati, allowlist kosong, atau user tak dikenal ⇒ false.
 * Artinya sesudah deploy halaman ini 403 untuk SEMUA orang sampai owner mengisi
 * `webUsers` sendiri — menyalakannya keputusan ops, bukan efek samping deploy.
 */
function isPersonalFinanceWebUser(user, config) {
    const cfg = (config && config.personalFinance) || {};
    if (cfg.enabled !== true) return false;

    const daftar = (cfg.webUsers || []).map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
    if (!daftar.length) return false;

    const username = String((user && user.username) || "").trim().toLowerCase();
    return Boolean(username) && daftar.includes(username);
}

function registerAdminPersonalFinanceRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());
    const getConfig = deps.getConfig || (() => global.config);

    function ensureOwner(req, res, next) {
        if (!isPersonalFinanceWebUser(req.user, getConfig())) {
            return res.status(403).json({ success: false, message: "Halaman ini bukan bagian dari akses Anda." });
        }
        return next();
    }

    const gate = [ensureAuthenticatedStaff, ensureOwner];

    // Rentang default = bulan berjalan; `?from=&to=` (YYYY-MM-DD) atau `?month=YYYY-MM`.
    function resolveRange(query = {}) {
        if (query.month) return monthRange(String(query.month));
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(query.from || "")) ? String(query.from) : null;
        const to = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to || "")) ? String(query.to) : null;
        if (from || to) return { month: null, from: from || "0000-01-01", to: to || "9999-12-31" };
        return monthRange(null);
    }

    router.get(
        "/api/keuangan-pribadi/ringkasan",
        gate,
        asyncHandler(async (req, res) => {
            const rentang = resolveRange(req.query);
            const rekap = await getRepo().summary({ from: rentang.from, to: rentang.to });
            const hariIni = todayStr();
            const rekapHari = await getRepo().summary({ from: hariIni, to: hariIni });
            res.json({
                success: true,
                data: {
                    ...buildReportData(rekap, []),
                    periode: rentang,
                    hariIni: {
                        tanggal: hariIni,
                        masuk: rekapHari.masuk,
                        keluar: rekapHari.keluar,
                        selisih: rekapHari.selisih
                    }
                }
            });
        })
    );

    router.get(
        "/api/keuangan-pribadi/catatan",
        gate,
        asyncHandler(async (req, res) => {
            const rentang = resolveRange(req.query);
            const rows = await getRepo().listEntries({
                from: rentang.from,
                to: rentang.to,
                kind: req.query.kind,
                category: req.query.category,
                limit: req.query.limit || 200,
                offset: req.query.offset
            });
            res.json({ success: true, data: rows, periode: rentang });
        })
    );

    router.post(
        "/api/keuangan-pribadi/catatan",
        gate,
        asyncHandler(async (req, res) => {
            const body = req.body || {};
            const kind = body.kind === "in" ? "in" : body.kind === "out" ? "out" : null;
            if (!kind) {
                return res.status(400).json({ success: false, message: "Jenis wajib 'in' (masuk) atau 'out' (keluar)." });
            }

            // Terima "50rb"/"2jt" dari form persis seperti di WhatsApp — satu penerjemah untuk dua permukaan.
            const amount = typeof body.amount === "number" ? Math.round(body.amount) : parseAmount(body.amount);
            if (!amount || amount <= 0) {
                return res.status(400).json({ success: false, message: "Nominal tidak terbaca (contoh: 50rb, 2jt, 50000)." });
            }

            const ts = /^\d{4}-\d{2}-\d{2}$/.test(String(body.tanggal || "")) ? `${body.tanggal} 12:00:00` : undefined;
            const entry = await getRepo().addEntry({
                kind,
                amount,
                category: body.category,
                note: body.note,
                source: "web",
                ts
            });
            res.json({ success: true, data: entry });
        })
    );

    router.delete(
        "/api/keuangan-pribadi/catatan/:id",
        gate,
        asyncHandler(async (req, res) => {
            const hasil = await getRepo().deleteEntry(req.params.id);
            if (!hasil.deleted) {
                return res.status(404).json({ success: false, message: "Catatan tidak ditemukan." });
            }
            res.json({ success: true });
        })
    );
}

module.exports = { registerAdminPersonalFinanceRoutes, isPersonalFinanceWebUser };
