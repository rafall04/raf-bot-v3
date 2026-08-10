/**
 * Header Doc
 * Purpose: API halaman `/pengeluaran` — CRUD pengeluaran operasional + ringkasannya.
 *          Seluruh tulis lewat `lib/expense-manager` (tabel `expense_entries` + buku besar),
 *          sumber angka yang SAMA dengan perintah `kas` di WhatsApp dan `/rekap-keuangan`.
 * Caller: `routes/admin-router.js` / registry route admin.
 * Deps: `lib/expense-manager`, `lib/activity-logger`, `lib/services/kas-group-notifier`
 *       (kabar pengeluaran besar ke grup kas — opsional, bergerbang `businessExpense.notifyAbove`).
 * MainFuncs: router Express (`GET /`, `POST /`, `PUT /:id`, `PUT /:id/cancel`, ringkasan).
 * SideEffects: Menulis `expense_entries` + buku besar; mencatat activity log; mengirim kabar WA
 *              ke grup kas untuk pengeluaran di atas ambang.
 */
"use strict";

const express = require("express");
const { logActivity } = require("../lib/activity-logger");
const {
    EXPENSE_CATEGORIES,
    createExpense,
    updateExpense,
    cancelExpense,
    listExpenses,
    getExpenseSummary,
    ensureExpenseTables
} = require("../lib/expense-manager");

const router = express.Router();

function ensureAdmin(req, res, next) {
    if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

function getActor(req) {
    return {
        id: req.user?.id || null,
        username: req.user?.username || "system",
        name: req.user?.name || req.user?.username || "system"
    };
}

ensureExpenseTables().catch(console.error);

router.get("/meta", ensureAdmin, (req, res) => {
    res.json({
        status: 200,
        data: {
            categories: EXPENSE_CATEGORIES
        }
    });
});

router.get("/", ensureAdmin, async (req, res) => {
    try {
        const filters = {
            month: req.query.month ? parseInt(req.query.month, 10) : null,
            year: req.query.year ? parseInt(req.query.year, 10) : null,
            category: req.query.category || null,
            paymentMethod: req.query.payment_method || null,
            status: req.query.status || null,
            createdBy: req.query.created_by || null
        };
        const [rows, summary] = await Promise.all([
            listExpenses(filters),
            getExpenseSummary(filters)
        ]);
        res.json({
            status: 200,
            data: rows,
            summary
        });
    } catch (error) {
        console.error("[EXPENSE_LIST_ERROR]", error);
        res.status(500).json({ status: 500, message: "Gagal mengambil daftar pengeluaran" });
    }
});

router.post("/", ensureAdmin, async (req, res) => {
    try {
        const expense = await createExpense(req.body, getActor(req));
        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: "CREATE",
            resourceType: "expense_entry",
            resourceId: String(expense.id),
            resourceName: expense.title,
            description: `Membuat pengeluaran ${expense.category} sebesar Rp ${expense.amount.toLocaleString("id-ID")}`,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
        }).catch(console.error);

        // Kabari grup kas untuk pengeluaran BESAR yang dibuat dari halaman.
        // Sengaja hanya jalur WEB: pengeluaran yang dicatat lewat `kas …` sudah dibalas di
        // grup itu juga, jadi mengabarkannya lagi hanya menghasilkan pesan dobel.
        // Ambangnya bisa diatur; 0/tak diisi = fitur diam.
        try {
            const ambang = Number(
                (global.config && global.config.businessExpense && global.config.businessExpense.notifyAbove) || 0
            );
            if (ambang > 0 && Number(expense.amount) >= ambang) {
                const { kabarkanKeGrupKas } = require("../lib/services/kas-group-notifier");
                kabarkanKeGrupKas("kas_notif_pengeluaran_besar", {
                    fallback: "🧾 *PENGELUARAN BESAR DICATAT*\n\n📌 ${judul}\n💰 ${nominal}\n📂 ${kategori}\n👤 oleh ${oleh}",
                    data: {
                        judul: expense.title,
                        nominal: Number(expense.amount),
                        kategori: expense.category,
                        oleh: (getActor(req) || {}).name || req.user.username || "admin"
                    }
                }).catch(() => {});
            }
        } catch (notifErr) {
            console.error("[EXPENSE_NOTIF]", notifErr && notifErr.message);
        }

        res.status(201).json({
            status: 201,
            message: "Pengeluaran berhasil disimpan",
            data: expense
        });
    } catch (error) {
        console.error("[EXPENSE_CREATE_ERROR]", error);
        res.status(400).json({ status: 400, message: error.message || "Gagal menyimpan pengeluaran" });
    }
});

router.put("/:id", ensureAdmin, async (req, res) => {
    try {
        const result = await updateExpense(req.params.id, req.body, getActor(req));
        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: "UPDATE",
            resourceType: "expense_entry",
            resourceId: String(result.current.id),
            resourceName: result.current.title,
            description: `Merevisi pengeluaran #${req.params.id} menjadi #${result.current.id}`,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
        }).catch(console.error);

        res.json({
            status: 200,
            message: "Pengeluaran berhasil direvisi",
            data: result
        });
    } catch (error) {
        console.error("[EXPENSE_UPDATE_ERROR]", error);
        res.status(400).json({ status: 400, message: error.message || "Gagal merevisi pengeluaran" });
    }
});

router.put("/:id/cancel", ensureAdmin, async (req, res) => {
    try {
        const expense = await cancelExpense(req.params.id, getActor(req), req.body.notes || "");
        logActivity({
            userId: req.user.id,
            username: req.user.username,
            role: req.user.role,
            actionType: "UPDATE",
            resourceType: "expense_entry",
            resourceId: String(expense.id),
            resourceName: expense.title,
            description: `Membatalkan pengeluaran #${expense.id}`,
            ipAddress: req.ip,
            userAgent: req.headers["user-agent"]
        }).catch(console.error);

        res.json({
            status: 200,
            message: "Pengeluaran berhasil dibatalkan",
            data: expense
        });
    } catch (error) {
        console.error("[EXPENSE_CANCEL_ERROR]", error);
        res.status(400).json({ status: 400, message: error.message || "Gagal membatalkan pengeluaran" });
    }
});

module.exports = router;
