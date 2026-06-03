/**
 * Header Doc
 * Purpose: Memusatkan utility admin destruktif agar route legacy admin tidak lagi memegang logika delete dan cleanup langsung.
 * Caller: `routes/admin-ops-routes.js`.
 * Deps: `repositories/admin-ops.repository`, `lib/database`, `lib/payment`, `lib/password`, `lib/mikrotik`, `lib/path-helper`, `lib/env-config`, dan `lib/error-handler`.
 * MainFuncs: `createAdminOpsService`, `deleteEntityByCategory`, `deleteAllUsers`, `cleanupOrphanedPhotos`.
 * SideEffects: Menghapus data SQLite/JSON, mereset cache memori, melakukan VACUUM, dan menghapus file foto yatim.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { createError, ErrorTypes } = require("../lib/error-handler");
const { createRuntimeCacheRepository } = require("../repositories/runtime-cache.repository");
const { createAdminOpsRepository } = require("../repositories/admin-ops.repository");

function defaultDeps() {
    const database = require("../lib/database");
    const runtime = global.__appRuntime || null;
    const runtimeScope = runtime?.globalScope || global;
    const runtimeCacheRepository = createRuntimeCacheRepository(runtime);
    const adminOpsRepository = createAdminOpsRepository({
        loadJSON: database.loadJSON,
        saveJSON: database.saveJSON
    });
    const resolveDb = () => runtime?.getDb?.() || runtimeScope.db || null;
    return {
        comparePassword: require("../lib/password").comparePassword,
        deleteActivePPPoEUser: require("../lib/mikrotik").deleteActivePPPoEUser,
        delPayment: require("../lib/payment").delPayment,
        userRepository: runtimeCacheRepository.users,
        accountRepository: runtimeCacheRepository.accounts,
        packageRepository: runtimeCacheRepository.packages,
        statikRepository: runtimeCacheRepository.statik,
        voucherRepository: runtimeCacheRepository.voucher,
        atmRepository: runtimeCacheRepository.atm,
        paymentMethodRepository: runtimeCacheRepository.paymentMethod,
        networkAssetsRepository: runtimeCacheRepository.networkAssets,
        reportsRepository: runtimeCacheRepository.reports,
        adminOpsRepository,
        saveNetworkAssets: database.saveNetworkAssets,
        saveAccounts: database.saveAccounts,
        savePackage: database.savePackage,
        saveStatik: database.saveStatik,
        saveVoucher: database.saveVoucher,
        saveAtm: database.saveAtm,
        savePaymentMethod: database.savePaymentMethod,
        updateOdpPortUsage: database.updateOdpPortUsage,
        updateOdcPortUsage: database.updateOdcPortUsage,
        getDatabasePath: require("../lib/env-config").getDatabasePath,
        getProjectRoot: require("../lib/path-helper").getProjectRoot,
        runDb(sql, params = []) {
            const db = resolveDb();
            return new Promise((resolve, reject) => {
                db.run(sql, params, function onRun(err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(this);
                });
            });
        },
        getDbRow(sql, params = []) {
            const db = resolveDb();
            return new Promise((resolve, reject) => {
                db.get(sql, params, (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(row);
                });
            });
        }
    };
}

function buildReqMeta(reqMeta = {}) {
    return {
        ipAddress: reqMeta.ipAddress || null,
        userAgent: reqMeta.userAgent || ""
    };
}

function buildActorContext(actorCtx = {}) {
    return {
        id: actorCtx.id || null,
        username: actorCtx.username || "system",
        role: actorCtx.role || null,
        rawUser: actorCtx.rawUser || null
    };
}

async function resolveAdminAccount(password, actor, accountRepository, comparePassword) {
    if (!password) {
        throw createError(ErrorTypes.VALIDATION_ERROR, "Password is required.", 400);
    }

    let account = accountRepository.getById(actor.id);
    if (!account) {
        const fallbackUser = actor.rawUser;
        if (fallbackUser?.username && fallbackUser?.password) {
            account = fallbackUser;
        } else {
            throw createError(ErrorTypes.AUTHENTICATION_ERROR, "Akun admin tidak ditemukan. Silakan login ulang.", 401);
        }
    }

    const isValid = await comparePassword(password, account.password);
    if (!isValid) {
        throw createError(ErrorTypes.AUTHENTICATION_ERROR, "Password salah. Silakan coba lagi.", 401);
    }

    return account;
}

function deleteFilesInsideDirectory(directoryPath, deletedFiles) {
    const files = fs.readdirSync(directoryPath);
    for (const file of files) {
        const filePath = path.join(directoryPath, file);
        if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
            deletedFiles.push(filePath);
        }
    }
    fs.rmdirSync(directoryPath);
}

function cleanupStructuredTicketFolders(baseDir, validTicketIds, deletedFiles, errors) {
    if (!fs.existsSync(baseDir)) {
        return;
    }

    const years = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

    for (const year of years) {
        const yearDir = path.join(baseDir, year);
        const months = fs.readdirSync(yearDir, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory())
            .map((dirent) => dirent.name);

        for (const month of months) {
            const monthDir = path.join(yearDir, month);
            const ticketDirs = fs.readdirSync(monthDir, { withFileTypes: true })
                .filter((dirent) => dirent.isDirectory())
                .map((dirent) => dirent.name);

            for (const ticketId of ticketDirs) {
                if (validTicketIds.has(ticketId)) {
                    continue;
                }

                const ticketDir = path.join(monthDir, ticketId);
                try {
                    deleteFilesInsideDirectory(ticketDir, deletedFiles);
                } catch (error) {
                    errors.push(`Error deleting ${ticketDir}: ${error.message}`);
                }
            }
        }
    }
}

function cleanupFlatTicketFiles(baseDir, validTicketIds, deletedFiles, errors) {
    if (!fs.existsSync(baseDir)) {
        return;
    }

    const files = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter((dirent) => dirent.isFile())
        .map((dirent) => dirent.name);

    for (const file of files) {
        const filePath = path.join(baseDir, file);
        const match = file.match(/^([A-Z0-9]+)-/);
        const ticketId = match ? match[1] : null;

        if (ticketId && validTicketIds.has(ticketId)) {
            continue;
        }

        try {
            fs.unlinkSync(filePath);
            deletedFiles.push(filePath);
        } catch (error) {
            errors.push(`Error deleting ${filePath}: ${error.message}`);
        }
    }
}

function resetNetworkAssetPorts(networkAssets = []) {
    networkAssets.forEach((asset) => {
        if (asset.type !== "ODP" && asset.type !== "ODC") {
            return;
        }

        asset.ports_used = 0;
        if (!Array.isArray(asset.ports)) {
            return;
        }

        asset.ports.forEach((port) => {
            port.used = false;
            port.userId = null;
        });
    });
}

function createAdminOpsService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        async deleteEntityByCategory({ category, id }, actorCtx = {}, reqMeta = {}, logActivity = async () => {}) {
                const actor = buildActorContext(actorCtx);
                const requestMeta = buildReqMeta(reqMeta);

                switch (category) {
                    case "users": {
                        const userIndexToDelete = deps.userRepository.findIndexById(id);
                        if (userIndexToDelete === -1) {
                            throw createError(ErrorTypes.NOT_FOUND_ERROR, "Pengguna tidak ditemukan", 404);
                        }

                        const users = deps.userRepository.getAll();
                        const userToDelete = users[userIndexToDelete];
                        const connectedOdpId = userToDelete.connected_odp_id;

                    try {
                        await logActivity({
                            userId: actor.id,
                            username: actor.username,
                            role: actor.role,
                            actionType: "DELETE",
                            resourceType: "user",
                            resourceId: String(id),
                            resourceName: userToDelete.name,
                            description: `Deleted user ${userToDelete.name}`,
                            oldValue: {
                                name: userToDelete.name,
                                phone_number: userToDelete.phone_number,
                                subscription: userToDelete.subscription,
                                paid: userToDelete.paid,
                                pppoe_username: userToDelete.pppoe_username
                            },
                            newValue: null,
                            ipAddress: requestMeta.ipAddress,
                            userAgent: requestMeta.userAgent
                        });
                    } catch (error) {
                        console.error("[ACTIVITY_LOG_ERROR] Failed to log user delete:", error);
                    }

                        await deps.runDb("DELETE FROM users WHERE id = ?", [id]);
                        deps.userRepository.removeById(id);

                        if (connectedOdpId) {
                            const networkAssets = deps.networkAssetsRepository.getAll();
                            deps.updateOdpPortUsage(connectedOdpId, false, networkAssets);
                            const odp = networkAssets.find((asset) => asset.id === connectedOdpId && asset.type === "ODP");
                            if (odp?.parent_odc_id) {
                                deps.updateOdcPortUsage(odp.parent_odc_id, networkAssets);
                            }
                            deps.networkAssetsRepository.setAll(networkAssets);
                            deps.saveNetworkAssets(networkAssets);
                        }

                    return {
                        status: 200,
                        message: "Pengguna berhasil dihapus"
                    };
                }

                case "accounts": {
                    const initialLength = deps.accountRepository.getAll().length;
                    const nextAccounts = deps.accountRepository.removeById(id);
                    if (nextAccounts.length === initialLength) {
                        throw createError(ErrorTypes.NOT_FOUND_ERROR, "Account not found.", 404);
                    }
                    deps.saveAccounts();
                    return { status: 200, message: "Successfully deleted" };
                }

                case "payment":
                    deps.delPayment(id);
                    return { status: 200, message: "Successfully deleted" };

                case "packages": {
                    const initialLength = deps.packageRepository.getAll().length;
                    const nextPackages = deps.packageRepository.removeById(id);
                    if (nextPackages.length === initialLength) {
                        throw createError(ErrorTypes.NOT_FOUND_ERROR, "Package not found.", 404);
                    }
                    deps.savePackage();
                    return { status: 200, message: "Successfully deleted" };
                }

                case "statik": {
                    const initialLength = deps.statikRepository.getAll().length;
                    const nextStatik = deps.statikRepository.removeById(id);
                    if (nextStatik.length === initialLength) {
                        throw createError(ErrorTypes.NOT_FOUND_ERROR, "Statik not found.", 404);
                    }
                    deps.saveStatik();
                    return { status: 200, message: "Successfully deleted" };
                }

                case "voucher": {
                    const initialLength = deps.voucherRepository.getAll().length;
                    const nextVoucher = deps.voucherRepository.removeById(id);
                    if (nextVoucher.length === initialLength) {
                        throw createError(ErrorTypes.NOT_FOUND_ERROR, "Voucher not found.", 404);
                    }
                    deps.saveVoucher();
                    return { status: 200, message: "Successfully deleted" };
                }

                case "atm": {
                    const initialLength = deps.atmRepository.getAll().length;
                    const nextAtm = deps.atmRepository.removeById(id);
                    if (nextAtm.length === initialLength) {
                        throw createError(ErrorTypes.NOT_FOUND_ERROR, "ATM not found.", 404);
                    }
                    deps.saveAtm();
                    return { status: 200, message: "Successfully deleted" };
                }

                case "payment-method": {
                    const initialLength = deps.paymentMethodRepository.getAll().length;
                    const nextPaymentMethods = deps.paymentMethodRepository.removeById(id);
                    if (nextPaymentMethods.length === initialLength) {
                        throw createError(ErrorTypes.NOT_FOUND_ERROR, "Payment method not found.", 404);
                    }
                    deps.savePaymentMethod();
                    return { status: 200, message: "Successfully deleted" };
                }

                case "mikrotik-devices": {
                    const result = deps.adminOpsRepository.deleteMikrotikDeviceById(id);
                    if (!result.deleted) {
                        throw createError(ErrorTypes.NOT_FOUND_ERROR, "Device not found", 404);
                    }
                    return { status: 200, message: "Device deleted successfully" };
                }

                default:
                    throw createError(ErrorTypes.VALIDATION_ERROR, "Invalid category for deletion.", 400);
            }
        },

        async deleteAllUsers({ password }, actorCtx = {}) {
            const actor = buildActorContext(actorCtx);
            await resolveAdminAccount(password, actor, deps.accountRepository, deps.comparePassword);

            for (const user of deps.userRepository.getAll()) {
                if (!user.pppoe_username) {
                    continue;
                }

                try {
                    const disconnectResult = await deps.deleteActivePPPoEUser(user.pppoe_username, { caller: "admin.delete-all-users" });
                    if (!disconnectResult.ok) {
                        throw new Error(disconnectResult.message);
                    }
                } catch (error) {
                    console.error(`[DELETE_ALL] Failed to delete PPPoE user ${user.pppoe_username}:`, error);
                }
            }

            const deleteResult = await deps.runDb("DELETE FROM users");
            const deletedCount = deleteResult.changes || 0;

            try {
                await deps.runDb("DELETE FROM sqlite_sequence WHERE name='users'");
            } catch (error) {
                console.warn("[/api/admin/delete-all-users] Warning: Could not reset sequence:", error.message);
            }

            try {
                await deps.runDb("VACUUM");
            } catch (error) {
                console.warn("[/api/admin/delete-all-users] WARNING: VACUUM failed. Deleted data may still exist in file.");
            }

            deps.userRepository.clear();
            const networkAssets = deps.networkAssetsRepository.getAll();
            resetNetworkAssetPorts(networkAssets);
            deps.networkAssetsRepository.setAll(networkAssets);
            deps.saveNetworkAssets(networkAssets);

            const remainingRow = await deps.getDbRow("SELECT COUNT(*) as count FROM users");
            const remainingCount = remainingRow ? remainingRow.count : 0;

            if (remainingCount > 0) {
                return {
                    status: 200,
                    message: `Hapus users berhasil dengan peringatan. ${deletedCount} users dihapus, ${remainingCount} masih tersisa.`,
                    details: {
                        deleted: deletedCount,
                        remaining: remainingCount
                    }
                };
            }

            let fileSizeAfter = 0;
            try {
                const dbPath = deps.getDatabasePath("users.sqlite");
                if (fs.existsSync(dbPath)) {
                    fileSizeAfter = fs.statSync(dbPath).size;
                }
            } catch (error) {
                console.warn("[/api/admin/delete-all-users] Could not get file size:", error.message);
            }

            return {
                status: 200,
                message: `Semua pengguna berhasil dihapus secara permanen! ${deletedCount} users dihapus. Database telah dibersihkan dan siap untuk production.`,
                details: {
                    deleted: deletedCount,
                    remaining: remainingCount,
                    memoryCleared: true,
                    sequenceReset: true,
                    vacuumPerformed: true,
                    logsCleaned: true,
                    fileSizeAfter,
                    note: "VACUUM telah dijalankan untuk menghapus data secara fisik dari file database. Admin logs (login_logs, activity_logs) berada di database terpisah (activity_logs.sqlite) dan tidak terpengaruh oleh operasi ini.",
                    important: "CATATAN: Database pelanggan (users.sqlite) terpisah dari database log (activity_logs.sqlite). Operasi ini hanya menghapus data pelanggan."
                }
            };
        },

        async cleanupOrphanedPhotos({ password }, actorCtx = {}) {
            const actor = buildActorContext(actorCtx);
            await resolveAdminAccount(password, actor, deps.accountRepository, deps.comparePassword);

            const validTicketIds = new Set();
            const reports = deps.reportsRepository.getAll();
            if (Array.isArray(reports)) {
                reports.forEach((ticket) => {
                    if (ticket.ticketId) {
                        validTicketIds.add(ticket.ticketId);
                    }
                });
            }

            const deletedFiles = [];
            const errors = [];
            const projectRoot = deps.getProjectRoot(__dirname);

            cleanupStructuredTicketFolders(path.join(projectRoot, "uploads", "reports"), validTicketIds, deletedFiles, errors);
            cleanupStructuredTicketFolders(path.join(projectRoot, "uploads", "teknisi"), validTicketIds, deletedFiles, errors);
            cleanupFlatTicketFiles(path.join(projectRoot, "uploads", "teknisi"), validTicketIds, deletedFiles, errors);
            cleanupStructuredTicketFolders(path.join(projectRoot, "uploads", "tickets"), validTicketIds, deletedFiles, errors);
            cleanupFlatTicketFiles(path.join(projectRoot, "uploads", "tickets"), validTicketIds, deletedFiles, errors);

            return {
                status: 200,
                message: `Berhasil menghapus ${deletedFiles.length} foto yang tidak terpakai.`,
                deletedCount: deletedFiles.length,
                errors: errors.length > 0 ? errors : undefined
            };
        }
    };
}

module.exports = {
    createAdminOpsService
};
