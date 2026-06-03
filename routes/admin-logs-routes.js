/**
 * Header Doc
 * Purpose: Registrar route admin untuk login logs dan activity logs.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, middleware auth staf, dan service activity logger.
 * MainFuncs: `registerAdminLogsRoutes`.
 * SideEffects: Membaca database log aktivitas/login.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");

function registerAdminLogsRoutes(router, deps) {
    const {
        ensureAuthenticatedStaff,
        getLoginLogs,
        getActivityLogs
    } = deps;

    router.get("/api/logs/login", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const {
                limit = parseInt(req.query.limit) || 100,
                offset = parseInt(req.query.offset) || 0,
                username = req.query.username || null,
                actionType = req.query.actionType || null,
                successOnly = req.query.successOnly === "true",
                startDate = req.query.startDate ? new Date(req.query.startDate) : null,
                endDate = req.query.endDate ? new Date(req.query.endDate) : null
            } = req.query;

            const logs = await getLoginLogs({
                limit: parseInt(limit),
                offset: parseInt(offset),
                username,
                actionType,
                successOnly,
                startDate,
                endDate
            });

            res.status(200).json({
                status: 200,
                message: "Login logs retrieved",
                data: logs,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    count: logs.length
                }
            });
        } catch (error) {
            console.error("[API_LOGIN_LOGS_ERROR]", error);
            res.status(500).json({ status: 500, message: "Error retrieving login logs: " + error.message });
        }
    }));

    router.get("/api/logs/activity", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        try {
            const {
                limit = parseInt(req.query.limit) || 100,
                offset = parseInt(req.query.offset) || 0,
                userId = req.query.userId ? parseInt(req.query.userId) : null,
                actionType = req.query.actionType || null,
                resourceType = req.query.resourceType || null,
                startDate = req.query.startDate ? new Date(req.query.startDate) : null,
                endDate = req.query.endDate ? new Date(req.query.endDate) : null
            } = req.query;

            const logs = await getActivityLogs({
                limit: parseInt(limit),
                offset: parseInt(offset),
                userId,
                actionType,
                resourceType,
                startDate,
                endDate
            });

            res.status(200).json({
                status: 200,
                message: "Activity logs retrieved",
                data: logs,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    count: logs.length
                }
            });
        } catch (error) {
            console.error("[API_ACTIVITY_LOGS_ERROR]", error);
            res.status(500).json({ status: 500, message: "Error retrieving activity logs: " + error.message });
        }
    }));
}

module.exports = {
    registerAdminLogsRoutes
};
