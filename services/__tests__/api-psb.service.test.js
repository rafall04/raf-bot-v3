/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan service PSB API menjadi owner orchestration awal read-model route PSB.
 * Caller: Jest test runner.
 * Deps: `../api-psb.service`.
 * MainFuncs: Memverifikasi submit/list/detail PSB membaca dan menulis melalui service owner.
 * SideEffects: Tidak ada; dependency dimock in-memory.
 */
"use strict";

const { createApiPsbService } = require("../api-psb.service");

describe("api-psb service", () => {
    test("submitPhase1 validates, writes psb record, and updates snapshot via service owner", async () => {
        const updatePsbRecordsSnapshot = jest.fn((updater) => updater([]));
        const service = createApiPsbService({
            repository: {
                getDb: jest.fn(() => ({ tag: "db" })),
                getConfigSnapshot: jest.fn(() => ({ accessLimit: 5 })),
                getCronConfigSnapshot: jest.fn(() => ({})),
                updatePsbRecordsSnapshot
            },
            validatePhoneNumbers: jest.fn().mockResolvedValue({ valid: true }),
            parseGoogleMapsLink: jest.fn(() => null),
            validateCoordinates: jest.fn(() => true),
            getNextAvailablePSBId: jest.fn().mockResolvedValue(101),
            insertPSBRecord: jest.fn().mockResolvedValue(undefined),
            sendPSBPhase1Notification: jest.fn().mockResolvedValue(undefined),
            logActivity: jest.fn().mockResolvedValue(undefined),
            fs: {
                existsSync: jest.fn(() => false),
                mkdirSync: jest.fn(),
                renameSync: jest.fn(),
                readdirSync: jest.fn(() => []),
                rmdirSync: jest.fn()
            },
            path: require("path"),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.submitPhase1({
            phone_number: "08123",
            name: "Cust Baru",
            address: "Jl. Test",
            ktp_photo_path: "/uploads/psb/2026/04/TEMP_1/ktp_photo.jpg",
            house_photo_path: "/uploads/psb/2026/04/TEMP_1/house_photo.jpg",
            temp_id: "TEMP_1",
            userContext: { id: 1, username: "staff", role: "staff" },
            requestMeta: {
                ipAddress: "127.0.0.1",
                userAgent: "jest",
                baseDir: "C:\\project\\raf-bot-v2"
            }
        });

        expect(service.deps.getNextAvailablePSBId).toHaveBeenCalled();
        expect(service.deps.insertPSBRecord).toHaveBeenCalled();
        expect(updatePsbRecordsSnapshot).toHaveBeenCalled();
        expect(service.deps.sendPSBPhase1Notification).toHaveBeenCalled();
        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Data awal PSB berhasil disimpan",
                data: {
                    customerId: 101,
                    name: "Cust Baru",
                    phone_number: "08123",
                    psb_status: "phase1_completed"
                }
            }
        });
    });

    test("updatePsbStatus updates snapshot and sends teknisi notification via service owner", async () => {
        const updatePsbRecordsSnapshot = jest.fn((updater) => updater([
            { id: 1, name: "Cust 1", psb_status: "phase1_completed" }
        ]));
        const service = createApiPsbService({
            repository: {
                getPsbRecordsSnapshot: jest.fn(() => [{ id: 1, name: "Cust 1", psb_status: "phase1_completed" }]),
                updatePsbRecordsSnapshot
            },
            updatePSBRecord: jest.fn().mockResolvedValue(undefined),
            sendPSBTeknisiMeluncurNotification: jest.fn().mockResolvedValue(undefined),
            logActivity: jest.fn().mockResolvedValue(undefined),
            withLock: jest.fn(async (_key, callback) => callback()),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.updatePsbStatus({
            customerId: 1,
            status: "teknisi_meluncur",
            userContext: { id: 7, username: "tech", role: "staff", name: "Teknisi A" },
            requestMeta: { ipAddress: "127.0.0.1", userAgent: "jest" }
        });

        expect(service.deps.updatePSBRecord).toHaveBeenCalledWith(1, { psb_status: "teknisi_meluncur" });
        expect(service.deps.sendPSBTeknisiMeluncurNotification).toHaveBeenCalled();
        expect(updatePsbRecordsSnapshot).toHaveBeenCalled();
        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Status berhasil diupdate menjadi 'teknisi_meluncur'",
                data: { customerId: 1, status: "teknisi_meluncur" }
            }
        });
    });

    test("submitPhase2 updates psb record and returns installation payload via service owner", async () => {
        const updatePsbRecordsSnapshot = jest.fn((updater) => updater([
            { id: 2, name: "Cust 2", phone_number: "081", psb_status: "phase1_completed", psb_data: {} }
        ]));
        const service = createApiPsbService({
            repository: {
                getPsbRecordsSnapshot: jest.fn(() => [
                    { id: 2, name: "Cust 2", phone_number: "081", psb_status: "phase1_completed", psb_data: {} }
                ]),
                updatePsbRecordsSnapshot
            },
            updatePSBRecord: jest.fn().mockResolvedValue(undefined),
            sendPSBInstallationCompleteNotification: jest.fn().mockResolvedValue(undefined),
            logActivity: jest.fn().mockResolvedValue(undefined),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.submitPhase2({
            customerId: 2,
            installed_odc_id: "ODC-1",
            installed_odp_id: "ODP-1",
            port_number: "3",
            installation_notes: "rapi",
            userContext: { id: 9, username: "staff", role: "staff" },
            requestMeta: { ipAddress: "127.0.0.1", userAgent: "jest" }
        });

        expect(service.deps.updatePSBRecord).toHaveBeenCalled();
        expect(service.deps.sendPSBInstallationCompleteNotification).toHaveBeenCalled();
        expect(updatePsbRecordsSnapshot).toHaveBeenCalled();
        expect(result.status).toBe(200);
        expect(result.body.data).toEqual({
            customerId: 2,
            name: "Cust 2",
            phone_number: "081",
            installed_odc_id: "ODC-1",
            installed_odp_id: "ODP-1",
            port_number: "3"
        });
    });

    test("submitPhase3 provisions user, updates snapshots, and hands off notification via service owner", async () => {
        const updatePsbRecordsSnapshot = jest.fn((updater) => updater([
            {
                id: 3,
                name: "Cust 3",
                phone_number: "082",
                address: "Jl. Fiber",
                latitude: -6.1,
                longitude: 106.8,
                location_url: "https://maps.test",
                odp_id: "ODP-A",
                installed_odp_id: "ODP-B",
                psb_status: "phase2_completed",
                created_at: "2026-04-23T00:00:00.000Z",
                psb_data: {}
            }
        ]));
        const updateUsers = jest.fn((updater) => updater([]));
        const service = createApiPsbService({
            repository: {
                getPsbRecordsSnapshot: jest.fn(() => [
                    {
                        id: 3,
                        name: "Cust 3",
                        phone_number: "082",
                        address: "Jl. Fiber",
                        latitude: -6.1,
                        longitude: 106.8,
                        location_url: "https://maps.test",
                        odp_id: "ODP-A",
                        installed_odp_id: "ODP-B",
                        psb_status: "phase2_completed",
                        created_at: "2026-04-23T00:00:00.000Z",
                        psb_data: {}
                    }
                ]),
                getConfigSnapshot: jest.fn(() => ({ defaultPPPoEPassword: "auto-pass" })),
                updatePsbRecordsSnapshot,
                updateUsers
            },
            addPPPoEUser: jest.fn().mockResolvedValue({ ok: true }),
            assertMikrotikResult: jest.fn(),
            getProfileBySubscription: jest.fn(() => "PROFILE-10M"),
            updatePsbDeviceConfig: jest.fn().mockResolvedValue({ ok: true, accepted: true }),
            getSSIDInfo: jest.fn().mockResolvedValue({ ssid: [{ id: "1", name: "OLD-SSID" }] }),
            updatePSBRecord: jest.fn().mockResolvedValue(undefined),
            movePSBToUsers: jest.fn().mockResolvedValue(77),
            logActivity: jest.fn().mockResolvedValue(undefined),
            logWifiChange: jest.fn().mockResolvedValue(undefined),
            sendPSBPhase2Notification: jest.fn().mockResolvedValue(undefined),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.submitPhase3({
            customerId: 3,
            pppoe_username: "cust3",
            subscription: "Paket 10M",
            device_id: "DEV-3",
            wifi_ssid: "HOME-3",
            wifi_password: "wifi-pass",
            ssid_index: 1,
            userContext: { id: 5, username: "staff", role: "staff" },
            requestMeta: { ipAddress: "127.0.0.1", userAgent: "jest" }
        });

        expect(service.deps.addPPPoEUser).toHaveBeenCalled();
        expect(service.deps.updatePsbDeviceConfig).toHaveBeenCalled();
        expect(service.deps.updatePSBRecord).toHaveBeenCalled();
        expect(service.deps.movePSBToUsers).toHaveBeenCalled();
        expect(updatePsbRecordsSnapshot).toHaveBeenCalled();
        expect(updateUsers).toHaveBeenCalled();
        expect(service.deps.logWifiChange).toHaveBeenCalled();
        expect(service.deps.sendPSBPhase2Notification).toHaveBeenCalled();
        expect(result.status).toBe(200);
        expect(result.body.data).toEqual({
            psbCustomerId: 3,
            finalUserId: 77,
            name: "Cust 3",
            pppoe_username: "cust3",
            pppoe_password: "auto-pass",
            wifi_ssid: "HOME-3",
            wifi_password: "wifi-pass",
            device_id: "DEV-3",
            mikrotikRegistered: true,
            genieacsUpdated: true
        });
    });

    test("deleteAllPsbRecords verifies password, deletes db rows, and clears snapshot via service owner", async () => {
        const service = createApiPsbService({
            repository: {
                getAccountsSnapshot: jest.fn(() => [{ username: "admin", password: "hash" }]),
                getPsbRecordsSnapshot: jest.fn(() => [{ id: 1 }, { id: 2 }]),
                deleteAllPsbRecords: jest.fn().mockResolvedValue(2),
                setPsbRecordsSnapshot: jest.fn()
            },
            comparePassword: jest.fn().mockResolvedValue(true),
            logActivity: jest.fn().mockResolvedValue(undefined),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.deleteAllPsbRecords({
            password: "secret",
            userContext: { id: 1, username: "admin", role: "admin" },
            requestMeta: { ipAddress: "127.0.0.1", userAgent: "jest" }
        });

        expect(service.deps.comparePassword).toHaveBeenCalledWith("secret", "hash");
        expect(service.deps.repository.deleteAllPsbRecords).toHaveBeenCalled();
        expect(service.deps.repository.setPsbRecordsSnapshot).toHaveBeenCalledWith([]);
        expect(service.deps.logActivity).toHaveBeenCalled();
        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Berhasil menghapus 2 data PSB",
                deletedCount: 2
            }
        });
    });

    test("listPsbRecordsByStatus delegates filtering to service owner over repository snapshot", async () => {
        const service = createApiPsbService({
            repository: {
                getPsbRecordsSnapshot: jest.fn(() => [
                    { id: 1, psb_status: "phase1_completed" },
                    { id: 2, psb_status: "completed" }
                ])
            },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.listPsbRecordsByStatus({ status: "completed" });

        expect(result).toEqual({
            status: 200,
            body: {
                status: 200,
                message: "Data customers berhasil diambil",
                data: [{ id: 2, psb_status: "completed" }]
            }
        });
    });

    test("getPsbRecordDetail returns not found when customer record is absent", async () => {
        const service = createApiPsbService({
            repository: {
                getPsbRecordsSnapshot: jest.fn(() => [])
            },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        const result = await service.getPsbRecordDetail({ customerId: 99 });

        expect(result).toEqual({
            status: 404,
            body: {
                status: 404,
                message: "Customer tidak ditemukan di database PSB"
            }
        });
    });
});
