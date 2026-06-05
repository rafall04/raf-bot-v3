jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('axios', () => ({
    get: jest.fn(),
    post: jest.fn(),
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

    test('M1: keepAlive http/https agents passed to axios.get', async () => {
        global.config = { site_url_bot: 'http://localhost' };
        getAxiosMock().get.mockResolvedValue({ status: 200, data: { data: {} } });

        const { getvoucher } = require('../mikrotik');
        await getvoucher('PROF', 'sender');

        const call = getAxiosMock().get.mock.calls[0][1];
        expect(call.httpAgent).toBeDefined();
        expect(call.httpAgent.keepAlive).toBe(true);
        expect(call.httpsAgent).toBeDefined();
    });

    test('M7: addPPPoEUser passes password via env (MTIN_pw), NOT argv', async () => {
        const child = createMockChildProcess();
        getChildProcessMock().spawn.mockReturnValue(child);

        const { addPPPoEUser } = require('../mikrotik');
        const promise = addPPPoEUser('alice', 'TopSecret!', 'PROFILE_X');

        setImmediate(() => {
            child.stdout.emit('data', JSON.stringify({ status: 'success', data: { username: 'alice' } }));
            child.emit('close', 0, null);
        });

        await promise;

        const [_bin, argv, opts] = getChildProcessMock().spawn.mock.calls[0];
        // Password TIDAK ada di argv — sensitive value pindah ke env.
        expect(argv).toContain('alice');
        expect(argv).toContain('PROFILE_X');
        expect(argv).not.toContain('TopSecret!');
        // argv slot password kosong (placeholder) supaya posisional argv tetap konsisten.
        expect(argv).toContain('');
        // env punya MTIN_pw.
        expect(opts.env.MTIN_pw).toBe('TopSecret!');
    });

    test('M6: addpppoe export dihapus — caller harus pakai addPPPoEUser (direct spawn)', () => {
        // addpppoe (HTTP) menambah overhead axios → Express → php-express → spawn,
        // sementara addPPPoEUser langsung spawn PHP CLI. M6 consolidate ke spawn.
        const mikrotik = require('../mikrotik');
        expect(mikrotik.addpppoe).toBeUndefined();
        expect(typeof mikrotik.addPPPoEUser).toBe('function');
    });

    test('M2: getvoucher does NOT retry on TIMEOUT (non-idempotent — random username)', async () => {
        global.config = { site_url_bot: 'http://localhost', mikrotikRetryAttempts: 3, mikrotikRetryBaseDelayMs: 1 };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock().get.mockRejectedValue(timeoutError);

        const { getvoucher } = require('../mikrotik');
        const result = await getvoucher('PROF', 'sender');

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('TIMEOUT_ERROR');
        // Voucher add tidak boleh diretry — random username = duplicate kalau retry.
        expect(getAxiosMock().get).toHaveBeenCalledTimes(1);
    });

    test('M2: HTTP read op (statusap) retries on TIMEOUT then succeeds', async () => {
        global.config = {
            site_url_bot: 'http://localhost',
            mikrotikRetryAttempts: 3,
            mikrotikRetryBaseDelayMs: 1,
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock().get
            .mockRejectedValueOnce(timeoutError)
            .mockRejectedValueOnce(timeoutError)
            .mockResolvedValueOnce({ status: 200, data: 'OK' });

        const { statusap } = require('../mikrotik');
        const result = await statusap();

        expect(result.ok).toBe(true);
        expect(getAxiosMock().get).toHaveBeenCalledTimes(3);
    });

    test('M2: HTTP read op gives up after exhausting retries on persistent TIMEOUT', async () => {
        global.config = {
            site_url_bot: 'http://localhost',
            mikrotikRetryAttempts: 2,
            mikrotikRetryBaseDelayMs: 1,
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock().get.mockRejectedValue(timeoutError);

        const { statusap } = require('../mikrotik');
        const result = await statusap();

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('TIMEOUT_ERROR');
        expect(getAxiosMock().get).toHaveBeenCalledTimes(2);
    });

    test('M2: circuit breaker opens after threshold consecutive TIMEOUTs', async () => {
        global.config = {
            site_url_bot: 'http://localhost',
            mikrotikCircuitFailureThreshold: 2,
            mikrotikCircuitOpenMs: 60000,
            mikrotikRetryAttempts: 1, // single attempt → setiap call = 1 failure record
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock().get.mockRejectedValue(timeoutError);

        const { getvoucher } = require('../mikrotik');

        // 2 attempt → trip breaker.
        await getvoucher('PROF', 's');
        await getvoucher('PROF', 's');
        expect(getAxiosMock().get).toHaveBeenCalledTimes(2);

        // Attempt ke-3: fail-fast tanpa axios.
        const blocked = await getvoucher('PROF', 's');
        expect(blocked.errorCode).toBe('CIRCUIT_OPEN');
        expect(getAxiosMock().get).toHaveBeenCalledTimes(2);
    });

    test('M2: circuit breaker does NOT trip on COMMAND_ERROR (could be user input bug)', async () => {
        global.config = {
            site_url_bot: 'http://localhost',
            mikrotikCircuitFailureThreshold: 2,
            mikrotikRetryAttempts: 1,
        };
        const httpError = Object.assign(new Error('server fault'), { response: { status: 500 } });
        getAxiosMock().get.mockRejectedValue(httpError);

        const { getvoucher } = require('../mikrotik');

        for (let i = 0; i < 5; i += 1) {
            const r = await getvoucher('PROF', 's');
            expect(r.errorCode).toBe('COMMAND_ERROR');
        }
        // 5 COMMAND_ERROR tidak trip breaker — hanya TIMEOUT_ERROR yang hitung.
        expect(getAxiosMock().get).toHaveBeenCalledTimes(5);
    });

    test('M4: config cached across calls within TTL', () => {
        const fs = require('fs');
        const existsSpy = jest.spyOn(fs, 'existsSync');
        existsSpy.mockReturnValue(false);

        const { getMikrotikConfig } = require('../mikrotik');
        getMikrotikConfig();
        getMikrotikConfig();
        getMikrotikConfig();

        // fs.existsSync hanya dipanggil saat populate cache pertama kali
        // (dipanggil 2x: untuk .env + mikrotik_devices.json).
        expect(existsSpy.mock.calls.length).toBeLessThanOrEqual(2);
    });

    test('M8: concurrent addPPPoEUser untuk username sama serialize via key lock', async () => {
        // Setup: 3 spawn pending, semua resolve setelah delay.
        const inFlight = { count: 0, maxConcurrent: 0 };
        getChildProcessMock().spawn.mockImplementation(() => {
            const child = createMockChildProcess();
            inFlight.count += 1;
            inFlight.maxConcurrent = Math.max(inFlight.maxConcurrent, inFlight.count);
            setImmediate(() => {
                setTimeout(() => {
                    child.stdout.emit('data', JSON.stringify({ status: 'success', data: { username: 'alice' } }));
                    child.emit('close', 0, null);
                    inFlight.count -= 1;
                }, 25);
            });
            return child;
        });

        const { addPPPoEUser } = require('../mikrotik');
        await Promise.all([
            addPPPoEUser('alice', 'p1', 'PROF'),
            addPPPoEUser('alice', 'p2', 'PROF'),
            addPPPoEUser('alice', 'p3', 'PROF'),
        ]);

        // Username sama → satu per satu. maxConcurrent harus 1.
        expect(inFlight.maxConcurrent).toBe(1);
    });

    test('M8: addPPPoEUser untuk username BERBEDA jalan paralel (no false serialization)', async () => {
        const inFlight = { count: 0, maxConcurrent: 0 };
        getChildProcessMock().spawn.mockImplementation(() => {
            const child = createMockChildProcess();
            inFlight.count += 1;
            inFlight.maxConcurrent = Math.max(inFlight.maxConcurrent, inFlight.count);
            setImmediate(() => {
                setTimeout(() => {
                    child.stdout.emit('data', JSON.stringify({ status: 'success', data: {} }));
                    child.emit('close', 0, null);
                    inFlight.count -= 1;
                }, 25);
            });
            return child;
        });

        const { addPPPoEUser } = require('../mikrotik');
        await Promise.all([
            addPPPoEUser('alice', 'p', 'PROF'),
            addPPPoEUser('bob', 'p', 'PROF'),
            addPPPoEUser('charlie', 'p', 'PROF'),
        ]);

        // Beda username → boleh paralel.
        expect(inFlight.maxConcurrent).toBeGreaterThanOrEqual(2);
    });

    test('M9: concurrent addqueue untuk nama sama serialize', async () => {
        global.config = { site_url_bot: 'http://localhost' };
        const inFlight = { count: 0, maxConcurrent: 0 };
        getAxiosMock().get.mockImplementation(async () => {
            inFlight.count += 1;
            inFlight.maxConcurrent = Math.max(inFlight.maxConcurrent, inFlight.count);
            await new Promise((r) => setTimeout(r, 20));
            inFlight.count -= 1;
            return { status: 200, data: { data: {} } };
        });

        const { addqueue } = require('../mikrotik');
        await Promise.all([
            addqueue('prof', 'queue-A', '10.0.0.1', 'parent', '0/0', '10M/10M'),
            addqueue('prof', 'queue-A', '10.0.0.1', 'parent', '0/0', '10M/10M'),
            addqueue('prof', 'queue-A', '10.0.0.1', 'parent', '0/0', '10M/10M'),
        ]);

        expect(inFlight.maxConcurrent).toBe(1);
    });

    test('M9: addqueue untuk nama berbeda jalan paralel', async () => {
        global.config = { site_url_bot: 'http://localhost' };
        const inFlight = { count: 0, maxConcurrent: 0 };
        getAxiosMock().get.mockImplementation(async () => {
            inFlight.count += 1;
            inFlight.maxConcurrent = Math.max(inFlight.maxConcurrent, inFlight.count);
            await new Promise((r) => setTimeout(r, 20));
            inFlight.count -= 1;
            return { status: 200, data: { data: {} } };
        });

        const { addqueue } = require('../mikrotik');
        await Promise.all([
            addqueue('prof', 'queue-A', '10.0.0.1', 'parent', '0/0', '10M/10M'),
            addqueue('prof', 'queue-B', '10.0.0.2', 'parent', '0/0', '10M/10M'),
            addqueue('prof', 'queue-C', '10.0.0.3', 'parent', '0/0', '10M/10M'),
        ]);

        expect(inFlight.maxConcurrent).toBeGreaterThanOrEqual(2);
    });

    test('M4: invalidateMikrotikConfigCache forces re-read', () => {
        const fs = require('fs');
        const existsSpy = jest.spyOn(fs, 'existsSync');
        existsSpy.mockReturnValue(false);

        const { getMikrotikConfig, invalidateMikrotikConfigCache } = require('../mikrotik');
        getMikrotikConfig();
        const callsAfterFirst = existsSpy.mock.calls.length;

        invalidateMikrotikConfigCache();
        getMikrotikConfig();

        // Setelah invalidate, fs.existsSync dipanggil lagi.
        expect(existsSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    });
});
