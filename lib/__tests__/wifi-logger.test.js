const {
    buildWebWifiLogPayload,
    pickCustomerPhone,
    resolveWebWifiChangeSource,
    normalizeLogData
} = require('../wifi-logger');

describe('lib/wifi-logger', () => {
    test('resolveWebWifiChangeSource maps teknisi correctly', () => {
        expect(resolveWebWifiChangeSource('teknisi')).toBe('web_technician');
        expect(resolveWebWifiChangeSource('admin')).toBe('web_admin');
    });

    test('pickCustomerPhone prefers phone_number over legacy phone', () => {
        expect(pickCustomerPhone({
            phone_number: '628123456789@s.whatsapp.net|08123',
            phone: '08123'
        })).toBe('628123456789');
    });

    test('buildWebWifiLogPayload creates admin SSID change log with normalized customer phone', () => {
        const plan = buildWebWifiLogPayload({
            customer: {
                id: 'cust-1',
                name: 'Budi',
                phone_number: '628123456789@s.whatsapp.net',
            },
            deviceId: 'device-1',
            payload: {
                ssid_name: 'Wifi Rumah Baru',
                reason: 'Update dari panel admin'
            },
            currentWifiInfo: {
                ssid_name: 'Wifi Rumah Lama'
            },
            staffUser: {
                username: 'admin1',
                role: 'admin'
            },
            req: {
                ip: '127.0.0.1',
                get: jest.fn(() => 'jest-agent')
            }
        });

        expect(plan.shouldLog).toBe(true);
        expect(plan.changeType).toBe('ssid_name');
        expect(plan.logData.customerPhone).toBe('628123456789');
        expect(plan.logData.changeSource).toBe('web_admin');
        expect(plan.logData.changes.ssidEntries).toHaveLength(1);
    });

    test('buildWebWifiLogPayload creates teknisi password change log', () => {
        const plan = buildWebWifiLogPayload({
            customer: {
                id: 'cust-2',
                name: 'Siti',
                phone_number: '628555111222'
            },
            deviceId: 'device-2',
            payload: {
                ssid_password_2: 'PasswordBaru123'
            },
            currentWifiInfo: {},
            staffUser: {
                username: 'teknisi1',
                role: 'teknisi'
            },
            req: {
                ip: '127.0.0.1',
                get: jest.fn(() => 'jest-agent')
            }
        });

        expect(plan.shouldLog).toBe(true);
        expect(plan.changeType).toBe('password');
        expect(plan.logData.changeSource).toBe('web_technician');
        expect(plan.logData.changes.passwordEntries).toEqual([
            {
                ssidId: '2',
                newValue: 'PasswordBaru123'
            }
        ]);
    });

    test('buildWebWifiLogPayload skips no-op updates', () => {
        const plan = buildWebWifiLogPayload({
            customer: {
                id: 'cust-3',
                name: 'Andi',
                phone_number: '628777000999'
            },
            deviceId: 'device-3',
            payload: {
                ssid_name: 'Sama'
            },
            currentWifiInfo: {
                ssid_name: 'Sama'
            },
            staffUser: {
                username: 'admin2',
                role: 'admin'
            },
            req: {
                ip: '127.0.0.1',
                get: jest.fn(() => 'jest-agent')
            }
        });

        expect(plan.shouldLog).toBe(false);
        expect(plan.skipReason).toBe('no_effective_change');
    });

    test('buildWebWifiLogPayload produces fallback customer markers when customer missing', () => {
        const plan = buildWebWifiLogPayload({
            customer: null,
            deviceId: 'device-4',
            payload: {
                password: 'Baru12345'
            },
            currentWifiInfo: {},
            staffUser: {
                username: 'admin3',
                role: 'admin'
            },
            req: {
                ip: '127.0.0.1',
                get: jest.fn(() => 'jest-agent')
            },
            fallbackReason: 'Customer not found for device device-4'
        });

        expect(plan.shouldLog).toBe(true);
        expect(plan.logData.userId).toBe('unknown');
        expect(plan.logData.customerName).toBe('Unknown Customer');
        expect(plan.logData.customerPhone).toBe('N/A');
        expect(plan.logData.notes).toContain('Customer not found');
    });

    test('normalizeLogData normalizes legacy change source aliases', () => {
        const normalized = normalizeLogData({
            userId: 'cust-5',
            deviceId: 'device-5',
            customerName: 'Test',
            customerPhone: '628000',
            changeType: 'name',
            changes: { newSsidName: 'Baru' },
            changedBy: 'admin',
            changeSource: 'web_teknisi'
        });

        expect(normalized.changeType).toBe('ssid_name');
        expect(normalized.changeSource).toBe('web_technician');
    });
});
