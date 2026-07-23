/**
 * Header Doc
 * Purpose: API halaman `/kas-usaha` — setelan grup WhatsApp kas, CRUD biaya rutin, dan
 *          ringkasan kas periode berjalan.
 *          BEDA dari dompet pribadi: ini setelan BISNIS, jadi memang di-gate akun staf
 *          (admin/owner) seperti halaman keuangan usaha lainnya — bukan sesi dompet.
 * Caller: `routes/admin-router.js`.
 * Deps: `ensureAuthenticatedStaff` (dari deps), `lib/error-handler.asyncHandler`,
 *       `lib/recurring-expense`, `lib/expense-manager`, `lib/whatsapp.adapter` (daftar grup).
 * MainFuncs: `registerAdminKasUsahaRoutes`.
 * SideEffects: Menulis `config.json` (hanya `businessExpense.groupId`) + tabel
 *              `recurring_expenses`; tak pernah menyentuh `expense_entries` secara langsung.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const recurring = require("../lib/recurring-expense");
const { EXPENSE_CATEGORIES, listExpenses } = require("../lib/expense-manager");

const PERAN = ["owner", "admin", "superadmin"];

function registerAdminKasUsahaRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());
    const getConfig = deps.getConfig || (() => global.config);

    function gate(req, res, next) {
        const peran = req.user && String(req.user.role || "").toLowerCase();
        if (req.user && !PERAN.includes(peran)) {
            return res.status(403).json({ success: false, message: "Halaman kas usaha khusus admin/owner." });
        }
        return next();
    }

    const jaga = [ensureAuthenticatedStaff, gate];

    // ── Setelan + daftar grup ───────────────────────────────────────────────────
    router.get(
        "/api/kas-usaha/setelan",
        jaga,
        asyncHandler(async (_req, res) => {
            const cfg = (getConfig() || {}).businessExpense || {};
            let grup = [];
            let waSiap = true;
            try {
                grup = await require("../lib/whatsapp.adapter").getGroups();
            } catch (_e) {
                // WA putus bukan kegagalan endpoint — setelan tersimpan tetap harus terlihat.
                waSiap = false;
            }
            res.json({
                success: true,
                data: {
                    enabled: cfg.enabled === true,
                    groupId: cfg.groupId || "",
                    ownerJids: cfg.ownerJids || [],
                    kategori: EXPENSE_CATEGORIES,
                    grup,
                    waSiap
                }
            });
        })
    );

    router.put(
        "/api/kas-usaha/grup",
        jaga,
        asyncHandler(async (req, res) => {
            const groupId = String((req.body || {}).groupId || "").trim();
            if (groupId && !/@g\.us$/.test(groupId)) {
                return res.status(400).json({ success: false, message: "JID grup harus berakhiran @g.us." });
            }

            const fs = require("fs");
            const path = require("path");
            const p = path.join(__dirname, "..", "config.json");
            // Baca-ubah-tulis, HANYA menyentuh satu key. config.json memuat kredensial
            // gateway dan puluhan setelan lain.
            const isi = JSON.parse(fs.readFileSync(p, "utf8"));
            if (!isi.businessExpense) isi.businessExpense = {};
            isi.businessExpense.groupId = groupId;
            fs.writeFileSync(p, JSON.stringify(isi, null, 2), "utf8");

            const cfg = getConfig();
            if (cfg) {
                if (!cfg.businessExpense) cfg.businessExpense = {};
                cfg.businessExpense.groupId = groupId;
            }
            res.json({
                success: true,
                message: groupId ? "Grup kas disimpan." : "Grup kas dikosongkan — pengingat tidak akan terkirim."
            });
        })
    );

    // ── Biaya rutin ─────────────────────────────────────────────────────────────
    router.get(
        "/api/kas-usaha/rutin",
        jaga,
        asyncHandler(async (_req, res) => {
            res.json({
                success: true,
                data: await recurring.listAll(),
                periode: recurring.periodeSekarang(),
                tertunda: (await recurring.tertunda()).map((x) => x.id)
            });
        })
    );

    router.put(
        "/api/kas-usaha/rutin",
        jaga,
        asyncHandler(async (req, res) => {
            try {
                res.json({ success: true, data: await recurring.simpan(req.body || {}) });
            } catch (e) {
                res.status(400).json({ success: false, message: e.message });
            }
        })
    );

    router.delete(
        "/api/kas-usaha/rutin/:id",
        jaga,
        asyncHandler(async (req, res) => {
            const r = await recurring.hapus(req.params.id);
            if (!r.dihapus) return res.status(404).json({ success: false, message: "Biaya rutin tidak ditemukan." });
            res.json({ success: true });
        })
    );

    // Catat manual dari web (mis. tagihan sudah dibayar sebelum pengingat sempat terkirim).
    router.post(
        "/api/kas-usaha/rutin/:id/catat",
        jaga,
        asyncHandler(async (req, res) => {
            try {
                const hasil = await recurring.konfirmasi(req.params.id, {
                    nominal: (req.body || {}).nominal,
                    actor: (req.user && req.user.username) || "web"
                });
                res.json({ success: true, data: { expenseId: hasil.expense.id, jumlah: hasil.jumlah } });
            } catch (e) {
                res.status(400).json({ success: false, message: e.message });
            }
        })
    );

    // ── Ringkasan kas bulan berjalan ────────────────────────────────────────────
    router.get(
        "/api/kas-usaha/ringkasan",
        jaga,
        asyncHandler(async (_req, res) => {
            const now = new Date();
            const p = (n) => String(n).padStart(2, "0");
            const from = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
            const to = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`;

            const rows = await listExpenses({ dateFrom: from, dateTo: to, status: "active" });
            const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
            const perKategori = {};
            for (const e of rows) {
                perKategori[e.category] = (perKategori[e.category] || 0) + Number(e.amount || 0);
            }
            res.json({ success: true, data: { periode: recurring.periodeSekarang(), total, jumlah: rows.length, perKategori, terbaru: rows.slice(0, 10) } });
        })
    );
}

module.exports = { registerAdminKasUsahaRoutes };
