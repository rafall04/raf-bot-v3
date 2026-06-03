/**
 * Header Doc
 * Purpose: Method `deleteAllUsers` — bulk delete semua users setelah verify admin password (auth gate ekstra untuk operasi destruktif). Disconnect semua PPPoE active sessions sequentially (best-effort), bersihkan DB + in-memory snapshot, reset semua port ODP/ODC ke unused (`ports_used=0`, `ports[].used=false`, `ports[].userId=null`). Operasi ini IRREVERSIBLE — auth password verify wajib.
 * Caller: `services/api-users.service.js` (composer wraps menjadi method `service.deleteAllUsers(args)`).
 * Deps: `deps.repository.findAccountById`/`getUsersSnapshot`/`deleteAllUserRecords`/`replaceUsersSnapshot`/`getNetworkAssetsSnapshot`/`replaceNetworkAssetsSnapshot`, `deps.comparePassword`, `deps.deleteActivePPPoEUser`, `deps.saveNetworkAssets`, `deps.logger`.
 * MainFuncs: `deleteAllUsers(deps, { password, actor })`.
 * SideEffects: Verify admin password → bulk MikroTik disconnect (best-effort) → DB bulk delete → snapshot reset → network assets reset + persist.
 */
"use strict";

async function deleteAllUsers(deps, { password, actor }) {
    if (!password) {
        return {
            status: 400,
            body: {
                status: 400,
                message: "Password is required."
            }
        };
    }

    const account = deps.repository.findAccountById(actor?.id)
        || ((actor && actor.username && actor.password) ? actor : null);

    if (!account) {
        return {
            status: 401,
            body: {
                status: 401,
                message: "Akun admin tidak ditemukan. Silakan login ulang."
            }
        };
    }

    const isValid = await deps.comparePassword(password, account.password);
    if (!isValid) {
        return {
            status: 401,
            body: {
                status: 401,
                message: "Password salah. Silakan coba lagi."
            }
        };
    }

    for (const user of deps.repository.getUsersSnapshot()) {
        if (!user.pppoe_username) {
            continue;
        }
        try {
            const disconnectResult = await deps.deleteActivePPPoEUser(user.pppoe_username, { caller: "api.delete-all-users" });
            if (!disconnectResult.ok) {
                throw new Error(disconnectResult.message);
            }
        } catch (err) {
            deps.logger.error?.(`[DELETE_ALL] Failed to delete PPPoE user ${user.pppoe_username}:`, err);
        }
    }

    await deps.repository.deleteAllUserRecords();
    deps.repository.replaceUsersSnapshot([]);

    const nextNetworkAssets = deps.repository.getNetworkAssetsSnapshot().map((asset) => {
        if (asset.type === "ODP" || asset.type === "ODC") {
            return {
                ...asset,
                ports_used: 0,
                ports: Array.isArray(asset.ports)
                    ? asset.ports.map((port) => ({
                        ...port,
                        used: false,
                        userId: null
                    }))
                    : asset.ports
            };
        }
        return asset;
    });

    deps.repository.replaceNetworkAssetsSnapshot(nextNetworkAssets);
    deps.saveNetworkAssets?.(nextNetworkAssets);

    return {
        status: 200,
        body: {
            status: 200,
            message: "Semua pengguna berhasil dihapus"
        }
    };
}

module.exports = {
    deleteAllUsers
};
