/**
 * Header Doc
 * Purpose: Registrar route admin untuk template pesan, pengumuman, berita, WiFi templates, dan broadcast.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, middleware auth staf, template service/manager, `lib/template-usage-scanner`
 *       (laporan kesehatan + peringatan slot), runtime repositories, persist JSON, dan service content admin.
 * MainFuncs: `registerAdminContentRoutes`, `buildAdminEditorAudit`.
 * SideEffects: Menulis templates, announcements, news, WiFi templates, dan memicu broadcast WhatsApp async.
 */
"use strict";

const { asyncHandler, createError, ErrorTypes } = require("../lib/error-handler");
const { createWifiTemplateConfigService } = require("../services/wifi-template-config.service");
const { createAdminBroadcastService } = require("../services/admin-broadcast.service");

function extractTemplateText(entry) {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry.template === "string") return entry.template;
    if (entry && typeof entry.content === "string") return entry.content;
    return "";
}

function extractPlaceholders(templateText) {
    const matches = String(templateText || "").match(/\$\{([^}]+)\}/g) || [];
    return [...new Set(matches
        .map((placeholder) => placeholder.slice(2, -1).trim())
        .filter(Boolean))];
}

function resolveWorkflowGroup(key) {
    if (key.startsWith("teknisi_workflow_")) return "teknisi_workflow";
    if (key.startsWith("smart_report_")) return "smart_report";
    if (key.startsWith("ticket_process_")) return "ticket_process";
    return key.split("_").slice(0, 2).join("_") || "uncategorized";
}

function buildResponseTemplateAudit(responseTemplates = {}) {
    const audit = {
        total: 0,
        missingName: [],
        missingCategory: [],
        emptyTemplate: [],
        placeholderIndex: {},
        categoryCounts: {},
        workflowGroups: {}
    };

    Object.entries(responseTemplates || {}).forEach(([key, entry]) => {
        audit.total += 1;
        const isObjectEntry = entry && typeof entry === "object" && !Array.isArray(entry);
        const templateText = extractTemplateText(entry);
        const category = isObjectEntry && entry.category ? entry.category : "uncategorized";
        const placeholders = extractPlaceholders(templateText);
        const workflowGroup = resolveWorkflowGroup(key);

        if (!isObjectEntry || !entry.name) audit.missingName.push(key);
        if (!isObjectEntry || !entry.category) audit.missingCategory.push(key);
        if (!templateText.trim()) audit.emptyTemplate.push(key);

        audit.placeholderIndex[key] = placeholders;
        audit.categoryCounts[category] = (audit.categoryCounts[category] || 0) + 1;

        if (!audit.workflowGroups[workflowGroup]) {
            audit.workflowGroups[workflowGroup] = {
                total: 0,
                keys: [],
                placeholders: {}
            };
        }

        audit.workflowGroups[workflowGroup].total += 1;
        audit.workflowGroups[workflowGroup].keys.push(key);
        placeholders.forEach((placeholder) => {
            if (!audit.workflowGroups[workflowGroup].placeholders[placeholder]) {
                audit.workflowGroups[workflowGroup].placeholders[placeholder] = [];
            }
            audit.workflowGroups[workflowGroup].placeholders[placeholder].push(key);
        });
    });

    return audit;
}

function buildAdminEditorAudit(templatesCache) {
    return {
        responseTemplates: buildResponseTemplateAudit(templatesCache.responseTemplates || {})
    };
}

function registerAdminContentRoutes(router, deps) {
    const {
        ensureAuthenticatedStaff,
        templateService,
        templateManager,
        templatesCache,
        saveJSON,
        runtime
    } = deps;

    const announcementsRepo = runtime.repositories.announcements;
    const newsRepo = runtime.repositories.news;
    const usersRepo = runtime.repositories.users || null;
    const wifiTemplateConfigService = createWifiTemplateConfigService(deps);
    const adminBroadcastService = createAdminBroadcastService(deps);

    function requireAdmin(req) {
        if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
            throw createError(ErrorTypes.AUTHORIZATION_ERROR, "Akses ditolak.", 403);
        }
    }

    router.get("/api/templates", ensureAuthenticatedStaff, (_req, res) => {
        try {
            templateService.loadAllCategories();
            const {
                notificationTemplates,
                wifiMenuTemplates,
                responseTemplates,
                commandTemplates,
                errorTemplates,
                successTemplates,
                systemTemplates,
                menuTemplates,
                reportTemplates
            } = templatesCache;

            const formattedWifiTemplates = {};
            for (const key in wifiMenuTemplates) {
                formattedWifiTemplates[key] = {
                    name: key.charAt(0).toUpperCase() + key.slice(1),
                    template: wifiMenuTemplates[key]
                };
            }

            res.status(200).json({
                status: 200,
                message: "Templates loaded successfully from cache.",
                data: {
                    notificationTemplates,
                    wifiMenuTemplates: formattedWifiTemplates,
                    responseTemplates,
                    commandTemplates,
                    errorTemplates,
                    successTemplates,
                    systemTemplates,
                    menuTemplates,
                    reportTemplates
                }
            });
        } catch (error) {
            console.error("[API_TEMPLATES_GET_ERROR]", error);
            res.status(500).json({ status: 500, message: "Failed to process templates from cache." });
        }
    });

    router.post("/api/templates", ensureAuthenticatedStaff, (req, res) => {
        try {
            const {
                notificationTemplates,
                wifiMenuTemplates,
                responseTemplates,
                commandTemplates,
                errorTemplates,
                successTemplates,
                systemTemplates,
                menuTemplates,
                reportTemplates
            } = req.body;

            if (!notificationTemplates || typeof notificationTemplates !== "object"
                || !wifiMenuTemplates || typeof wifiMenuTemplates !== "object"
                || !responseTemplates || typeof responseTemplates !== "object") {
                return res.status(400).json({ status: 400, message: "Invalid template data structure provided." });
            }

            // Simpanan yang menghapus sebagian besar kategori ditolak (lihat saveCategory).
            // `?allowMassDeletion=1` untuk penghapusan yang memang disengaja.
            const saveOptions = {
                allowMassDeletion: req.query.allowMassDeletion === "1" || req.body.allowMassDeletion === true
            };

            templateService.saveCategory("notificationTemplates", notificationTemplates, saveOptions);
            templateService.saveCategory("wifiMenuTemplates", wifiMenuTemplates, saveOptions);
            templateService.saveCategory("responseTemplates", responseTemplates, saveOptions);
            if (commandTemplates && typeof commandTemplates === "object") templateService.saveCategory("commandTemplates", commandTemplates, saveOptions);
            if (errorTemplates && typeof errorTemplates === "object") templateService.saveCategory("errorTemplates", errorTemplates, saveOptions);
            if (successTemplates && typeof successTemplates === "object") templateService.saveCategory("successTemplates", successTemplates, saveOptions);
            if (systemTemplates && typeof systemTemplates === "object") templateService.saveCategory("systemTemplates", systemTemplates, saveOptions);
            if (menuTemplates && typeof menuTemplates === "object") templateService.saveCategory("menuTemplates", menuTemplates, saveOptions);
            if (reportTemplates && typeof reportTemplates === "object") templateService.saveCategory("reportTemplates", reportTemplates, saveOptions);

            templateService.loadAllCategories();
            templateManager.reloadTemplates();

            // Peringatan slot bersifat ADVISORY, bukan penolakan: repo punya beberapa signature
            // render berbeda sehingga daftar slot yang "dikenal" tak 100% bisa disimpulkan statis.
            // Menolak keras akan salah-tolak edit yang sah; menampilkan peringatan tidak.
            let warnings = [];
            try {
                const { buildHealthReport } = require("../lib/template-usage-scanner");
                warnings = buildHealthReport(templatesCache.responseTemplates || {}).unknownSlots;
            } catch (_error) { /* peringatan opsional */ }

            res.status(200).json({
                status: 200,
                message: "All message templates saved successfully. Cache reloads automatically.",
                warnings
            });
        } catch (error) {
            if (error.code === "TEMPLATE_MASS_DELETION") {
                console.warn("[API_TEMPLATES_POST_BLOCKED]", error.message);
                return res.status(409).json({ status: 409, message: error.message });
            }
            console.error("[API_TEMPLATES_POST_ERROR]", error);
            res.status(500).json({ status: 500, message: "Failed to save one or more message template files." });
        }
    });

    // `?health=1` menambahkan laporan key yatim / hilang / slot tak dikenal (memindai source,
    // hasilnya di-cache 5 menit). `?force=1` memaksa pindai ulang.
    router.get("/api/templates/diagnostics", ensureAuthenticatedStaff, (req, res) => {
        try {
            templateService.loadAllCategories();
            const withHealth = req.query.health === "1" || req.query.health === "true";
            res.status(200).json({
                status: 200,
                message: "Template diagnostics loaded successfully.",
                data: {
                    ...templateService.getDiagnostics({
                        health: withHealth,
                        force: req.query.force === "1"
                    }),
                    adminEditorAudit: buildAdminEditorAudit(templatesCache)
                }
            });
        } catch (error) {
            console.error("[API_TEMPLATES_DIAGNOSTICS_ERROR]", error);
            res.status(500).json({ status: 500, message: "Failed to load template diagnostics." });
        }
    });

    router.post("/api/announcements", ensureAuthenticatedStaff, (req, res) => {
        const { message } = req.body;
        if (!message || typeof message !== "string" || message.trim() === "") {
            return res.status(400).json({ status: 400, message: "Pesan tidak boleh kosong." });
        }
        try {
            const newAnnouncement = {
                id: String(Date.now()),
                message: message.trim(),
                createdAt: new Date().toISOString()
            };
            const nextAnnouncements = [...announcementsRepo.getAll(), newAnnouncement];
            announcementsRepo.setAll(nextAnnouncements);
            saveJSON("announcements.json", nextAnnouncements);
            res.status(201).json({ status: 201, message: "Pengumuman berhasil dibuat.", data: newAnnouncement });
        } catch (error) {
            console.error("[API_ANNOUNCEMENTS_POST_ERROR]", error);
            res.status(500).json({ status: 500, message: "Gagal membuat pengumuman." });
        }
    });

    router.post("/api/announcements/:id", ensureAuthenticatedStaff, (req, res) => {
        const { id } = req.params;
        const { message } = req.body;
        if (!message || typeof message !== "string" || message.trim() === "") {
            return res.status(400).json({ status: 400, message: "Pesan tidak boleh kosong." });
        }
        try {
            const allAnnouncements = announcementsRepo.getAll();
            const index = allAnnouncements.findIndex((item) => item.id === id);
            if (index === -1) return res.status(404).json({ status: 404, message: "Pengumuman tidak ditemukan." });
            const nextAnnouncements = [...allAnnouncements];
            nextAnnouncements[index] = { ...nextAnnouncements[index], message: message.trim() };
            announcementsRepo.setAll(nextAnnouncements);
            saveJSON("announcements.json", nextAnnouncements);
            res.status(200).json({ status: 200, message: "Pengumuman berhasil diperbarui.", data: nextAnnouncements[index] });
        } catch (error) {
            console.error("[API_ANNOUNCEMENTS_UPDATE_ERROR]", error);
            res.status(500).json({ status: 500, message: "Gagal memperbarui pengumuman." });
        }
    });

    router.delete("/api/announcements/:id", ensureAuthenticatedStaff, (req, res) => {
        const { id } = req.params;
        try {
            const currentAnnouncements = announcementsRepo.getAll();
            const nextAnnouncements = currentAnnouncements.filter((item) => item.id !== id);
            if (nextAnnouncements.length === currentAnnouncements.length) {
                return res.status(404).json({ status: 404, message: "Pengumuman tidak ditemukan." });
            }
            announcementsRepo.setAll(nextAnnouncements);
            saveJSON("announcements.json", nextAnnouncements);
            res.status(200).json({ status: 200, message: "Pengumuman berhasil dihapus." });
        } catch (error) {
            console.error("[API_ANNOUNCEMENTS_DELETE_ERROR]", error);
            res.status(500).json({ status: 500, message: "Gagal menghapus pengumuman." });
        }
    });

    router.post("/api/news", ensureAuthenticatedStaff, (req, res) => {
        const { title, news_content: newsContent } = req.body;
        if (!title || typeof title !== "string" || title.trim() === "") {
            return res.status(400).json({ status: 400, message: "Judul tidak boleh kosong." });
        }
        if (!newsContent || typeof newsContent !== "string" || newsContent.trim() === "") {
            return res.status(400).json({ status: 400, message: "Konten tidak boleh kosong." });
        }
        try {
            const newItem = {
                id: `news_${Date.now()}`,
                title: title.trim(),
                content: newsContent.trim(),
                createdAt: new Date().toISOString()
            };
            const nextNews = [...newsRepo.getAll(), newItem];
            newsRepo.setAll(nextNews);
            saveJSON("news.json", nextNews);
            res.status(201).json({ status: 201, message: "Berita berhasil dibuat.", data: newItem });
        } catch (error) {
            console.error("[API_NEWS_POST_ERROR]", error);
            res.status(500).json({ status: 500, message: "Gagal membuat berita." });
        }
    });

    router.post("/api/news/:id", ensureAuthenticatedStaff, (req, res) => {
        const { id } = req.params;
        const { title, news_content: newsContent } = req.body;
        if (!title || typeof title !== "string" || title.trim() === "") {
            return res.status(400).json({ status: 400, message: "Judul tidak boleh kosong." });
        }
        if (!newsContent || typeof newsContent !== "string" || newsContent.trim() === "") {
            return res.status(400).json({ status: 400, message: "Konten tidak boleh kosong." });
        }
        try {
            const allNews = newsRepo.getAll();
            const index = allNews.findIndex((item) => item.id === id);
            if (index === -1) return res.status(404).json({ status: 404, message: "Berita tidak ditemukan." });
            const nextNews = [...allNews];
            nextNews[index] = { ...nextNews[index], title: title.trim(), content: newsContent.trim() };
            newsRepo.setAll(nextNews);
            saveJSON("news.json", nextNews);
            res.status(200).json({ status: 200, message: "Berita berhasil diperbarui.", data: nextNews[index] });
        } catch (error) {
            console.error("[API_NEWS_UPDATE_ERROR]", error);
            res.status(500).json({ status: 500, message: "Gagal memperbarui berita." });
        }
    });

    router.delete("/api/news/:id", ensureAuthenticatedStaff, (req, res) => {
        const { id } = req.params;
        try {
            const currentNews = newsRepo.getAll();
            const nextNews = currentNews.filter((item) => item.id !== id);
            if (nextNews.length === currentNews.length) {
                return res.status(404).json({ status: 404, message: "Berita tidak ditemukan." });
            }
            newsRepo.setAll(nextNews);
            saveJSON("news.json", nextNews);
            res.status(200).json({ status: 200, message: "Berita berhasil dihapus." });
        } catch (error) {
            console.error("[API_NEWS_DELETE_ERROR]", error);
            res.status(500).json({ status: 500, message: "Gagal menghapus berita." });
        }
    });

    router.get("/api/wifi-templates", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = wifiTemplateConfigService.listWifiTemplates();
        return res.status(result.status).json(result);
    }));

    router.post("/api/wifi-templates", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = wifiTemplateConfigService.createWifiTemplate(req.body, {
            username: req.user?.username || "system"
        });
        return res.status(result.status).json(result);
    }));

    router.put("/api/wifi-templates/:intent", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = wifiTemplateConfigService.updateWifiTemplate(req.params.intent, req.body, {
            username: req.user?.username || "system"
        });
        return res.status(result.status).json(result);
    }));

    router.delete("/api/wifi-templates/:intent", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        requireAdmin(req);
        const result = wifiTemplateConfigService.deleteWifiTemplate(req.params.intent, {
            username: req.user?.username || "system"
        });
        return res.status(result.status).json(result);
    }));

    function loadUsers() {
        return usersRepo && typeof usersRepo.getAll === "function" ? usersRepo.getAll() : [];
    }

    function buildBroadcastPayload(req) {
        const allUsers = loadUsers();
        const selectedIds = Array.isArray(req.body?.users) ? req.body.users : [];
        const selectedUsers = selectedIds
            .map((id) => allUsers.find((user) => String(user.id) === String(id)))
            .filter(Boolean);
        // Kompatibel dengan UI legacy (`all=on`) — diabaikan bila mode eksplisit dikirim.
        const sendToAll = req.body?.all === "on" || req.body?.all === true;
        return {
            text: req.body?.text,
            templateKey: req.body?.template_key || req.body?.templateKey || null,
            templateFallback: req.body?.template_fallback || req.body?.templateFallback || "",
            mode: req.body?.mode || null,
            filter: req.body?.filter || null,
            forceIncludeOptOut: req.body?.force_include_opt_out === true
                || req.body?.force_include_opt_out === "true"
                || req.body?.forceIncludeOptOut === true,
            // Lolos-paksa penjaga data internal (jumlah pelanggan / PPPoE / ODP-ODC di teks pelanggan).
            // Harus disengaja: default menahan, karena pesan WA tak bisa ditarik kembali.
            allowSensitive: req.body?.allow_sensitive === true
                || req.body?.allow_sensitive === "true"
                || req.body?.allowSensitive === true,
            sendToAll,
            allUsers,
            selectedUsers,
            operator: req.user?.username || "system"
        };
    }

    router.post("/api/broadcast/preview", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const payload = buildBroadcastPayload(req);
        const result = adminBroadcastService.previewBroadcast(payload);
        return res.status(result.status).json(result);
    }));

    router.get("/api/broadcast/history", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const repo = require("../repositories/broadcast.repository").createBroadcastRepository();
        const limit = Number(req.query?.limit) || 50;
        const offset = Number(req.query?.offset) || 0;
        const data = await repo.listHistory({ limit, offset });
        return res.status(200).json({
            status: 200,
            message: "Riwayat broadcast dimuat.",
            data
        });
    }));

    router.post("/api/broadcast", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const payload = buildBroadcastPayload(req);
        payload.dryRun = req.body?.dry_run === true || req.body?.dryRun === true;
        const result = await adminBroadcastService.queueBroadcast(payload);
        return res.status(result.status).json({
            status: result.status,
            message: result.message,
            data: result.data || null
        });
    }));
}

module.exports = {
    registerAdminContentRoutes,
    buildAdminEditorAudit
};
