/**
 * Header Doc
 * Purpose: Menjadi owner orchestration domain API network untuk update profile jaringan, read-model import/source export MikroTik, dan handoff notifikasi route `api-network-routes`.
 * Caller: `routes/api-network-routes.js`.
 * Deps: `repositories/api-network.repository.js`, adapter MikroTik/network, gateway/runtime WA, dan delivery service terpusat.
 * MainFuncs: `createApiNetworkService`, `handleNetworkAction`, `sendManualMessage`, `listUnregisteredPppoeSecrets`, `listDevicesForImport`, `listMikrotikExportSources`.
 * SideEffects: Membaca snapshot users/packages/config, memanggil adapter MikroTik/network untuk action/read-model/import aktif, dan mengirim pesan WhatsApp manual via delivery boundary.
 */
"use strict";

const { listMikrotikExportSources } = require("./api-network/list-mikrotik-export-sources");

function defaultDeps() {
    return {
        repository: null,
        updatePPPoEProfile: null,
        assertMikrotikResult: null,
        isMikrotikSyncEnabled: null,
        buildMikrotikSyncResult: null,
        getAllPPPoESecrets: null,
        getPPPProfiles: null,
        getHotspotProfiles: null,
        getDevicesForImport: null,
        sendMessage: null,
        getSocket: null,
        isReady: null,
        logger: console
    };
}

function createApiNetworkService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        deps,

        async handleNetworkAction({ action, username, newProfile } = {}) {
            switch (action) {
                case "update-pppoe-profile": {
                    if (!username || !newProfile) {
                        return {
                            status: 400,
                            body: { message: "Username and new profile are required." }
                        };
                    }

                    const syncEnabled = deps.isMikrotikSyncEnabled(deps.repository.getConfigSnapshot());
                    if (!syncEnabled) {
                        const mikrotikSync = deps.buildMikrotikSyncResult(
                            "applied_locally_sync_disabled",
                            "Sinkronisasi MikroTik sedang dinonaktifkan. Aksi manual tidak diterapkan ke RouterOS."
                        );
                        return {
                            status: 200,
                            body: {
                                message: mikrotikSync.message,
                                sync_policy: "disabled",
                                sync_status: mikrotikSync.status,
                                sync_message: mikrotikSync.message,
                                mikrotik_sync: mikrotikSync
                            }
                        };
                    }

                    try {
                        const result = await deps.updatePPPoEProfile(username, newProfile, { caller: "api.action" });
                        deps.assertMikrotikResult(result);
                        deps.logger.log?.(`Updated PPPoE profile for user ${username} to ${newProfile}`);
                        const mikrotikSync = deps.buildMikrotikSyncResult(
                            "applied",
                            `PPPoE profile updated for ${username} to ${newProfile}`
                        );

                        return {
                            status: 200,
                            body: {
                                message: mikrotikSync.message,
                                result,
                                sync_policy: "enabled",
                                sync_status: mikrotikSync.status,
                                sync_message: mikrotikSync.message,
                                mikrotik_sync: mikrotikSync
                            }
                        };
                    } catch (error) {
                        deps.logger.error?.("Failed to update PPPoE profile:", error);
                        const mikrotikSync = deps.buildMikrotikSyncResult(
                            "failed_sync",
                            error.message || "Failed to update PPPoE profile"
                        );

                        return {
                            status: 500,
                            body: {
                                message: "Failed to update PPPoE profile",
                                sync_policy: "enabled",
                                sync_status: mikrotikSync.status,
                                sync_message: mikrotikSync.message,
                                mikrotik_sync: mikrotikSync
                            }
                        };
                    }
                }
                default:
                    return {
                        status: 400,
                        body: { message: "Invalid action specified." }
                    };
            }
        },

        async sendManualMessage({ id, text } = {}) {
            const socket = deps.getSocket();
            if (!socket) {
                return {
                    status: 200,
                    body: { status: 500, message: "the server is not connected to WhatsApp" }
                };
            }

            try {
                if (id.endsWith("@g.us")) {
                    const groups = Object.entries(await socket.groupFetchAllParticipating()).map((entry) => entry[1]);
                    if (!groups.find((group) => group.id === id)) {
                        return { status: 200, body: { status: 400, message: "Invalid group id" } };
                    }
                } else if (id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net")) {
                    if (!(await socket.onWhatsApp(id))[0]) {
                        return { status: 200, body: { status: 400, message: "Invalid contact id" } };
                    }
                } else {
                    return { status: 200, body: { status: 400, message: "Invalid id" } };
                }

                if (deps.isReady()) {
                    try {
                        const send = await deps.sendMessage(id, { text }, { skipDuplicateCheck: true });
                        return {
                            status: 200,
                            body: {
                                status: 200,
                                message: `Success send message with text ${text}`,
                                result: send.result || send
                            }
                        };
                    } catch (error) {
                        deps.logger.error?.("[SEND_MESSAGE_ERROR]", {
                            recipientId: id,
                            error: error.message
                        });
                        return {
                            status: 200,
                            body: { status: 500, message: `Failed to send message: ${error.message}` }
                        };
                    }
                }

                deps.logger.warn?.("[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to", id);
                return {
                    status: 200,
                    body: { status: 503, message: "WhatsApp connection not available" }
                };
            } catch (error) {
                return {
                    status: 200,
                    body: { status: 500, message: error }
                };
            }
        },

        async listUnregisteredPppoeSecrets() {
            const mikrotikSecretsResult = await deps.getAllPPPoESecrets({ caller: "api.mikrotik.unregistered-pppoe" });
            deps.assertMikrotikResult(mikrotikSecretsResult);

            const mikrotikSecrets = mikrotikSecretsResult.data?.secrets || [];
            if (!mikrotikSecrets || mikrotikSecrets.length === 0) {
                return {
                    status: 200,
                    body: {
                        status: 200,
                        message: "Tidak ada PPPoE secrets di MikroTik",
                        data: [],
                        stats: { total: 0, registered: 0, unregistered: 0 }
                    }
                };
            }

            const registeredUsernames = deps.repository.buildRegisteredUsernames();
            const unregisteredSecrets = mikrotikSecrets.filter((secret) => {
                const username = String(secret.name || "").toLowerCase();
                return username && !registeredUsernames.has(username);
            });

            const profileToPackage = deps.repository.buildProfileToPackageMap();
            const enhancedSecrets = unregisteredSecrets.map((secret) => {
                const profileLower = String(secret.profile || "").toLowerCase();
                const matchedPackage = profileToPackage[profileLower] || null;

                return {
                    ...secret,
                    matchedPackage,
                    packageName: matchedPackage ? matchedPackage.name : null,
                    packagePrice: matchedPackage ? matchedPackage.price : null
                };
            });

            const packages = deps.repository.getPackagesSnapshot();

            return {
                status: 200,
                body: {
                    status: 200,
                    message: `Ditemukan ${enhancedSecrets.length} PPPoE yang belum terdaftar`,
                    data: enhancedSecrets,
                    stats: {
                        total: mikrotikSecrets.length,
                        registered: registeredUsernames.size,
                        unregistered: enhancedSecrets.length
                    },
                    profiles: [...new Set(mikrotikSecrets.map((secret) => secret.profile).filter(Boolean))],
                    packages: packages.map((pkg) => ({
                        name: pkg.name || pkg.nama || null,
                        profile: pkg.profile,
                        price: pkg.price ?? pkg.harga ?? null
                    }))
                }
            };
        },

        async listDevicesForImport() {
            const response = await deps.getDevicesForImport(
                deps.repository.buildDeviceIdSet(),
                {
                    limit: 1000,
                    timeoutMs: 30000,
                    operation: "api.genieacs.devicesForImport"
                }
            );

            if (!response.ok) {
                return {
                    status: 200,
                    body: {
                        status: 200,
                        message: "Tidak ada device di GenieACS",
                        data: []
                    }
                };
            }

            const availableDevices = Array.isArray(response.data) ? response.data : [];
            deps.logger.log?.(
                `[GENIEACS_DEVICES_FOR_IMPORT] Found ${response.stats?.total || 0} devices, ${availableDevices.length} available for import`
            );

            return {
                status: 200,
                body: {
                    status: 200,
                    message: `Ditemukan ${availableDevices.length} device tersedia`,
                    data: availableDevices,
                    stats: response.stats || {
                        total: availableDevices.length,
                        registered: 0,
                        available: availableDevices.length
                    }
                }
            };
        },

        async listMikrotikExportSources(args = {}) {
            return listMikrotikExportSources(deps, args);
        }
    };
}

module.exports = {
    createApiNetworkService
};
