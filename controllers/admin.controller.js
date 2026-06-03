/**
 * Header Doc
 * Purpose: Controller admin untuk memetakan HTTP request/response ke service admin dan billing tanpa menyimpan business logic.
 * Caller: `routes/admin.routes.js`.
 * Deps: `services/admin.service` dan `services/billing.service`.
 * MainFuncs: `createAdminController`, handler list/reload users, package change, dan bulk payment action.
 * SideEffects: Mengirim response HTTP JSON berdasarkan hasil service.
 */
"use strict";

const { createAdminService } = require("../services/admin.service");
const { createBillingService, buildPaymentAuditContext } = require("../services/billing.service");

function createActorContext(req) {
    return buildPaymentAuditContext(req.user, req);
}

function createAdminController(overrides = {}) {
    const adminService = overrides.adminService || createAdminService();
    const billingService = overrides.billingService || createBillingService();

    return {
        async reloadUsersCache(req, res) {
            const result = await adminService.reloadUsersCache(createActorContext(req));
            res.status(result.status).json(result);
        },

        async listUsers(req, res) {
            const data = await adminService.getUsersList();
            res.json({ status: 200, message: "User list fetched.", data });
        },

        async listPackages(req, res) {
            const data = await adminService.getPackagesList();
            res.json({ status: 200, message: "Package list fetched.", data });
        },

        async bulkApprovePaymentRequests(req, res) {
            const result = await billingService.bulkApprovePaymentRequests(req.body, createActorContext(req));
            res.status(result.status).json(result);
        },

        async requestPackageChange(req, res) {
            const result = await adminService.requestPackageChange(req.body, createActorContext(req));
            res.status(result.status).json(result);
        },

        async approvePackageChange(req, res) {
            const result = await adminService.approvePackageChange(req.body, createActorContext(req));
            res.status(result.status).json(result);
        },

        async listPackageChangeRequests(req, res) {
            const result = await adminService.listPackageChangeRequests(createActorContext(req));
            res.status(result.status).json(result);
        },

        async bulkUpdatePaymentStatus(req, res) {
            const result = await billingService.bulkUpdatePaymentStatus(req.body, createActorContext(req));
            res.status(result.status).json(result);
        }
    };
}

module.exports = {
    createAdminController
};
