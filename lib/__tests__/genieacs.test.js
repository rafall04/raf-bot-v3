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
            status: 202,
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
                return Promise.resolve({ status: 202, data: { _id: 'task-ssid' } });
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
            status: 202,
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
            status: 202,
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
                return Promise.resolve({ status: 202, data: { _id: 'refresh-1' } });
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
            status: 202,
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
            return { status: 202, data: { _id: 'task-x' } };
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
            return { status: 202, data: { _id: 'task-x' } };
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
});
