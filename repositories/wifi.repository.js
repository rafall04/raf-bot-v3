/**
 * Header Doc
 * Purpose: Repository WiFi untuk membungkus concern log/history perubahan WiFi pada flow bot/admin Wave 2.
 * Caller: `services/wifi-management.service.js` dan consumer WiFi lain yang butuh write-path log perubahan.
 * Deps: `lib/wifi-logger`.
 * MainFuncs: `createWifiRepository`, `saveWifiNameChange`, `saveWifiPasswordChange`, `saveWebWifiChange`, dan `saveWebWifiChangeByDevice`.
 * SideEffects: Menulis entri log perubahan WiFi melalui adapter logger yang ada.
 */
"use strict";

function sanitizePhone(identifier = "") {
    return String(identifier || "")
        .replace("@s.whatsapp.net", "")
        .replace("@lid", "");
}

function createWifiRepository(options = {}) {
    const logWifiChange = options.logWifiChange || require("../lib/wifi-logger").logWifiChange;
    const buildWebWifiLogPayload = options.buildWebWifiLogPayload || require("../lib/wifi-logger").buildWebWifiLogPayload;

    return {
        async saveWifiNameChange(user, newName, sender, type) {
            return logWifiChange({
                userId: user.id,
                deviceId: user.device_id,
                changeType: "name",
                changes: {
                    oldName: "ada",
                    newName
                },
                changedBy: "customer",
                changeSource: "wa_bot",
                customerName: user.name,
                customerPhone: sanitizePhone(sender),
                reason: `Perubahan nama WiFi melalui WhatsApp Bot (${type})`,
                notes: type === "bulk_auto" ? `Mengubah nama untuk ${user.bulk.length} SSID` : null
            });
        },

        async saveWifiPasswordChange(user, newPassword, sender, type) {
            return logWifiChange({
                userId: user.id,
                deviceId: user.device_id,
                changeType: "password",
                changes: {
                    newPassword
                },
                changedBy: "customer",
                changeSource: "wa_bot",
                customerName: user.name,
                customerPhone: sanitizePhone(sender),
                reason: `Perubahan password WiFi melalui WhatsApp Bot (${type})`,
                notes: type === "bulk_auto" ? `Mengubah password untuk ${user.bulk.length} SSID` : null
            });
        },

        async saveWebWifiChange({ customer, deviceId, payload, currentWifiInfo, staffUser, req, fallbackReason }) {
            const loggingPlan = buildWebWifiLogPayload({
                customer,
                deviceId,
                payload,
                currentWifiInfo,
                staffUser,
                req,
                fallbackReason
            });

            if (loggingPlan.shouldLog) {
                await logWifiChange(loggingPlan.logData);
            }

            return loggingPlan;
        },

        async saveWebWifiChangeByDevice({ userRepository, deviceId, payload, currentWifiInfo, staffUser, req }) {
            const customer = userRepository.findByDeviceId(deviceId);
            const fallbackReason = customer ? "" : `Customer not found for device ${deviceId}`;

            return this.saveWebWifiChange({
                customer,
                deviceId,
                payload,
                currentWifiInfo,
                staffUser,
                req,
                fallbackReason
            });
        }
    };
}

module.exports = {
    createWifiRepository
};
