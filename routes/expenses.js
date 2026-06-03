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
