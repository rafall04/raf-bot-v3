/**
 * Header Doc
 * Purpose: Owner persistence SQLite untuk auto outage rules, states, conversations, dan scan logs.
 * Caller: `services/auto-outage-*.service.js` dan `routes/admin-auto-outage-routes.js`.
 * Deps: `sqlite3`, `lib/env-config.getDatabasePath`, runtime DB fallback.
 * MainFuncs: `createAutoOutageRepository`, `ensureSchema`, rule/state/conversation/scan-log CRUD skeleton.
 * SideEffects: Membuka koneksi SQLite dan menyiapkan table auto outage saat dipanggil.
 */
"use strict";

function defaultDeps() {
    return {
        sqlite3: require("sqlite3").verbose(),
        getDatabasePath: require("../lib/env-config").getDatabasePath,
        runtime: global.__appRuntime || null
    };
}

function createAutoOutageRepository(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    return {
        deps,
        async ensureSchema() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async upsertRule() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async listRules() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async getRuleById() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async getEnabledRules() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async upsertStates() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async listStates() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async getStateByUserId() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async createConversation() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async updateConversation() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async getOpenConversationByUserId() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async insertScanLog() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); },
        async listScanLogs() { throw new Error("AUTO_OUTAGE_REPOSITORY_NOT_IMPLEMENTED"); }
    };
}

module.exports = { createAutoOutageRepository };
