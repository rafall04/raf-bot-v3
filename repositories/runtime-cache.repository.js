/**
 * Header Doc
 * Purpose: Repository cache runtime bersama untuk service legacy yang sedang dipurge dari `global.*`.
 * Caller: Service aktif seperti `admin-ops`, `admin-database-ops`, `network-ops`, dan `payment-approval`.
 * Deps: `global.__appRuntime` atau runtime yang diinjeksikan.
 * MainFuncs: `createRuntimeCacheRepository`.
 * SideEffects: Menulis cache runtime/global fallback untuk collection yang didukung.
 */
"use strict";

const { getRuntimeCollection, resolveRuntimeBindings } = require("../lib/runtime-repositories");

function createCollectionRepository(runtimeBindings, key, options = {}) {
    const runtime = runtimeBindings.runtime;
    const globalScope = runtimeBindings.globalScope;
    const runtimeRepository = runtime?.repositories?.[key];
    const identity = options.identity || ((item) => item && item.id);

    return {
        getAll() {
            if (runtimeRepository?.getAll) {
                return runtimeRepository.getAll();
            }
            return getRuntimeCollection(runtime, key, globalScope);
        },
        setAll(items) {
            const nextItems = Array.isArray(items) ? items : [];
            if (runtimeRepository?.setAll) {
                runtimeRepository.setAll(nextItems);
                return nextItems;
            }
            globalScope[key] = nextItems;
            return globalScope[key];
        },
        getById(id) {
            return this.getAll().find((item) => String(identity(item)) === String(id)) || null;
        },
        findIndexById(id) {
            return this.getAll().findIndex((item) => String(identity(item)) === String(id));
        },
        removeById(id) {
            const nextItems = this.getAll().filter((item) => String(identity(item)) !== String(id));
            return this.setAll(nextItems);
        },
        clear() {
            return this.setAll([]);
        },
        findByDeviceId(deviceId) {
            return this.getAll().find((item) => item.device_id === deviceId) || null;
        }
    };
}

function createRuntimeCacheRepository(runtimeOverride) {
    const runtimeBindings = resolveRuntimeBindings(runtimeOverride);

    return {
        users: createCollectionRepository(runtimeBindings, "users"),
        accounts: createCollectionRepository(runtimeBindings, "accounts"),
        packages: createCollectionRepository(runtimeBindings, "packages"),
        statik: createCollectionRepository(runtimeBindings, "statik", {
            identity: (item) => item && item.prof
        }),
        voucher: createCollectionRepository(runtimeBindings, "voucher", {
            identity: (item) => item && item.prof
        }),
        atm: createCollectionRepository(runtimeBindings, "atm"),
        paymentMethod: createCollectionRepository(runtimeBindings, "paymentMethod"),
        networkAssets: createCollectionRepository(runtimeBindings, "networkAssets"),
        reports: createCollectionRepository(runtimeBindings, "reports")
    };
}

module.exports = {
    createRuntimeCacheRepository
};
