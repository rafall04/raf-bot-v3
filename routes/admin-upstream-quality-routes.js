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
}

module.exports = { registerAdminUpstreamQualityRoutes };
