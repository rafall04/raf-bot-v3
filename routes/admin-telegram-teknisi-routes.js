/**
 * Header Doc
 * Purpose: Route admin untuk bot Telegram teknisi — kelola whitelist chat_id (list/add/remove/
 *          toggle) dan konfigurasi bot (enable/token/poll) + status runtime. Hanya admin/owner/
 *          superadmin yang boleh mengubah (ACL akses bot bersifat sensitif).
 * Caller: `routes/admin-router.js`.
 * Deps: Express router, `ensureAuthenticatedStaff`, `lib/error-handler.asyncHandler`,
 *       `repositories/telegram-teknisi.repository`, `lib/telegram/telegram-teknisi-bootstrap`
 *       (getStatus/restart), runtime config (setConfig). Semua dapat diinjeksi untuk test.
 * MainFuncs: `registerAdminTelegramTeknisiRoutes`, `normalizeTeknisiConfig`.
 * SideEffects: Baca/tulis `config.json` (sub-key telegramTeknisi), reload runtime, restart bot.
 */
"use strict";
const { writeFileAtomicSync } = require('../lib/atomic-file'); // config.json ATOMIK (#b343)

const fs = require("fs");
const path = require("path");
const { asyncHandler } = require("../lib/error-handler");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const WRITE_ROLES = ["admin", "owner", "superadmin"];

function asBool(v) {
    return v === true || v === "true" || v === "1" || v === 1;
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/**
 * Normalkan input config. Token kosong → pertahankan token lama (jangan terhapus saat
 * admin sekadar toggle enable). Token tak pernah dikembalikan ke klien.
 */
function normalizeTeknisiConfig(input = {}, existing = {}) {
    const rawToken = input.botToken != null ? String(input.botToken).trim() : "";
    const botToken = rawToken !== "" ? rawToken : existing.botToken || "";
    return {
        enabled: asBool(input.enabled),
        botToken,
        pollTimeoutSec: Math.round(clampNumber(input.pollTimeoutSec, 1, 300, existing.pollTimeoutSec || 50)),
    };
}

function sanitizeConfigForView(cfg = {}) {
    return {
        enabled: cfg.enabled === true,
        pollTimeoutSec: cfg.pollTimeoutSec || 50,
        tokenConfigured: !!cfg.botToken && !String(cfg.botToken).startsWith("ISI_"),
    };
}

function registerAdminTelegramTeknisiRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());
    const configPath = deps.configPath || CONFIG_PATH;
    const readConfig = deps.readConfig || (() => JSON.parse(fs.readFileSync(configPath, "utf8")));
    const writeConfig =
        deps.writeConfig || ((cfg) => writeFileAtomicSync(configPath, JSON.stringify(cfg, null, 4)));
    const runtime = deps.runtime || global.__appRuntime || null;
    const setRuntimeConfig =
        deps.setRuntimeConfig ||
        ((cfg) => {
            if (runtime && typeof runtime.setConfig === "function") runtime.setConfig(cfg);
            else global.config = cfg;
        });
    const repository =
        deps.repository || require("../repositories/telegram-teknisi.repository").telegramTeknisiRepository;
    const getStatus = deps.getStatus || (() => require("../lib/telegram/telegram-teknisi-bootstrap").getStatus());
    const restartBot = deps.restartBot || (() => require("../lib/telegram/telegram-teknisi-bootstrap").restartTelegramTeknisiBot());
    const logActivity = deps.logActivity || (async () => {});

    function denyIfNotPrivileged(req, res) {
        if (req.user && !WRITE_ROLES.includes(req.user.role)) {
            res.status(403).json({ status: 403, message: "Akses ditolak." });
            return true;
        }
        return false;
    }

    async function safeLog(req, action, description) {
        try {
            await logActivity({
                userId: req.user?.id,
                username: req.user?.username,
                role: req.user?.role,
                actionType: action,
                resourceType: "telegram-teknisi",
                resourceId: "telegram-teknisi",
                resourceName: "Bot Telegram Teknisi",
                description,
                ipAddress: req.ip || req.connection?.remoteAddress,
                userAgent: req.headers?.["user-agent"],
            });
        } catch (e) {
            console.error("[TELEGRAM_TEKNISI_ADMIN] activity log error:", e.message);
        }
    }

    // Daftar whitelist + status runtime + config (tersanitasi, tanpa token).
    router.get(
        "/api/admin/telegram-teknisi/list",
        ensureAuthenticatedStaff,
        asyncHandler(async (_req, res) => {
            const cfg = readConfig();
            res.status(200).json({
                status: 200,
                message: "OK",
                data: {
                    technicians: repository.list(),
                    status: getStatus(),
                    config: sanitizeConfigForView(cfg.telegramTeknisi || {}),
                },
            });
        })
    );

    router.post(
        "/api/admin/telegram-teknisi/add",
        ensureAuthenticatedStaff,
        asyncHandler(async (req, res) => {
            if (denyIfNotPrivileged(req, res)) return;
            const chatId = req.body?.chatId;
            if (!chatId || !String(chatId).trim()) {
                return res.status(400).json({ status: 400, message: "chatId wajib diisi." });
            }
            const entry = repository.add({
                chatId: String(chatId).trim(),
                name: req.body?.name ? String(req.body.name).trim() : "",
                addedBy: req.user?.username || "admin",
            });
            await safeLog(req, "CREATE", `Tambah teknisi Telegram chat_id ${entry.chatId} (${entry.name})`);
            res.status(200).json({ status: 200, message: "Teknisi ditambahkan.", data: entry });
        })
    );

    router.post(
        "/api/admin/telegram-teknisi/remove",
        ensureAuthenticatedStaff,
        asyncHandler(async (req, res) => {
            if (denyIfNotPrivileged(req, res)) return;
            const chatId = req.body?.chatId;
            const removed = repository.remove(String(chatId || "").trim());
            if (!removed) return res.status(404).json({ status: 404, message: "chat_id tidak ditemukan." });
            await safeLog(req, "DELETE", `Hapus teknisi Telegram chat_id ${chatId}`);
            res.status(200).json({ status: 200, message: "Teknisi dihapus." });
        })
    );

    router.post(
        "/api/admin/telegram-teknisi/toggle",
        ensureAuthenticatedStaff,
        asyncHandler(async (req, res) => {
            if (denyIfNotPrivileged(req, res)) return;
            const chatId = String(req.body?.chatId || "").trim();
            const enabled = asBool(req.body?.enabled);
            const updated = repository.setEnabled(chatId, enabled);
            if (!updated) return res.status(404).json({ status: 404, message: "chat_id tidak ditemukan." });
            await safeLog(req, "UPDATE", `Set teknisi ${chatId} enabled=${enabled}`);
            res.status(200).json({ status: 200, message: "Status diperbarui.", data: updated });
        })
    );

    router.post(
        "/api/admin/telegram-teknisi/config",
        ensureAuthenticatedStaff,
        asyncHandler(async (req, res) => {
            if (denyIfNotPrivileged(req, res)) return;
            const cfg = readConfig();
            const normalized = normalizeTeknisiConfig(req.body || {}, cfg.telegramTeknisi || {});
            cfg.telegramTeknisi = normalized;
            writeConfig(cfg);
            setRuntimeConfig(cfg);

            // Terapkan langsung: restart loop bot (token/enable berubah).
            try {
                restartBot();
            } catch (e) {
                console.error("[TELEGRAM_TEKNISI_ADMIN] restart error:", e.message);
            }

            await safeLog(req, "UPDATE", `Update config bot teknisi (enabled: ${normalized.enabled})`);
            res.status(200).json({
                status: 200,
                message: "Konfigurasi disimpan.",
                data: sanitizeConfigForView(normalized),
            });
        })
    );

    return { normalizeTeknisiConfig };
}

module.exports = { registerAdminTelegramTeknisiRoutes, normalizeTeknisiConfig, sanitizeConfigForView };
