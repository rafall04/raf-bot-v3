/**
 * Header Doc
 * Purpose: Memusatkan business logic observability jaringan dan mutasi WiFi perangkat agar route admin tetap tipis.
 * Caller: `routes/admin-wifi-ops-routes.js`.
 * Deps: adaptor GenieACS/MikroTik, helper WiFi, repository WiFi, dan cache user runtime.
 * MainFuncs: `createNetworkOpsService`, `getGenieAcsStatus`, `getMikrotikStatus`, `getPppStats`, `getHotspotStats`, `getActivePppoeUsers`, `getPppProfiles`, `getCustomerMetricsBatch`, `getDeviceDetails`, `getCustomerRedaman`, `testConfiguredParameter`, `testCustomParameter`, `getCustomerWifiInfo`, `updateCustomerWifi`.
 * SideEffects: Membaca data observability perangkat, membaca konfigurasi parameter GenieACS, dan menulis log perubahan WiFi melalui repository owner bila mutasi berhasil.
 */
"use strict";

const { createRuntimeCacheRepository } = require("../repositories/runtime-cache.repository");
const { createWifiRepository } = require("../repositories/wifi.repository");

function defaultDeps() {
    const runtime = global.__appRuntime || null;
    const runtimeCacheRepository = createRuntimeCacheRepository(runtime);
    return {
        getGenieAcsDiagnostics: require("../lib/genieacs").getGenieAcsDiagnostics,
        getWifiInfo: require("../lib/genieacs").getWifiInfo,
        getMikrotikDiagnostics: require("../lib/mikrotik").getMikrotikDiagnostics,
        getPppStats: require("../lib/mikrotik").getPppStats,
        getHotspotStats: require("../lib/mikrotik").getHotspotStats,
        getActivePPPoEUsers: require("../lib/mikrotik").getActivePPPoEUsers,
        getPPPProfiles: require("../lib/mikrotik").getPPPProfiles,
        assertMikrotikResult: require("../lib/mikrotik").assertMikrotikResult,
        updateWifiSettings: require("../lib/wifi").updateWifiSettings,
        getMultipleDeviceMetrics: require("../lib/wifi").getMultipleDeviceMetrics,
        getParameterValue: require("../lib/genieacs").getParameterValue,
        getParameterValueByPath: require("../lib/genieacs").getParameterValueByPath,
        loadJSON: require("../lib/database").loadJSON,
        userRepository: runtimeCacheRepository.users,
        wifiRepository: createWifiRepository()
    };
}

function buildActorContext(actorCtx = {}) {
    return {
        id: actorCtx.id || null,
        username: actorCtx.username || "system",
        role: actorCtx.role || null
    };
}

function createNetworkOpsService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        async getGenieAcsStatus(actorCtx) {
            const actor = buildActorContext(actorCtx);
            const diagnostic = await deps.getGenieAcsDiagnostics({
                caller: "admin.status-genieacs",
                mode: "basic",
                actor: actor.username
            });
            return {
                status: diagnostic.ok ? 200 : 500,
                message: diagnostic.message,
                connected: diagnostic.ok,
                accepted: diagnostic.accepted,
                applied: diagnostic.applied,
                errorCode: diagnostic.errorCode,
                mode: diagnostic.data?.mode || "basic",
                details: diagnostic.details
            };
        },

        async getMikrotikStatus(actorCtx) {
            const actor = buildActorContext(actorCtx);
            const diagnostic = await deps.getMikrotikDiagnostics({
                caller: "admin.status-mikrotik",
                actor: actor.username
            });
            return {
                status: diagnostic.ok ? 200 : 500,
                message: diagnostic.message,
                connected: diagnostic.ok,
                operation: diagnostic.operation,
                errorCode: diagnostic.errorCode,
                details: diagnostic.details
            };
        },

        async getPppStats(actorCtx) {
            const actor = buildActorContext(actorCtx);
            const result = await deps.getPppStats({
                caller: "admin.api.get_ppp_stats",
                actor: actor.username
            });
            return {
                status: result.ok ? 200 : 500,
                message: result.message,
                data: result.data,
                errorCode: result.errorCode
            };
        },

        async getHotspotStats(actorCtx) {
            const actor = buildActorContext(actorCtx);
            const result = await deps.getHotspotStats({
                caller: "admin.api.get_hotspot_stats",
                actor: actor.username
            });
            return {
                status: result.ok ? 200 : 500,
                message: result.message,
                data: result.data,
                errorCode: result.errorCode
            };
        },

        async getActivePppoeUsers(actorCtx) {
            const actor = buildActorContext(actorCtx);
            const fetchedAt = new Date().toISOString();
            try {
                const result = await deps.getActivePPPoEUsers({
                    caller: "admin.ppp-active-users",
                    actor: actor.username
                });
                return {
                    status: 200,
                    message: result.ok ? "Data PPP aktif berhasil diambil." : (result.message || "Data PPP tidak tersedia saat ini."),
                    data: Array.isArray(result.data) ? result.data : [],
                    error: result.ok !== true,
                    ok: result.ok === true,
                    errorCode: result.errorCode || null,
                    timingMs: result.timingMs || 0,
                    last_updated_at: fetchedAt
                };
            } catch (error) {
                return {
                    status: 200,
                    message: error.message || "Data PPP tidak tersedia saat ini.",
                    data: [],
                    error: true,
                    ok: false,
                    errorCode: error.code || "COMMAND_ERROR",
                    timingMs: 0,
                    last_updated_at: fetchedAt
                };
            }
        },

        async getPppProfiles() {
            try {
                const result = await deps.getPPPProfiles();
                deps.assertMikrotikResult(result);
                const profiles = (result.data || []).map((name) => typeof name === "string" ? { name } : name);
                return {
                    status: 200,
                    message: "Profil PPP berhasil diambil",
                    data: profiles
                };
            } catch (error) {
                return {
                    status: 500,
                    message: "Gagal mengambil profil PPP dari MikroTik",
                    error: error.message
                };
            }
        },

        async getCustomerMetricsBatch({ deviceIds }) {
            const results = await deps.getMultipleDeviceMetrics(deviceIds);
            return {
                status: 200,
                message: "Batch metrics retrieved successfully",
                data: results
            };
        },

        async getDeviceDetails({ deviceId }) {
            const results = await deps.getMultipleDeviceMetrics([deviceId]);
            if (results && results.length > 0) {
                const deviceData = results[0];
                return {
                    status: 200,
                    message: "Device details retrieved successfully",
                    data: {
                        modemType: deviceData.modemType || null,
                        redaman: deviceData.redaman || null,
                        temperature: deviceData.temperature || null,
                        uptime: deviceData.uptime || null,
                        totalConnectedDevices: deviceData.totalConnectedDevices || 0
                    }
                };
            }
            return {
                status: 404,
                message: "Device not found or no data available",
                data: null
            };
        },

        async getCustomerRedaman({ deviceId }) {
            const results = await deps.getMultipleDeviceMetrics([deviceId]);
            if (results && results.length > 0) {
                const deviceData = results[0];
                let redamanValue = null;
                if (deviceData.redaman) {
                    const match = deviceData.redaman.match(/-?\d+\.?\d*/);
                    if (match) {
                        redamanValue = parseFloat(match[0]);
                    }
                }
                return {
                    status: 200,
                    message: redamanValue !== null ? "Data redaman berhasil diambil" : "Data redaman tidak tersedia untuk perangkat ini",
                    data: {
                        redaman: redamanValue,
                        redamanRaw: deviceData.redaman || null
                    }
                };
            }
            return {
                status: 404,
                message: "Device not found or no data available",
                data: { redaman: null }
            };
        },

        async testConfiguredParameter({ deviceId, parameterType }) {
            const parameters = deps.loadJSON("genieacs_parameters.json") || [];
            const paramConfig = parameters.find((item) => item.type === parameterType);
            if (!paramConfig) {
                return {
                    status: 404,
                    message: `No configuration found for parameter type: ${parameterType}`
                };
            }

            const response = await deps.getParameterValue(deviceId, parameterType, {
                timeoutMs: 10000,
                operation: "admin.testParameter"
            });
            if (!response.ok) {
                return {
                    status: 404,
                    message: response.message || "Device not found in GenieACS",
                    data: { value: null, pathFound: null }
                };
            }

            return {
                status: 200,
                message: response.data?.value !== null ? "Parameter found successfully" : "Parameter paths configured but no value found",
                data: {
                    value: response.data?.value ?? null,
                    pathFound: response.data?.pathFound ?? null,
                    deviceId,
                    parameterType,
                    testedPaths: response.data?.testedPaths || paramConfig.paths,
                    valueType: response.data?.valueType ?? null,
                    rawValue: response.data?.rawValue ?? null
                }
            };
        },

        async testCustomParameter({ deviceId, parameterPath }) {
            const response = await deps.getParameterValueByPath(deviceId, parameterPath, {
                timeoutMs: 10000,
                operation: "admin.testParameterCustom"
            });
            if (!response.ok) {
                return {
                    status: 404,
                    message: response.message || "Device not found in GenieACS",
                    data: {
                        value: null,
                        pathFound: null,
                        valueType: null,
                        rawValue: null
                    }
                };
            }

            const message = response.data?.value !== null && response.data?.value !== undefined
                ? `Parameter found successfully at path: ${response.data?.pathFound} (access method: genieacs.getParameterValueByPath)`
                : `Parameter path "${parameterPath}" exists but no value found or value is null`;

            return {
                status: 200,
                message,
                data: {
                    value: response.data?.value ?? null,
                    pathFound: response.data?.pathFound ?? null,
                    valueType: response.data?.valueType ?? null,
                    rawValue: response.data?.rawValue ?? null,
                    deviceId,
                    parameterPath,
                    accessMethod: "genieacs.getParameterValueByPath"
                }
            };
        },

        async getCustomerWifiInfo({ deviceId, skipRefresh }, actorCtx) {
            const actor = buildActorContext(actorCtx);
            try {
                const wifiInfoResult = await deps.getWifiInfo(deviceId, {
                    skipRefresh,
                    context: { caller: "admin.customer-wifi-info", deviceId, actor: actor.username }
                });
                if (!wifiInfoResult.ok) {
                    return {
                        status: 500,
                        message: wifiInfoResult.message,
                        accepted: wifiInfoResult.accepted,
                        applied: wifiInfoResult.applied,
                        errorCode: wifiInfoResult.errorCode
                    };
                }
                return {
                    status: 200,
                    message: wifiInfoResult.message,
                    data: wifiInfoResult.data,
                    accepted: wifiInfoResult.accepted,
                    applied: wifiInfoResult.applied,
                    refreshed: !skipRefresh
                };
            } catch (error) {
                const statusCode = error.response?.status || 500;
                return {
                    status: statusCode,
                    message: error.message || "Terjadi kesalahan internal server."
                };
            }
        },

        async updateCustomerWifi({ deviceId, payload, reqMeta, actorCtx }) {
            const actor = buildActorContext(actorCtx);
            let currentWifiInfo = null;

            try {
                const currentWifiInfoResult = await deps.getWifiInfo(deviceId, {
                    skipRefresh: true,
                    context: { caller: "admin.ssid-update.currentWifi", deviceId, actor: actor.username }
                });
                if (currentWifiInfoResult.ok) {
                    currentWifiInfo = currentWifiInfoResult.data;
                }
            } catch (infoError) {
                console.warn(`[WIFI_LOGGING] Could not get current WiFi info for logging: ${infoError.message}`);
            }

            try {
                const result = await deps.updateWifiSettings(deviceId, payload, {
                    verifyApplied: true,
                    context: { caller: "admin.ssid-update", deviceId, actor: actor.username }
                });

                if (!result.ok) {
                    return {
                        status: 500,
                        message: result.message || "Terjadi masalah saat mengirim perubahan ke perangkat.",
                        accepted: result.accepted,
                        applied: result.applied,
                        errorCode: result.errorCode,
                        details: result.details
                    };
                }

                try {
                    const loggingPlan = await deps.wifiRepository.saveWebWifiChangeByDevice({
                        userRepository: deps.userRepository,
                        deviceId,
                        payload,
                        currentWifiInfo,
                        staffUser: actorCtx,
                        req: {
                            ip: reqMeta.ipAddress,
                            connection: { remoteAddress: reqMeta.ipAddress },
                            headers: { "user-agent": reqMeta.userAgent }
                        }
                    });

                    if (!loggingPlan.shouldLog && loggingPlan.skipReason !== "test") {
                        console.log("[WIFI_LOGGING]", {
                            ...loggingPlan.metadata,
                            logged: false,
                            skipReason: loggingPlan.skipReason
                        });
                    }
                } catch (logError) {
                    console.error("[WIFI_LOGGING] Failed to write WiFi change log:", {
                        deviceId,
                        error: logError.message
                    });
                }

                const statusCode = result.applied === false ? 202 : 200;
                return {
                    status: statusCode,
                    message: result.message,
                    accepted: result.accepted,
                    applied: result.applied,
                    errorCode: result.errorCode,
                    result: result.data || null
                };
            } catch (error) {
                let errorMessage = `Gagal mengirim perubahan SSID untuk device ${deviceId}.`;
                let statusCode = 500;

                if (error.response) {
                    statusCode = error.response.status;
                    if (error.response.data && typeof error.response.data === "string" && error.response.data.toLowerCase().includes("404 not found")) {
                        errorMessage = `Perangkat dengan ID ${deviceId} tidak ditemukan di server manajemen.`;
                        statusCode = 404;
                    } else if (error.response.data && error.response.data.fault) {
                        errorMessage = `Server manajemen perangkat melaporkan kesalahan: ${error.response.data.fault.faultString || "Error tidak diketahui"}`;
                    } else if (error.response.data) {
                        errorMessage = `Server manajemen perangkat merespons dengan error: ${JSON.stringify(error.response.data)}`;
                    } else {
                        errorMessage = `Server manajemen perangkat merespons dengan error ${statusCode}.`;
                    }
                } else if (error.request) {
                    errorMessage = "Tidak ada respons dari server manajemen perangkat. Periksa konektivitas dan status server.";
                } else if (error.message) {
                    errorMessage = error.message;
                }

                return {
                    status: statusCode,
                    message: errorMessage
                };
            }
        }
    };
}

module.exports = {
    createNetworkOpsService
};
