const {
    normalizeMAC,
    parseHiosoLogMessage,
    parseSlotOnu,
    parseTimestamp,
    createEventCorrelator,
    scoreEventConfidence,
} = require('../olt-event-classifier');

describe('lib/olt-event-classifier', () => {
    describe('normalizeMAC', () => {
        test('strips separators and uppercases', () => {
            expect(normalizeMAC('aa:bb:cc:dd:ee:ff')).toBe('AABBCCDDEEFF');
            expect(normalizeMAC('aa-bb-cc-dd-ee-ff')).toBe('AABBCCDDEEFF');
            expect(normalizeMAC('aabbcc ddeeff')).toBe('AABBCCDDEEFF');
        });

        test('empty / invalid returns empty string', () => {
            expect(normalizeMAC('')).toBe('');
            expect(normalizeMAC(null)).toBe('');
            expect(normalizeMAC(undefined)).toBe('');
        });
    });

    describe('parseHiosoLogMessage', () => {
        test('parses dying-gasp line', () => {
            const line = 'Jan 18 14:53:57 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da dying-gasp';
            expect(parseHiosoLogMessage(line)).toEqual({
                type: 'dying-gasp',
                timestamp: 'Jan 18 14:53:57',
                slot_onu: '0/1/1:4',
                mac: 'C0F6EC1EFFDA',
            });
        });

        test('parses Lost line with bracket tag', () => {
            const line = 'Jan 18 14:53:59 EPON: Slot 0/1/1:4 Onu c0:f6:ec:1e:ff:da[Na] Lost';
            expect(parseHiosoLogMessage(line)).toEqual({
                type: 'lost',
                timestamp: 'Jan 18 14:53:59',
                slot_onu: '0/1/1:4',
                mac: 'C0F6EC1EFFDA',
            });
        });

        test('parses Discovery (recovery) line', () => {
            const line = 'Jan 18 14:54:45 EPON: Onu 0/1/1:4 c0:f6:ec:1e:ff:da [Na] Discovery';
            expect(parseHiosoLogMessage(line)).toEqual({
                type: 'discovery',
                timestamp: 'Jan 18 14:54:45',
                slot_onu: '0/1/1:4',
                mac: 'C0F6EC1EFFDA',
            });
        });

        test('returns null for unknown line', () => {
            expect(parseHiosoLogMessage('random debug message')).toBeNull();
            expect(parseHiosoLogMessage('')).toBeNull();
            expect(parseHiosoLogMessage(null)).toBeNull();
        });
    });

    describe('parseSlotOnu', () => {
        test('extracts slot + onu from 0/1/1:4 format', () => {
            expect(parseSlotOnu('0/1/1:4')).toEqual({ slot: '1', onu: '4' });
            expect(parseSlotOnu('0/2/3:12')).toEqual({ slot: '3', onu: '12' });
        });

        test('returns nulls for invalid format', () => {
            expect(parseSlotOnu('invalid')).toEqual({ slot: null, onu: null });
            expect(parseSlotOnu('')).toEqual({ slot: null, onu: null });
        });
    });

    describe('createEventCorrelator', () => {
        test('DG ingest returns null (pending Lost)', () => {
            const c = createEventCorrelator({ source: 'test' });
            const result = c.ingest({ type: 'dying-gasp', mac: 'AABB', slot_onu: '0/1/1:4' }, Date.now());
            expect(result).toBeNull();
            expect(c._state().pendingDgCount).toBe(1);
        });

        test('Lost following DG within window emits dying-gasp event', () => {
            const c = createEventCorrelator({ source: 'syslog' });
            const t0 = Date.now();
            c.ingest({ type: 'dying-gasp', mac: 'AABB', slot_onu: '0/1/1:4' }, t0);
            const result = c.ingest({ type: 'lost', mac: 'AABB', slot_onu: '0/1/1:4' }, t0 + 5_000);

            expect(result).toMatchObject({
                mac: 'AABB',
                slot: '1',
                onu: '4',
                event_type: 'dying-gasp',
                source: 'syslog',
                correlated_with_dg: true,
            });
            // DG entry consumed.
            expect(c._state().pendingDgCount).toBe(0);
        });

        test('Lost without DG emits LOS event', () => {
            const c = createEventCorrelator({ source: 'syslog' });
            const result = c.ingest({ type: 'lost', mac: 'CCDD', slot_onu: '0/1/2:3' }, Date.now());

            expect(result).toMatchObject({
                mac: 'CCDD',
                event_type: 'los',
                correlated_with_dg: false,
            });
        });

        test('Lost after DG window expired emits LOS event (not DG)', () => {
            const c = createEventCorrelator({ source: 'syslog', correlationWindowMs: 1_000 });
            const t0 = Date.now();
            c.ingest({ type: 'dying-gasp', mac: 'AABB', slot_onu: '0/1/1:4' }, t0);
            // 2 detik kemudian — di luar window 1s.
            const result = c.ingest({ type: 'lost', mac: 'AABB', slot_onu: '0/1/1:4' }, t0 + 2_000);
            expect(result.event_type).toBe('los');
        });

        test('Discovery emits recovery event and clears pending DG', () => {
            const c = createEventCorrelator({ source: 'syslog' });
            c.ingest({ type: 'dying-gasp', mac: 'AABB', slot_onu: '0/1/1:4' }, Date.now());
            const result = c.ingest({ type: 'discovery', mac: 'AABB', slot_onu: '0/1/1:4' }, Date.now());

            expect(result).toMatchObject({
                mac: 'AABB',
                event_type: 'discovery',
            });
            expect(c._state().pendingDgCount).toBe(0);
        });

        test('stale DG entries pruned after dgTtlMs', () => {
            const c = createEventCorrelator({ source: 'syslog', dgTtlMs: 100 });
            const t0 = Date.now();
            c.ingest({ type: 'dying-gasp', mac: 'AABB', slot_onu: '0/1/1:4' }, t0);
            expect(c._state().pendingDgCount).toBe(1);

            // Ingest event lain jauh setelah TTL → DG lama harus dipruning.
            c.ingest({ type: 'lost', mac: 'XXYY', slot_onu: '0/1/1:9' }, t0 + 200);
            expect(c._state().pendingDgMacs).not.toContain('AABB');
        });

        test('Multiple ONUs tracked independently', () => {
            const c = createEventCorrelator({ source: 'syslog' });
            const t0 = Date.now();
            c.ingest({ type: 'dying-gasp', mac: 'AABB', slot_onu: '0/1/1:1' }, t0);
            c.ingest({ type: 'dying-gasp', mac: 'CCDD', slot_onu: '0/1/1:2' }, t0);

            const r1 = c.ingest({ type: 'lost', mac: 'AABB', slot_onu: '0/1/1:1' }, t0 + 1_000);
            expect(r1.event_type).toBe('dying-gasp');

            // CCDD belum Lost — masih pending.
            expect(c._state().pendingDgCount).toBe(1);
            expect(c._state().pendingDgMacs).toContain('CCDD');
        });
    });

    describe('scoreEventConfidence', () => {
        test('DG with no extra signals → base 0.85', () => {
            const { confidence, signals } = scoreEventConfidence('dying-gasp', { correlatedWithDg: true });
            expect(confidence).toBe(0.85);
            expect(signals[0].source).toBe('syslog');
            expect(signals[0].hint).toBe('dying-gasp');
        });

        test('LOS with no extra signals → base 0.6', () => {
            const { confidence } = scoreEventConfidence('los', {});
            expect(confidence).toBe(0.6);
        });

        test('discovery → base 1.0', () => {
            const { confidence } = scoreEventConfidence('discovery', {});
            expect(confidence).toBe(1.0);
        });

        test('agreeing rxPower signal boosts confidence', () => {
            const rxSignal = { source: 'rxpower', hint: 'dying-gasp', weight: 0.15 };
            const { confidence } = scoreEventConfidence('dying-gasp', {
                correlatedWithDg: true,
                extraSignals: [rxSignal],
            });
            // 0.85 + 0.15 = 1.0 → clamp 0.99
            expect(confidence).toBe(0.99);
        });

        test('disagreeing rxPower signal lowers confidence by half weight', () => {
            // event_type DG (0.85), but rxPower declining suggests LOS.
            const rxSignal = { source: 'rxpower', hint: 'los', weight: 0.25 };
            const { confidence } = scoreEventConfidence('dying-gasp', {
                correlatedWithDg: true,
                extraSignals: [rxSignal],
            });
            // 0.85 - (0.25 * 0.5) = 0.725
            expect(confidence).toBeCloseTo(0.725, 3);
        });

        test('LOS + declining rxPower (agree) → boosted', () => {
            const rxSignal = { source: 'rxpower', hint: 'los', weight: 0.25 };
            const { confidence } = scoreEventConfidence('los', { extraSignals: [rxSignal] });
            // 0.6 + 0.25 = 0.85
            expect(confidence).toBeCloseTo(0.85, 3);
        });

        test('LOS + healthy rxPower (disagree, maybe missed DG) → lowered', () => {
            const rxSignal = { source: 'rxpower', hint: 'dying-gasp', weight: 0.15 };
            const { confidence } = scoreEventConfidence('los', { extraSignals: [rxSignal] });
            // 0.6 - (0.15 * 0.5) = 0.525
            expect(confidence).toBeCloseTo(0.525, 3);
        });

        test('neutral rxPower signal does not change confidence', () => {
            const rxSignal = { source: 'rxpower', hint: 'neutral', weight: 0.05 };
            const { confidence } = scoreEventConfidence('los', { extraSignals: [rxSignal] });
            expect(confidence).toBe(0.6);
        });

        test('confidence clamped to [0.3, 0.99]', () => {
            const heavyDisagree = { source: 'rxpower', hint: 'los', weight: 5 };
            const { confidence } = scoreEventConfidence('dying-gasp', {
                correlatedWithDg: true,
                extraSignals: [heavyDisagree],
            });
            expect(confidence).toBeGreaterThanOrEqual(0.3);
        });

        test('signals array includes syslog primary + extras', () => {
            const rxSignal = { source: 'rxpower', hint: 'los', weight: 0.25 };
            const { signals } = scoreEventConfidence('los', { extraSignals: [rxSignal] });
            expect(signals).toHaveLength(2);
            expect(signals[0].source).toBe('syslog');
            expect(signals[1].source).toBe('rxpower');
        });
    });

    describe('parseTimestamp', () => {
        test('returns epoch ms for valid timestamp', () => {
            const year = 2026;
            const result = parseTimestamp('Jan 18 14:53:57', year);
            expect(typeof result).toBe('number');
            expect(new Date(result).getUTCFullYear()).toBe(year);
        });

        test('falls back to Date.now() for invalid', () => {
            const before = Date.now();
            const result = parseTimestamp('garbage');
            const after = Date.now();
            expect(result).toBeGreaterThanOrEqual(before);
            expect(result).toBeLessThanOrEqual(after);
        });
    });
});
