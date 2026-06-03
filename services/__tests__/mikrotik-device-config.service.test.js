/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service konfigurasi device MikroTik mempertahankan persistence JSON dan sinkronisasi active device.
 * Caller: Jest test runner.
 * Deps: `../mikrotik-device-config.service`.
 * MainFuncs: Memverifikasi list/detail/update/set-active device.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createMikrotikDeviceConfigService } = require("../mikrotik-device-config.service");

describe("mikrotik-device-config.service", () => {
    test("list/detail/update/set-active mempertahankan contract legacy", () => {
        let devices = [
            { id: "1", ip: "10.0.0.1", name: "Core", password: "secret", port: "8728", active: true },
            { id: "2", ip: "10.0.0.2", name: "Backup", password: "backup", port: "8729", active: false }
        ];
        let envContent = "IP_MC=10.0.0.1\nNAME_MC=Core\nPASSWORD_MC=secret\nPORT_MC=8728\n";
        const fsMock = {
            existsSync: jest.fn((targetPath) => targetPath.endsWith(".json") || targetPath.endsWith(".env")),
            readFileSync: jest.fn((targetPath) => {
                if (targetPath.endsWith(".json")) {
                    return JSON.stringify(devices);
                }
                return envContent;
            }),
            writeFileSync: jest.fn((targetPath, content) => {
                if (targetPath.endsWith(".json")) {
                    devices = JSON.parse(content);
                    return;
                }
                envContent = content;
            })
        };

        const service = createMikrotikDeviceConfigService({
            fs: fsMock,
            devicesPath: "mikrotik_devices.json",
            envPath: ".env"
        });

        expect(service.listDevices().body).toHaveLength(2);
        expect(service.getDeviceById("1").body).toEqual(expect.objectContaining({ id: "1", port: "8728" }));

        const updated = service.updateDevice("2", { name: "Backup 2", port: "8730" });
        expect(updated.status).toBe(200);
        expect(updated.body.data.name).toBe("Backup 2");

        const activated = service.setActiveDevice("2");
        expect(activated.status).toBe(200);
        expect(devices.find((item) => item.id === "1").active).toBe(false);
        expect(devices.find((item) => item.id === "2").active).toBe(true);
        expect(envContent).toContain("PORT_MC=8730");
    });

    test("monitoring_interface: default ether1, dan sync MONITOR_INTERFACE ke .env saat device aktif", () => {
        let devices = [
            { id: "1", ip: "10.0.0.1", name: "Core", password: "secret", port: "8728", monitoring_interface: "ether1", active: true }
        ];
        let envContent = "IP_MC=10.0.0.1\nNAME_MC=Core\nPASSWORD_MC=secret\nPORT_MC=8728\n";
        const fsMock = {
            existsSync: jest.fn((targetPath) => targetPath.endsWith(".json") || targetPath.endsWith(".env")),
            readFileSync: jest.fn((targetPath) => (targetPath.endsWith(".json") ? JSON.stringify(devices) : envContent)),
            writeFileSync: jest.fn((targetPath, content) => {
                if (targetPath.endsWith(".json")) { devices = JSON.parse(content); return; }
                envContent = content;
            })
        };

        const service = createMikrotikDeviceConfigService({
            fs: fsMock,
            devicesPath: "mikrotik_devices.json",
            envPath: ".env"
        });

        // createDevice tanpa monitoring_interface -> default "ether1"
        const created = service.createDevice({ ip: "10.0.0.9", name: "New", password: "pw" });
        expect(created.body.data.monitoring_interface).toBe("ether1");

        // updateDevice device aktif -> .env dapat MONITOR_INTERFACE baru
        const updated = service.updateDevice("1", { monitoring_interface: "sfp-sfpplus1" });
        expect(updated.body.data.monitoring_interface).toBe("sfp-sfpplus1");
        expect(envContent).toContain("MONITOR_INTERFACE=sfp-sfpplus1");

        // getDeviceById menormalkan device lama tanpa field -> default ether1
        devices.push({ id: "9", ip: "10.0.0.10", name: "Legacy", password: "pw", port: "8728", active: false });
        expect(service.getDeviceById("9").body.monitoring_interface).toBe("ether1");

        // setActiveDevice juga sync MONITOR_INTERFACE
        envContent = envContent.replace(/MONITOR_INTERFACE=.*/g, "");
        service.setActiveDevice("1");
        expect(envContent).toContain("MONITOR_INTERFACE=sfp-sfpplus1");
    });
});
