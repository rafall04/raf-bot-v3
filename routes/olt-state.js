/**
 * Header Doc
 * Purpose: Read API state modem OLT (turunan `olt_state.sqlite`) — status terkini per modem,
 *          daftar insiden, dan DIAGNOSA per-modem (metrik + verdict) untuk halaman admin/teknisi.
 *          READ-ONLY, gated `config.oltModemState`, tak pernah live-poll OLT (baca cache state).
 *          Lihat docs/olt-modem-state-blueprint.md §10.
 * Caller: `lib/routes-registry.js` (mount di `/api/olt`).
 * Deps: `express`, `repositories/olt-incident.repository`, `lib/olt-modem-diagnostics`.
 * MainFuncs: GET `/modem-state`, `/modem-state/:mac`, `/modem-diagnosis`, `/modem-incidents`, `/modem-summary`.
 * SideEffects: Tidak ada (read-only SQLite).
 */
"use strict";

const express = require("express");
const router = express.Router();

const { getOltIncidentRepository } = require("../repositories/olt-incident.repository");
const { buildModemDiagnosis } = require("../lib/olt-modem-diagnostics");

const STAFF_ROLES = new Set(["admin", "owner", "superadmin", "teknisi"]);

function ensureStaff(req, res, next) {
    if (!req.user || !STAFF_ROLES.has(String(req.user.role || "").toLowerCase())) {
        return res.status(403).json({ status: 403, message: "Akses ditolak." });
    }
    next();
}

// Gate fitur: bila dimatikan eksplisit → 404 (fitur tak aktif).
function ensureEnabled(req, res, next) {
    const c = (global.config && global.config.oltModemState) || {};
    if (c.enabled === false) {
        return res.status(404).json({ status: 404, message: "Fitur state modem OLT tidak aktif." });
    }
    next();
}

function repo() {
    return getOltIncidentRepository();
}

// GET /api/olt/modem-state — daftar status modem (filter current_state/olt_id/stale).
router.get("/modem-state", ensureEnabled, ensureStaff, async (req, res) => {
    try {
        const items = await repo().listModemStates({
            current_state: req.query.state || undefined,
            olt_id: req.query.olt_id || undefined,
            stale: req.query.stale === "1" || req.query.stale === "true" ? true : undefined,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        const summary = { total: items.length };
        for (const s of items) {
            const k = s.current_state || "unknown";
            summary[k] = (summary[k] || 0) + 1;
        }
        return res.json({ status: 200, message: `${items.length} modem.`, data: { items, summary } });
    } catch (err) {
        console.error("[OLT_STATE_ROUTE_ERROR] modem-state:", err.message);
        return res.status(500).json({ status: 500, message: "Gagal memuat state modem." });
    }
});

// GET /api/olt/modem-state/:mac — status satu modem.
router.get("/modem-state/:mac", ensureEnabled, ensureStaff, async (req, res) => {
    try {
        const s = await repo().getModemState(req.params.mac);
        if (!s) return res.status(404).json({ status: 404, message: "Modem tidak ditemukan." });
        return res.json({ status: 200, data: s });
    } catch (err) {
        console.error("[OLT_STATE_ROUTE_ERROR] modem-state/:mac:", err.message);
        return res.status(500).json({ status: 500, message: "Gagal memuat state modem." });
    }
});

// GET /api/olt/modem-incidents — daftar insiden (filter mac/pppoe/olt/type/status/from/to).
router.get("/modem-incidents", ensureEnabled, ensureStaff, async (req, res) => {
    try {
        const items = await repo().listIncidents({
            mac: req.query.mac || undefined,
            pppoe_username: req.query.pppoe || undefined,
            olt_id: req.query.olt_id || undefined,
            incident_type: req.query.type || undefined,
            status: req.query.status || undefined,
            from: req.query.from ? Number(req.query.from) : undefined,
            to: req.query.to ? Number(req.query.to) : undefined,
            excludeArea: req.query.exclude_area === "1",
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json({ status: 200, message: `${items.length} insiden.`, data: { items } });
    } catch (err) {
        console.error("[OLT_STATE_ROUTE_ERROR] modem-incidents:", err.message);
        return res.status(500).json({ status: 500, message: "Gagal memuat insiden." });
    }
});

// GET /api/olt/modem-diagnosis?mac=..|pppoe=.. — metrik + verdict per modem (diagnosa admin).
router.get("/modem-diagnosis", ensureEnabled, ensureStaff, async (req, res) => {
    try {
        const mac = req.query.mac || null;
        const pppoe = req.query.pppoe || null;
        if (!mac && !pppoe) {
            return res.status(400).json({ status: 400, message: "Wajib isi ?mac= atau ?pppoe=." });
        }
        const diagnosis = await buildModemDiagnosis({ repo: repo(), mac, pppoe_username: pppoe, config: global.config });
        return res.json({ status: 200, data: diagnosis });
    } catch (err) {
        console.error("[OLT_STATE_ROUTE_ERROR] modem-diagnosis:", err.message);
        return res.status(500).json({ status: 500, message: "Gagal menyusun diagnosa modem." });
    }
});

module.exports = router;
