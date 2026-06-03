/**
 * Purpose: Guardrail test untuk helper persistence request admin yang dipisah dari router legacy.
 * Caller: Jest test runner.
 * Deps: `../admin-request-persistence` dan `../json-store`.
 * MainFuncs: Menguji load/persist request dan auto-cancel package change request expired.
 * SideEffects: Tidak ada.
 */
"use strict";

const mockLoadJSON = jest.fn();
const mockSyncJsonCollection = jest.fn();

jest.mock("../json-store", () => ({
    loadJSON: (...args) => mockLoadJSON(...args),
    syncJsonCollection: (...args) => mockSyncJsonCollection(...args)
}));

const {
    loadApprovalRequests,
    persistApprovalRequests,
    cancelExpiredPackageChangeRequests,
    persistPackageChangeRequests,
    createPackageChangeRequestRecord
} = require("../admin-request-persistence");

describe("admin-request-persistence", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("load/persist approval requests memakai helper JSON store", () => {
        mockLoadJSON.mockReturnValue([{ id: "REQ1" }]);

        expect(loadApprovalRequests()).toEqual([{ id: "REQ1" }]);
        persistApprovalRequests([{ id: "REQ2" }]);

        expect(mockLoadJSON).toHaveBeenCalledWith("requests.json");
        expect(mockSyncJsonCollection).toHaveBeenCalledWith("requests.json", [{ id: "REQ2" }], expect.objectContaining({
            globalKey: "requests"
        }));
    });

    test("auto-cancel request expired mengubah status pending lama", () => {
        const requests = [{
            id: "PKG1",
            status: "pending",
            createdAt: "2020-01-01T00:00:00.000Z",
            notes: ""
        }];

        const changed = cancelExpiredPackageChangeRequests(requests, new Date("2020-01-10T00:00:00.000Z").getTime());

        expect(changed).toBe(true);
        expect(requests[0].status).toBe("cancelled_by_system");
        expect(requests[0].notes).toContain("Auto-cancelled");
    });

    test("createPackageChangeRequestRecord membentuk payload request konsisten", () => {
        const request = createPackageChangeRequestRecord({
            user: { id: 1, name: "User A", phone_number: "0812", subscription: "Basic" },
            requestedPackage: { price: 150000 },
            requester: { id: "admin-1", username: "admin", role: "admin" },
            newPackageName: "Pro",
            notes: "upgrade"
        });

        expect(request).toMatchObject({
            userId: 1,
            requestedPackageName: "Pro",
            requestedPackagePrice: 150000,
            requestedBy: "admin",
            status: "pending",
            notes: "upgrade"
        });
    });

    test("persistPackageChangeRequests memakai helper sync JSON", () => {
        persistPackageChangeRequests([{ id: "PKG2" }]);

        expect(mockSyncJsonCollection).toHaveBeenCalledWith("package_change_requests.json", [{ id: "PKG2" }], expect.objectContaining({
            globalKey: "packageChangeRequests"
        }));
    });
});
