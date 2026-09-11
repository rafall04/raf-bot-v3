/**
 * Header Doc
 * Purpose: Guard lib/config-writer.saveConfigGate — read-modify-write config.json kanonik: baca segar,
 *   mutate hanya subkey sendiri, tulis atomik (via saveConfigAtomic), sync runtime holder, opsional
 *   reinit cron + resync worker; efek samping never-throw.
 * Caller: Jest.
 * Deps: ../config-writer dgn ../env-config, ../cron, ../feature-flags di-mock.
 * SideEffects: -
 */
"use strict";

jest.mock("../env-config", () => {
    let disk = { existing: { keep: 1 }, notifRouting: { enabled: false } };
    return {
        readConfigFresh: jest.fn(() => JSON.parse(JSON.stringify(disk))),
        saveConfigAtomic: jest.fn((cfg) => { disk = JSON.parse(JSON.stringify(cfg)); global.config = cfg; return cfg; }),
        __setDisk: (d) => { disk = d; },
    };
});
jest.mock("../cron", () => ({ initializeAllCronTasks: jest.fn() }));
jest.mock("../feature-flags", () => ({ resyncWorkerForFlag: jest.fn() }));

const envConfig = require("../env-config");
const cron = require("../cron");
const flags = require("../feature-flags");
const { saveConfigGate } = require("../config-writer");

afterEach(() => { jest.clearAllMocks(); delete global.config; });

test("mutate in-place → saveConfigAtomic dipanggil dgn config termutasi; subkey lain terjaga", () => {
    saveConfigGate((cfg) => { cfg.notifRouting.enabled = true; });
    const written = envConfig.saveConfigAtomic.mock.calls[0][0];
    expect(written.notifRouting.enabled).toBe(true);
    expect(written.existing).toEqual({ keep: 1 }); // subkey lain utuh (baca segar)
    expect(global.config.notifRouting.enabled).toBe(true);
});

test("runtime disuntik → setConfig(global.config) dipanggil", () => {
    const runtime = { setConfig: jest.fn() };
    saveConfigGate((cfg) => { cfg.x = 1; }, { runtime });
    expect(runtime.setConfig).toHaveBeenCalledTimes(1);
    expect(runtime.setConfig.mock.calls[0][0]).toBe(global.config);
});

test("reinitCron → initializeAllCronTasks; resyncWorkerKey → resyncWorkerForFlag", () => {
    saveConfigGate((cfg) => { cfg.bulkApprovalJob = { enabled: true }; }, { reinitCron: true, resyncWorkerKey: "bulkApprovalJob" });
    expect(cron.initializeAllCronTasks).toHaveBeenCalledTimes(1);
    expect(flags.resyncWorkerForFlag).toHaveBeenCalledWith("bulkApprovalJob");
});

test("efek samping never-throw: reinit cron lempar → saveConfigGate tetap sukses", () => {
    cron.initializeAllCronTasks.mockImplementationOnce(() => { throw new Error("boom"); });
    expect(() => saveConfigGate((cfg) => { cfg.y = 2; }, { reinitCron: true })).not.toThrow();
    expect(envConfig.saveConfigAtomic).toHaveBeenCalled();
});

test("mutate bukan fungsi → lempar (kontrak jelas)", () => {
    expect(() => saveConfigGate(null)).toThrow(/mutate harus fungsi/);
});
