jest.mock('axios', () => jest.fn());
jest.mock('../database', () => ({
    loadJSON: jest.fn(() => []),
}));

describe('lib/genieacs', () => {
    const originalConfig = global.config;

    function getAxiosMock() {
        return require('axios');
    }

    beforeEach(() => {
        jest.resetModules();
        getAxiosMock().mockReset();
        global.config = {
            genieacsBaseUrl: 'http://genieacs.local:7557',
            genieacsTimeoutMs: 1000,
            genieacsVerifyTimeoutMs: 10,
            genieacsVerifyIntervalMs: 1,
        };
    });

    afterAll(() => {
        global.config = originalConfig;
    });

    test('parseWifiPayload handles password-only payload', () => {
        const { parseWifiPayload } = require('../genieacs');
        const parsed = parseWifiPayload({ ssid_password_2: 'newpass123' });

        expect(parsed.hasChanges).toBe(true);
        expect(parsed.updates).toEqual([{ ssidIndex: '2', password: 'newpass123' }]);
    });

    test('getGenieAcsDiagnostics returns config error when base url is missing', async () => {
        global.config = {};
        const { getGenieAcsDiagnostics } = require('../genieacs');
        const result = await getGenieAcsDiagnostics();

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('CONFIG_ERROR');
    });

    test('getGenieAcsFeatureStatus reports disabled global feature before probing network', async () => {
        global.config = {
            genieacsBaseUrl: 'http://genieacs.local:7557',
            genieacsEnabled: false,
        };
        const { getGenieAcsFeatureStatus } = require('../genieacs');
        const result = await getGenieAcsFeatureStatus({ feature: 'customerReboot', deviceId: 'device-1' });

        expect(result.available).toBe(false);
        expect(result.errorCode).toBe('GENIEACS_DISABLED');
        expect(result.reason).toMatch(/dinonaktifkan/i);
        expect(getAxiosMock()).not.toHaveBeenCalled();
    });

    test('getGenieAcsFeatureStatus requires device id for reboot feature', async () => {
        const { getGenieAcsFeatureStatus } = require('../genieacs');
        const result = await getGenieAcsFeatureStatus({ feature: 'adminReboot' });

        expect(result.available).toBe(false);
        expect(result.errorCode).toBe('DEVICE_ID_REQUIRED');
    });

    test('updateWifiSettings returns accepted result when verification disabled', async () => {
        getAxiosMock().mockResolvedValueOnce({
            status: 200,
            data: { _id: 'task-1' },
        });

        const { updateWifiSettings } = require('../genieacs');
        const result = await updateWifiSettings('device-1', { ssid_password_1: 'newpass123' }, { verifyApplied: false });

        expect(result.ok).toBe(true);
        expect(result.accepted).toBe(true);
        expect(result.applied).toBe(null);
        expect(result.data.taskId).toBe('task-1');
    });

    test('setWifiName verifies applied value', async () => {
        getAxiosMock().mockImplementation(({ method, url }) => {
            if (method === 'post' && url.includes('/tasks?connection_request')) {
                return Promise.resolve({ status: 200, data: { _id: 'task-ssid' } });
            }
            return Promise.resolve({
                status: 200,
                data: [{
                    _id: 'device-1',
                    Device: {
                        WiFi: {
                            SSID: {
                                '3': {
                                    SSID: { _value: 'MySSID' },
                                },
                            },
                        },
                    },
                    InternetGatewayDevice: {
                        LANDevice: {
                            '1': {
                                WLANConfiguration: {
                                    '3': {
                                        SSID: { _value: 'MySSID' },
                                    },
                                },
                            },
                        },
                    },
                }],
            });
        });

        const { setWifiName } = require('../genieacs');
        const result = await setWifiName('device-1', '3', 'MySSID', { verifyApplied: true });

        expect(result.ok).toBe(true);
        expect(result.applied).toBe(true);
        expect(result.data.taskId).toBe('task-ssid');
    });

    test('setPPPoECredentials accepts password changes without plaintext readback', async () => {
        getAxiosMock().mockResolvedValueOnce({
            status: 200,
            data: { _id: 'task-pppoe' },
        });

        const { setPPPoECredentials } = require('../genieacs');
        const result = await setPPPoECredentials('device-1', null, 'secretpass123');

        expect(result.ok).toBe(true);
        expect(result.accepted).toBe(true);
        expect(result.applied).toBe(null);
        expect(result.details.verificationMode).toBe('accept_task_only');
        expect(result.details.unverifiedPaths.length).toBeGreaterThan(0);
    });

    test('setBulkWifiPasswords builds registry-based parameter paths for each SSID', async () => {
        getAxiosMock().mockResolvedValueOnce({
            status: 200,
            data: { _id: 'task-bulk-password' },
        });

        const { setBulkWifiPasswords } = require('../genieacs');
        const result = await setBulkWifiPasswords('device-1', ['1', '5'], 'bulkpass123');

        expect(result.ok).toBe(true);
        expect(result.accepted).toBe(true);
        expect(getAxiosMock()).toHaveBeenCalledWith(expect.objectContaining({
            method: 'post',
            url: 'http://genieacs.local:7557/devices/device-1/tasks?connection_request',
            data: expect.objectContaining({
                parameterValues: expect.arrayContaining([
                    ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey', 'bulkpass123', 'xsd:string'],
                    ['Device.WiFi.AccessPoint.1.Security.KeyPassphrase', 'bulkpass123', 'xsd:string'],
                    ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey', 'bulkpass123', 'xsd:string'],
                    ['Device.WiFi.AccessPoint.5.Security.KeyPassphrase', 'bulkpass123', 'xsd:string'],
                ]),
            }),
        }));
    });

    test('getGenieAcsDiagnostics returns capability matrix for readable device', async () => {
        getAxiosMock().mockImplementation(({ method, params, data }) => {
            if (method === 'get' && !params?.query) {
                return Promise.resolve({ status: 200, data: [{ _id: 'device-1' }] });
            }

            if (method === 'get' && params?.query) {
                return Promise.resolve({
                    status: 200,
                    data: [{
                        _id: 'device-1',
                        Device: {
                            PPP: {
                                Interface: {
                                    '1': {
                                        Username: { _value: 'user123' },
                                    },
                                },
                            },
                            WiFi: {
                                SSID: {
                                    '1': {
                                        SSID: { _value: 'SSID-OK' },
                                    },
                                },
                            },
                        },
                    }],
                });
            }

            if (method === 'post' && data?.name === 'refreshObject') {
                return Promise.resolve({ status: 200, data: { _id: 'refresh-1' } });
            }

            throw new Error('Unexpected axios call');
        });

        const { getGenieAcsDiagnostics } = require('../genieacs');
        const result = await getGenieAcsDiagnostics({ deviceId: 'device-1', mode: 'device-read' });

        expect(result.ok).toBe(true);
        expect(result.data.connected).toBe(true);
        expect(result.data.basicConnected).toBe(true);
        expect(result.data.deviceReadable).toBe(true);
        expect(result.data.wifiCapable).toBe(true);
        expect(result.data.pppoeCapable).toBe(true);
        expect(result.data.mutationCapable).toBe(true);
        expect(result.data.capabilityReady).toBe(true);
        expect(result.data.resolvedPaths.pppoeUsername.length).toBeGreaterThan(0);
    });

    test('getGenieAcsDiagnostics capability mode fails readiness when mutation task is rejected', async () => {
        getAxiosMock().mockImplementation(({ method, params, data }) => {
            if (method === 'get' && !params?.query) {
                return Promise.resolve({ status: 200, data: [{ _id: 'device-1' }] });
            }

            if (method === 'get' && params?.query) {
                return Promise.resolve({
                    status: 200,
                    data: [{
                        _id: 'device-1',
                        Device: {
                            PPP: {
                                Interface: {
                                    '1': {
                                        Username: { _value: 'user123' },
                                    },
                                },
                            },
                            WiFi: {
                                SSID: {
                                    '1': {
                                        SSID: { _value: 'SSID-OK' },
                                    },
                                },
                            },
                        },
                    }],
                });
            }

            if (method === 'post' && data?.name === 'refreshObject') {
                return Promise.reject({ response: { status: 500, data: { message: 'refresh failed' } } });
            }

            throw new Error('Unexpected axios call');
        });

        const { getGenieAcsDiagnostics } = require('../genieacs');
        const result = await getGenieAcsDiagnostics({ deviceId: 'device-1', mode: 'capability' });

        expect(result.ok).toBe(false);
        expect(result.data.basicConnected).toBe(true);
        expect(result.data.deviceReadable).toBe(true);
        expect(result.data.mutationCapable).toBe(false);
        expect(result.data.capabilityReady).toBe(false);
    });

    test('legacy wifi wrapper normalizes reversed argument order', async () => {
        getAxiosMock().mockResolvedValueOnce({
            status: 200,
            data: { _id: 'task-legacy' },
        });

        const { setSSIDName } = require('../wifi');
        const result = await setSSIDName('device-1', 'NamaBaru', '2', { verifyApplied: false });

        expect(result.success).toBe(true);
        expect(getAxiosMock()).toHaveBeenCalledWith(expect.objectContaining({
            method: 'post',
            url: 'http://genieacs.local:7557/devices/device-1/tasks?connection_request',
            data: expect.objectContaining({
                parameterValues: expect.arrayContaining([
                    ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID', 'NamaBaru', 'xsd:string'],
                ]),
            }),
        }));
    });

    test('GET request retries on transient TIMEOUT_ERROR and eventually succeeds', async () => {
        global.config = {
            ...global.config,
            genieacsRetryAttempts: 3,
            genieacsRetryBaseDelayMs: 1, // cepat untuk test
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock()
            .mockRejectedValueOnce(timeoutError)
            .mockRejectedValueOnce(timeoutError)
            .mockResolvedValueOnce({ status: 200, data: [{ _id: 'device-1' }] });

        const { getDeviceById } = require('../genieacs');
        const result = await getDeviceById('device-1');

        expect(result.ok).toBe(true);
        expect(getAxiosMock()).toHaveBeenCalledTimes(3);
    });

    test('GET request gives up after exhausting retries on persistent timeout', async () => {
        global.config = {
            ...global.config,
            genieacsRetryAttempts: 2,
            genieacsRetryBaseDelayMs: 1,
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock().mockRejectedValue(timeoutError);

        const { getDeviceById } = require('../genieacs');
        const result = await getDeviceById('device-1');

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('TIMEOUT_ERROR');
        expect(getAxiosMock()).toHaveBeenCalledTimes(2);
        expect(result.details.attempts).toBe(2);
    });

    test('GET request does NOT retry on AUTH_ERROR (non-transient)', async () => {
        global.config = {
            ...global.config,
            genieacsRetryAttempts: 3,
            genieacsRetryBaseDelayMs: 1,
        };
        const authError = Object.assign(new Error('forbidden'), { response: { status: 401, data: 'denied' } });
        getAxiosMock().mockRejectedValue(authError);

        const { getDeviceById } = require('../genieacs');
        const result = await getDeviceById('device-1');

        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('AUTH_ERROR');
        expect(getAxiosMock()).toHaveBeenCalledTimes(1);
    });

    test('POST submitTask is NOT retried even on TIMEOUT_ERROR', async () => {
        global.config = {
            ...global.config,
            genieacsRetryAttempts: 3,
            genieacsRetryBaseDelayMs: 1,
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock().mockRejectedValue(timeoutError);

        const { rebootDevice } = require('../genieacs');
        const result = await rebootDevice('device-1');

        expect(result.ok).toBe(false);
        // satu attempt saja — POST tidak idempotent.
        expect(getAxiosMock()).toHaveBeenCalledTimes(1);
    });

    test('axios called with keepAlive http/https agents', async () => {
        getAxiosMock().mockResolvedValueOnce({ status: 200, data: [{ _id: 'device-1' }] });

        const { getDeviceById } = require('../genieacs');
        await getDeviceById('device-1');

        const call = getAxiosMock().mock.calls[0][0];
        expect(call.httpAgent).toBeDefined();
        expect(call.httpAgent.keepAlive).toBe(true);
        expect(call.httpsAgent).toBeDefined();
        expect(call.httpsAgent.keepAlive).toBe(true);
    });

    test('concurrent setParameterValues for same deviceId serialize via per-device lock', async () => {
        // Track order: setiap POST submitTask increment counter & catat sequence.
        const inFlight = { count: 0, maxConcurrent: 0 };
        getAxiosMock().mockImplementation(async () => {
            inFlight.count += 1;
            inFlight.maxConcurrent = Math.max(inFlight.maxConcurrent, inFlight.count);
            await new Promise((r) => setTimeout(r, 20));
            inFlight.count -= 1;
            return { status: 200, data: { _id: 'task-x' } };
        });

        const { setParameterValues } = require('../genieacs');
        const params = [['Device.WiFi.SSID.1.SSID', 'name', 'xsd:string']];
        await Promise.all([
            setParameterValues('device-A', params, { verificationMode: 'accept_task_only' }),
            setParameterValues('device-A', params, { verificationMode: 'accept_task_only' }),
            setParameterValues('device-A', params, { verificationMode: 'accept_task_only' }),
        ]);

        // Hanya 1 in-flight at a time karena dilock per-device.
        expect(inFlight.maxConcurrent).toBe(1);
    });

    test('setParameterValues for different deviceIds run in parallel', async () => {
        const inFlight = { count: 0, maxConcurrent: 0 };
        getAxiosMock().mockImplementation(async () => {
            inFlight.count += 1;
            inFlight.maxConcurrent = Math.max(inFlight.maxConcurrent, inFlight.count);
            await new Promise((r) => setTimeout(r, 20));
            inFlight.count -= 1;
            return { status: 200, data: { _id: 'task-x' } };
        });

        const { setParameterValues } = require('../genieacs');
        const params = [['Device.WiFi.SSID.1.SSID', 'name', 'xsd:string']];
        await Promise.all([
            setParameterValues('device-A', params, { verificationMode: 'accept_task_only' }),
            setParameterValues('device-B', params, { verificationMode: 'accept_task_only' }),
            setParameterValues('device-C', params, { verificationMode: 'accept_task_only' }),
        ]);

        // Beda device → boleh paralel.
        expect(inFlight.maxConcurrent).toBeGreaterThanOrEqual(2);
    });

    test('password value in error response is redacted before reaching logs', async () => {
        // Skenario: GenieACS lempar error pendek yang mengandung password (mis. di
        // pesan fault). Sebelum redact, password muncul. Setelah redact, harus
        // diganti [REDACTED] sebelum di-truncate ke log.
        const errorWithPwd = Object.assign(new Error('bad'), {
            response: {
                status: 400,
                data: { msg: 'invalid: SecretPass123!' }, // pendek, [REDACTED] bisa survive truncation
            },
        });
        getAxiosMock().mockRejectedValueOnce(errorWithPwd);

        const { setWifiPassword } = require('../genieacs');
        const result = await setWifiPassword('device-1', '1', 'SecretPass123!');

        expect(result.ok).toBe(false);
        const responseLog = result.details?.response || '';
        expect(responseLog).not.toContain('SecretPass123!');
        expect(responseLog).toContain('[REDACTED]');
    });

    test('password is masked from log even when response is long (truncated)', async () => {
        // Edge case: response besar — minimum guarantee password tidak muncul di log
        // (entah diganti [REDACTED] atau ke-truncate, asal tidak leak utuh).
        const longErrorData = {
            fault: 'cwmp-fault',
            parameterValues: [
                ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey', 'SecretPass123!', 'xsd:string'],
            ],
        };
        const longError = Object.assign(new Error('bad'), { response: { status: 400, data: longErrorData } });
        getAxiosMock().mockRejectedValueOnce(longError);

        const { setWifiPassword } = require('../genieacs');
        const result = await setWifiPassword('device-1', '1', 'SecretPass123!');

        expect(result.details?.response || '').not.toContain('SecretPass123!');
    });

    test('non-sensitive parameter values are NOT redacted', async () => {
        const errorWithEcho = Object.assign(new Error('bad'), {
            response: {
                status: 400,
                data: { parameterValues: [['Device.WiFi.SSID.1.SSID', 'MySSID', 'xsd:string']] },
            },
        });
        getAxiosMock().mockRejectedValueOnce(errorWithEcho);

        const { setWifiName } = require('../genieacs');
        const result = await setWifiName('device-1', '1', 'MySSID', { verifyApplied: false });

        const responseLog = result.details?.response || '';
        // SSID name bukan sensitive — boleh visible di log untuk debugging.
        expect(responseLog).toContain('MySSID');
        expect(responseLog).not.toContain('[REDACTED]');
    });

    test('circuit breaker opens after threshold consecutive transient failures', async () => {
        global.config = {
            ...global.config,
            genieacsCircuitFailureThreshold: 3,
            genieacsCircuitOpenMs: 60000,
            genieacsRetryAttempts: 1, // no retry — supaya 1 fail = 1 attempt
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock().mockRejectedValue(timeoutError);

        const { getDeviceById } = require('../genieacs');

        // 3 attempts pertama tetap nyentuh axios (jadi TIMEOUT_ERROR).
        await getDeviceById('device-1');
        await getDeviceById('device-1');
        await getDeviceById('device-1');

        expect(getAxiosMock()).toHaveBeenCalledTimes(3);

        // Attempt ke-4: breaker open → fail-fast tanpa axios call.
        const blocked = await getDeviceById('device-1');
        expect(blocked.errorCode).toBe('CIRCUIT_OPEN');
        expect(getAxiosMock()).toHaveBeenCalledTimes(3); // tidak bertambah
    });

    test('circuit breaker does NOT trip on non-transient errors (AUTH/NOT_FOUND)', async () => {
        global.config = {
            ...global.config,
            genieacsCircuitFailureThreshold: 2,
            genieacsRetryAttempts: 1,
        };
        const authError = Object.assign(new Error('forbidden'), { response: { status: 401, data: 'denied' } });
        getAxiosMock().mockRejectedValue(authError);

        const { getDeviceById } = require('../genieacs');

        // 5 kali fail dengan AUTH_ERROR — breaker tidak boleh trip.
        for (let i = 0; i < 5; i += 1) {
            const r = await getDeviceById('device-1');
            expect(r.errorCode).toBe('AUTH_ERROR');
        }
        expect(getAxiosMock()).toHaveBeenCalledTimes(5);
    });

    test('circuit breaker transitions to half-open then closes on probe success', async () => {
        global.config = {
            ...global.config,
            genieacsCircuitFailureThreshold: 2,
            genieacsCircuitOpenMs: 50, // cooldown pendek untuk test
            genieacsRetryAttempts: 1,
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        const { getDeviceById } = require('../genieacs');

        // Trip breaker: 2 failure berturut.
        getAxiosMock().mockRejectedValueOnce(timeoutError).mockRejectedValueOnce(timeoutError);
        await getDeviceById('device-1');
        await getDeviceById('device-1');

        // Immediate retry → blocked (open).
        const blocked = await getDeviceById('device-1');
        expect(blocked.errorCode).toBe('CIRCUIT_OPEN');

        // Tunggu cooldown.
        await new Promise((r) => setTimeout(r, 60));

        // Probe lewat — kalau sukses, breaker close.
        getAxiosMock().mockResolvedValueOnce({ status: 200, data: [{ _id: 'device-1' }] });
        const probe = await getDeviceById('device-1');
        expect(probe.ok).toBe(true);

        // Setelah close, request normal lewat tanpa block.
        getAxiosMock().mockResolvedValueOnce({ status: 200, data: [{ _id: 'device-1' }] });
        const normal = await getDeviceById('device-1');
        expect(normal.ok).toBe(true);
    });

    test('circuit breaker can be disabled via config', async () => {
        global.config = {
            ...global.config,
            genieacsCircuitEnabled: false,
            genieacsCircuitFailureThreshold: 2,
            genieacsRetryAttempts: 1,
        };
        const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
        getAxiosMock().mockRejectedValue(timeoutError);

        const { getDeviceById } = require('../genieacs');
        // 10 fail → semua tetap nyentuh axios (no breaker).
        for (let i = 0; i < 10; i += 1) {
            await getDeviceById('device-1');
        }
        expect(getAxiosMock()).toHaveBeenCalledTimes(10);
    });

    test('Basic Auth header included when config provides credentials', async () => {
        global.config = {
            ...global.config,
            genieacsUsername: 'admin',
            genieacsPassword: 'supersecret',
        };
        getAxiosMock().mockResolvedValueOnce({ status: 200, data: [{ _id: 'device-1' }] });

        const { getDeviceById } = require('../genieacs');
        await getDeviceById('device-1');

        const call = getAxiosMock().mock.calls[0][0];
        expect(call.auth).toEqual({ username: 'admin', password: 'supersecret' });
    });

    test('no auth header when config has no username (current production)', async () => {
        // global.config in beforeEach tidak set username → no auth.
        getAxiosMock().mockResolvedValueOnce({ status: 200, data: [{ _id: 'device-1' }] });

        const { getDeviceById } = require('../genieacs');
        await getDeviceById('device-1');

        const call = getAxiosMock().mock.calls[0][0];
        expect(call.auth).toBeUndefined();
    });
});

// INSIDEN Dander 2026-08-07: PPPoE pelanggan terlihat di UI GenieACS tapi bot membacanya kosong,
// karena path config hardcoded `WANConnectionDevice.1` sedangkan modem dgn WAN TR-069 terpisah
// menaruh PPPoE pelanggan di index lain. Pemindai lintas-index wajib menemukannya.
describe('extractPppoeUsernames (pemindai lintas-index)', () => {
    const { extractPppoeUsernames, extractPppoeUsername } = require('../genieacs');

    test('PPPoE di WANConnectionDevice.2 (index non-1) tetap terbaca', () => {
        const device = {
            InternetGatewayDevice: {
                WANDevice: {
                    1: {
                        WANConnectionDevice: {
                            // WAN 1 = jalur TR-069 (IPoE, tanpa PPP) — kosong.
                            1: { WANIPConnection: { 1: {} } },
                            2: { WANPPPConnection: { 1: { Username: { _value: 'wimpi-krajan@rafcybernet' } } } },
                        },
                    },
                },
            },
        };
        expect(extractPppoeUsernames(device)).toEqual(['wimpi-krajan@rafcybernet']);
        expect(extractPppoeUsername(device)).toBe('wimpi-krajan@rafcybernet');
    });

    test('nilai path config (index 1) tetap prioritas pertama; hasil pindai menyusul & dedup', () => {
        const device = {
            InternetGatewayDevice: {
                WANDevice: {
                    1: {
                        WANConnectionDevice: {
                            1: { WANPPPConnection: { 1: { Username: { _value: 'tes@hw' } } } },
                            2: { WANPPPConnection: { 1: { Username: { _value: 'cust@rafcybernet' } } } },
                        },
                    },
                },
            },
        };
        expect(extractPppoeUsernames(device)).toEqual(['tes@hw', 'cust@rafcybernet']);
        expect(extractPppoeUsername(device)).toBe('tes@hw');
    });

    test('pohon Device.PPP.Interface index non-1 + string kosong dibuang', () => {
        const device = {
            Device: {
                PPP: {
                    Interface: {
                        1: { Username: { _value: '   ' } },
                        3: { Username: { _value: 'zte-cust@realm' } },
                    },
                },
            },
        };
        expect(extractPppoeUsernames(device)).toEqual(['zte-cust@realm']);
    });

    test('device tanpa pohon WAN sama sekali → daftar kosong, single null', () => {
        expect(extractPppoeUsernames({ _id: 'x' })).toEqual([]);
        expect(extractPppoeUsername({ _id: 'x' })).toBeNull();
    });
});


// !! Mock POST di suite ATAS sengaja 200, bukan 202. Sejak #b254, 202 = modem TAK MENJAWAB
// (task cuma diantrekan) dan itu dihitung GAGAL. Tes-tes di atas menguji BENTUK payload & mode
// verifikasi, jadi mereka butuh jalur-bahagia yang benar. Godaan yang harus DIHINDARI: membiarkan
// mock 202 lalu melonggarkan assertion jadi `ok:false` — itu menghapus satu-satunya bukti bahwa
// ganti sandi ke modem HIDUP tetap dilaporkan berhasil.
describe('#b254 — vonis queuedOnly di jalur WiFi/PPPoE', () => {
    const axiosMock = () => require('axios');
    const configAsli = global.config;

    beforeEach(() => {
        jest.resetModules();
        axiosMock().mockReset();
        global.config = { genieacsBaseUrl: 'http://genieacs.local:7557', genieacsTimeoutMs: 1000 };
    });
    afterAll(() => { global.config = configAsli; });

    test('HTTP 202 (modem tak menjawab) → ok:false + DEVICE_UNREACHABLE', async () => {
        axiosMock().mockResolvedValue({ status: 202, data: { _id: 'task-q' } });
        const { setWifiCredentials } = require('../genieacs');
        const hasil = await setWifiCredentials('DEV-Q', '1', null, 'sandibaru123');
        expect(hasil.ok).toBe(false);
        expect(hasil.errorCode).toBe('DEVICE_UNREACHABLE');
        expect(hasil.accepted).toBe(true);   // ACS MENERIMA task-nya...
        expect(hasil.applied).toBe(false);   // ...modemnya TIDAK menerapkan
    });

    test('HTTP 200 (modem menerapkan) → tetap ok:true, applied null (sandi tak bisa dibaca balik)', async () => {
        axiosMock().mockResolvedValue({ status: 200, data: { _id: 'task-ok' } });
        const { setWifiCredentials } = require('../genieacs');
        const hasil = await setWifiCredentials('DEV-OK', '1', null, 'sandibaru123');
        expect(hasil.ok).toBe(true);
        expect(hasil.applied).toBeNull();
    });

    test('saklar genieacsQueuedOnlyIsFailure=false mengembalikan perilaku lama', async () => {
        global.config.genieacsQueuedOnlyIsFailure = false;
        axiosMock().mockResolvedValue({ status: 202, data: { _id: 'task-q' } });
        const { setWifiCredentials } = require('../genieacs');
        const hasil = await setWifiCredentials('DEV-Q', '1', null, 'sandibaru123');
        expect(hasil.ok).toBe(true);
    });
});
