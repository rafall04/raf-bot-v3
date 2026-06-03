jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('axios', () => ({
    get: jest.fn(),
}));

const { EventEmitter } = require('events');
function createMockChildProcess() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn(() => {
        child.emit('close', null, 'SIGTERM');
    });
    return child;
}

describe('lib/mikrotik', () => {
    const ORIGINAL_ENV = process.env;

    function getChildProcessMock() {
        return require('child_process');
    }

    function getAxiosMock() {
        return require('axios');
    }

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env = {
            ...ORIGINAL_ENV,
            IP_MC: '10.10.10.1',
            NAME_MC: 'admin',
            PASSWORD_MC: 'secret',
            PORT_MC: '8728',
            SSL_MC: 'false',
        };
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('getMikrotikConfig supports modern aliases when legacy env is absent', () => {
        delete process.env.IP_MC;
        delete process.env.NAME_MC;
        delete process.env.PASSWORD_MC;
        delete process.env.PORT_MC;
        delete process.env.SSL_MC;
        process.env.MIKROTIK_HOST = '192.168.88.1';
        process.env.MIKROTIK_USER = 'modern-user';
        process.env.MIKROTIK_PASSWORD = 'modern-password';
        process.env.MIKROTIK_PORT = '8729';
        process.env.MIKROTIK_SSL = 'true';

        const { getMikrotikConfig } = require('../mikrotik');
        expect(getMikrotikConfig()).toMatchObject({
            host: '192.168.88.1',
            username: 'modern-user',
            password: '[configured]',
            port: 8729,
            ssl: true,
            valid: true,
            missing: [],
        });
    });

    test('getMikrotikConfig falls back to .env when process env is not exported', () => {
        delete process.env.IP_MC;
        delete process.env.NAME_MC;
        delete process.env.PASSWORD_MC;
        delete process.env.PORT_MC;
        delete process.env.SSL_MC;
        delete process.env.MIKROTIK_HOST;
        delete process.env.MIKROTIK_USER;
        delete process.env.MIKROTIK_PASSWORD;
        delete process.env.MIKROTIK_PORT;
        delete process.env.MIKROTIK_SSL;

        const fs = require('fs');
        jest.spyOn(fs, 'existsSync').mockImplementation((targetPath) => String(targetPath).endsWith('.env'));
        jest.spyOn(fs, 'readFileSync').mockImplementation((targetPath) => {
            if (String(targetPath).endsWith('.env')) {
                return 'IP_MC=192.168.100.1\nNAME_MC=dotenv-user\nPASSWORD_MC=dotenv-pass\nPORT_MC=8799\nSSL_MC=false\n';
            }
            throw new Error(`Unexpected readFileSync path: ${targetPath}`);
        });

        const { getMikrotikConfig } = require('../mikrotik');
        expect(getMikrotikConfig()).toEqual(expect.objectContaining({
            host: '192.168.100.1',
            username: 'dotenv-user',
            password: '[configured]',
            port: 8799,
            ssl: false,
            valid: true,
            missing: [],
        }));
    });

    test('getMikrotikConfig falls back to active device file when env and .env are unavailable', () => {
        delete process.env.IP_MC;
        delete process.env.NAME_MC;
        delete process.env.PASSWORD_MC;
        delete process.env.PORT_MC;
        delete process.env.SSL_MC;
        delete process.env.MIKROTIK_HOST;
        delete process.env.MIKROTIK_USER;
        delete process.env.MIKROTIK_PASSWORD;
        delete process.env.MIKROTIK_PORT;
        delete process.env.MIKROTIK_SSL;

        const fs = require('fs');
        jest.spyOn(fs, 'existsSync').mockImplementation((targetPath) => String(targetPath).endsWith('mikrotik_devices.json'));
        jest.spyOn(fs, 'readFileSync').mockImplementation((targetPath) => {
            if (String(targetPath).endsWith('mikrotik_devices.json')) {
                return JSON.stringify([
                    { id: '1', ip: '10.20.30.40', name: 'device-user', password: 'device-pass', port: '8728', active: true }
                ]);
            }
            throw new Error(`Unexpected readFileSync path: ${targetPath}`);
        });

        const { getMikrotikConfig } = require('../mikrotik');
        expect(getMikrotikConfig()).toEqual(expect.objectContaining({
            host: '10.20.30.40',
            username: 'device-user',
            password: '[configured]',
            port: 8728,
            ssl: false,
            valid: true,
            missing: [],
        }));
    });

    test('isMikrotikSyncEnabled defaults to true and respects false-like config values', () => {
        const { isMikrotikSyncEnabled } = require('../mikrotik');

        expect(isMikrotikSyncEnabled(undefined)).toBe(true);
        expect(isMikrotikSyncEnabled({})).toBe(true);
        expect(isMikrotikSyncEnabled({ sync_to_mikrotik: false })).toBe(false);
        expect(isMikrotikSyncEnabled({ sync_to_mikrotik: 'false' })).toBe(false);
        expect(isMikrotikSyncEnabled({ sync_to_mikrotik: true })).toBe(true);
    });

    test('runPhpMikrotik returns CONFIG_ERROR when configuration is incomplete', async () => {
        delete process.env.IP_MC;
        delete process.env.NAME_MC;
        delete process.env.PASSWORD_MC;
        delete process.env.MIKROTIK_HOST;
        delete process.env.MIKROTIK_USER;
        delete process.env.MIKROTIK_PASSWORD;

        const fs = require('fs');
        jest.spyOn(fs, 'existsSync').mockReturnValue(false);

        const { runPhpMikrotik } = require('../mikrotik');
        const result = await runPhpMikrotik('checkMikrotikConnection', 'check_mikrotik_connection');

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('CONFIG_ERROR');
        expect(result.message).toMatch(/Konfigurasi MikroTik tidak lengkap/);
        expect(getChildProcessMock().spawn).not.toHaveBeenCalled();
    });

    test('runPhpMikrotik maps JSON bridge success into structured result', async () => {
        const child = createMockChildProcess();
        getChildProcessMock().spawn.mockReturnValue(child);

        const { runPhpMikrotik } = require('../mikrotik');
        const promise = runPhpMikrotik('getPPPProfiles', 'get_ppp_profiles');

        setImmediate(() => {
            child.stdout.emit('data', JSON.stringify({
                status: 'success',
                operation: 'getPPPProfiles',
                message: 'Profiles loaded',
                data: { profiles: ['10M', '20M'] },
                error_code: null,
                meta: { source: 'php-bridge' },
            }));
            child.emit('close', 0, null);
        });

        const result = await promise;
        expect(result).toMatchObject({
            ok: true,
            operation: 'getPPPProfiles',
            message: 'Profiles loaded',
            errorCode: null,
            data: { profiles: ['10M', '20M'] },
        });
    });

    test('getActivePPPoEUsers delegates to get_ppp_active_optimized bridge', async () => {
        const child = createMockChildProcess();
        getChildProcessMock().spawn.mockReturnValue(child);

        const { getActivePPPoEUsers } = require('../mikrotik');
        const promise = getActivePPPoEUsers({ caller: 'test' });

        setImmediate(() => {
            child.stdout.emit('data', JSON.stringify({
                status: 'success',
                message: 'Active PPP users loaded',
                data: [{ name: 'cust-1', address: '10.0.0.2', caller_id: 'AA:BB:CC' }],
            }));
            child.emit('close', 0, null);
        });

        const result = await promise;
        expect(getChildProcessMock().spawn).toHaveBeenCalledWith(
            'php',
            expect.arrayContaining([expect.stringContaining('get_ppp_active_optimized.php')]),
            expect.any(Object)
        );
        expect(result).toMatchObject({
            ok: true,
            operation: 'getActivePPPoEUsers',
            data: [{ name: 'cust-1', address: '10.0.0.2', caller_id: 'AA:BB:CC' }],
        });
    });

    test('runPhpMikrotik returns PARSE_ERROR for invalid JSON output', async () => {
        const child = createMockChildProcess();
        getChildProcessMock().spawn.mockReturnValue(child);

        const { runPhpMikrotik } = require('../mikrotik');
        const promise = runPhpMikrotik('getPPPProfiles', 'get_ppp_profiles');

        setImmediate(() => {
            child.stdout.emit('data', 'not-json');
            child.emit('close', 0, null);
        });

        const result = await promise;
        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('PARSE_ERROR');
        expect(result.message).toMatch(/tidak valid/i);
    });

    test('runPhpMikrotik returns TIMEOUT_ERROR when bridge exceeds timeout', async () => {
        jest.useFakeTimers();
        const child = createMockChildProcess();
        child.kill = jest.fn();
        getChildProcessMock().spawn.mockReturnValue(child);

        const { runPhpMikrotik } = require('../mikrotik');
        const promise = runPhpMikrotik('getPPPProfiles', 'get_ppp_profiles', [], { timeoutMs: 25 });

        jest.advanceTimersByTime(30);
        const result = await promise;

        expect(child.kill).toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('TIMEOUT_ERROR');
        jest.useRealTimers();
    });

    test('assertMikrotikResult throws with attached result on failure', () => {
        const { assertMikrotikResult } = require('../mikrotik');
        const failedResult = {
            ok: false,
            message: 'Profile update failed',
            errorCode: 'COMMAND_ERROR',
        };

        expect(() => assertMikrotikResult(failedResult)).toThrow('Profile update failed');
        try {
            assertMikrotikResult(failedResult);
        } catch (error) {
            expect(error.code).toBe('COMMAND_ERROR');
            expect(error.result).toEqual(failedResult);
        }
    });

    test('getvoucher returns structured HTTP result', async () => {
        global.config = { site_url_bot: 'http://localhost' };
        getAxiosMock().get.mockResolvedValue({
            status: 200,
            data: {
                message: 'Voucher created',
                data: { username: 'VC-001' },
            },
        });

        const { getvoucher } = require('../mikrotik');
        const result = await getvoucher('HOTSPOT-1', '62812');

        expect(getAxiosMock().get).toHaveBeenCalledWith(
            'http://localhost/adduserhotspot.php',
            expect.objectContaining({
                params: { profil: 'HOTSPOT-1', komen: '62812' },
                timeout: 15000,
            })
        );
        expect(result).toMatchObject({
            ok: true,
            operation: 'getvoucher',
            data: { username: 'VC-001' },
            message: 'Voucher created',
        });
    });
});
