/**
 * Header Doc
 * Purpose: Service admin untuk memisahkan business logic package change, reload users cache, dan listing admin dari router HTTP.
 * Caller: `controllers/admin.controller.js`.
 * Deps: `repositories/admin.repository`, `lib/error-handler`, adapter MikroTik, activity logger, delivery WhatsApp, dan template-service.
 * MainFuncs: `createAdminService`, `requestPackageChange`, `approvePackageChange`, `listPackageChangeRequests`, `reloadUsersCache`.
 * SideEffects: Menulis SQLite/JSON via repository, sinkronisasi MikroTik, activity log, dan notifikasi WhatsApp.
 */
"use strict";

const { createAdminRepository } = require("../repositories/admin.repository");
const { createError, ErrorTypes } = require("../lib/error-handler");
const { withLock } = require("../lib/request-lock");
const { logActivity } = require("../lib/activity-logger");
const { sendMessage, sendMessageToMany } = require("../lib/whatsapp-delivery-service");
const { sendCritical } = require("../lib/whatsapp-critical-delivery");
const { renderCategoryTemplate } = require("../lib/template-service");
const {
    updatePPPoEProfile,
    deleteActivePPPoEUser,
    assertMikrotikResult,
    isMikrotikSyncEnabled
} = require("../lib/mikrotik");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate("responseTemplates", key, data).text;
}

function requireAdminRole(actorCtx) {
    if (!actorCtx || !ADMIN_ROLES.includes(actorCtx.role)) {
        throw createError(ErrorTypes.AUTHORIZATION_ERROR, "Akses ditolak.", 403);
    }
}

function buildAuditPayload(actorCtx, overrides) {
    return {
        userId: actorCtx.id,
        username: actorCtx.username,
        role: actorCtx.role,
        ipAddress: actorCtx.ipAddress,
        userAgent: actorCtx.userAgent,
        ...overrides
    };
}

function normalizeTechnicianJid(phoneNumber) {
    let normalized = String(phoneNumber || "").trim();
    if (!normalized) {
        return "";
    }
    if (normalized.endsWith("@s.whatsapp.net")) {
        return normalized;
    }
    if (normalized.startsWith("0")) {
        return `62${normalized.slice(1)}@s.whatsapp.net`;
    }
    if (normalized.startsWith("62")) {
        return `${normalized}@s.whatsapp.net`;
    }
    return `62${normalized}@s.whatsapp.net`;
}

/**
 * Kirim notifikasi terjamin (sendCritical) secara best-effort: TIDAK pernah throw,
 * supaya kegagalan kirim tidak menggagalkan approval yang sudah commit ke DB/MikroTik.
 * Fallback ke deps.sendMessage hanya bila sendCritical tak tersedia (mis. test lama).
 */
async function deliverCritical(deps, recipient, message, label) {
    const send = deps.sendCritical || deps.sendMessage;
    if (!send) return { delivered: false, error: "no_sender" };
    try {
        return await send(recipient, message, { label, waitForReadyMs: 8000 });
    } catch (err) {
        console.error(`[PKG_CHANGE_NOTIF_ERROR] ${label}:`, err.message);
        return { delivered: false, error: err.message };
    }
}

function defaultDeps() {
    return {
        repository: createAdminRepository(),
        withLock,
        logActivity,
        sendMessage,
        sendMessageToMany,
        sendCritical,
        updatePPPoEProfile,
        deleteActivePPPoEUser,
        assertMikrotikResult,
        isMikrotikSyncEnabled
    };
}

function createAdminService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        async reloadUsersCache(actorCtx) {
            requireAdminRole(actorCtx);
            const details = await deps.repository.reloadUsersFromDatabase();
            return {
                status: 200,
                message: `Users reloaded successfully. ${details.memoryCountAfter} users loaded from database.`,
                details
            };
        },

        async getUsersList() {
            return deps.repository.getUsersList();
        },

        async getPackagesList() {
            return deps.repository.getPackagesList();
        },

        async listPackageChangeRequests(actorCtx) {
            requireAdminRole(actorCtx);
            return {
                status: 200,
                message: "Package change requests fetched.",
                data: [...deps.repository.getPackageChangeRequests()].sort(
                    (left, right) => new Date(right.createdAt) - new Date(left.createdAt)
                )
            };
        },

        async requestPackageChange(input, actorCtx) {
            if (!input.userId || !input.newPackageName) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "Parameter 'userId' dan 'newPackageName' wajib diisi.",
                    400
                );
            }

            const lockKey = `create-pkg-request-${input.userId}`;

            try {
                return await deps.withLock(lockKey, async () => {
                    const user = deps.repository.getUserById(input.userId);
                    if (!user) {
                        throw createError(
                            ErrorTypes.NOT_FOUND_ERROR,
                            `Pelanggan dengan ID ${input.userId} tidak ditemukan.`,
                            404
                        );
                    }

                    const requestedPackage = deps.repository.getPackageByName(input.newPackageName);
                    if (!requestedPackage) {
                        throw createError(
                            ErrorTypes.NOT_FOUND_ERROR,
                            `Paket '${input.newPackageName}' tidak ditemukan.`,
                            404
                        );
                    }

                    if (user.subscription === input.newPackageName) {
                        throw createError(
                            ErrorTypes.VALIDATION_ERROR,
                            `Pelanggan sudah menggunakan paket '${input.newPackageName}'.`,
                            400
                        );
                    }

                    const hasExpiredRequests = deps.repository.cancelExpiredPackageChangeRequests();
                    if (hasExpiredRequests) {
                        deps.repository.persistPackageChangeRequests();
                    }

                    const existingPendingRequest = deps.repository.findPendingPackageChangeRequestByUserId(user.id);
                    if (existingPendingRequest) {
                        throw createError(
                            ErrorTypes.VALIDATION_ERROR,
                            `Pelanggan ini sudah memiliki permintaan perubahan paket yang sedang menunggu persetujuan (Request ID: ${existingPendingRequest.id}).`,
                            400
                        );
                    }

                    const requester = {
                        id: actorCtx.id,
                        username: actorCtx.username,
                        role: actorCtx.role,
                        name: actorCtx.name
                    };

                    const newRequest = deps.repository.createPackageChangeRequestRecord({
                        user,
                        requestedPackage,
                        requester,
                        newPackageName: input.newPackageName,
                        notes: input.notes
                    });

                    deps.repository.appendPackageChangeRequest(newRequest);
                    deps.repository.persistPackageChangeRequests();

                    const ownerNumbers = deps.repository.getOwnerNumbers();
                    if (ownerNumbers.length > 0) {
                        const formattedPrice = new Intl.NumberFormat("id-ID", {
                            style: "currency",
                            currency: "IDR",
                            minimumFractionDigits: 0
                        }).format(requestedPackage.price);

                        const requesterName = requester.name || requester.username;
                        const messageToOwner = renderResponseTemplate("admin_service_package_change_owner_request", {
                            requesterRole: requester.role === "teknisi" ? "Teknisi" : "Admin",
                            requesterName,
                            customerName: user.name,
                            customerPhone: user.phone_number || "Tidak ada",
                            currentPackage: user.subscription || "Belum berlangganan",
                            newPackage: input.newPackageName,
                            price: formattedPrice,
                            notesSection: input.notes ? `Catatan:\n${input.notes}\n\n` : "",
                            requestId: newRequest.id,
                            createdAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
                        });

                        await deps.sendMessageToMany(ownerNumbers, { text: messageToOwner });
                    }

                    return {
                        status: 201,
                        message: "Permintaan perubahan paket berhasil dibuat dan akan ditinjau oleh admin.",
                        data: {
                            requestId: newRequest.id,
                            status: newRequest.status
                        }
                    };
                });
            } catch (error) {
                if (String(error.message || "") === `Could not acquire lock for ${lockKey}`) {
                    throw createError(ErrorTypes.RATE_LIMIT_ERROR, "Request sedang diproses. Silakan coba lagi.", 409);
                }
                throw error;
            }
        },

        async approvePackageChange(input, actorCtx) {
            requireAdminRole(actorCtx);

            if (!input.requestId || !input.action) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "Parameter 'requestId' dan 'action' wajib diisi.",
                    400
                );
            }

            if (!["approve", "reject"].includes(input.action)) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "Aksi tidak valid. Gunakan 'approve' atau 'reject'.",
                    400
                );
            }

            const lockKey = `approve-pkg-${input.requestId}`;

            try {
                return await deps.withLock(lockKey, async () => {
                    const requestIndex = deps.repository.findPackageChangeRequestIndexById(input.requestId);
                    if (requestIndex === -1) {
                        throw createError(
                            ErrorTypes.NOT_FOUND_ERROR,
                            "Permintaan perubahan paket tidak ditemukan.",
                            404
                        );
                    }

                    const request = deps.repository.getPackageChangeRequests()[requestIndex];
                    if (request.status !== "pending") {
                        throw createError(
                            ErrorTypes.VALIDATION_ERROR,
                            `Permintaan ini sudah dalam status '${request.status}' dan tidak dapat diubah lagi.`,
                            400
                        );
                    }

                    let notificationMessage = "";

                    if (input.action === "approve") {
                        const user = deps.repository.getUserById(request.userId);
                        if (!user) {
                            throw createError(
                                ErrorTypes.NOT_FOUND_ERROR,
                                `User dengan ID ${request.userId} untuk permintaan ini tidak ditemukan.`,
                                404
                            );
                        }
                        if (!user.pppoe_username) {
                            throw createError(
                                ErrorTypes.VALIDATION_ERROR,
                                `User ${user.name} tidak memiliki username PPPoE.`,
                                400
                            );
                        }

                        const requestedPackage = deps.repository.getPackageByName(request.requestedPackageName);
                        if (!requestedPackage || !requestedPackage.profile) {
                            throw createError(
                                ErrorTypes.NOT_FOUND_ERROR,
                                `Paket yang diminta (${request.requestedPackageName}) atau profil Mikrotik-nya tidak ditemukan.`,
                                404
                            );
                        }

                        const oldPackage = user.subscription;
                        const syncToMikrotik = deps.isMikrotikSyncEnabled(deps.repository.getConfig());
                        let mikrotikSync = {
                            status: "skipped_no_pppoe",
                            message: "Tidak ada sinkronisasi MikroTik yang perlu dijalankan."
                        };

                        if (syncToMikrotik) {
                            try {
                                deps.assertMikrotikResult(
                                    await deps.updatePPPoEProfile(user.pppoe_username, requestedPackage.profile, {
                                        caller: "admin.approve-package-change"
                                    })
                                );
                                mikrotikSync = {
                                    status: "applied",
                                    message: `Profile MikroTik untuk ${user.pppoe_username} berhasil diperbarui ke ${requestedPackage.profile}.`
                                };
                            } catch (error) {
                                throw createError(
                                    ErrorTypes.MIKROTIK_ERROR,
                                    `Gagal mengupdate profil di MikroTik: ${error.message}. Database tidak di-update untuk mencegah inconsistent state.`,
                                    502
                                );
                            }

                            try {
                                const disconnectResult = await deps.deleteActivePPPoEUser(user.pppoe_username, {
                                    caller: "admin.approve-package-change"
                                });
                                if (!disconnectResult.ok) {
                                    throw new Error(disconnectResult.message);
                                }
                            } catch (error) {
                                console.warn("[PKG_CHANGE_APPROVE_WARN]", error.message);
                            }
                        } else {
                            mikrotikSync = {
                                status: "applied_locally_sync_disabled",
                                message: "Sinkronisasi MikroTik dinonaktifkan. Perubahan paket hanya disimpan lokal."
                            };
                        }

                        await deps.repository.updateUserSubscription(user.id, request.requestedPackageName);
                        deps.repository.syncUserSubscriptionCache(user.id, request.requestedPackageName);

                        request.status = "approved";
                        request.sync_policy = syncToMikrotik ? "enabled" : "disabled";
                        request.sync_status = mikrotikSync.status;
                        request.sync_message = mikrotikSync.message;

                        try {
                            await deps.logActivity(buildAuditPayload(actorCtx, {
                                actionType: "UPDATE",
                                resourceType: "package",
                                resourceId: String(user.id),
                                resourceName: user.name,
                                description: `Approved package change for user ${user.name}: ${oldPackage} -> ${request.requestedPackageName}`,
                                oldValue: { subscription: oldPackage },
                                newValue: {
                                    subscription: request.requestedPackageName,
                                    sync_policy: request.sync_policy,
                                    sync_status: request.sync_status,
                                    sync_message: request.sync_message
                                }
                            }));
                        } catch (error) {
                            console.error("[ACTIVITY_LOG_ERROR] Failed to log package change:", error);
                        }

                        notificationMessage = renderResponseTemplate("admin_service_package_change_customer_approved", {
                            customerName: user.name,
                            packageName: request.requestedPackageName,
                            syncMessageSection: request.sync_message ? `${request.sync_message}\n\n` : ""
                        });
                    } else {
                        request.status = "rejected";
                        const user = deps.repository.getUserById(request.userId);
                        const userName = user ? user.name : "Pelanggan";
                        notificationMessage = renderResponseTemplate("admin_service_package_change_customer_rejected", {
                            customerName: userName,
                            packageName: request.requestedPackageName,
                            reason: input.notes || "Ditolak oleh admin."
                        });
                    }

                    request.updatedAt = new Date().toISOString();
                    request.approvedBy = actorCtx.username;
                    request.notes = input.notes || "";
                    deps.repository.replacePackageChangeRequest(requestIndex, request);
                    deps.repository.persistPackageChangeRequests();

                    // Notifikasi hasil approval/reject — terjamin (sendCritical: tunggu-ready
                    // + retry + dead-letter, auto-retry saat WA reconnect). Best-effort: DB &
                    // MikroTik sudah commit di atas, jadi kegagalan kirim TIDAK boleh
                    // menggagalkan approval (jangan throw — sendCritical sendiri tidak throw).
                    const customer = deps.repository.getUserById(request.userId);
                    if (customer && customer.phone_number) {
                        const phoneNumbers = customer.phone_number
                            .split("|")
                            .map((item) => item.trim())
                            .filter(Boolean);
                        for (const phone of phoneNumbers) {
                            await deliverCritical(deps, phone, { text: notificationMessage }, "package_change_approval");
                        }
                    }

                    const technician = deps.repository.getAccountById(request.requestedById);
                    if (technician && technician.phone_number) {
                        const statusText = input.action === "approve" ? "DISETUJUI" : "DITOLAK";
                        const technicianMessage = renderResponseTemplate("admin_service_package_change_technician_result", {
                            statusText,
                            technicianName: technician.name || technician.username,
                            requestId: request.id,
                            customerName: customer ? customer.name : "N/A",
                            currentPackage: request.currentPackageName,
                            newPackage: request.requestedPackageName,
                            rejectionSection: input.action === "reject" && input.notes
                                ? `\nAlasan Penolakan:\n${input.notes}\n`
                                : "",
                            processedAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
                            processedBy: actorCtx.username
                        });

                        await deliverCritical(deps, normalizeTechnicianJid(technician.phone_number), { text: technicianMessage }, "package_change_approval_teknisi");
                    }

                    return {
                        status: 200,
                        message: `Permintaan berhasil di-${input.action === "approve" ? "setujui" : "tolak"}.`,
                        sync_policy: request.sync_policy,
                        sync_status: request.sync_status,
                        sync_message: request.sync_message
                    };
                });
            } catch (error) {
                if (String(error.message || "") === `Could not acquire lock for ${lockKey}`) {
                    throw createError(ErrorTypes.RATE_LIMIT_ERROR, "Request sedang diproses. Silakan coba lagi.", 409);
                }
                throw error;
            }
        }
    };
}

module.exports = {
    createAdminService
};
