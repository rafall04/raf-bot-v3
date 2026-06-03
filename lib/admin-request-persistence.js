/**
 * Header Doc
 * Purpose: Membungkus persistence request approval dan package change agar router admin legacy tidak menulis file langsung.
 * Caller: `routes/admin.js`.
 * Deps: `lib/json-store.js` dan state global legacy.
 * MainFuncs: `loadApprovalRequests`, `persistApprovalRequests`, `cancelExpiredPackageChangeRequests`, `persistPackageChangeRequests`, `createPackageChangeRequestRecord`.
 * SideEffects: Menyinkronkan `global.requests`/`global.packageChangeRequests` ke file JSON.
 */
"use strict";

const { loadJSON, syncJsonCollection } = require("./json-store");

function loadApprovalRequests() {
    return loadJSON("requests.json");
}

function persistApprovalRequests(requests, globalScope = global) {
    return syncJsonCollection("requests.json", requests, {
        globalScope,
        globalKey: "requests"
    });
}

function cancelExpiredPackageChangeRequests(requests = [], now = Date.now()) {
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    let hasExpiredRequests = false;

    requests.forEach((request) => {
        if (request.status === "pending" && request.createdAt) {
            try {
                const requestAge = now - new Date(request.createdAt).getTime();
                if (requestAge > sevenDaysInMs) {
                    request.status = "cancelled_by_system";
                    request.updatedAt = new Date().toISOString();
                    request.notes = (request.notes || "") + " [Auto-cancelled: Request expired >7 hari]";
                    hasExpiredRequests = true;
                }
            } catch (error) {
                console.error(`[PKG_REQUEST_AUTO_CANCEL_ERROR] Error processing request ${request.id}:`, error.message);
            }
        }
    });

    return hasExpiredRequests;
}

function persistPackageChangeRequests(requests, globalScope = global) {
    return syncJsonCollection("package_change_requests.json", requests, {
        globalScope,
        globalKey: "packageChangeRequests"
    });
}

function createPackageChangeRequestRecord({ user, requestedPackage, requester, newPackageName, notes }) {
    return {
        id: `req_pkg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        userId: user.id,
        userName: user.name,
        userPhone: user.phone_number || "N/A",
        currentPackageName: user.subscription || "Belum berlangganan",
        requestedPackageName: newPackageName,
        requestedPackagePrice: requestedPackage.price || 0,
        requestedBy: requester.username,
        requestedByRole: requester.role,
        requestedById: requester.id,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        approvedBy: null,
        status: "pending",
        notes: notes || ""
    };
}

module.exports = {
    loadApprovalRequests,
    persistApprovalRequests,
    cancelExpiredPackageChangeRequests,
    persistPackageChangeRequests,
    createPackageChangeRequestRecord
};
