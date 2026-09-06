/**
 * Header Doc
 * Purpose: Route Survei Kepuasan (CSAT) untuk admin/owner, menyokong halaman `/survei`:
 *   GET  /api/owner/csat?period=YYYY-MM  → rekap periode (report + tren 12 bln + detractor + komentar
 *        + non-responder + optout + enabled + settings) dari csat.repository via getRepository().
 *   POST /api/owner/csat/run       → kirim survei SEKARANG (fire-and-forget, dedup per-periode).
 *   POST /api/owner/csat/recover   → pulihkan balasan yang sempat bocor (replay handleInboundReply).
 *   POST /api/owner/csat/settings  → simpan setelan survei + anti-ban (merge config.json + live).
 *   Semua via getRepository() singleton (hindari koneksi SQLite ganda).
 * Caller: routes/admin-router.js (registerAdminCsatRoutes).
 * Deps: Express router, ensureAuthenticatedStaff (di-inject), lib/csat/csat-survey-service (getRepository),
 *   lib/error-handler.asyncHandler.
 * MainFuncs: registerAdminCsatRoutes.
 * SideEffects: Tidak ada (hanya baca agregasi).
 */
"use strict";
const { writeFileAtomicSync } = require('../lib/atomic-file'); // config.json ATOMIK (#b343)

const fs = require("fs");
const path = require("path");
const { asyncHandler } = require("../lib/error-handler");
const csatService = require("../lib/csat/csat-survey-service");

const CSAT_ROLES = ["owner", "admin", "superadmin"];

function readCsatSettings(c = {}) {
    const cs = c.csatSurvey || {};
    const bg = c.broadcastGuard || {};
    const nOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    return {
        csatSurvey: {
            enabled: cs.enabled === true,
            onlyPaid: cs.onlyPaid !== false,
            alertDetractor: cs.alertDetractor !== false,
            detractorMaxScore: nOr(cs.detractorMaxScore, 2),
        },
        broadcastGuard: {
            enabled: bg.enabled === true,
            validateOnWhatsApp: bg.validateOnWhatsApp === true,
            jitterMaxExtraMs: nOr(bg.jitterMaxExtraMs, 4000),
            batchSize: nOr(bg.batchSize, 25),
            batchPauseMs: nOr(bg.batchPauseMs, 60000),
            breakerThreshold: nOr(bg.breakerThreshold, 6),
            minGapMs: nOr(bg.minGapMs, 0),
        },
    };
}

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
        const settings = readCsatSettings(global.config || {});
        res.json({ success: true, data: { period, enabled, settings, report, trend, detractors, comments, nonResponders, optouts } });
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

    // PEMULIHAN balasan survei yang sempat bocor (pelanggan membalas selama jendela kirim ber-jeda
    // sebelum baris ditandai 'sent'). Baca inbound mentah → putar ulang lewat handleInboundReply
    // (rating tercatat + WA susulan + alert detractor + opt-out). In-process (butuh koneksi WA),
    // fire-and-forget, ber-jeda anti-ban. Idempoten: sekali dipulihkan status ≠ 'sent' → tak diulang.
    router.post("/api/owner/csat/recover", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const role = req.user && String(req.user.role || "").toLowerCase();
        if (req.user && !CSAT_ROLES.includes(role)) {
            return res.status(403).json({ success: false, message: "Pemulihan survei khusus admin/owner." });
        }
        const period = /^\d{4}-\d{2}$/.test(String((req.body && req.body.period) || "")) ? String(req.body.period) : currentPeriod();
        const dryRun = Boolean(req.body && (req.body.dryRun === true || req.body.dryRun === "true"));
        const { recoverLostResponders } = require("../lib/csat/csat-recovery");
        if (dryRun) {
            const r = await recoverLostResponders({ period, dryRun: true });
            return res.json({ success: true, dryRun: true, data: r, message: `Rencana: ${r.plan.length} balasan akan dipulihkan (belum dieksekusi).` });
        }
        recoverLostResponders({ period })
            .then((r) => console.log(`[CSAT_RECOVERY] dipicu ${req.user && req.user.username}: ${JSON.stringify(r)}`))
            .catch((e) => console.error("[CSAT_RECOVERY_ERR]", e && e.message));
        res.json({ success: true, message: "Pemulihan balasan yang terlewat mulai berjalan (ber-jeda anti-ban). Hasil muncul di halaman ini beberapa menit lagi." });
    }));

    // Simpan setelan survei + anti-ban ke config.json (MERGE, bukan replace) + update config LIVE
    // tanpa restart (cron/hook/guard baca global.config saat runtime).
    router.post("/api/owner/csat/settings", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const role = req.user && String(req.user.role || "").toLowerCase();
        if (req.user && !CSAT_ROLES.includes(role)) {
            return res.status(403).json({ success: false, message: "Setelan survei khusus admin/owner." });
        }
        const body = req.body || {};
        const b = (v) => v === true || v === "true" || v === "on" || v === 1 || v === "1";
        const clampNum = (v, d, min, max) => {
            let n = Number(v);
            if (!Number.isFinite(n)) n = d;
            if (min !== undefined) n = Math.max(min, n);
            if (max !== undefined) n = Math.min(max, n);
            return n;
        };
        const cfgPath = path.join(__dirname, "..", "config.json");
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        cfg.csatSurvey = cfg.csatSurvey || {};
        cfg.broadcastGuard = cfg.broadcastGuard || {};
        const cs = body.csatSurvey || {};
        if ("enabled" in cs) cfg.csatSurvey.enabled = b(cs.enabled);
        if ("onlyPaid" in cs) cfg.csatSurvey.onlyPaid = b(cs.onlyPaid);
        if ("alertDetractor" in cs) cfg.csatSurvey.alertDetractor = b(cs.alertDetractor);
        if ("detractorMaxScore" in cs) cfg.csatSurvey.detractorMaxScore = clampNum(cs.detractorMaxScore, 2, 1, 5);
        const bg = body.broadcastGuard || {};
        if ("enabled" in bg) cfg.broadcastGuard.enabled = b(bg.enabled);
        if ("validateOnWhatsApp" in bg) cfg.broadcastGuard.validateOnWhatsApp = b(bg.validateOnWhatsApp);
        if ("jitterMaxExtraMs" in bg) cfg.broadcastGuard.jitterMaxExtraMs = clampNum(bg.jitterMaxExtraMs, 4000, 0);
        if ("batchSize" in bg) cfg.broadcastGuard.batchSize = clampNum(bg.batchSize, 25, 0);
        if ("batchPauseMs" in bg) cfg.broadcastGuard.batchPauseMs = clampNum(bg.batchPauseMs, 60000, 0);
        if ("breakerThreshold" in bg) cfg.broadcastGuard.breakerThreshold = clampNum(bg.breakerThreshold, 6, 0);
        if ("minGapMs" in bg) cfg.broadcastGuard.minGapMs = clampNum(bg.minGapMs, 0, 0);
        writeFileAtomicSync(cfgPath, JSON.stringify(cfg, null, 2));
        if (global.config) { global.config.csatSurvey = cfg.csatSurvey; global.config.broadcastGuard = cfg.broadcastGuard; }
        console.log(`[CSAT_SETTINGS] disimpan oleh ${req.user && req.user.username}: csatSurvey.enabled=${cfg.csatSurvey.enabled} broadcastGuard.enabled=${cfg.broadcastGuard.enabled} validateOnWhatsApp=${cfg.broadcastGuard.validateOnWhatsApp}`);
        res.json({ success: true, message: "Setelan disimpan & langsung aktif.", data: readCsatSettings(cfg) });
    }));
}

module.exports = { registerAdminCsatRoutes };
