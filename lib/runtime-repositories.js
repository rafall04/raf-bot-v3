/**
 * Header Doc
 * Purpose: Menyediakan repository tipis di atas state runtime agar modul baru tidak menulis langsung ke `global.*`.
 * Caller: `lib/app-runtime.js` dan service/controller baru hasil refactor konservatif.
 * Deps: `lib/runtime-state.js`.
 * MainFuncs: `createRuntimeRepositories`, `createStateRepository`.
 * SideEffects: Menulis state runtime melalui wrapper `runtime.state`.
 */
"use strict";

const { readStateCollection, readStateObject, readStateValue } = require("./runtime-state");

const REPOSITORY_KEYS = Object.freeze({
    db: "db",
    psbDb: "psbDb",
    io: "io",
    config: "config",
    monitoringConfig: "monitoringConfig",
    users: "users",
    packages: "packages",
    accounts: "accounts",
    reports: "reports",
    requests: "requests",
    payment: "payment",
    paymentMethod: "paymentMethod",
    statik: "statik",
    voucher: "voucher",
    psbRecords: "psbRecords",
    networkAssets: "networkAssets",
    announcements: "announcements",
    news: "news",
    cronConfig: "cronConfig",
    packageChangeRequests: "packageChangeRequests"
});

function normalizeCollection(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeValue(value) {
    return typeof value === "undefined" ? null : value;
}

function getRepositoryMode(key) {
    if (["cronConfig", "config", "monitoringConfig"].includes(key)) {
        return "object";
    }
    if (["db", "psbDb", "io"].includes(key)) {
        return "value";
    }
    return "array";
}

function resolveRuntimeBindings(runtimeOverride, globalScopeOverride = global) {
    const runtime = runtimeOverride || globalScopeOverride.__appRuntime || null;
    const globalScope = runtime?.globalScope || globalScopeOverride;
    return {
        runtime,
        globalScope,
        repositories: runtime?.repositories || {},
        config: runtime?.getConfig?.() || runtime?.config || readStateObject(globalScope, "config")
    };
}

function readRuntimeRepositoryFallback(globalScope, key) {
    const mode = getRepositoryMode(key);
    if (mode === "object") {
        return readStateObject(globalScope, key);
    }
    if (mode === "value") {
        return readStateValue(globalScope, key, null);
    }
    return readStateCollection(globalScope, key);
}

function getRuntimeRepository(runtimeOverride, name, globalScopeOverride = global) {
    const { repositories } = resolveRuntimeBindings(runtimeOverride, globalScopeOverride);
    return repositories?.[name] || null;
}

function getRuntimeRepositoryValue(runtimeOverride, name, globalScopeOverride = global) {
    const key = REPOSITORY_KEYS[name] || name;
    const repository = getRuntimeRepository(runtimeOverride, name, globalScopeOverride);
    if (repository?.getAll) {
        return repository.getAll();
    }
    if (repository?.get) {
        return repository.get();
    }
    const { globalScope } = resolveRuntimeBindings(runtimeOverride, globalScopeOverride);
    return readRuntimeRepositoryFallback(globalScope, key);
}

function getRuntimeCollection(runtimeOverride, name, globalScopeOverride = global) {
    return normalizeCollection(getRuntimeRepositoryValue(runtimeOverride, name, globalScopeOverride));
}

function getRuntimeObject(runtimeOverride, name, globalScopeOverride = global) {
    return normalizeObject(getRuntimeRepositoryValue(runtimeOverride, name, globalScopeOverride));
}

function getRuntimeValue(runtimeOverride, name, globalScopeOverride = global) {
    return normalizeValue(getRuntimeRepositoryValue(runtimeOverride, name, globalScopeOverride));
}

function getRuntimeConfig(runtimeOverride, globalScopeOverride = global) {
    return getRuntimeObject(runtimeOverride, "config", globalScopeOverride);
}

function createStateRepository(runtimeState, key, options = {}) {
    const mode = options.mode || "array";
    return {
        key,
        getAll() {
            if (mode === "object") {
                return normalizeObject(runtimeState.get(key));
            }
            if (mode === "value") {
                return normalizeValue(runtimeState.get(key));
            }
            return normalizeCollection(runtimeState.get(key));
        },
        get() {
            return this.getAll();
        },
        setAll(items) {
            if (mode === "object") {
                return runtimeState.set(key, normalizeObject(items));
            }
            if (mode === "value") {
                return runtimeState.set(key, normalizeValue(items));
            }
            return runtimeState.set(key, normalizeCollection(items));
        },
        set(value) {
            return this.setAll(value);
        },
        update(updater) {
            const currentValue = this.getAll();
            const nextValue = typeof updater === "function" ? updater(currentValue) : updater;
            return this.setAll(nextValue);
        },
        push(item) {
            if (mode !== "array") {
                throw new Error(`Repository ${key} tidak mendukung push() karena mode ${mode}.`);
            }
            const nextValue = [...normalizeCollection(runtimeState.get(key)), item];
            return runtimeState.set(key, nextValue);
        },
        merge(patch) {
            if (mode !== "object") {
                throw new Error(`Repository ${key} tidak mendukung merge() karena mode array.`);
            }
            return runtimeState.set(key, {
                ...normalizeObject(runtimeState.get(key)),
                ...normalizeObject(patch)
            });
        }
    };
}

function createRuntimeRepositories(runtimeState) {
    return Object.fromEntries(Object.entries(REPOSITORY_KEYS).map(([name, key]) => {
        const mode = getRepositoryMode(key);
        return [name, createStateRepository(runtimeState, key, { mode })];
    }));
}

module.exports = {
    REPOSITORY_KEYS,
    createRuntimeRepositories,
    createStateRepository,
    getRepositoryMode,
    resolveRuntimeBindings,
    getRuntimeRepository,
    getRuntimeRepositoryValue,
    getRuntimeCollection,
    getRuntimeObject,
    getRuntimeValue,
    getRuntimeConfig
};
