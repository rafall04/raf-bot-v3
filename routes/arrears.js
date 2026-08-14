/**
 * Header Doc
 * Purpose: Menyediakan endpoint API read-only untuk rekap tunggakan pelanggan berbasis periode.
 * Caller: `routes/api.js`.
 * Deps: Express dan `../services/arrears.service`.
 * MainFuncs: `GET /read-model`, `GET /summary`, `GET /customer/:id`.
 * SideEffects: Tidak ada; read-model only.
 * INVARIAN: ketiga handler WAJIB dibungkus `asyncHandler`. Express 4 hanya menangkap lemparan
 *           SINKRON, jadi handler `async` polos yang menolak akan membuat request MENGGANTUNG:
 *           tanpa 500, tanpa body. Saat users.sqlite bermasalah (SQLITE_IOERR / WAL yatim —
 *           insiden yang sudah pernah terjadi), halaman rekap berputar terus dan admin
 *           menyimpulkan "tidak ada tunggakan" alih-alih "database rusak".
 */
"use strict";

const express = require("express");
const { createArrearsService } = require("../services/arrears.service");
const { asyncHandler } = require("../lib/error-handler");

function ensureAdmin(req, res, next) {
    if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak." });
    }
    next();
}

function parsePeriod(value) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
}

function createArrearsRouter(overrides = {}) {
    const router = express.Router();
    const service = overrides.service || createArrearsService();

    router.get("/read-model", ensureAdmin, asyncHandler(async (req, res) => {
        const periodMonth = parsePeriod(req.query.period_month);
        const periodYear = parsePeriod(req.query.period_year);
        if (!periodMonth || !periodYear) {
            return res.status(400).json({ status: 400, message: "period_month dan period_year wajib diisi" });
        }

        const data = await service.getArrearsReadModel({ periodMonth, periodYear });
        return res.json({ status: 200, data });
    }));

    router.get("/summary", ensureAdmin, asyncHandler(async (req, res) => {
        const periodMonth = parsePeriod(req.query.period_month);
        const periodYear = parsePeriod(req.query.period_year);
        if (!periodMonth || !periodYear) {
            return res.status(400).json({ status: 400, message: "period_month dan period_year wajib diisi" });
        }

        const data = await service.getArrearsReadModel({ periodMonth, periodYear });
        return res.json({ status: 200, data: data.summary });
    }));

    router.get("/customer/:id", ensureAdmin, asyncHandler(async (req, res) => {
        const periodMonth = parsePeriod(req.query.period_month);
        const periodYear = parsePeriod(req.query.period_year);
        if (!periodMonth || !periodYear) {
            return res.status(400).json({ status: 400, message: "period_month dan period_year wajib diisi" });
        }

        const data = await service.getCustomerArrearsDetail({
            userId: req.params.id,
            periodMonth,
            periodYear
        });
        return res.json({ status: 200, data });
    }));

    return router;
}

module.exports = createArrearsRouter;
module.exports.createArrearsRouter = createArrearsRouter;
