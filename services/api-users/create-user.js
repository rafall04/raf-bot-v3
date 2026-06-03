/**
 * Header Doc
 * Purpose: Orchestrator method `upsertUserFromAdminPanel` — entry point untuk admin panel POST `/api/users`. Jika `userData.id` present, delegate ke `service.updateUserById(...)`. Jika tidak, eksekusi 3-phase create flow: validate (`prepareNewUser`) → mikrotik sync (`syncMikrotikForNewUser`) → persist+notify (`persistAndNotifyNewUser`). Setiap phase return `{ errorResponse }` (early return) atau prepared payload untuk next phase.
 * Caller: `services/api-users.service.js` (composer wraps menjadi method `service.upsertUserFromAdminPanel(args)`, pass `service` ref untuk delegate updateUserById).
 * Deps: 3 sub-modul phase: `./create-user-validate` (prepareNewUser), `./create-user-mikrotik-sync` (syncMikrotikForNewUser), `./create-user-persist` (persistAndNotifyNewUser).
 * MainFuncs: `upsertUserFromAdminPanel(deps, service, { userData, actor, requestMeta })`.
 * SideEffects: Delegasi ke 3 phase + delegasi ke updateUserById jika id present.
 */
"use strict";

const { prepareNewUser } = require('./create-user-validate');
const { syncMikrotikForNewUser } = require('./create-user-mikrotik-sync');
const { persistAndNotifyNewUser } = require('./create-user-persist');

async function upsertUserFromAdminPanel(deps, service, { userData, actor, requestMeta }) {
    if (userData?.id) {
        return service.updateUserById({
            id: userData.id,
            userData,
            actor,
            requestMeta
        });
    }

    // Phase 1+2: validate & prepare newUser object
    const validation = await prepareNewUser(deps, { userData });
    if (validation.errorResponse) {
        return validation.errorResponse;
    }
    const {
        newUser,
        plainTextPassword,
        finalUsername,
        paymentMethod,
        registrationMode,
        addToMikrotik,
        skipMikrotik,
        syncEnabled
    } = validation.prepared;

    // Phase 3: mikrotik sync (may throw critical errors)
    const syncResult = await syncMikrotikForNewUser(deps, {
        newUser,
        userData,
        registrationMode,
        addToMikrotik,
        skipMikrotik,
        syncEnabled
    });
    const mikrotikSync = syncResult.mikrotikSync;

    // Phase 4-8: persist + apply paid + activity log + welcome msg
    return persistAndNotifyNewUser(deps, {
        newUser,
        plainTextPassword,
        finalUsername,
        paymentMethod,
        registrationMode,
        mikrotikSync,
        syncEnabled,
        userData,
        actor,
        requestMeta
    });
}

module.exports = {
    upsertUserFromAdminPanel
};
