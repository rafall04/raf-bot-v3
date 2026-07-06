/**
 * Header Doc
 * Purpose: Default dependency injection blueprint untuk `createApiUsersService` factory. Memuat 30 keys dependency (repository, finance/payment helpers, mikrotik adapter, activity logger, auth verifier, network asset mutator, dll) dengan nilai default `null` agar `createApiUsersService(overrides)` bisa override per-test/per-runtime tanpa tergantung global. Logger default ke `console`.
 * Caller: `services/api-users.service.js` (composer/factory).
 * Deps: tidak ada — pure data builder.
 * MainFuncs: `defaultDeps()` — return object berisi default dependency keys.
 * SideEffects: tidak ada.
 */
"use strict";

function defaultDeps() {
    return {
        repository: null,
        applyPaymentStatusChange: null,
        handlePaidStatusChange: null,
        getPeriodParts: null,
        getEffectivePrice: null,
        normalizeUserPaymentMethod: null,
        deleteActivePPPoEUser: null,
        removePPPoESecret: null,
        updateOdpPortUsage: null,
        saveNetworkAssets: null,
        comparePassword: null,
        logActivity: null,
        validatePhoneNumbers: null,
        getDb: null,
        getProfileBySubscription: null,
        isMikrotikSyncEnabled: null,
        buildMikrotikSyncResult: null,
        assertMikrotikResult: null,
        updatePPPoEProfile: null,
        getNextAvailableUserId: null,
        hashPassword: null,
        addPPPoEUser: null,
        getConfig: null,
        getPackages: null,
        renderTemplate: null,
        sendMessage: null,
        getStatusSnapshot: null,
        logWifiChange: null,
        logger: console
    };
}

module.exports = {
    defaultDeps
};
