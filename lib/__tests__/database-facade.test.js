/**
 * Purpose: Guardrail test untuk facade `lib/database.js` setelah internal helper dipecah.
 * Caller: Jest test runner.
 * Deps: `../database` dan helper internal yang dimock.
 * MainFuncs: Memverifikasi kontrak export dan delegasi wrapper lama tetap kompatibel.
 * SideEffects: Tidak ada.
 */
"use strict";

const mockLoadJSON = jest.fn();
const mockSaveJSON = jest.fn();
const mockInitializeConnectionWaypointsTable = jest.fn();
const mockGetConnectionWaypoints = jest.fn();
const mockSaveConnectionWaypoints = jest.fn();
const mockDeleteConnectionWaypoints = jest.fn();
const mockGetAllConnectionWaypoints = jest.fn();
const mockLoadNetworkAssets = jest.fn();
const mockSaveNetworkAssets = jest.fn();
const mockUpdateNetworkAssetsWithLock = jest.fn();
const mockLoadReports = jest.fn();
const mockLoadSpeedRequests = jest.fn();
const mockLoadCompensations = jest.fn();
const mockSetupAnnouncementsAndNewsWatchers = jest.fn();
const mockUpdateOdpPortUsage = jest.fn();
const mockUpdateOdcPortUsage = jest.fn();

jest.mock("../json-store", () => ({
    dbBasePath: "C:/project/raf-bot-v2/database",
    loadJSON: (...args) => mockLoadJSON(...args),
    saveJSON: (...args) => mockSaveJSON(...args)
}));

jest.mock("../waypoints-repository", () => ({
    initializeConnectionWaypointsTable: (...args) => mockInitializeConnectionWaypointsTable(...args),
    getConnectionWaypoints: (...args) => mockGetConnectionWaypoints(...args),
    saveConnectionWaypoints: (...args) => mockSaveConnectionWaypoints(...args),
    deleteConnectionWaypoints: (...args) => mockDeleteConnectionWaypoints(...args),
    getAllConnectionWaypoints: (...args) => mockGetAllConnectionWaypoints(...args)
}));

jest.mock("../network-assets-persistence", () => ({
    loadNetworkAssets: (...args) => mockLoadNetworkAssets(...args),
    saveNetworkAssets: (...args) => mockSaveNetworkAssets(...args),
    updateNetworkAssetsWithLock: (...args) => mockUpdateNetworkAssetsWithLock(...args)
}));

jest.mock("../json-collections-loader", () => ({
    loadReports: (...args) => mockLoadReports(...args),
    loadSpeedRequests: (...args) => mockLoadSpeedRequests(...args),
    loadCompensations: (...args) => mockLoadCompensations(...args),
    setupAnnouncementsAndNewsWatchers: (...args) => mockSetupAnnouncementsAndNewsWatchers(...args)
}));

jest.mock("../port-usage-updater", () => ({
    updateOdpPortUsage: (...args) => mockUpdateOdpPortUsage(...args),
    updateOdcPortUsage: (...args) => mockUpdateOdcPortUsage(...args)
}));

const database = require("../database");

describe("database facade", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("tetap mengekspor kontrak helper utama lama", () => {
        expect(typeof database.loadJSON).toBe("function");
        expect(typeof database.saveJSON).toBe("function");
        expect(typeof database.initializeConnectionWaypointsTable).toBe("function");
        expect(typeof database.updateOdpPortUsage).toBe("function");
    });

    test("mendelegasikan load/save JSON ke json-store", () => {
        mockLoadJSON.mockReturnValue([{ id: 1 }]);

        expect(database.loadJSON("voucher.json")).toEqual([{ id: 1 }]);
        database.saveJSON("voucher.json", [{ id: 2 }]);

        expect(mockLoadJSON).toHaveBeenCalledWith("voucher.json");
        expect(mockSaveJSON).toHaveBeenCalledWith("voucher.json", [{ id: 2 }]);
    });

    test("mendelegasikan waypoint helpers ke repository baru", async () => {
        mockInitializeConnectionWaypointsTable.mockResolvedValue(true);
        mockGetConnectionWaypoints.mockResolvedValue([[1, 2]]);

        await database.initializeConnectionWaypointsTable();
        const result = await database.getConnectionWaypoints("odc-odp", "1", "2");

        expect(mockInitializeConnectionWaypointsTable).toHaveBeenCalled();
        expect(mockGetConnectionWaypoints).toHaveBeenCalledWith("odc-odp", "1", "2");
        expect(result).toEqual([[1, 2]]);
    });

    test("save wrapper lama tetap menulis lewat saveJSON", () => {
        global.reports = [{ id: "r1" }];
        global.voucher = [{ prof: "VC1" }];

        database.saveReports();
        database.saveVoucher();

        expect(mockSaveJSON).toHaveBeenCalledWith("reports.json", [{ id: "r1" }]);
        expect(mockSaveJSON).toHaveBeenCalledWith("voucher.json", [{ prof: "VC1" }]);
    });

    test("mendelegasikan update port usage ke helper baru", () => {
        const assets = [{ id: "odp-1", type: "ODP", ports_used: 0 }];

        database.updateOdpPortUsage("odp-1", true, assets);
        database.updateOdcPortUsage("odc-1", assets);

        expect(mockUpdateOdpPortUsage).toHaveBeenCalledWith("odp-1", true, assets);
        expect(mockUpdateOdcPortUsage).toHaveBeenCalledWith("odc-1", assets);
    });
});
