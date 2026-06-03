/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service wifi/network ops mempertahankan kontrak response dan fallback logging lama.
 * Caller: Jest test runner.
 * Deps: `../network-ops.service`.
 * MainFuncs: Memverifikasi `skipRefresh` diteruskan dan logging repository failure tidak menggagalkan mutasi.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createNetworkOpsService } = require("../network-ops.service");

describe("network-ops.service", () => {
    beforeEach(() => {
        global.users = [{ id: 1, name: "Mbah Uti", device_id: "ONT-1" }];
    });

    test("getCustomerWifiInfo meneruskan skipRefresh ke adaptor GenieACS", async () => {
        const getWifiInfo = jest.fn().mockResolvedValue({
            ok: true,
            message: "ok",
            data: { ssid: [] },
            accepted: true,
            applied: true
        });
        const service = createNetworkOpsService({ getWifiInfo });

        const result = await service.getCustomerWifiInfo({ deviceId: "ONT-1", skipRefresh: true }, { username: "raf" });

        expect(getWifiInfo).toHaveBeenCalledWith("ONT-1", expect.objectContaining({
            skipRefresh: true,
            context: expect.objectContaining({ caller: "admin.customer-wifi-info", actor: "raf" })
        }));
        expect(result.status).toBe(200);
        expect(result.refreshed).toBe(false);
    });

    test("updateCustomerWifi tetap sukses walau fetch current WiFi dan logging gagal", async () => {
        const getWifiInfo = jest.fn().mockRejectedValue(new Error("wifi info unavailable"));
        const updateWifiSettings = jest.fn().mockResolvedValue({
            ok: true,
            message: "accepted",
            accepted: true,
            applied: false,
            errorCode: null,
            data: { updates: [] }
        });
        const saveWebWifiChangeByDevice = jest.fn().mockRejectedValue(new Error("log failed"));
        const service = createNetworkOpsService({
            getWifiInfo,
            updateWifiSettings,
            wifiRepository: { saveWebWifiChangeByDevice }
        });

        const result = await service.updateCustomerWifi({
            deviceId: "ONT-1",
            payload: { ssid: "Baru" },
            reqMeta: { ipAddress: "127.0.0.1", userAgent: "jest" },
            actorCtx: { id: 1, username: "raf", role: "admin" }
        }, { id: 1, username: "raf", role: "admin" });

        expect(getWifiInfo).toHaveBeenCalledWith("ONT-1", expect.objectContaining({
            skipRefresh: true
        }));
        expect(updateWifiSettings).toHaveBeenCalledWith("ONT-1", { ssid: "Baru" }, expect.objectContaining({
            verifyApplied: true
        }));
        expect(saveWebWifiChangeByDevice).toHaveBeenCalled();
        expect(result.status).toBe(202);
        expect(result.applied).toBe(false);
    });

    test("getCustomerMetricsBatch, getDeviceDetails, dan getCustomerRedaman mempertahankan mapping legacy", async () => {
        const getMultipleDeviceMetrics = jest.fn().mockResolvedValue([{
            modemType: "ZTE",
            redaman: "-24.5 dBm",
            temperature: "45C",
            uptime: "1d",
            totalConnectedDevices: 4
        }]);
        const service = createNetworkOpsService({ getMultipleDeviceMetrics });

        const batch = await service.getCustomerMetricsBatch({ deviceIds: ["ONT-1"] });
        const details = await service.getDeviceDetails({ deviceId: "ONT-1" });
        const redaman = await service.getCustomerRedaman({ deviceId: "ONT-1" });

        expect(batch.data).toHaveLength(1);
        expect(details.data).toEqual({
            modemType: "ZTE",
            redaman: "-24.5 dBm",
            temperature: "45C",
            uptime: "1d",
            totalConnectedDevices: 4
        });
        expect(redaman.data).toEqual({
            redaman: -24.5,
            redamanRaw: "-24.5 dBm"
        });
    });

    test("testConfiguredParameter dan testCustomParameter mempertahankan contract debug", async () => {
        const service = createNetworkOpsService({
            loadJSON: jest.fn().mockReturnValue([{ type: "redaman", paths: ["Path.A"] }]),
            getParameterValue: jest.fn().mockResolvedValue({
                ok: true,
                data: {
                    value: "-23.1",
                    pathFound: "Path.A",
                    testedPaths: ["Path.A"],
                    valueType: "string",
                    rawValue: "-23.1"
                }
            }),
            getParameterValueByPath: jest.fn().mockResolvedValue({
                ok: true,
                data: {
                    value: "-23.1",
                    pathFound: "Path.Custom",
                    valueType: "string",
                    rawValue: "-23.1"
                }
            })
        });

        const configured = await service.testConfiguredParameter({ deviceId: "ONT-1", parameterType: "redaman" });
        const custom = await service.testCustomParameter({ deviceId: "ONT-1", parameterPath: "Path.Custom" });

        expect(configured.data).toEqual(expect.objectContaining({
            value: "-23.1",
            pathFound: "Path.A",
            valueType: "string",
            rawValue: "-23.1"
        }));
        expect(custom.data).toEqual(expect.objectContaining({
            value: "-23.1",
            pathFound: "Path.Custom",
            accessMethod: "genieacs.getParameterValueByPath"
        }));
    });
});
