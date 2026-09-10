/**
 * Header Doc
 * Purpose: Guard deteksi worker-mati/stale otorisasi massal — isJobStale menandai job 'running'
 *   yang heartbeat_at-nya basi > ambang (3×tick, min 60 dtk) tanpa memfitnah job antre/selesai/
 *   yang baru saja berdetak. Endpoint /bulk-approve/log memakai ini agar UI tak "buta" (dulu
 *   'Sedang berjalan' selamanya walau worker mati).
 * Caller: Jest.
 * Deps: ../bulk-approval-job.service (baca global.config.bulkApprovalJob.tickMs).
 * SideEffects: -
 */
"use strict";

const svc = require("../bulk-approval-job.service");

const NOW = Date.parse("2026-09-11T10:00:00.000Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

beforeEach(() => {
    global.config = { bulkApprovalJob: { enabled: true, tickMs: 5000 } };
});
afterEach(() => {
    delete global.config;
});

test("ambang = max(3×tick, 60s); tick 5s → 60s", () => {
    expect(svc.staleThresholdMs()).toBe(60000);
    global.config.bulkApprovalJob.tickMs = 30000; // 3×30s = 90s > 60s
    expect(svc.staleThresholdMs()).toBe(90000);
});

test("running + heartbeat basi (>60s) → stale", () => {
    expect(svc.isJobStale({ status: "running", heartbeat_at: iso(120000) }, NOW)).toBe(true);
});

test("running + heartbeat segar (<60s) → tidak stale", () => {
    expect(svc.isJobStale({ status: "running", heartbeat_at: iso(10000) }, NOW)).toBe(false);
});

test("queued/done/tanpa heartbeat → tidak pernah stale", () => {
    expect(svc.isJobStale({ status: "queued", heartbeat_at: iso(999999) }, NOW)).toBe(false);
    expect(svc.isJobStale({ status: "done", heartbeat_at: iso(999999) }, NOW)).toBe(false);
    expect(svc.isJobStale({ status: "running", heartbeat_at: null }, NOW)).toBe(false);
    expect(svc.isJobStale(null, NOW)).toBe(false);
});
