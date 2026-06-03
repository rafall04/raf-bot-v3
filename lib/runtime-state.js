/**
 * Header Doc
 * Purpose: Membungkus akses state runtime berbasis global agar pembacaan/penulisan state bersama konsisten.
 * Caller: `lib/app-runtime.js`, bootstrap runtime, dan modul baru yang membutuhkan akses state terstandar.
 * Deps: `global`/`globalScope` yang berisi state legacy aplikasi.
 * MainFuncs: `createRuntimeState`, `get`, `set`, `has`, `snapshot`.
 * SideEffects: Menulis ke `globalScope` untuk menjaga kompatibilitas dengan kode legacy.
 */
"use strict";

const DEFAULT_STATE = Object.freeze({
    conn: null,
    whatsappConnectionState: "close",
    db: null,
    psbDb: null,
    io: null,
    config: null,
    monitoringConfig: null,
    users: [],
    packages: [],
    reports: [],
    compensations: [],
    speed_requests: [],
    packageChangeRequests: [],
    accounts: [],
    payment: [],
    paymentMethod: [],
    statik: [],
    voucher: [],
    atm: [],
    psbRecords: [],
    networkAssets: [],
    cronConfig: {}
});

function ensureDefaultState(globalScope) {
    Object.entries(DEFAULT_STATE).forEach(([key, value]) => {
        if (typeof globalScope[key] === "undefined") {
            globalScope[key] = Array.isArray(value) ? [...value] : value;
        }
    });
}

function readStateCollection(globalScope, name) {
    const value = globalScope && typeof globalScope === "object" ? globalScope[name] : undefined;
    return Array.isArray(value) ? value : [];
}

function readStateObject(globalScope, name) {
    const value = globalScope && typeof globalScope === "object" ? globalScope[name] : undefined;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readStateValue(globalScope, name, fallback = null) {
    if (!globalScope || typeof globalScope !== "object" || typeof globalScope[name] === "undefined") {
        return fallback;
    }
    return globalScope[name];
}

function createRuntimeState(globalScope = global) {
    ensureDefaultState(globalScope);

    return {
        get(name) {
            return globalScope[name];
        },
        getCollection(name) {
            return readStateCollection(globalScope, name);
        },
        getObject(name) {
            return readStateObject(globalScope, name);
        },
        getValue(name, fallback = null) {
            return readStateValue(globalScope, name, fallback);
        },
        set(name, value) {
            globalScope[name] = value;
            return value;
        },
        has(name) {
            return typeof globalScope[name] !== "undefined";
        },
        snapshot() {
            return { ...globalScope };
        },
        keys() {
            return Object.keys(DEFAULT_STATE);
        }
    };
}

module.exports = {
    DEFAULT_STATE,
    createRuntimeState,
    ensureDefaultState,
    readStateCollection,
    readStateObject,
    readStateValue
};
