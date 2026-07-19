/**
 * Header Doc
 * Purpose: Route ringkasan Survei Kepuasan (CSAT) — GET /api/owner/csat?period=YYYY-MM mengembalikan
 *   rekap satu periode (report + tren 12 bulan + detractor + komentar + non-responder) dari
 *   csat.repository via csat-survey-service.getRepository() (singleton, hindari koneksi SQLite ganda).
 *   READ-ONLY, admin/owner. Menyokong halaman web `/survei`.
 * Caller: routes/admin-router.js (registerAdminCsatRoutes).
 * Deps: Express router, ensureAuthenticatedStaff (di-inject), lib/csat/csat-survey-service (getRepository),
 *   lib/error-handler.asyncHandler.
 * MainFuncs: registerAdminCsatRoutes.
 * SideEffects: Tidak ada (hanya baca agregasi).
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const csatService = require("../lib/csat/csat-survey-service");

const CSAT_ROLES = ["owner", "admin", "superadmin"];

function currentPeriod() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function registerAdminCsatRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());

    router.get("/api/owner/csat", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const role = req.user && String(req.user.role || "").toLowerCase();
        if (req.user && !CSAT_ROLES.includes(role)) {
            return res.status(403).json({ success: false, message: "Survei kepuasan khusus admin/owner." });
        }
        const period = /^\d{4}-\d{2}$/.test(String(req.query.period || "")) ? String(req.query.period) : currentPeriod();
        const repo = csatService.getRepository();
        const [report, trend, detractors, comments, nonResponders, optouts] = await Promise.all([
            repo.getReport(period),
            repo.getTrend({ limit: 12 }),
            repo.listDetractors(period),
            repo.listComments(period, { limit: 200 }),
            repo.listNonResponders(period),
            repo.listOptouts(),
        ]);
        const enabled = Boolean(global.config && global.config.csatSurvey && global.config.csatSurvey.enabled === true);
        res.json({ success: true, data: { period, enabled, report, trend, detractors, comments, nonResponders, optouts } });
    }));

    // Kirim survei SEKARANG (manual) ke semua pelanggan layak — fire-and-forget (pengiriman ber-jeda
    // anti-ban di background). Idempoten: dedup per-periode → klik dua kali tak menyurvei ulang.
    router.post("/api/owner/csat/run", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const role = req.user && String(req.user.role || "").toLowerCase();
        if (req.user && !CSAT_ROLES.includes(role)) {
            return res.status(403).json({ success: false, message: "Survei kepuasan khusus admin/owner." });
        }
        const cfg = global.config || {};
        if (!cfg.csatSurvey || cfg.csatSurvey.enabled !== true) {
            return res.status(400).json({ success: false, message: "Fitur survei belum aktif (csatSurvey.enabled=false)." });
        }
        const { runRatingSurveyCycle } = require("../lib/cron/jobs/rating-survey");
        runRatingSurveyCycle()
            .then((r) => console.log(`[CSAT_MANUAL_RUN] selesai oleh ${req.user && req.user.username}: ${JSON.stringify(r && { surveys: r.surveys, sent: r.sent, skipped: r.skipped })}`))
            .catch((e) => console.error("[CSAT_MANUAL_RUN_ERR]", e && e.message));
        res.json({ success: true, message: "Survei mulai dikirim ke pelanggan yang layak. Pengiriman ber-jeda (anti-ban) — hasil muncul di halaman ini beberapa menit lagi." });
    }));
}

module.exports = { registerAdminCsatRoutes };
