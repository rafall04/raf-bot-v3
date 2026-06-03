/**
 * Header Doc
 * Purpose: Menjadi adapter bot untuk command WiFi dan meneruskan orchestration rename/password ke `services/wifi-management.service.js`.
 * Caller: `message/raf.js` dan state WiFi managed (`conversation-state-handler.js`).
 * Deps: `./conversation-handler` untuk state/template reply, serta `../../services/wifi-management.service.js` sebagai owner orchestration aktif.
 * MainFuncs: `handleGantiNamaWifi`, `handleGantiSandiWifi`, `handleSingleSSIDNameChange`, `handleBulkAutoNameChange`, `handleSingleSSIDPasswordChange`, `handleBulkAutoPasswordChange`, `logWifiNameChange`, `logWifiPasswordChange`.
 * SideEffects: Meneruskan perubahan state/reply ke service WiFi dan mempertahankan signature kompatibel untuk flow state legacy.
 */
"use strict";

const { setUserState, deleteUserState, format } = require("./conversation-handler");
const { createWifiManagementService } = require("../../services/wifi-management.service");

function renderResponseTemplate(key, fallback, data = {}) {
    const rendered = format(key, data);
    return rendered && rendered.trim() ? rendered : fallback;
}

const wifiManagementService = createWifiManagementService();

function withWifiStateHelpers(payload) {
    return {
        ...payload,
        setUserState,
        deleteUserState,
        renderResponseTemplate
    };
}

module.exports = {
    handleGantiNamaWifi(context) {
        return wifiManagementService.handleGantiNamaWifi(withWifiStateHelpers(context));
    },
    handleGantiSandiWifi(context) {
        return wifiManagementService.handleGantiSandiWifi(withWifiStateHelpers(context));
    },
    handleSingleSSIDNameChange(stateKey, user, newName, reply, global, rawSender = null) {
        return wifiManagementService.handleSingleSSIDNameChange(withWifiStateHelpers({
            stateKey,
            user,
            newName,
            reply,
            global,
            rawSender
        }));
    },
    handleBulkAutoNameChange(stateKey, user, newName, reply, global, rawSender = null) {
        return wifiManagementService.handleBulkAutoNameChange(withWifiStateHelpers({
            stateKey,
            user,
            newName,
            reply,
            global,
            rawSender
        }));
    },
    handleSingleSSIDPasswordChange(stateKey, user, newPassword, reply, global, rawSender = null) {
        return wifiManagementService.handleSingleSSIDPasswordChange(withWifiStateHelpers({
            stateKey,
            user,
            newPassword,
            reply,
            global,
            rawSender
        }));
    },
    handleBulkAutoPasswordChange(stateKey, user, newPassword, reply, global, rawSender = null) {
        return wifiManagementService.handleBulkAutoPasswordChange(withWifiStateHelpers({
            stateKey,
            user,
            newPassword,
            reply,
            global,
            rawSender
        }));
    },
    logWifiNameChange(user, newName, sender, type) {
        return wifiManagementService.logWifiNameChange(user, newName, sender, type);
    },
    logWifiPasswordChange(user, newPassword, sender, type) {
        return wifiManagementService.logWifiPasswordChange(user, newPassword, sender, type);
    }
};
