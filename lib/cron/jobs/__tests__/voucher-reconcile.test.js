"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const { runReconcileOnce } = require("../voucher-reconcile");
const { createVoucherTrackingRepository } = require("../../../../repositories/voucher-tracking.repository");

function tmpRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vr-"));
    return createVoucherTrackingRepository({ dbPath: path.join(dir, "voucher.sqlite") });
}

const LOG = "apr/03/2025-|-01:28:42-|-JDGH4988-|-2500-|-10.10.2.112-|-CA:BF:E9:94:6E:1D-|-1d-|-Paket-1Hari-|-vc-263";

describe("voucher-reconcile runReconcileOnce", () => {
    test("ingest then prune (idempotent ingest, prune ids fetched)", async () => {
        const repo = tmpRepo();
        let removedIds = null;
        const r = await runReconcileOnce({
            getHotspotLogScripts: async () => ({ ok: true, data: { scripts: [{ id: "*1", name: LOG }] } }),
            removeScriptsByIds: async (ids) => { removedIds = ids; return { ok: true, data: { removed: ids.length } }; },
            repository: repo
        });
        expect(r.ok).toBe(true);
        expect(r.found).toBe(1);
        expect(r.ingested).toBe(1);
        expect(r.pruned).toBe(1);
        expect(removedIds).toEqual(["*1"]);
        expect((await repo.getReport({})).aktivasi).toBe(1);
        await repo.close();
    });

    test("no scripts -> no prune", async () => {
        const repo = tmpRepo();
        let called = false;
        const r = await runReconcileOnce({
            getHotspotLogScripts: async () => ({ ok: true, data: { scripts: [] } }),
            removeScriptsByIds: async () => { called = true; return { ok: true, data: { removed: 0 } }; },
            repository: repo
        });
        expect(r.found).toBe(0);
        expect(called).toBe(false);
        await repo.close();
    });

    test("getLogs failure -> ok false, no prune", async () => {
        const repo = tmpRepo();
        let called = false;
        const r = await runReconcileOnce({
            getHotspotLogScripts: async () => ({ ok: false, message: "router down" }),
            removeScriptsByIds: async () => { called = true; return {}; },
            repository: repo
        });
        expect(r.ok).toBe(false);
        expect(called).toBe(false);
        await repo.close();
    });
});
