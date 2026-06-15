/**
 * Header Doc
 * Purpose: Guardrail test fitur broadcast GAMAS — targeting per segmen, opt-out, dry-run, dan throttle antar pelanggan.
 * Caller: Jest test runner.
 * Deps: `../admin-broadcast.service`.
 * MainFuncs: Memverifikasi resolveTargetUsers, queueBroadcast dengan mode segmen + opt-out + throttle.
 * SideEffects: Tidak ada (semua dependency diinjeksikan via mock).
 */
"use strict";

const {
    createAdminBroadcastService,
    resolveTargetUsers
} = require("../admin-broadcast.service");

const USERS = [
    { id: 1, name: "A", phone_number: "0811", subscription: "20Mbps", connected_odp_id: "ODP-01", odc: "ODC-A", notify_outage: true },
    { id: 2, name: "B", phone_number: "0812", subscription: "20Mbps", connected_odp_id: "ODP-01", odc: "ODC-A", notify_outage: false },
    { id: 3, name: "C", phone_number: "0813", subscription: "50Mbps", connected_odp_id: "ODP-02", odc: "ODC-B" }, // default opt-in
    { id: 4, name: "D", phone_number: "",     subscription: "20Mbps", connected_odp_id: "ODP-01", odc: "ODC-A", notify_outage: 1 }
];

describe("admin-broadcast.service GAMAS", () => {
    test("resolveTargetUsers mode 'odp' menyaring berdasarkan ODP dan exclude opt-out", () => {
        const targets = resolveTargetUsers({
            mode: "odp",
            allUsers: USERS,
            selectedUsers: [],
            filter: "ODP-01"
        });
        expect(targets.map((u) => u.id)).toEqual([1, 4]);
    });

    test("resolveTargetUsers mode 'odp' menghormati forceIncludeOptOut", () => {
        const targets = resolveTargetUsers({
            mode: "odp",
            allUsers: USERS,
            selectedUsers: [],
            filter: "ODP-01",
            forceIncludeOptOut: true
        });
        expect(targets.map((u) => u.id)).toEqual([1, 2, 4]);
    });

    test("resolveTargetUsers mode 'package' filter case-insensitive", () => {
        const targets = resolveTargetUsers({
            mode: "package",
            allUsers: USERS,
            selectedUsers: [],
            filter: "20mbps"
        });
        expect(targets.map((u) => u.id)).toEqual([1, 4]);
    });

    test("resolveTargetUsers mode 'notify_flagged' selalu honor flag walau forceIncludeOptOut", () => {
        const targets = resolveTargetUsers({
            mode: "notify_flagged",
            allUsers: USERS,
            selectedUsers: [],
            forceIncludeOptOut: true
        });
        expect(targets.map((u) => u.id)).toEqual([1, 3, 4]);
    });

    test("resolveTargetUsers mode 'all' default exclude opt-out", () => {
        const targets = resolveTargetUsers({ mode: "all", allUsers: USERS, selectedUsers: [] });
        expect(targets.map((u) => u.id)).toEqual([1, 3, 4]);
    });

    test("previewBroadcast mengembalikan total target & sample tanpa kirim", () => {
        const sendMessageToMany = jest.fn();
        const service = createAdminBroadcastService({
            hasAuthenticatedSession: () => true,
            sendMessageToMany,
            normalizePhoneNumber: (v) => v,
            wait: () => Promise.resolve(),
            randomJitter: () => 0,
            getConfig: () => ({})
        });

        const result = service.previewBroadcast({
            mode: "odp",
            filter: "ODP-01",
            allUsers: USERS
        });
        expect(result.status).toBe(200);
        expect(result.data.total_targets).toBe(2);
        expect(result.data.opt_out_excluded).toBe(1);
        expect(sendMessageToMany).not.toHaveBeenCalled();
    });

    test("queueBroadcast menerapkan throttle wait antar pelanggan & merekam history sukses", async () => {
        const sendMessageToMany = jest.fn().mockResolvedValue({ sent: true, recipients: [] });
        const wait = jest.fn().mockResolvedValue();
        const insertHistory = jest.fn().mockResolvedValue();
        const service = createAdminBroadcastService({
            hasAuthenticatedSession: () => true,
            sendMessageToMany,
            normalizePhoneNumber: (v) => v,
            wait,
            randomJitter: () => 200,
            getConfig: () => ({ messageDelayMs: 1000, jitterMs: 500 }),
            historyRepository: { insertHistory }
        });

        const result = await service.queueBroadcast({
            mode: "odp",
            filter: "ODP-01",
            allUsers: USERS,
            text: "Halo ${nama} ODP ${odp}",
            operator: "admin1"
        });

        expect(result.status).toBe(202);
        expect(result.data.totalTargets).toBe(2);

        // Tunggu Promise async di-finish.
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        // Hanya pelanggan id=1 punya phone; id=4 tidak punya → 1 sukses + 1 failure.
        expect(sendMessageToMany).toHaveBeenCalledTimes(1);
        expect(sendMessageToMany).toHaveBeenCalledWith(["0811"], { text: "Halo A ODP ODP-01" });
        // Throttle dipanggil sekali antar dua pelanggan (bukan setelah pelanggan terakhir).
        expect(wait).toHaveBeenCalledWith(1200);
        expect(insertHistory).toHaveBeenCalledTimes(1);
        const historyEntry = insertHistory.mock.calls[0][0];
        expect(historyEntry).toMatchObject({
            mode: "odp",
            filter: "ODP-01",
            total_targets: 2,
            total_sent: 1,
            total_failed: 1,
            operator: "admin1"
        });
    });

    test("queueBroadcast dryRun tidak mengirim dan tidak menulis history", async () => {
        const sendMessageToMany = jest.fn();
        const insertHistory = jest.fn();
        const service = createAdminBroadcastService({
            hasAuthenticatedSession: () => true,
            sendMessageToMany,
            normalizePhoneNumber: (v) => v,
            wait: () => Promise.resolve(),
            randomJitter: () => 0,
            getConfig: () => ({}),
            historyRepository: { insertHistory }
        });

        const result = await service.queueBroadcast({
            mode: "odp",
            filter: "ODP-01",
            allUsers: USERS,
            text: "Halo ${nama}",
            dryRun: true
        });
        expect(result.status).toBe(200);
        expect(result.data.total_targets).toBe(2);
        expect(sendMessageToMany).not.toHaveBeenCalled();
        expect(insertHistory).not.toHaveBeenCalled();
    });

    test("queueBroadcast menolak segmen 'odp' tanpa filter", async () => {
        const service = createAdminBroadcastService({
            hasAuthenticatedSession: () => true,
            sendMessageToMany: jest.fn(),
            normalizePhoneNumber: (v) => v,
            getConfig: () => ({})
        });
        await expect(service.queueBroadcast({
            mode: "odp",
            allUsers: USERS,
            text: "x"
        })).rejects.toMatchObject({ statusCode: 400 });
    });

    test("queueBroadcast menolak saat text dan templateKey kosong", async () => {
        const service = createAdminBroadcastService({
            hasAuthenticatedSession: () => true,
            sendMessageToMany: jest.fn(),
            normalizePhoneNumber: (v) => v,
            getConfig: () => ({})
        });
        await expect(service.queueBroadcast({
            mode: "all",
            allUsers: USERS,
            text: ""
        })).rejects.toMatchObject({ statusCode: 400 });
    });
});
