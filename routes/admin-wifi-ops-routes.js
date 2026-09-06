/**
 * Header Doc
 * Purpose: Registrar route admin untuk WiFi logs, working hours, observability jaringan, dan mutasi WiFi perangkat.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, middleware auth staf, rate limiter, runtime config, `services/network-ops.service`, dan service WiFi/working-hours.
 * MainFuncs: `registerAdminWifiOpsRoutes`.
 * SideEffects: Menulis `config.json` untuk pengaturan jam kerja, membaca statistik/log WiFi/network, dan memicu mutasi WiFi perangkat via service.
 */
"use strict";
const { writeFileAtomicSync } = require('../lib/atomic-file'); // config.json ATOMIK (#b343)

const { asyncHandler, createError, ErrorTypes } = require("../lib/error-handler");
const { createNetworkOpsService } = require("../services/network-ops.service");

function registerAdminWifiOpsRoutes(router, deps) {
    const {
        ensureAuthenticatedStaff,
        rateLimit,
        runtime,
        getWifiChangeLogs,
        getWifiChangeStats,
        isWithinWorkingHours,
        getNextAvailableMessage,
        fs,
        path
    } = deps;
    const networkOpsService = createNetworkOpsService(deps);

    function buildActorContext(req) {
        return {
            id: req.user?.id || null,
            username: req.user?.username || "system",
            role: req.user?.role || null
        };
    }

    router.get("/api/wifi-logs", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const filters = {
                userId: req.query.userId,
                deviceId: req.query.deviceId,
                changeType: req.query.changeType,
                changedBy: req.query.changedBy,
                changeSource: req.query.changeSource,
                dateFrom: req.query.dateFrom,
                dateTo: req.query.dateTo,
                limit: parseInt(req.query.limit) || 50,
                offset: parseInt(req.query.offset) || 0
            };
            const result = await getWifiChangeLogs(filters);
            res.status(200).json({ status: 200, message: "WiFi change logs retrieved successfully", data: result });
        } catch (error) {
            console.error("[API_WIFI_LOGS_ERROR] Error retrieving WiFi logs:", error);
            res.status(500).json({ status: 500, message: "Gagal mengambil log perubahan WiFi", error: error.message });
        }
    }));

    router.get("/api/wifi-logs/stats", ensureAuthenticatedStaff, asyncHandler(async (_req, res) => {
        try {
            const stats = await getWifiChangeStats();
            res.status(200).json({ status: 200, message: "WiFi change statistics retrieved successfully", data: stats });
        } catch (error) {
            console.error("[API_WIFI_STATS_ERROR] Error retrieving WiFi stats:", error);
            res.status(500).json({ status: 500, message: "Gagal mengambil statistik perubahan WiFi", error: error.message });
        }
    }));

    router.get("/api/working-hours", ensureAuthenticatedStaff, (_req, res) => {
        try {
            const settings = runtime.config.teknisiWorkingHours || {
                enabled: false,
                weekdays: { start: "08:00", end: "17:00" },
                saturday: { start: "08:00", end: "13:00" },
                sunday: { enabled: false, start: "00:00", end: "00:00" },
                holidays: [],
                responseTime: {
                    high_priority_within_hours: "maksimal 2 jam",
                    high_priority_outside_hours: "keesokan hari jam kerja",
                    medium_priority: "1x24 jam kerja"
                },
                psbEstimationTime: "30-60 menit"
            };
            if (!settings.psbEstimationTime) settings.psbEstimationTime = "30-60 menit";
            const workingStatus = isWithinWorkingHours();
            const nextAvailable = getNextAvailableMessage();
            res.json({
                success: true,
                settings,
                status: {
                    isWithinHours: workingStatus.isWithinHours,
                    dayType: workingStatus.dayType,
                    message: workingStatus.message,
                    nextAvailable
                }
            });
        } catch (error) {
            console.error("[API] Error getting working hours:", error);
            res.status(500).json({ success: false, message: "Gagal mengambil pengaturan jam kerja" });
        }
    });

    router.post("/api/working-hours", ensureAuthenticatedStaff, rateLimit("working-hours-update", 5, 60000), asyncHandler(async (req, res) => {
        if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: "Akses ditolak. Hanya admin yang dapat mengubah pengaturan." });
        }
        try {
            const newSettings = req.body;
            let configToSave;
            if (newSettings.days) {
                if (!newSettings.days || !newSettings.responseTime) {
                    return res.status(400).json({ success: false, message: "Data pengaturan tidak lengkap" });
                }
                configToSave = {
                    enabled: newSettings.enabled !== false,
                    days: newSettings.days,
                    holidays: newSettings.holidays || runtime.config.teknisiWorkingHours?.holidays || [],
                    responseTime: newSettings.responseTime,
                    outOfHoursMessage: newSettings.outOfHoursMessage || "Laporan Anda diterima di luar jam kerja. Akan diproses pada jam kerja berikutnya.",
                    holidayMessage: newSettings.holidayMessage || "Laporan Anda diterima pada hari libur. Akan diproses pada hari kerja berikutnya.",
                    psbEstimationTime: newSettings.psbEstimationTime || "30-60 menit"
                };
            } else {
                if (!newSettings.weekdays || !newSettings.saturday || !newSettings.sunday || !newSettings.responseTime) {
                    return res.status(400).json({ success: false, message: "Data pengaturan tidak lengkap" });
                }
                configToSave = {
                    enabled: newSettings.enabled !== false,
                    weekdays: newSettings.weekdays,
                    saturday: newSettings.saturday,
                    sunday: newSettings.sunday,
                    holidays: newSettings.holidays || [],
                    responseTime: newSettings.responseTime,
                    psbEstimationTime: newSettings.psbEstimationTime || "30-60 menit"
                };
            }
            runtime.setConfig({ ...runtime.config, teknisiWorkingHours: configToSave });
            const configPath = path.join(__dirname, "..", "config.json");
            // Pakai fs yang di-inject (deps.fs) supaya uji tetap terisolasi; tulis tetap ATOMIK.
            writeFileAtomicSync(configPath, JSON.stringify(runtime.config, null, 4), fs);
            res.json({ success: true, message: "Pengaturan jam kerja berhasil disimpan" });
        } catch (error) {
            console.error("[API] Error saving working hours:", error);
            res.status(500).json({ success: false, message: "Gagal menyimpan pengaturan jam kerja" });
        }
    }));

    router.get("/api/status/genieacs", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await networkOpsService.getGenieAcsStatus(buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.get("/api/get_ppp_stats", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await networkOpsService.getPppStats(buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.get("/api/get_hotspot_stats", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await networkOpsService.getHotspotStats(buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.get("/api/status/mikrotik", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await networkOpsService.getMikrotikStatus(buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.get("/api/customer-wifi-info/:deviceId", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const { deviceId } = req.params;
        if (!deviceId) {
            throw createError(ErrorTypes.VALIDATION_ERROR, "Device ID tidak boleh kosong.", 400);
        }
        const result = await networkOpsService.getCustomerWifiInfo({
            deviceId,
            skipRefresh: req.query.skipRefresh === "true"
        }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.post("/api/ssid/:deviceId", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const { deviceId } = req.params;
        if (!deviceId) {
            throw createError(ErrorTypes.VALIDATION_ERROR, "Device ID tidak boleh kosong.", 400);
        }
        const result = await networkOpsService.updateCustomerWifi({
            deviceId,
            payload: req.body,
            reqMeta: {
                ipAddress: req.ip || req.connection?.remoteAddress || req.headers["x-forwarded-for"],
                userAgent: req.headers["user-agent"] || ""
            },
            actorCtx: buildActorContext(req)
        }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.get("/api/mikrotik/ppp-active-users", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await networkOpsService.getActivePppoeUsers(buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.get("/api/mikrotik/ppp-profiles", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        const result = await networkOpsService.getPppProfiles(buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.post("/api/customer-metrics-batch", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!Array.isArray(req.body.deviceIds) || req.body.deviceIds.length === 0) {
            throw createError(ErrorTypes.VALIDATION_ERROR, "deviceIds array is required and cannot be empty", 400);
        }
        const result = await networkOpsService.getCustomerMetricsBatch({ deviceIds: req.body.deviceIds }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.get("/api/device-details/:deviceId", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.params.deviceId) {
            throw createError(ErrorTypes.VALIDATION_ERROR, "deviceId is required", 400);
        }
        const result = await networkOpsService.getDeviceDetails({ deviceId: req.params.deviceId }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.get("/api/customer-redaman/:deviceId", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.params.deviceId) {
            throw createError(ErrorTypes.VALIDATION_ERROR, "deviceId is required", 400);
        }
        const result = await networkOpsService.getCustomerRedaman({ deviceId: req.params.deviceId }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.post("/api/test-parameter", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.body.deviceId || !req.body.parameterType) {
            throw createError(ErrorTypes.VALIDATION_ERROR, "deviceId and parameterType are required", 400);
        }
        const result = await networkOpsService.testConfiguredParameter({
            deviceId: req.body.deviceId,
            parameterType: req.body.parameterType
        }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));

    router.post("/api/test-parameter-custom", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.body.deviceId || !req.body.parameterPath) {
            throw createError(ErrorTypes.VALIDATION_ERROR, "deviceId and parameterPath are required", 400);
        }
        const result = await networkOpsService.testCustomParameter({
            deviceId: req.body.deviceId,
            parameterPath: req.body.parameterPath
        }, buildActorContext(req));
        return res.status(result.status).json(result);
    }));
}

module.exports = {
    registerAdminWifiOpsRoutes
};
