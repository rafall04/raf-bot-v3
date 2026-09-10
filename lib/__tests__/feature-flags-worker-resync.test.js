/**
 * Header Doc
 * Purpose: Guard landmine panel Feature Flags — toggle gate ber-`worker` (bulkApprovalJob) WAJIB
 *   memanggil startBulkApprovalWorker (worker latar hanya distart saat boot; tanpa resync, job
 *   antre selamanya + 409 permanen). Menguji resyncWorkerForFlag: memicu untuk gate worker,
 *   diam untuk gate biasa / key tak dikenal, dan tak melempar bila service tak wajar.
 * Caller: Jest.
 * Deps: ../feature-flags (lazy-require ../../services/bulk-approval-job.service, di-mock).
 * SideEffects: -
 */
"use strict";

jest.mock("../../services/bulk-approval-job.service", () => ({
    startBulkApprovalWorker: jest.fn(),
}));

const svc = require("../../services/bulk-approval-job.service");
const { resyncWorkerForFlag, FEATURE_FLAGS } = require("../feature-flags");

beforeEach(() => {
    svc.startBulkApprovalWorker.mockClear();
});

test("bulkApprovalJob ditandai worker di registri", () => {
    const f = FEATURE_FLAGS.find((x) => x.key === "bulkApprovalJob");
    expect(f && f.worker).toBe("bulkApprovalJob");
});

test("resync gate worker → panggil startBulkApprovalWorker sekali + return true", () => {
    const hit = resyncWorkerForFlag("bulkApprovalJob");
    expect(hit).toBe(true);
    expect(svc.startBulkApprovalWorker).toHaveBeenCalledTimes(1);
});

test("resync gate NON-worker → tak panggil worker + return false", () => {
    const hit = resyncWorkerForFlag("teknisiPrefs");
    expect(hit).toBe(false);
    expect(svc.startBulkApprovalWorker).not.toHaveBeenCalled();
});

test("resync key tak dikenal → false, tak melempar", () => {
    expect(resyncWorkerForFlag("ngawur")).toBe(false);
    expect(svc.startBulkApprovalWorker).not.toHaveBeenCalled();
});
