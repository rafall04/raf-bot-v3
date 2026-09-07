/**
 * Header Doc
 * Purpose: API SELF-SERVICE preferensi teknisi (RONDE 6 Fase A) — halaman "Pengaturan Saya" (web)
 *   baca/tulis preferensi milik DIRINYA. Di-scope ke `req.user.id` (teknisi hanya boleh prefs sendiri;
 *   admin/owner boleh lihat/ubah teknisi lain via ?teknisi_id). Persist ke store per-teknisi
 *   (repositories/teknisi-prefs.repository, terpisah dari accounts.json). Di-mount di prefix sendiri
 *   /api/teknisi (BUKAN admin-router) → lolos gerbang fail-closed, gate cukup ensureAuthenticatedStaff.
 * Caller: lib/routes-registry.js (app.use('/api/teknisi', teknisiSettingsRouter)).
 * Deps: express, ../lib/error-handler (asyncHandler), ./api-route-helpers (ensureAuthenticatedStaff),
 *   ../repositories/teknisi-prefs.repository, ../lib/teknisi-account-link (Fase D profil + hubungkan WA).
 * MainFuncs: GET/POST /prefs; GET/PUT /profile; POST /link-code; POST /unlink.
 * SideEffects: Menulis database/teknisi_prefs.json (repo) & database/accounts.json (profil/link, atomik).
 */
"use strict";

const express = require("express");
const router = express.Router();
const { asyncHandler } = require("../lib/error-handler");
const { ensureAuthenticatedStaff } = require("./api-route-helpers");
const prefsRepo = require("../repositories/teknisi-prefs.repository");
const accountLink = require("../lib/teknisi-account-link");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

// Gate fitur: prefs BELUM diterapkan (resolver Fase B / pantau Fase C) sampai admin mengaktifkan.
// Halaman tetap fungsional agar teknisi bisa pra-atur; status dikirim ke UI utk banner jujur.
function featureEnabled() {
    const cfg = (global.config && global.config.teknisiPrefs) || {};
    return cfg.enabled === true;
}

// Teknisi → hanya prefs SENDIRI; admin/owner → boleh target teknisi lain via ?teknisi_id.
function resolveTargetId(req) {
    if (ADMIN_ROLES.includes(req.user && req.user.role) && req.query.teknisi_id) {
        return String(req.query.teknisi_id);
    }
    return String(req.user && req.user.id);
}

// Ambil HANYA field yang dikenal dari body (anti-injeksi field asing ke store).
function sanitize(body = {}) {
    const out = {};
    if (typeof body.enabled === "boolean") out.enabled = body.enabled;
    if (typeof body.channel === "string" && ["dm", "group", "both"].includes(body.channel)) out.channel = body.channel;
    if (Array.isArray(body.areas)) out.areas = body.areas.map((a) => String(a).trim()).filter(Boolean).slice(0, 50);
    if (body.alerts && typeof body.alerts === "object") {
        out.alerts = {};
        for (const k of ["los", "redaman", "ticket_new", "post_repair"]) {
            if (typeof body.alerts[k] === "boolean") out.alerts[k] = body.alerts[k];
        }
    }
    if (body.quietHours && typeof body.quietHours === "object") {
        out.quietHours = {};
        if (typeof body.quietHours.enabled === "boolean") out.quietHours.enabled = body.quietHours.enabled;
        if (/^\d{2}:\d{2}$/.test(body.quietHours.start || "")) out.quietHours.start = body.quietHours.start;
        if (/^\d{2}:\d{2}$/.test(body.quietHours.end || "")) out.quietHours.end = body.quietHours.end;
    }
    if (body.pantau && typeof body.pantau === "object") {
        out.pantau = {};
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
        if (num(body.pantau.intervalMs) !== undefined) out.pantau.intervalMs = Math.max(30000, num(body.pantau.intervalMs));
        if (num(body.pantau.durationMs) !== undefined) out.pantau.durationMs = Math.max(60000, num(body.pantau.durationMs));
        if (num(body.pantau.changeThresholdDb) !== undefined) out.pantau.changeThresholdDb = num(body.pantau.changeThresholdDb);
        if (num(body.pantau.targetDbm) !== undefined) out.pantau.targetDbm = num(body.pantau.targetDbm);
    }
    if (body.snoozeUntil === null || typeof body.snoozeUntil === "string") out.snoozeUntil = body.snoozeUntil;
    return out;
}

router.get("/prefs", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
    const id = resolveTargetId(req);
    return res.status(200).json({
        status: 200,
        data: {
            teknisiId: id,
            prefs: prefsRepo.getPrefs(id),
            customized: !!prefsRepo.getRawPrefs(id),
            defaults: prefsRepo.DEFAULTS,
            featureEnabled: featureEnabled(),
        },
    });
}));

router.post("/prefs", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
    const id = resolveTargetId(req);
    const patch = sanitize(req.body || {});
    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ status: 400, message: "Tak ada field preferensi yang valid untuk disimpan." });
    }
    const prefs = prefsRepo.setPrefs(id, patch);
    return res.status(200).json({ status: 200, message: "Preferensi disimpan.", data: { teknisiId: id, prefs } });
}));

// ── RONDE 6 Fase D: profil diri + hubungkan WhatsApp (self-scoped, #b357) ──
// Selalu operasi pada AKUN SENDIRI (req.user.id) — bukan ?teknisi_id (identitas tak boleh diubah admin
// atas nama teknisi lewat sini; admin punya CRUD /api/accounts sendiri).
function ownAccount(req) {
    const id = String(req.user && req.user.id);
    const acc = (Array.isArray(global.accounts) ? global.accounts : []).find((a) => a && String(a.id) === id);
    return { id, acc };
}

router.get("/profile", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
    const { id, acc } = ownAccount(req);
    if (!acc) return res.status(404).json({ status: 404, message: "Akun tidak ditemukan." });
    return res.status(200).json({
        status: 200,
        data: {
            id,
            username: acc.username || null,
            name: acc.name || null,
            role: acc.role || null,
            phone_number: acc.phone_number || "",
            waLinked: !!acc.lid,
            featureEnabled: featureEnabled(),
        },
    });
}));

router.put("/profile", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
    const name = req.body && req.body.name;
    if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ status: 400, message: "Nama tidak boleh kosong." });
    }
    const r = await accountLink.updateProfile(req.user.id, { name });
    if (!r.ok) return res.status(r.reason === "not_found" ? 404 : 400).json({ status: 400, message: "Gagal menyimpan profil." });
    return res.status(200).json({ status: 200, message: "Profil disimpan.", data: { name: r.account.name } });
}));

// Terbitkan kode hubung WA (ditebus dari WA: `hubungkan <kode>`). Membuktikan kepemilikan web (JWT).
router.post("/link-code", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
    const out = accountLink.issueLinkCode(req.user.id);
    return res.status(200).json({ status: 200, data: { code: out.code, expiresAt: out.expiresAt, ttlMs: out.ttlMs } });
}));

router.post("/unlink", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
    const r = await accountLink.unlinkWa(req.user.id);
    if (!r.ok) return res.status(400).json({ status: 400, message: "Gagal memutus tautan." });
    return res.status(200).json({ status: 200, message: "Tautan WhatsApp diputus." });
}));

// Helper internal diekspos untuk unit test (self-scope + anti-injeksi field).
module.exports = router;
module.exports.resolveTargetId = resolveTargetId;
module.exports.sanitize = sanitize;
