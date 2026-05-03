/**
 * Header Doc
 * Purpose: Orchestrator deteksi pelanggan offline berbasis database users dan PPP active MikroTik batch.
 * Caller: `routes/admin-auto-outage-routes.js`, `lib/cron/jobs/auto-outage-check.js`.
 * Deps: `repositories/auto-outage.repository.js`, runtime users repository, `lib/mikrotik` adapter functions.
 * MainFuncs: `createAutoOutageDetectionService`, `runManualScan`, `buildDetectionSnapshot`.
 * SideEffects: Membaca MikroTik, membaca runtime users, dan menulis state/scan log auto outage.
 */
"use strict";

function defaultDeps() {
    return {
        repository: require("../repositories/auto-outage.repository").createAutoOutageRepository(),
        runtime: global.__appRuntime || null,
        getActivePPPoEUsers: require("../lib/mikrotik").getActivePPPoEUsers,
        getAllPPPoESecrets: require("../lib/mikrotik").getAllPPPoESecrets,
        now: () => new Date()
    };
}

function createAutoOutageDetectionService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    return {
        deps,
        async runManualScan() { throw new Error("AUTO_OUTAGE_DETECTION_NOT_IMPLEMENTED"); },
        async buildDetectionSnapshot() { throw new Error("AUTO_OUTAGE_DETECTION_NOT_IMPLEMENTED"); }
    };
}

module.exports = { createAutoOutageDetectionService };
