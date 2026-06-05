/**
 * Test untuk olt-syslog-receiver — fokus ke parser + handler logic.
 * UDP bind/listen tidak di-test di sini (integration concern).
 */

jest.mock('fs', () => {
    const real = jest.requireActual('fs');
    return {
        ...real,
        existsSync: jest.fn(() => false), // no persisted events file
        readFileSync: jest.fn(),
        writeFileSync: jest.fn(),
    };
});

const fs = require('fs');
const { createEventCorrelator } = require('../olt-event-classifier');

describe('lib/olt-syslog-receiver', () => {
    beforeEach(() => {
        fs.writeFileSync.mockClear();
        fs.existsSync.mockClear();
        fs.readFileSync.mockClear();
        fs.existsSync.mockReturnValue(false);
    });

    describe('parseSyslogPacket', () => {
        test('parses RFC 3164 with PRI', () => {
            const { parseSyslogPacket } = require('../olt-syslog-receiver');
            const raw = '<14>Jan 18 14:53:57 OLT-HIOSO EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp';
            const parsed = parseSyslogPacket(raw);
            expect(parsed).toMatchObject({
                priority: 14,
                timestamp: 'Jan 18 14:53:57',
                hostname: 'OLT-HIOSO',
                message: raw,
            });
        });

        test('falls back to loose parse without PRI', () => {
            const { parseSyslogPacket } = require('../olt-syslog-receiver');
            const raw = 'Jan 18 14:53:57 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp';
            const parsed = parseSyslogPacket(raw);
            expect(parsed).toMatchObject({
                priority: null,
                timestamp: 'Jan 18 14:53:57',
                hostname: null,
                message: raw,
            });
        });

        test('returns null for garbage', () => {
            const { parseSyslogPacket } = require('../olt-syslog-receiver');
            expect(parseSyslogPacket('!!@@##')).toBeNull();
            expect(parseSyslogPacket('')).toBeNull();
        });
    });

    describe('packet handler', () => {
        function setupReceiver() {
            const receiver = require('../olt-syslog-receiver');
            const correlator = createEventCorrelator({ source: 'syslog' });
            receiver._setCorrelatorForTest(correlator);
            return { receiver, correlator };
        }

        test('DG packet stores in pending, no event written', () => {
            const { receiver, correlator } = setupReceiver();
            const dg = '<14>Jan 18 14:53:57 OLT EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp';
            receiver._handleMessageForTest(Buffer.from(dg), { address: '10.0.0.5' });

            expect(correlator._state().pendingDgCount).toBe(1);
            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        test('Lost following DG writes DG event to file', () => {
            const { receiver } = setupReceiver();
            const dg = '<14>Jan 18 14:53:57 OLT EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp';
            const lost = '<14>Jan 18 14:53:59 OLT EPON: Slot 0/1/1:4 Onu c0:f6:ec:1e:ff:da[Na] Lost';

            receiver._handleMessageForTest(Buffer.from(dg), { address: '10.0.0.5' });
            receiver._handleMessageForTest(Buffer.from(lost), { address: '10.0.0.5' });

            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            const [filePath, content] = fs.writeFileSync.mock.calls[0];
            expect(filePath).toMatch(/olt-events\.json$/);
            const events = JSON.parse(content);
            expect(events.C0F6EC1EFFDA).toMatchObject({
                mac: 'C0F6EC1EFFDA',
                event_type: 'dying-gasp',
                source: 'syslog',
                correlated_with_dg: true,
                received_from: '10.0.0.5',
            });
        });

        test('Lost alone writes LOS event', () => {
            const { receiver } = setupReceiver();
            const lost = '<14>Jan 18 14:53:59 OLT EPON: Slot 0/1/1:4 Onu c0:f6:ec:1e:ff:da[Na] Lost';
            receiver._handleMessageForTest(Buffer.from(lost), { address: '10.0.0.5' });

            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            const events = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
            expect(events.C0F6EC1EFFDA.event_type).toBe('los');
            expect(events.C0F6EC1EFFDA.correlated_with_dg).toBe(false);
        });

        test('offline event carries confidence + signals (rxPower neutral when no history)', () => {
            const { receiver } = setupReceiver();
            const lost = '<14>Jan 18 14:53:59 OLT EPON: Slot 0/1/1:4 Onu c0:f6:ec:1e:ff:da[Na] Lost';
            receiver._handleMessageForTest(Buffer.from(lost), { address: '10.0.0.5' });

            const events = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
            const ev = events.C0F6EC1EFFDA;
            // Tanpa rxPower history → base LOS confidence 0.6, hanya syslog signal.
            expect(ev.classification_confidence).toBe(0.6);
            expect(Array.isArray(ev.signals)).toBe(true);
            expect(ev.signals[0].source).toBe('syslog');
        });

        test('LOS confidence boosted when rxPower history shows decline', () => {
            const rxHistory = require('../olt-rxpower-history');
            rxHistory.clearAll();
            const now = Date.now();
            // Declining trend before offline → LOS hint.
            rxHistory.recordSample('C0F6EC1EFFDA', -20, now - 180000);
            rxHistory.recordSample('C0F6EC1EFFDA', -24, now - 120000);
            rxHistory.recordSample('C0F6EC1EFFDA', -28, now - 30000);

            const { receiver } = setupReceiver();
            const lost = '<14>Jan 18 14:53:59 OLT EPON: Slot 0/1/1:4 Onu c0:f6:ec:1e:ff:da[Na] Lost';
            receiver._handleMessageForTest(Buffer.from(lost), { address: '10.0.0.5' });

            const events = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
            const ev = events.C0F6EC1EFFDA;
            // 0.6 base + 0.25 (declining LOS agree) = 0.85
            expect(ev.classification_confidence).toBeGreaterThan(0.6);
            expect(ev.signals.some((s) => s.source === 'rxpower' && s.hint === 'los')).toBe(true);
            rxHistory.clearAll();
        });

        test('Discovery (recovery) writes discovery event', () => {
            const { receiver } = setupReceiver();
            const discovery = '<14>Jan 18 14:54:45 OLT EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da [Na] Discovery';
            receiver._handleMessageForTest(Buffer.from(discovery), { address: '10.0.0.5' });

            expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
            const events = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
            expect(events.C0F6EC1EFFDA.event_type).toBe('discovery');
        });

        test('non-Hioso packet is silently ignored', () => {
            const { receiver } = setupReceiver();
            const noise = '<14>Jan 18 14:53:57 OTHER-DEVICE app: random heartbeat';
            receiver._handleMessageForTest(Buffer.from(noise), { address: '10.0.0.5' });

            expect(fs.writeFileSync).not.toHaveBeenCalled();
        });

        test('garbage packet does not crash', () => {
            const { receiver } = setupReceiver();
            expect(() => {
                receiver._handleMessageForTest(Buffer.from('!!@@##'), { address: '10.0.0.5' });
            }).not.toThrow();
        });
    });

    describe('config gating', () => {
        test('startSyslogReceiver short-circuits when disabled', () => {
            global.config = { oltSyslog: { enabled: false } };
            const receiver = require('../olt-syslog-receiver');
            // Should not throw and should not bind anything.
            expect(() => receiver.startSyslogReceiver()).not.toThrow();
            const status = receiver.getStatus();
            expect(status.running).toBe(false);
            expect(status.config.enabled).toBe(false);
        });

        test('default port is 5514 (non-root friendly)', () => {
            global.config = { oltSyslog: { enabled: false } };
            const receiver = require('../olt-syslog-receiver');
            expect(receiver.getStatus().config.port).toBe(5514);
        });

        test('custom port respected', () => {
            global.config = { oltSyslog: { enabled: false, port: 9514 } };
            const receiver = require('../olt-syslog-receiver');
            expect(receiver.getStatus().config.port).toBe(9514);
        });
    });
});
