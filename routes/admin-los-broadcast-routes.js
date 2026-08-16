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
const { findCustomerTextLeaks, describeLeaks } = require("../lib/customer-text-guard");

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

// Prioritas tiket valid (ticket-workflow): HIGH (label URGENT) / MEDIUM (NORMAL). Default HIGH untuk LOS.
function normalizePriority(v) {
    const p = String(v || "").trim().toUpperCase();
    return p === "MEDIUM" ? "MEDIUM" : "HIGH";
}

function normalizeLosConfig(input = {}, current = {}) {
    const cur = current || {};
    const confirmationWindowMinutes = clampNumber(input.confirmationWindowMinutes, 1, 60, 3);
    const clusterFlushSeconds = clampNumber(input.clusterFlushSeconds, 1, 300, 20);
    const rebroadcastCooldownMinutes = clampNumber(input.rebroadcastCooldownMinutes, 1, 720, 30);
    const recoveryConfirmSeconds = clampNumber(input.recoveryConfirmSeconds, 5, 600, 60);
    const recoveryClusterFlushSeconds = clampNumber(input.recoveryClusterFlushSeconds, 1, 300, 20);
    // Blok bersarang menerima field flat dari form ATAU objek bersarang dari config yang SUDAH ADA
    // (current) — supaya Save dari UI yang tak mengirim field ini TIDAK menghapus/menonaktifkannya
    // (pelajaran autoTicket: normalizeLosConfig menulis-ulang seluruh oltLosBroadcast).
    const nc = input.notifyCustomer || cur.notifyCustomer || {};
    const ncDefault = DEFAULTS.notifyCustomer || {};
    // undefined (bukan null) saat absen: Number(null)=0 lolos Number.isFinite → clamp ke min,
    // sedangkan Number(undefined)=NaN → clampNumber pakai fallback default. (GOTCHA klasik.)
    const curNcDelayMin = (cur.notifyCustomer && Number.isFinite(cur.notifyCustomer.delayMs))
        ? Math.round(cur.notifyCustomer.delayMs / 60000) : undefined;
    const customerDelayMinutes = clampNumber(
        input.customerNotifyDelayMinutes != null ? input.customerNotifyDelayMinutes
            : (nc.delayMinutes != null ? nc.delayMinutes : curNcDelayMin),
        1, 1440, Math.round((ncDefault.delayMs || 600000) / 60000)
    );
    const at = input.autoTicket || cur.autoTicket || {};
    const atDefault = DEFAULTS.autoTicket || {};
    // Verifikasi via scrape web log OLT (anti salah-vonis mati-listrik). Terima flat (verify*)
    // atau nested (verifyViaScrape) — WAJIB dinormalisasi agar tak ke-drop saat admin Simpan.
    const vs = input.verifyViaScrape || cur.verifyViaScrape || {};
    const vsDefault = DEFAULTS.verifyViaScrape || {};
    const ao = vs.areaOutage || {};
    const aoDefault = vsDefault.areaOutage || {};
    return {
        enabled: asBool(input.enabled),
        // Grup alarm OLT (grup khusus). notifyTeknisi default true (perilaku lama).
        notifyGroup: asBool(input.notifyGroup),
        groupId: input.groupId != null ? String(input.groupId).trim() : (cur.groupId != null ? String(cur.groupId).trim() : (DEFAULTS.groupId || "")),
        notifyTeknisi: input.notifyTeknisi != null ? asBool(input.notifyTeknisi) : (cur.notifyTeknisi != null ? asBool(cur.notifyTeknisi) : (DEFAULTS.notifyTeknisi !== false)),
        // Notif PULIH ke grup/teknisi saat ONU kembali online (menutup alarm yang tergantung).
        notifyRecovery: asBool(input.notifyRecovery),
        recoveryConfirmMs: Math.round(recoveryConfirmSeconds * 1000),
        recoveryClusterFlushMs: Math.round(recoveryClusterFlushSeconds * 1000),
        autoTicket: {
            enabled: asBool(input.autoTicketEnabled != null ? input.autoTicketEnabled : at.enabled),
            assignTeknisi: (() => {
                const v = input.autoTicketAssignTeknisi != null ? input.autoTicketAssignTeknisi : at.assignTeknisi;
                return v != null ? String(v).trim() : (atDefault.assignTeknisi || "");
            })(),
            priority: normalizePriority(input.autoTicketPriority != null ? input.autoTicketPriority : at.priority),
        },
        verifyViaScrape: {
            enabled: input.verifyEnabled != null
                ? asBool(input.verifyEnabled)
                : (vs.enabled != null ? asBool(vs.enabled) : (vsDefault.enabled !== false)),
            maxPages: Math.round(clampNumber(
                input.verifyMaxPages != null ? input.verifyMaxPages : vs.maxPages, 3, 40, vsDefault.maxPages || 20)),
            timeWindowMinutes: Math.round(clampNumber(
                input.verifyTimeWindowMinutes != null ? input.verifyTimeWindowMinutes : vs.timeWindowMinutes, 3, 120, vsDefault.timeWindowMinutes || 15)),
            // GERBANG MATI-LISTRIK-AREA (dibaca broadcaster + verifier). Dinormalisasi agar tak ke-drop.
            areaOutage: {
                enabled: input.verifyAreaOutageEnabled != null
                    ? asBool(input.verifyAreaOutageEnabled)
                    : (ao.enabled != null ? asBool(ao.enabled) : (aoDefault.enabled !== false)),
                dgClusterThreshold: Math.round(clampNumber(
                    input.verifyAreaDgThreshold != null ? input.verifyAreaDgThreshold : ao.dgClusterThreshold, 2, 200, aoDefault.dgClusterThreshold || 5)),
                windowSeconds: Math.round(clampNumber(
                    input.verifyAreaWindowSeconds != null ? input.verifyAreaWindowSeconds : ao.windowSeconds, 1, 120, aoDefault.windowSeconds || 10)),
            },
        },
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
            // Kabari pelanggan saat PULIH (hanya yang tadi dikabari saat gangguan).
            notifyOnRecovery: input.customerNotifyOnRecovery != null
                ? asBool(input.customerNotifyOnRecovery)
                : (nc.notifyOnRecovery !== false),
            recoveryMessageTemplate: (input.customerRecoveryTemplate != null ? input.customerRecoveryTemplate : nc.recoveryMessageTemplate)
                || ncDefault.recoveryMessageTemplate || "",
        },
    };
}

/** Tambah field human-friendly turunan supaya UI tinggal pakai. */
function decorateForView(cfg) {
    const nc = cfg.notifyCustomer || DEFAULTS.notifyCustomer || {};
    const ncDefault = DEFAULTS.notifyCustomer || {};
    // Isi shape lengkap autoTicket (config lama mungkin cuma simpan sebagian key).
    const at = cfg.autoTicket || {};
    const atDefault = DEFAULTS.autoTicket || {};
    const vs = cfg.verifyViaScrape || {};
    const vsDefault = DEFAULTS.verifyViaScrape || {};
    return {
        ...cfg,
        confirmationWindowMinutes: Math.round((cfg.confirmationWindowMs || DEFAULTS.confirmationWindowMs) / 60000),
        clusterFlushSeconds: Math.round((cfg.clusterFlushMs || DEFAULTS.clusterFlushMs) / 1000),
        rebroadcastCooldownMinutes: Math.round((cfg.rebroadcastCooldownMs || DEFAULTS.rebroadcastCooldownMs) / 60000),
        notifyRecovery: cfg.notifyRecovery === true,
        recoveryConfirmSeconds: Math.round((cfg.recoveryConfirmMs || DEFAULTS.recoveryConfirmMs) / 1000),
        recoveryClusterFlushSeconds: Math.round((cfg.recoveryClusterFlushMs || DEFAULTS.recoveryClusterFlushMs) / 1000),
        autoTicket: {
            enabled: at.enabled === true,
            assignTeknisi: at.assignTeknisi != null ? String(at.assignTeknisi) : (atDefault.assignTeknisi || ""),
            priority: normalizePriority(at.priority != null ? at.priority : atDefault.priority),
        },
        verifyViaScrape: {
            enabled: (vs.enabled != null ? vs.enabled : vsDefault.enabled) !== false,
            maxPages: vs.maxPages != null ? vs.maxPages : (vsDefault.maxPages || 20),
            timeWindowMinutes: vs.timeWindowMinutes != null ? vs.timeWindowMinutes : (vsDefault.timeWindowMinutes || 15),
            areaOutage: (() => {
                const ao = vs.areaOutage || {};
                const aoDefault = vsDefault.areaOutage || {};
                return {
                    enabled: (ao.enabled != null ? ao.enabled : aoDefault.enabled) !== false,
                    dgClusterThreshold: ao.dgClusterThreshold != null ? ao.dgClusterThreshold : (aoDefault.dgClusterThreshold || 5),
                    windowSeconds: ao.windowSeconds != null ? ao.windowSeconds : (aoDefault.windowSeconds || 10),
                };
            })(),
        },
        notifyCustomer: {
            enabled: nc.enabled === true,
            onlyIfStillDown: nc.onlyIfStillDown !== false,
            delayMinutes: Math.round((nc.delayMs || ncDefault.delayMs || 600000) / 60000),
            messageTemplate: nc.messageTemplate || ncDefault.messageTemplate || "",
            notifyOnRecovery: (nc.notifyOnRecovery != null ? nc.notifyOnRecovery : ncDefault.notifyOnRecovery) !== false,
            recoveryMessageTemplate: nc.recoveryMessageTemplate || ncDefault.recoveryMessageTemplate || "",
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
        const cfg = readConfig();
        // Lewatkan config TERSIMPAN sebagai fallback → Save dari UI yang tak mengirim sub-blok
        // (notifyCustomer/verifyViaScrape/autoTicket) tidak menghapus/menonaktifkannya.
        const normalized = normalizeLosConfig(req.body || {}, cfg.oltLosBroadcast || {});

        // TOLAK DI HULU: template yang dibaca PELANGGAN tak boleh memuat data internal.
        // Menjaga hanya saat kirim tidak cukup — config produksi di-merge-key (tak pernah
        // ditimpa deploy), jadi template berbahaya yang terlanjur tersimpan akan bertahan
        // selamanya dan tiap kirim cuma menghasilkan peringatan berulang. Ditolak di sini,
        // pemiliknya langsung tahu alasannya.
        const nc = normalized.notifyCustomer || {};
        for (const [medan, label] of [["messageTemplate", "Pesan ke Pelanggan"], ["recoveryMessageTemplate", "Pesan Pulih ke Pelanggan"]]) {
            const bocor = findCustomerTextLeaks(nc[medan] || "");
            if (bocor && bocor.length) {
                return res.status(400).json({
                    status: 400,
                    message: `Template "${label}" ditolak: ${describeLeaks(bocor)}. `
                        + `Data internal jaringan (MAC/slot/ONU/ODP/nama PPPoE) dan jumlah pelanggan tidak boleh dibaca pelanggan. `
                        + `Yang tersedia: {customer_name}, {address}, {company_name}.`,
                    field: medan,
                });
            }
        }

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
