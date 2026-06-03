/**
 * Header Doc
 * Purpose: Menjaga kontrak runtime bootstrap agar wrapper state/repository dan background services tetap kompatibel.
 * Caller: Jest.
 * Deps: `../app-runtime`.
 * MainFuncs: Menguji `createAppRuntime` dan `initializeBackgroundServices`.
 * SideEffects: Memodifikasi `global.__appRuntime` selama test lalu dibersihkan.
 */
"use strict";

jest.mock('../topup-expiry', () => ({
    initTopupExpiryChecker: jest.fn()
}));

jest.mock('../speed-boost-cleanup', () => ({
    scheduleSpeedBoostCleanup: jest.fn()
}));

jest.mock('../../scripts/auto-migrate-on-startup', () => ({
    runAutoMigration: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../temp-cleanup', () => ({}), { virtual: true });

const { createAppRuntime } = require('../app-runtime');
const { initTopupExpiryChecker } = require('../topup-expiry');
const { scheduleSpeedBoostCleanup } = require('../speed-boost-cleanup');
const { runAutoMigration } = require('../../scripts/auto-migrate-on-startup');

describe('app-runtime', () => {
    afterEach(() => {
        delete global.__appRuntime;
        jest.clearAllMocks();
    });

    test('createAppRuntime exposes state and repositories over legacy globals', () => {
        const globalScope = {
            users: [{ id: 1 }],
            packages: [{ id: 'pkg-1' }],
            config: { jwt: 'secret-a' },
            monitoringConfig: { enabled: true },
            db: null,
            io: null
        };

        const runtime = createAppRuntime({
            globalScope,
            config: { nama: 'RAF BOT' },
            dbInitPromise: Promise.resolve()
        });

        expect(runtime.state.get('users')).toEqual([{ id: 1 }]);
        expect(runtime.repositories.packages.getAll()).toEqual([{ id: 'pkg-1' }]);
        expect(runtime.getConfig()).toEqual({ nama: 'RAF BOT' });
        expect(runtime.getMonitoringConfig()).toEqual({ enabled: true });
        expect(runtime.getDb()).toBeNull();
        expect(runtime.getIo()).toBeNull();

        runtime.repositories.users.push({ id: 2 });
        runtime.setConfig({ jwt: 'secret-b' });
        runtime.setMonitoringConfig({ enabled: false });
        runtime.setDb({ close: jest.fn() });
        runtime.setIo({ emit: jest.fn() });

        expect(globalScope.users).toEqual([{ id: 1 }, { id: 2 }]);
        expect(globalScope.config).toEqual({ jwt: 'secret-b' });
        expect(globalScope.monitoringConfig).toEqual({ enabled: false });
        expect(globalScope.db).toEqual({ close: expect.any(Function) });
        expect(globalScope.io).toEqual({ emit: expect.any(Function) });
        expect(globalScope.__appRuntime).toBe(runtime);
    });

    test('getRepository throws for unknown repository key', () => {
        const runtime = createAppRuntime({
            globalScope: {},
            dbInitPromise: Promise.resolve()
        });

        expect(() => runtime.getRepository('missing-repo')).toThrow("Runtime repository 'missing-repo' tidak terdaftar.");
    });

    test('initializeBackgroundServices runs startup hooks once after db init', async () => {
        const initializeAllCronTasks = jest.fn();
        const initializeUploadDirs = jest.fn();
        const startCollector = jest.fn().mockResolvedValue(undefined);
        const startScraper = jest.fn();

        const runtime = createAppRuntime({
            globalScope: {},
            dbInitPromise: Promise.resolve(),
            services: {
                initializeAllCronTasks,
                initializeUploadDirs,
                CustomerTrafficUsageService: { startCollector },
                oltLogScraper: { startScraper }
            }
        });

        await runtime.initializeBackgroundServices();
        await Promise.resolve();
        await Promise.resolve();
        await runtime.initializeBackgroundServices();

        expect(scheduleSpeedBoostCleanup).toHaveBeenCalledTimes(1);
        expect(runAutoMigration).toHaveBeenCalledTimes(1);
        expect(initializeAllCronTasks).toHaveBeenCalledTimes(1);
        expect(initializeUploadDirs).toHaveBeenCalledTimes(1);
        expect(initTopupExpiryChecker).toHaveBeenCalledTimes(1);
        expect(startScraper).toHaveBeenCalledTimes(1);
        expect(startCollector).toHaveBeenCalledTimes(1);
    });
});
