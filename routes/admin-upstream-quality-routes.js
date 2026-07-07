/**
 * Header Doc
 * Purpose: Route admin monitoring kualitas jalur upstream (GMDP/IH/MNI/SF) — status vonis per
 *          jalur, riwayat probe mentah, dan trigger probe manual.
 * Caller: `routes/admin-router.js`.
 * Deps: `lib/upstream-quality-poller` (status/poll), `repositories/upstream-quality.repository`
 *       (riwayat), `ensureAuthenticatedStaff`, `lib/error-handler.asyncHandler`.
 * MainFuncs: `registerAdminUpstreamQualityRoutes`.
 * SideEffects: Endpoint poll-now memicu satu siklus ping dari router gateway.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const upstreamPoller = require("../lib/upstream-quality-poller");
const serviceProber = require("../lib/service-reachability-prober");
const { getUpstreamQualityRepository } = require("../repositories/upstream-quality.repository");

function registerAdminUpstreamQualityRoutes(router, deps) {
    const { ensureAuthenticatedStaff } = deps;

    // Status ringkas per jalur (vonis NORMAL/DEGRADASI/GANGGUAN/PUTUS + failover MNI→SF).
    router.get("/api/upstream-quality/status", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const report = await upstreamPoller.buildStatusReport();
        res.json({ success: true, data: report });
    }));

    // Riwayat probe mentah untuk grafik/analisa (default 6 jam terakhir, filter ?path=).
    router.get("/api/upstream-quality/history", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const minutes = Math.max(5, Math.min(7 * 24 * 60, Number(req.query.minutes) || 360));
        const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();
        const rows = await getUpstreamQualityRepository().getRecentProbes({
            sinceIso,
            path: req.query.path || null,
            limit: Number(req.query.limit) || 2000
        });
        res.json({ success: true, data: { since: sinceIso, count: rows.length, rows } });
    }));

    // Trigger satu siklus probe sekarang (untuk verifikasi setelah setup / saat investigasi).
    router.post("/api/upstream-quality/poll-now", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await upstreamPoller.pollOnce();
        res.json({ success: result.ok === true, data: result, stats: upstreamPoller.getPollerStats() });
    }));

    // Riwayat link WAN (bps/utilisasi/error/flap) untuk grafik throughput per ISP.
    router.get("/api/upstream-quality/wan-history", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const minutes = Math.max(5, Math.min(7 * 24 * 60, Number(req.query.minutes) || 360));
        const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();
        const rows = await getUpstreamQualityRepository().getWanHistory({
            sinceIso,
            path: req.query.path || null,
            limit: Number(req.query.limit) || 4000
        });
        res.json({ success: true, data: { since: sinceIso, count: rows.length, rows } });
    }));

    // Rapor ISP N hari (availability/loss/RTT/flap) — bahan objektif evaluasi/komplain ISP.
    router.get("/api/upstream-quality/report", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const days = Math.max(1, Math.min(30, Number(req.query.days) || 7));
        const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const cfg = upstreamPoller.getMonitorConfig();
        const rows = await getUpstreamQualityRepository().getIspReport({
            sinceIso,
            lossWarnPct: cfg.thresholds.lossWarnPct
        });
        const labelByPath = new Map(cfg.paths.map((p) => [p.key, p.label || p.key]));
        res.json({
            success: true,
            data: {
                days,
                since: sinceIso,
                rows: rows.map((r) => ({ ...r, label: labelByPath.get(r.path) || r.path }))
            }
        });
    }));

    // Insiden terakhir (alert/flap/traceroute bukti hop) — kronologi utk komplain ISP.
    router.get("/api/upstream-quality/incidents", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const rows = await getUpstreamQualityRepository().getIncidents({
            limit: Number(req.query.limit) || 30
        });
        res.json({ success: true, data: { rows } });
    }));

    // Traceroute manual satu jalur (bukti on-demand; hasil ikut masuk daftar insiden).
    router.post("/api/upstream-quality/trace/:path", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await upstreamPoller.runTraceProbe(String(req.params.path || ""));
        res.json({ success: result.ok === true, data: result });
    }));

    // Matriks reachability Layanan × Jalur (Instagram/FB/Google via GMDP/IH/MNI/SF).
    router.get("/api/service-quality/status", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const report = await serviceProber.buildServiceReport();
        res.json({ success: true, data: report });
    }));

    router.get("/api/service-quality/history", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const minutes = Math.max(5, Math.min(7 * 24 * 60, Number(req.query.minutes) || 360));
        const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();
        const rows = await getUpstreamQualityRepository().getServiceHistory({
            sinceIso,
            service: req.query.service || null,
            path: req.query.path || null,
            limit: Number(req.query.limit) || 4000
        });
        res.json({ success: true, data: { since: sinceIso, count: rows.length, rows } });
    }));

    // Trigger satu siklus probe layanan sekarang (verifikasi setelah setup).
    router.post("/api/service-quality/poll-now", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await serviceProber.probeCycle();
        res.json({ success: result.ok === true, data: result, stats: serviceProber.getProberStats() });
    }));
}

module.exports = { registerAdminUpstreamQualityRoutes };
