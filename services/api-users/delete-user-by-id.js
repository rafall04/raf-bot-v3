/**
 * Header Doc
 * Purpose: Method `deleteUserById` — hapus single user dari DB + in-memory snapshot, disconnect PPPoE active session di MikroTik (best-effort), reset ODP port usage jika user terkait ke ODP, lalu log activity. Audit log dilakukan SEBELUM delete sehingga jika delete gagal, audit tetap menggambarkan intent action.
 * Caller: `services/api-users.service.js` (composer wraps menjadi method `service.deleteUserById(args)`).
 * Deps: `deps.repository.findUserById`/`deleteUserRecord`/`getUsersSnapshot`/`replaceUsersSnapshot`, `deps.logActivity`, `deps.deleteActivePPPoEUser`, `deps.updateOdpPortUsage`, `deps.logger`.
 * MainFuncs: `deleteUserById(deps, { userId, actor, requestMeta })`.
 * SideEffects: Activity log (best-effort) + MikroTik disconnect (best-effort) + DB delete + in-memory snapshot replace + ODP port usage reset (best-effort).
 */
"use strict";

async function deleteUserById(deps, { userId, actor, requestMeta }) {
    const user = deps.repository.findUserById(userId);
    if (!user) {
        return {
            status: 404,
            body: {
                status: 404,
                message: "User tidak ditemukan"
            }
        };
    }

    if (deps.logActivity) {
        try {
            await deps.logActivity({
                userId: actor?.id,
                username: actor?.username,
                role: actor?.role,
                actionType: "DELETE",
                resourceType: "user",
                resourceId: String(user.id),
                resourceName: user.name,
                description: `Deleted user ${user.name}`,
                oldValue: {
                    name: user.name,
                    phone_number: user.phone_number,
                    subscription: user.subscription,
                    paid: user.paid,
                    pppoe_username: user.pppoe_username
                },
                newValue: null,
                ipAddress: requestMeta?.ipAddress,
                userAgent: requestMeta?.userAgent
            });
        } catch (logErr) {
            deps.logger.error?.("[ACTIVITY_LOG_ERROR] Failed to log user delete:", logErr);
        }
    }

    if (user.pppoe_username) {
        try {
            const disconnectResult = await deps.deleteActivePPPoEUser(user.pppoe_username, { caller: "api.user-delete" });
            if (!disconnectResult.ok) {
                throw new Error(disconnectResult.message);
            }
        } catch (err) {
            deps.logger.error?.("[DELETE_USER] Failed to delete PPPoE user:", err);
        }
    }

    await deps.repository.deleteUserRecord(userId);
    const nextUsers = deps.repository.getUsersSnapshot().filter((currentUser) => String(currentUser.id) !== String(userId));
    deps.repository.replaceUsersSnapshot(nextUsers);

    if (user.odp_id && user.odp_port) {
        deps.updateOdpPortUsage?.(user.odp_id, user.odp_port, false);
    }

    return {
        status: 200,
        body: {
            status: 200,
            message: "User berhasil dihapus"
        }
    };
}

module.exports = {
    deleteUserById
};
