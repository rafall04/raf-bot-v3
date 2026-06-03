/**
 * Header Doc
 * Purpose: Menyediakan endpoint API read-only untuk rekap tunggakan pelanggan berbasis periode.
 * Caller: `routes/api.js`.
 * Deps: Express dan `../services/arrears.service`.
 * MainFuncs: `GET /read-model`, `GET /summary`, `GET /customer/:id`.
 * SideEffects: Tidak ada; read-model only.
 */
"use strict";

const express = require("express");
const { createArrearsService } = require("../services/arrears.service");

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

    router.get("/read-model", ensureAdmin, async (req, res) => {
        const periodMonth = parsePeriod(req.query.period_month);
        const periodYear = parsePeriod(req.query.period_year);
        if (!periodMonth || !periodYear) {
            return res.status(400).json({ status: 400, message: "period_month dan period_year wajib diisi" });
        }

        const data = await service.getArrearsReadModel({ periodMonth, periodYear });
        return res.json({ status: 200, data });
    });

    router.get("/summary", ensureAdmin, async (req, res) => {
        const periodMonth = parsePeriod(req.query.period_month);
        const periodYear = parsePeriod(req.query.period_year);
        if (!periodMonth || !periodYear) {
            return res.status(400).json({ status: 400, message: "period_month dan period_year wajib diisi" });
        }

        const data = await service.getArrearsReadModel({ periodMonth, periodYear });
        return res.json({ status: 200, data: data.summary });
    });

    router.get("/customer/:id", ensureAdmin, async (req, res) => {
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
    });

    return router;
}

module.exports = createArrearsRouter;
module.exports.createArrearsRouter = createArrearsRouter;
