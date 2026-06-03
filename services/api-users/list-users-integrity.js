/**
 * Header Doc
 * Purpose: Method `listUsersWithIntegrityCheck` — list semua users dari repository, bandingkan count antara DB dan in-memory snapshot, return payload dengan warning jika tidak sinkron. Standalone async function dengan deps as first parameter.
 * Caller: `services/api-users.service.js` (composer wraps menjadi method `service.listUsersWithIntegrityCheck()`).
 * Deps: tidak ada langsung; `deps.repository.getUserCountComparison()` + `deps.logger`.
 * MainFuncs: `listUsersWithIntegrityCheck(deps)`.
 * SideEffects: read-only — hanya log warning saat verification gagal atau count mismatch.
 */
"use strict";

async function listUsersWithIntegrityCheck(deps) {
    const comparison = await deps.repository.getUserCountComparison();

    if (comparison.verificationFailed) {
        deps.logger.error("[GET_USERS] Error verifying database count:", comparison.error?.message || comparison.error);
        return {
            status: 200,
            body: {
                status: 200,
                message: "Data pengguna berhasil dimuat",
                data: comparison.users,
                warning: "Database verification failed"
            }
        };
    }

    if (comparison.dbCount !== comparison.memoryCount) {
        deps.logger.warn(`[GET_USERS] WARNING: Data mismatch! Database has ${comparison.dbCount} users but memory has ${comparison.memoryCount} users`);
        deps.logger.warn("[GET_USERS] This indicates data synchronization issue. Consider reloading users from database.");
        return {
            status: 200,
            body: {
                status: 200,
                message: "Data pengguna berhasil dimuat",
                data: comparison.users,
                warning: `Data mismatch detected: Database has ${comparison.dbCount} users, memory has ${comparison.memoryCount} users`,
                databaseCount: comparison.dbCount,
                memoryCount: comparison.memoryCount
            }
        };
    }

    return {
        status: 200,
        body: {
            status: 200,
            message: "Data pengguna berhasil dimuat",
            data: comparison.users,
            count: comparison.memoryCount
        }
    };
}

module.exports = {
    listUsersWithIntegrityCheck
};
