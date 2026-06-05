/**
 * Header Doc
 * Purpose: Route admin untuk konfigurasi & monitoring auto-broadcast LOS (fiber putus) ke teknisi.
 * Caller: `routes/admin-router.js`.
 * Deps: Express router, `ensureAuthenticatedStaff`, `lib/olt-los-broadcaster`, runtime config (setConfig), `lib/error-handler.asyncHandler`.
 * MainFuncs: `registerAdminLosBroadcastRoutes`, `normalizeLosConfig`.
 * SideEffects: Membaca/menulis `config.json` (sub-key `oltLosBroadcast`) dan memuat ulang config runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { asyncHandler } = require("../lib/error-handler");
const losBroadcaster = require("../lib/olt-los-broadcaster");

const DEFAULTS = losBroadcaster.DEFAULTS;
const CONFIG_PATH = path.join(__dirname, "..", "config.json");

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/**
 * Terima input human-friendly (menit/detik) → simpan kanonik (ms). Semua nilai
 * di-clamp ke rentang aman supaya admin tak bisa men-set nilai berbahaya
 * (mis. window 0 → langsung broadcast tanpa konfirmasi).
 */
function asBool(v) {
    return v === true || v === "true" || v === "1" || v === 1;
}

function normalizeLosConfig(input = {}) {
    const confirmationWindowMinutes = clampNumber(input.confirmationWindowMinutes, 1, 60, 3);
    const clusterFlushSeconds = clampNumber(input.clusterFlushSeconds, 1, 300, 20);
    const rebroadcastCooldownMinutes = clampNumber(input.rebroadcastCooldownMinutes, 1, 720, 30);
    // Notifikasi pelanggan terjadwal setelah teknisi (default 60 menit).
    const nc = input.notifyCustomer || {};
    const customerDelayMinutes = clampNumber(
        input.customerNotifyDelayMinutes != null ? input.customerNotifyDelayMinutes : nc.delayMinutes,
        1, 1440, 60
    );
    const ncDefault = DEFAULTS.notifyCustomer || {};
    return {
        enabled: asBool(input.enabled),
        confidenceThreshold: clampNumber(input.confidenceThreshold, 0, 1, DEFAULTS.confidenceThreshold),
        confirmationWindowMs: Math.round(confirmationWindowMinutes * 60 * 1000),
        clusterFlushMs: Math.round(clusterFlushSeconds * 1000),
        clusterThreshold: Math.round(clampNumber(input.clusterThreshold, 2, 100, DEFAULTS.clusterThreshold)),
        rebroadcastCooldownMs: Math.round(rebroadcastCooldownMinutes * 60 * 1000),
        notifyCustomer: {
            enabled: asBool(input.notifyCustomerEnabled != null ? input.notifyCustomerEnabled : nc.enabled),
            delayMs: Math.round(customerDelayMinutes * 60 * 1000),
            onlyIfStillDown: input.customerOnlyIfStillDown != null
                ? asBool(input.customerOnlyIfStillDown)
                : (nc.onlyIfStillDown !== false),
            messageTemplate: (input.customerMessageTemplate != null ? input.customerMessageTemplate : nc.messageTemplate)
                || ncDefault.messageTemplate || "",
        },
    };
}

/** Tambah field human-friendly turunan supaya UI tinggal pakai. */
function decorateForView(cfg) {
    const nc = cfg.notifyCustomer || DEFAULTS.notifyCustomer || {};
    const ncDefault = DEFAULTS.notifyCustomer || {};
    return {
        ...cfg,
        confirmationWindowMinutes: Math.round((cfg.confirmationWindowMs || DEFAULTS.confirmationWindowMs) / 60000),
        clusterFlushSeconds: Math.round((cfg.clusterFlushMs || DEFAULTS.clusterFlushMs) / 1000),
        rebroadcastCooldownMinutes: Math.round((cfg.rebroadcastCooldownMs || DEFAULTS.rebroadcastCooldownMs) / 60000),
        notifyCustomer: {
            enabled: nc.enabled === true,
            onlyIfStillDown: nc.onlyIfStillDown !== false,
            delayMinutes: Math.round((nc.delayMs || ncDefault.delayMs || 3600000) / 60000),
            messageTemplate: nc.messageTemplate || ncDefault.messageTemplate || "",
        },
    };
}

function registerAdminLosBroadcastRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());
    const configPath = deps.configPath || CONFIG_PATH;
    const readConfig = deps.readConfig || (() => JSON.parse(fs.readFileSync(configPath, "utf8")));
    const writeConfig = deps.writeConfig || ((cfg) => fs.writeFileSync(configPath, JSON.stringify(cfg, null, 4), "utf8"));
    const runtime = deps.runtime || global.__appRuntime || null;
    const setRuntimeConfig = deps.setRuntimeConfig || ((cfg) => {
        // Runtime.setConfig juga meng-update global.config (dilihat broadcaster live).
        if (runtime && typeof runtime.setConfig === "function") runtime.setConfig(cfg);
        else global.config = cfg;
    });
    const listIncidents = deps.listIncidents || losBroadcaster.listLosIncidents;
    const getState = deps.getState || losBroadcaster.getLosState;
    const logActivity = deps.logActivity || (async () => {});

    function isPrivileged(req) {
        return req.user && ["admin", "owner", "superadmin", "teknisi"].includes(req.user.role);
    }

    router.get("/api/admin/los-broadcast/config", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        const cfg = readConfig();
        const merged = { ...DEFAULTS, ...(cfg.oltLosBroadcast || {}) };
        res.status(200).json({
            status: 200,
            message: "LOS broadcast config loaded.",
            data: decorateForView(merged),
        });
    }));

    router.post("/api/admin/los-broadcast/config", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!isPrivileged(req) && req.user) {
            return res.status(403).json({ status: 403, message: "Akses ditolak." });
        }
        const normalized = normalizeLosConfig(req.body || {});
        const cfg = readConfig();
        cfg.oltLosBroadcast = normalized;
        writeConfig(cfg);
        setRuntimeConfig(cfg);

        try {
            await logActivity({
                userId: req.user?.id,
                username: req.user?.username,
                role: req.user?.role,
                actionType: "UPDATE",
                resourceType: "config",
                resourceId: "los-broadcast",
                resourceName: "LOS Auto-Broadcast Configuration",
                description: `Updated LOS broadcast config (enabled: ${normalized.enabled}, window: ${normalized.confirmationWindowMs}ms)`,
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers?.["user-agent"],
            });
        } catch (logErr) {
            console.error("[LOS_BROADCAST_CONFIG] activity log error:", logErr.message);
        }

        res.status(200).json({
            status: 200,
            message: "LOS broadcast config saved.",
            data: decorateForView(normalized),
        });
    }));

    router.get("/api/admin/los-broadcast/incidents", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const limit = clampNumber(req.query?.limit, 1, 1000, 100);
        const status = req.query?.status ? String(req.query.status) : null;
        let items = listIncidents() || [];
        if (status) items = items.filter((i) => i.status === status);
        // Terbaru dulu.
        items = items.slice().reverse().slice(0, limit);
        res.status(200).json({
            status: 200,
            message: "LOS incidents loaded.",
            data: { items, total: items.length },
        });
    }));

    router.get("/api/admin/los-broadcast/state", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        res.status(200).json({
            status: 200,
            message: "LOS broadcast runtime state.",
            data: getState(),
        });
    }));

    return { normalizeLosConfig };
}

module.exports = { registerAdminLosBroadcastRoutes, normalizeLosConfig, decorateForView };
