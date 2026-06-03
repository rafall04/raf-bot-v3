/**
 * Header Doc
 * Purpose: Menjadi owner persistence/read-model awal untuk domain API network selama normalisasi `routes/api-network-routes.js`.
 * Caller: `services/api-network.service.js`.
 * Deps: Runtime repository users/packages/config dan state runtime/global sebagai fallback snapshot domain network.
 * MainFuncs: `createApiNetworkRepository`, `getUsersSnapshot`, `getPackagesSnapshot`, `getConfigSnapshot`, `buildRegisteredUsernames`, `buildProfileToPackageMap`, `buildDeviceIdSet`.
 * SideEffects: Membaca snapshot runtime/global untuk users, packages, config, identifier device, dan mapping paket network tanpa memodifikasi state.
 */
"use strict";

function defaultDeps() {
    return {
        runtime: global.__appRuntime || null
    };
}

function createApiNetworkRepository(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        deps,

        getRuntimeStateValue(key, fallbackValue) {
            if (deps.runtime?.state?.has?.(key)) {
                return deps.runtime.state.get(key);
            }
            if (typeof global[key] !== "undefined") {
                return global[key];
            }
            return fallbackValue;
        },

        getUsersSnapshot() {
            const usersRepository = deps.runtime?.repositories?.users || null;
            if (usersRepository?.getAll) {
                return usersRepository.getAll();
            }
            return this.getRuntimeStateValue("users", []);
        },

        getPackagesSnapshot() {
            const packagesRepository = deps.runtime?.repositories?.packages || null;
            if (packagesRepository?.getAll) {
                return packagesRepository.getAll();
            }
            return this.getRuntimeStateValue("packages", []);
        },

        getConfigSnapshot() {
            return deps.runtime?.getConfig?.() || this.getRuntimeStateValue("config", {}) || {};
        },

        buildRegisteredUsernames() {
            return new Set(
                this.getUsersSnapshot()
                    .filter((user) => user.pppoe_username)
                    .map((user) => String(user.pppoe_username).toLowerCase())
            );
        },

        buildProfileToPackageMap() {
            const profileToPackage = {};

            this.getPackagesSnapshot().forEach((pkg) => {
                if (!pkg.profile) {
                    return;
                }

                profileToPackage[String(pkg.profile).toLowerCase()] = {
                    name: pkg.name || pkg.nama || null,
                    price: pkg.price ?? pkg.harga ?? null,
                    profile: pkg.profile
                };
            });

            return profileToPackage;
        },

        buildDeviceIdSet() {
            return new Set(
                this.getUsersSnapshot()
                    .filter((user) => user.device_id)
                    .map((user) => user.device_id)
            );
        }
    };
}

module.exports = {
    createApiNetworkRepository
};
