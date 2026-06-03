/**
 * Header Doc
 * Purpose: Phase 3 dari workflow create user — sinkronisasi MikroTik berdasarkan registration mode (`new`, `import`, `legacy`/`addToMikrotik`). Untuk mode `new` set WiFi credentials di GenieACS device + add PPPoE user di MikroTik + set PPPoE credentials di device. Untuk mode `import`/`skipMikrotik`/`!syncEnabled` skip dan return `applied_locally_sync_disabled`. Untuk legacy add via flag, panggil `addPPPoEUser` (handle "sudah ada" sebagai applied). Memodifikasi `newUser.pppoe_password` jika di-generate baru. Throw critical mikrotik errors untuk propagate ke caller.
 * Caller: `services/api-users/create-user.js` (orchestrator).
 * Deps: `deps.getProfileBySubscription`, `deps.addPPPoEUser`, `deps.assertMikrotikResult`, `deps.buildMikrotikSyncResult`, `deps.getConfig`, `deps.logger`, lazy-require `../../lib/genieacs-helper` (setWifiCredentials, setPPPoECredentials).
 * MainFuncs: `syncMikrotikForNewUser(deps, { newUser, userData, registrationMode, addToMikrotik, skipMikrotik, syncEnabled })`.
 * SideEffects: GenieACS write (set WiFi/PPPoE credentials di device), MikroTik write (add PPPoE user + profile binding). Best-effort untuk WiFi/device PPPoE (errors di-log, tidak fatal). Critical add PPPoE error throw untuk caller propagate.
 */
"use strict";

async function syncMikrotikForNewUser(deps, { newUser, userData, registrationMode, addToMikrotik, skipMikrotik, syncEnabled }) {
    let mikrotikSync = deps.buildMikrotikSyncResult("skipped_no_pppoe", "Tidak ada sinkronisasi MikroTik yang diperlukan.");

    if (registrationMode === "new") {
        const deviceId = userData.device_id;
        const wifiSSID = userData.wifi_ssid;
        const wifiPassword = userData.wifi_password;
        const ssidIndices = userData.ssid_indices || [];

        if (deviceId && wifiSSID && wifiPassword && ssidIndices.length > 0) {
            try {
                const { setWifiCredentials } = require("../../lib/genieacs-helper");
                for (const ssidIndex of ssidIndices) {
                    const wifiResult = await setWifiCredentials(deviceId, ssidIndex, wifiSSID, wifiPassword, {
                        verifyApplied: false,
                        context: { caller: "api.user-create.new-mode", deviceId, ssidIndex }
                    });
                    if (!wifiResult.ok) {
                        throw new Error(wifiResult.message);
                    }
                }
            } catch (wifiError) {
                deps.logger.error?.("[USER_CREATE_MODE_NEW_ERROR] Failed to set WiFi:", wifiError.message);
            }
        }

        if (newUser.pppoe_username && newUser.subscription && !skipMikrotik) {
            const profile = deps.getProfileBySubscription(newUser.subscription);
            const pppoePassword = newUser.pppoe_password || deps.getConfig().defaultPPPoEPassword || "rafnet123";

            if (profile) {
                if (syncEnabled) {
                    try {
                        const addPppoeResult = await deps.addPPPoEUser(newUser.pppoe_username, pppoePassword, profile, { caller: "api.user-create.new-mode" });
                        deps.assertMikrotikResult(addPppoeResult);
                        if (!newUser.pppoe_password) {
                            newUser.pppoe_password = pppoePassword;
                        }
                        mikrotikSync = deps.buildMikrotikSyncResult("applied", `PPPoE user ${newUser.pppoe_username} berhasil ditambahkan ke MikroTik.`);
                    } catch (mikrotikError) {
                        if (mikrotikError.message && mikrotikError.message.includes("sudah ada")) {
                            mikrotikSync = deps.buildMikrotikSyncResult("applied", `PPPoE user ${newUser.pppoe_username} sudah ada di MikroTik.`);
                        } else {
                            throw new Error(`Gagal menambahkan user ke MikroTik: ${mikrotikError.message}`);
                        }
                    }
                } else {
                    mikrotikSync = deps.buildMikrotikSyncResult("applied_locally_sync_disabled", "Sinkronisasi MikroTik dinonaktifkan. User hanya disimpan lokal.");
                }
            }
        }

        if (deviceId && newUser.pppoe_username && !skipMikrotik && syncEnabled) {
            try {
                const { setPPPoECredentials } = require("../../lib/genieacs-helper");
                const pppoePassword = newUser.pppoe_password || deps.getConfig().defaultPPPoEPassword || "rafnet123";
                const pppoeDeviceResult = await setPPPoECredentials(deviceId, newUser.pppoe_username, pppoePassword, {
                    verifyApplied: false,
                    context: { caller: "api.user-create.new-mode", deviceId }
                });
                if (!pppoeDeviceResult.ok) {
                    throw new Error(pppoeDeviceResult.message);
                }
            } catch (pppoeDeviceError) {
                deps.logger.error?.("[USER_CREATE_MODE_NEW_ERROR] Failed to set PPPoE on device:", pppoeDeviceError.message);
            }
        }
    } else if (registrationMode === "import" || skipMikrotik) {
        if (skipMikrotik || !syncEnabled) {
            mikrotikSync = deps.buildMikrotikSyncResult("applied_locally_sync_disabled", "Sinkronisasi MikroTik dinonaktifkan. User hanya disimpan lokal.");
        }
    } else if (addToMikrotik && newUser.pppoe_username && newUser.pppoe_password && newUser.subscription) {
        const profile = deps.getProfileBySubscription(newUser.subscription);
        if (profile) {
            if (syncEnabled) {
                try {
                    const addPppoeResult = await deps.addPPPoEUser(newUser.pppoe_username, newUser.pppoe_password, profile, { caller: "api.user-create.legacy" });
                    deps.assertMikrotikResult(addPppoeResult);
                    mikrotikSync = deps.buildMikrotikSyncResult("applied", `PPPoE user ${newUser.pppoe_username} berhasil ditambahkan ke MikroTik.`);
                } catch (mikrotikError) {
                    if (mikrotikError.message && mikrotikError.message.includes("sudah ada")) {
                        mikrotikSync = deps.buildMikrotikSyncResult("applied", `PPPoE user ${newUser.pppoe_username} sudah ada di MikroTik.`);
                    } else {
                        throw new Error(`Gagal menambahkan user ke MikroTik: ${mikrotikError.message}`);
                    }
                }
            }
        }
    } else if (!syncEnabled && (registrationMode === "legacy" || registrationMode === "new")) {
        mikrotikSync = deps.buildMikrotikSyncResult("applied_locally_sync_disabled", "Sinkronisasi MikroTik dinonaktifkan. User hanya disimpan lokal.");
    }

    return { mikrotikSync };
}

module.exports = {
    syncMikrotikForNewUser
};
