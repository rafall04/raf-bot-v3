/**
 * Header Doc
 * Purpose: Repository admin ops untuk membungkus persistence utility JSON yang masih dipakai service operasional admin.
 * Caller: `services/admin-ops.service.js`.
 * Deps: `lib/database`.
 * MainFuncs: `createAdminOpsRepository`, `getMikrotikDevices`, `deleteMikrotikDeviceById`.
 * SideEffects: Membaca dan menulis file JSON `mikrotik_devices.json` melalui adapter database yang ada.
 */
"use strict";

function createAdminOpsRepository(options = {}) {
    const loadJSON = options.loadJSON || require("../lib/database").loadJSON;
    const saveJSON = options.saveJSON || require("../lib/database").saveJSON;

    return {
        getMikrotikDevices() {
            return loadJSON("mikrotik_devices.json") || [];
        },

        deleteMikrotikDeviceById(id) {
            const devices = this.getMikrotikDevices();
            const nextDevices = devices.filter((device) => String(device.id) !== String(id));
            const deleted = nextDevices.length !== devices.length;

            if (deleted) {
                saveJSON("mikrotik_devices.json", nextDevices);
            }

            return {
                deleted,
                devices: nextDevices
            };
        }
    };
}

module.exports = {
    createAdminOpsRepository
};
