/**
 * Header Doc
 * Purpose: Memusatkan business logic konfigurasi device MikroTik agar registrar config admin tetap tipis.
 * Caller: `routes/admin-config-routes.js`.
 * Deps: `fs`, `path`, dan `lib/error-handler`.
 * MainFuncs: `createMikrotikDeviceConfigService`, `listDevices`, `getDeviceById`, `createDevice`, `updateDevice`, `setActiveDevice`.
 * SideEffects: Menulis `database/mikrotik_devices.json` dan sinkronisasi `.env` ketika device aktif berubah.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { createError, ErrorTypes } = require("../lib/error-handler");

function defaultDeps() {
    return {
        fs,
        path,
        devicesPath: path.join(__dirname, "..", "database", "mikrotik_devices.json"),
        envPath: path.join(__dirname, "..", ".env")
    };
}

function readDevices(deps) {
    try {
        if (!deps.fs.existsSync(deps.devicesPath)) {
            return [];
        }
        const data = deps.fs.readFileSync(deps.devicesPath, "utf8");
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error("[MIKROTIK_DEVICES] Error reading devices file:", error);
        return [];
    }
}

function writeDevices(deps, devices) {
    deps.fs.writeFileSync(deps.devicesPath, JSON.stringify(devices, null, 2), "utf8");
}

function updateEnvFile(deps, key, value) {
    // .env di-gitignore (tak ikut clone) -> buat baru bila belum ada,
    // jangan ENOENT. File ini tempat sinkronisasi kredensial MikroTik aktif
    // (IP_MC/NAME_MC/PASSWORD_MC/dst) yang dibaca lib/mikrotik.js.
    let envContent = deps.fs.existsSync(deps.envPath)
        ? deps.fs.readFileSync(deps.envPath, "utf8")
        : "";
    const keyRegex = new RegExp(`^${key}=.*$`, "m");

    if (keyRegex.test(envContent)) {
        envContent = envContent.replace(keyRegex, `${key}=${value}`);
    } else {
        if (envContent.length > 0 && !envContent.endsWith("\n")) {
            envContent += "\n";
        }
        envContent += `${key}=${value}`;
    }

    deps.fs.writeFileSync(deps.envPath, envContent, "utf8");
}

function requireDeviceId(deviceId) {
    if (!deviceId) {
        throw createError(ErrorTypes.VALIDATION_ERROR, "Device ID harus diisi", 400, "Missing device ID");
    }
}

function normalizeDevice(device = {}) {
    return {
        id: device.id || "",
        ip: device.ip || "",
        name: device.name || "",
        password: device.password || "",
        port: device.port || "8728",
        monitoring_interface: device.monitoring_interface || "ether1",
        active: device.active || false
    };
}

function createMikrotikDeviceConfigService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        listDevices() {
            return {
                status: 200,
                body: readDevices(deps)
            };
        },

        getDeviceById(deviceId) {
            requireDeviceId(deviceId);

            const devices = readDevices(deps);
            if (!Array.isArray(devices)) {
                return {
                    status: 500,
                    body: {
                        status: 500,
                        message: "Data perangkat tidak valid",
                        error: "Invalid devices data format"
                    }
                };
            }

            const device = devices.find((item) => item && item.id === deviceId);
            if (!device) {
                return {
                    status: 404,
                    body: {
                        status: 404,
                        message: "Perangkat tidak ditemukan",
                        error: "Device not found"
                    }
                };
            }

            return {
                status: 200,
                body: normalizeDevice(device)
            };
        },

        createDevice(input = {}) {
            const devices = readDevices(deps);
            const newDevice = {
                id: String(Date.now()),
                ip: input.ip,
                name: input.name,
                password: input.password,
                port: input.port || "8728",
                monitoring_interface: input.monitoring_interface || "ether1",
                active: false
            };

            devices.push(newDevice);
            writeDevices(deps, devices);

            return {
                status: 201,
                body: {
                    message: "Device added successfully",
                    data: newDevice
                }
            };
        },

        updateDevice(deviceId, input = {}) {
            requireDeviceId(deviceId);

            if (!input || typeof input !== "object") {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: "Data perangkat harus diisi",
                        error: "Missing request body"
                    }
                };
            }

            const devices = readDevices(deps);
            if (!Array.isArray(devices)) {
                return {
                    status: 500,
                    body: {
                        status: 500,
                        message: "Data perangkat tidak valid",
                        error: "Invalid devices data format"
                    }
                };
            }

            const index = devices.findIndex((device) => device && device.id === deviceId);
            if (index === -1) {
                return {
                    status: 404,
                    body: {
                        status: 404,
                        message: "Perangkat tidak ditemukan",
                        error: "Device not found"
                    }
                };
            }

            const updatedDevice = {
                ...devices[index],
                id: deviceId,
                ip: input.ip || devices[index].ip || "",
                name: input.name || devices[index].name || "",
                password: input.password || devices[index].password || "",
                port: input.port || devices[index].port || "8728",
                monitoring_interface: input.monitoring_interface || devices[index].monitoring_interface || "ether1",
                active: devices[index].active || false
            };

            devices[index] = updatedDevice;

            if (updatedDevice.active) {
                try {
                    updateEnvFile(deps, "IP_MC", updatedDevice.ip);
                    updateEnvFile(deps, "NAME_MC", updatedDevice.name);
                    updateEnvFile(deps, "PASSWORD_MC", updatedDevice.password);
                    updateEnvFile(deps, "PORT_MC", updatedDevice.port);
                    updateEnvFile(deps, "MONITOR_INTERFACE", updatedDevice.monitoring_interface);
                } catch (envError) {
                    console.error("[ENV_UPDATE_WARN] Failed to update .env file after editing active device:", envError.message);
                }
            }

            writeDevices(deps, devices);
            return {
                status: 200,
                body: {
                    status: 200,
                    message: "Perangkat berhasil diperbarui",
                    data: updatedDevice
                }
            };
        },

        setActiveDevice(deviceId) {
            requireDeviceId(deviceId);

            const devices = readDevices(deps);
            const index = devices.findIndex((device) => device.id === deviceId);
            if (index === -1) {
                return {
                    status: 404,
                    body: {
                        message: "Device not found"
                    }
                };
            }

            devices.forEach((device, currentIndex) => {
                devices[currentIndex].active = currentIndex === index;
            });

            const activeDevice = devices[index];
            try {
                updateEnvFile(deps, "IP_MC", activeDevice.ip);
                updateEnvFile(deps, "NAME_MC", activeDevice.name);
                updateEnvFile(deps, "PASSWORD_MC", activeDevice.password);
                updateEnvFile(deps, "PORT_MC", activeDevice.port || "8728");
                updateEnvFile(deps, "MONITOR_INTERFACE", activeDevice.monitoring_interface || "ether1");
            } catch (envError) {
                console.error("[ENV_UPDATE_WARN] Failed to update .env file after setting active device:", envError.message);
            }
            writeDevices(deps, devices);

            return {
                status: 200,
                body: {
                    message: "Device set as active successfully"
                }
            };
        }
    };
}

module.exports = {
    createMikrotikDeviceConfigService
};
