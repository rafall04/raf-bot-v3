/**
 * Header Doc
 * Purpose: Service broadcast admin — resolusi target (segmen + opt-out), throttle anti-ban, dry-run, dan history.
 * Caller: `routes/admin-content-routes.js` (endpoint `/api/broadcast`, `/api/broadcast/preview`, `/api/broadcast/history`).
 * Deps: `lib/whatsapp-gateway`, `lib/whatsapp-delivery-service`, `lib/utils`, `lib/response-template-helper`, `lib/error-handler`, `lib/bill-pay-token` (link bayar), `rupiah-format`, dan `repositories/broadcast.repository`.
 * MainFuncs: `createAdminBroadcastService`, `resolveTargetUsers`, `formatBroadcastMessage`, `queueBroadcast`, `previewBroadcast`.
 * SideEffects: Mengirim pesan WhatsApp dengan jeda antar pelanggan, menulis entri history broadcast ke SQLite.
 */
"use strict";

const { createError, ErrorTypes } = require("../lib/error-handler");
const formatRupiah = require("rupiah-format");
const { buildBillPayUrl } = require("../lib/bill-pay-token");

const DEFAULT_MESSAGE_DELAY_MS = 1500;
const DEFAULT_JITTER_MS = 800;
const PREVIEW_SAMPLE_LIMIT = 25;
const VALID_MODES = new Set(["all", "odp", "odc", "package", "notify_flagged", "manual"]);

function defaultDeps() {
    return {
        hasAuthenticatedSession: require("../lib/whatsapp-gateway").hasAuthenticatedSession,
        sendMessageToMany: require("../lib/whatsapp-delivery-service").sendMessageToMany,
        normalizePhoneNumber: require("../lib/utils").normalizePhoneNumber,
        renderResponseTemplate: (() => {
            try {
                return require("../lib/response-template-helper").renderResponseTemplate;
            } catch (_err) {
                return null;
            }
        })(),
        historyRepository: null,
        getConfig: () => (global.config && global.config.broadcast) || {},
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        randomJitter: (jitterMs) => (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0),
        now: () => new Date()
    };
}

function loadHistoryRepositoryLazy() {
    try {
        return require("../repositories/broadcast.repository").createBroadcastRepository();
    } catch (_err) {
        return null;
    }
}

function normalizeString(value) {
    return String(value || "").trim().toLowerCase();
}

function isOptedIn(user) {
    // Opt-in default TRUE. Hanya nilai eksplisit 0/'0'/false yang berarti opt-out.
    return !(user?.notify_outage === 0 || user?.notify_outage === "0" || user?.notify_outage === false);
}

function formatBroadcastMessage(template, user) {
    let message = String(template || "");
    const subscription = user?.subscription || user?.package || "";
    const placeholders = {
        nama: user?.name || "",
        nama_pelanggan: user?.name || "",
        paket: subscription,
        nama_paket: subscription,
        alamat: user?.address || "",
        username_pppoe: user?.pppoe_username || "",
        odp: user?.connected_odp_id || user?.odp || "",
        odc: user?.odc || ""
    };

    // Placeholder pembayaran — dihitung LAZY (hanya bila template memuatnya) supaya
    // broadcast biasa (GAMAS/info gangguan) tak terbebani hitung link/harga per pelanggan.
    if (message.includes("${harga}")) {
        const pkg = (global.packages || []).find((p) => p.name === subscription) || {};
        placeholders.harga = pkg.price ? formatRupiah.convert(pkg.price) : "-";
    }
    if (message.includes("${jatuh_tempo}")) {
        const due = new Date();
        due.setDate((global.config && parseInt(global.config.tanggal_batas_bayar, 10)) || 10);
        placeholders.jatuh_tempo = due.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    }
    if (message.includes("${periode}")) {
        placeholders.periode = new Date().toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    }
    if (message.includes("${link_bayar}")) {
        // Link bayar mandiri (token bertanda-tangan, tanpa login). Gagal → string kosong;
        // JANGAN lempar — placeholder untuk notifikasi tak boleh menjatuhkan broadcast.
        let link = "";
        try {
            const now = new Date();
            link = buildBillPayUrl(user, { periodMonth: now.getMonth() + 1, periodYear: now.getFullYear() });
        } catch (_err) {
            link = "";
        }
        placeholders.link_bayar = link;
    }

    for (const [key, value] of Object.entries(placeholders)) {
        const regex = new RegExp(`\\$\\{${key}\\}`, "g");
        message = message.replace(regex, value);
    }

    return message;
}

function pickSegmentValue(user, mode) {
    if (mode === "odp") return user?.connected_odp_id || user?.odp || null;
    if (mode === "odc") return user?.odc || null;
    if (mode === "package") return user?.subscription || user?.package || null;
    return null;
}

function resolveTargetUsers({ mode, allUsers, selectedUsers, filter, forceIncludeOptOut }) {
    const safeAll = Array.isArray(allUsers) ? allUsers : [];
    let candidates = [];

    if (mode === "all") {
        candidates = safeAll.slice();
    } else if (mode === "manual") {
        candidates = Array.isArray(selectedUsers) ? selectedUsers.slice() : [];
    } else if (mode === "notify_flagged") {
        // Mode khusus: hanya yang ditandai butuh info gangguan (selalu hormati flag, abaikan forceIncludeOptOut).
        return safeAll.filter(isOptedIn);
    } else if (mode === "odp" || mode === "odc" || mode === "package") {
        const wanted = normalizeString(filter);
        if (!wanted) return [];
        candidates = safeAll.filter((user) => normalizeString(pickSegmentValue(user, mode)) === wanted);
    } else {
        candidates = [];
    }

    if (forceIncludeOptOut) {
        return candidates;
    }
    return candidates.filter(isOptedIn);
}

function normalizeMode(input) {
    if (typeof input !== "string") return "manual";
    const value = input.trim().toLowerCase();
    return VALID_MODES.has(value) ? value : "manual";
}

function createAdminBroadcastService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    function getHistoryRepository() {
        if (deps.historyRepository) return deps.historyRepository;
        deps.historyRepository = loadHistoryRepositoryLazy();
        return deps.historyRepository;
    }

    function readThrottleConfig() {
        const cfg = (typeof deps.getConfig === "function" ? deps.getConfig() : {}) || {};
        const rawDelay = Number(cfg.messageDelayMs);
        const rawJitter = Number(cfg.jitterMs);
        return {
            delayMs: Number.isFinite(rawDelay) && rawDelay >= 0 ? rawDelay : DEFAULT_MESSAGE_DELAY_MS,
            jitterMs: Number.isFinite(rawJitter) && rawJitter >= 0 ? rawJitter : DEFAULT_JITTER_MS
        };
    }

    function buildPhoneTargets(user) {
        return String(user?.phone_number || user?.phone || "")
            .split("|")
            .map((value) => deps.normalizePhoneNumber(value))
            .filter(Boolean);
    }

    function renderText({ text, templateKey, user, fallback }) {
        let rawTemplate = String(text || "");
        if (!rawTemplate && templateKey && deps.renderResponseTemplate) {
            rawTemplate = deps.renderResponseTemplate(templateKey, fallback || "", {});
        } else if (!rawTemplate && fallback) {
            rawTemplate = String(fallback);
        }
        return formatBroadcastMessage(rawTemplate, user);
    }

    async function sendWithThrottle({ targetUsers, text, templateKey, fallback }) {
        const { delayMs, jitterMs } = readThrottleConfig();
        const successByUserId = [];
        const failureByUserId = [];

        for (let index = 0; index < targetUsers.length; index += 1) {
            const user = targetUsers[index];
            const numbers = buildPhoneTargets(user);
            if (numbers.length === 0) {
                failureByUserId.push({ user_id: user?.id ?? null, reason: "missing_phone_number" });
                continue;
            }

            const personalizedText = renderText({ text, templateKey, user, fallback });
            try {
                const result = await deps.sendMessageToMany(numbers, { text: personalizedText });
                if (result && result.sent === false) {
                    failureByUserId.push({
                        user_id: user?.id ?? null,
                        reason: result.errorCode || "delivery_failed",
                        warning: result.warning || null
                    });
                } else {
                    successByUserId.push({ user_id: user?.id ?? null, recipients: result?.recipients || numbers });
                }
            } catch (error) {
                failureByUserId.push({
                    user_id: user?.id ?? null,
                    reason: "send_exception",
                    warning: error.message
                });
            }

            // Throttle antar pelanggan agar nomor WA tidak diblokir (bukan setelah pelanggan terakhir).
            if (index < targetUsers.length - 1 && delayMs > 0) {
                await deps.wait(delayMs + deps.randomJitter(jitterMs));
            }
        }

        return { successByUserId, failureByUserId };
    }

    function buildPreview({ mode, filter, forceIncludeOptOut, targetUsers, optOutCount }) {
        const sample = targetUsers.slice(0, PREVIEW_SAMPLE_LIMIT).map((user) => ({
            id: user?.id ?? null,
            name: user?.name || "",
            phone_number: user?.phone_number || "",
            odp: user?.connected_odp_id || user?.odp || null,
            odc: user?.odc || null,
            subscription: user?.subscription || null,
            notify_outage: isOptedIn(user)
        }));

        return {
            mode,
            filter: filter || null,
            force_include_opt_out: Boolean(forceIncludeOptOut),
            total_targets: targetUsers.length,
            opt_out_excluded: optOutCount,
            sample
        };
    }

    async function recordHistory(entry) {
        const repository = getHistoryRepository();
        if (!repository?.insertHistory) return;
        try {
            await repository.insertHistory(entry);
        } catch (error) {
            console.warn("[BROADCAST_HISTORY_WARN]", error.message);
        }
    }

    function ensureSegmentFilter(mode, filter) {
        if ((mode === "odp" || mode === "odc" || mode === "package") && !String(filter || "").trim()) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Filter ${mode} wajib diisi untuk mode segmentasi ${mode}.`,
                400
            );
        }
    }

    function ensureText(text, templateKey) {
        if (!String(text || "").trim() && !String(templateKey || "").trim()) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Pesan broadcast wajib diisi atau pilih template terlebih dahulu.",
                400
            );
        }
    }

    return {
        deps,
        formatBroadcastMessage,
        resolveTargetUsers,

        previewBroadcast(input = {}) {
            const mode = normalizeMode(input.mode || (input.sendToAll ? "all" : "manual"));
            ensureSegmentFilter(mode, input.filter);
            const allUsers = Array.isArray(input.allUsers) ? input.allUsers : [];
            const selectedUsers = Array.isArray(input.selectedUsers) ? input.selectedUsers : [];
            const forceIncludeOptOut = Boolean(input.forceIncludeOptOut);

            const targetUsers = resolveTargetUsers({
                mode,
                allUsers,
                selectedUsers,
                filter: input.filter,
                forceIncludeOptOut
            });
            const baselineCount = mode === "manual"
                ? selectedUsers.length
                : resolveTargetUsers({
                    mode,
                    allUsers,
                    selectedUsers,
                    filter: input.filter,
                    forceIncludeOptOut: true
                }).length;
            const optOutCount = Math.max(0, baselineCount - targetUsers.length);

            return {
                status: 200,
                message: `${targetUsers.length} pelanggan akan menerima broadcast (preview).`,
                data: buildPreview({ mode, filter: input.filter, forceIncludeOptOut, targetUsers, optOutCount })
            };
        },

        async queueBroadcast(input = {}) {
            if (!deps.hasAuthenticatedSession()) {
                throw createError(ErrorTypes.WHATSAPP_ERROR, "The server is not connected to WhatsApp.", 500);
            }

            const text = String(input.text || "");
            const templateKey = input.templateKey ? String(input.templateKey) : null;
            const templateFallback = input.templateFallback ? String(input.templateFallback) : "";
            ensureText(text, templateKey);

            const allUsers = Array.isArray(input.allUsers) ? input.allUsers : [];
            const selectedUsers = Array.isArray(input.selectedUsers) ? input.selectedUsers : [];

            // Resolusi mode: dukung input baru `mode`, juga signature lama (`sendToAll`).
            const mode = input.mode
                ? normalizeMode(input.mode)
                : (input.sendToAll ? "all" : "manual");
            ensureSegmentFilter(mode, input.filter);
            const forceIncludeOptOut = Boolean(input.forceIncludeOptOut);

            const targetUsers = resolveTargetUsers({
                mode,
                allUsers,
                selectedUsers,
                filter: input.filter,
                forceIncludeOptOut
            });

            if (targetUsers.length === 0) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "No valid users selected for broadcast.", 400);
            }

            if (input.dryRun) {
                return {
                    status: 200,
                    message: `Dry-run: ${targetUsers.length} pelanggan akan menerima broadcast.`,
                    data: buildPreview({
                        mode,
                        filter: input.filter,
                        forceIncludeOptOut,
                        targetUsers,
                        optOutCount: 0
                    })
                };
            }

            const startedAt = deps.now().toISOString();
            const broadcastPromise = sendWithThrottle({
                targetUsers,
                text,
                templateKey,
                fallback: templateFallback
            }).then(async ({ successByUserId, failureByUserId }) => {
                await recordHistory({
                    started_at: startedAt,
                    finished_at: deps.now().toISOString(),
                    mode,
                    filter: input.filter || null,
                    template_key: templateKey,
                    message_preview: text.slice(0, 500),
                    total_targets: targetUsers.length,
                    total_sent: successByUserId.length,
                    total_failed: failureByUserId.length,
                    force_include_opt_out: forceIncludeOptOut ? 1 : 0,
                    operator: input.operator || "system",
                    failed_user_ids_json: failureByUserId
                });
            });

            broadcastPromise.catch((error) => {
                console.error("[BROADCAST_ERROR]", error);
            });

            return {
                status: 202,
                message: `Broadcast has been initiated for ${targetUsers.length} user(s).`,
                data: {
                    totalTargets: targetUsers.length,
                    mode,
                    filter: input.filter || null,
                    template_key: templateKey
                }
            };
        }
    };
}

module.exports = {
    createAdminBroadcastService,
    formatBroadcastMessage,
    resolveTargetUsers
};
