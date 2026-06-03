/**
 * Header Doc
 * Purpose: Phase 3 dari workflow create user — sinkronisasi MikroTik berdasarkan registration mode (`new`, `import`, `legacy`/`addToMikrotik`). Untuk mode `new`: add PPPoE user di MikroTik (critical) lalu konfigurasi device GenieACS (WiFi semua SSID + PPPoE) digabung dalam SATU task via `updatePsbDeviceConfig` (1 connection_request, bukan N+1). Untuk mode `import`/`skipMikrotik`/`!syncEnabled` skip dan return `applied_locally_sync_disabled`. Untuk legacy add via flag, panggil `addPPPoEUser` (handle duplikat via errorCode `DUPLICATE`/substring sebagai applied). Memodifikasi `newUser.pppoe_password` jika di-generate baru. Throw critical mikrotik errors untuk propagate ke caller.
 * Caller: `services/api-users/create-user.js` (orchestrator).
 * Deps: `deps.getProfileBySubscription`, `deps.addPPPoEUser`, `deps.assertMikrotikResult`, `deps.buildMikrotikSyncResult`, `deps.getConfig`, `deps.logger`, lazy-require `../../lib/genieacs-helper` (updatePsbDeviceConfig).
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

        // 1. Tambahkan PPPoE user ke MikroTik router (critical — set newUser.pppoe_password bila baru di-generate)
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
                        if (mikrotikError.code === "DUPLICATE" || (mikrotikError.message && mikrotikError.message.includes("sudah ada"))) {
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

        // 2. Konfigurasi device via GenieACS — WiFi (semua SSID) + PPPoE digabung dalam SATU task
        //    (1 connection_request, bukan N+1). Best-effort: kegagalan di-log, tidak fatal.
        //    Gating dipertahankan: WiFi tetap dicoba walau sync MikroTik nonaktif/skip,
        //    sedangkan PPPoE-ke-device hanya saat !skipMikrotik && syncEnabled.
        if (deviceId) {
            const devicePayload = {};
            if (wifiSSID && wifiPassword && ssidIndices.length > 0) {
                devicePayload.wifiSSID = wifiSSID;
                devicePayload.wifiPassword = wifiPassword;
                devicePayload.ssidIndices = ssidIndices;
            }
            if (newUser.pppoe_username && !skipMikrotik && syncEnabled) {
                devicePayload.pppUsername = newUser.pppoe_username;
                devicePayload.pppPassword = newUser.pppoe_password || deps.getConfig().defaultPPPoEPassword || "rafnet123";
            }

            if (Object.keys(devicePayload).length > 0) {
                try {
                    const { updatePsbDeviceConfig } = require("../../lib/genieacs-helper");
                    const deviceResult = await updatePsbDeviceConfig(deviceId, devicePayload, {
                        context: { caller: "api.user-create.new-mode", deviceId }
                    });
                    if (!deviceResult.ok) {
                        throw new Error(deviceResult.message);
                    }
                } catch (deviceError) {
                    deps.logger.error?.("[USER_CREATE_MODE_NEW_ERROR] Failed to apply device config (WiFi/PPPoE) via GenieACS:", deviceError.message);
                }
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
                    if (mikrotikError.code === "DUPLICATE" || (mikrotikError.message && mikrotikError.message.includes("sudah ada"))) {
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
