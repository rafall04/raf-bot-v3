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

    describe('ground truth regression (real OLT Hioso capture)', () => {
        // Data nyata dari OLT 192.168.11.2, tes fisik Jun 2026.
        // DG (power cabut): dying-gasp + Lost detik sama.
        // LOS (fiber cabut MAC 28:53:4e:d5:db:b2): Lost SAJA.
        test('real DG pair → dying-gasp', () => {
            const c = createEventCorrelator({ source: 'scraper' });
            const dg = parseHiosoLogMessage('Jun 5 05:47:40 EPON: Onu 0/1/2:2 94:00:b0:97:76:73 dying-gasp');
            const lost = parseHiosoLogMessage('Jun 5 05:47:40 EPON: Slot 0/1/2:2 Onu 94:00:b0:97:76:73[Na] Lost');
            expect(c.ingest(dg, 1000)).toBeNull();
            const ev = c.ingest(lost, 1000); // same second
            expect(ev.event_type).toBe('dying-gasp');
            expect(ev.mac).toBe('9400B0977673');
        });

        test('real LOS line (fiber cut, no dying-gasp) → los', () => {
            const c = createEventCorrelator({ source: 'scraper' });
            const lost = parseHiosoLogMessage('Jun 5 13:05:45 EPON: Slot 0/1/1:22 Onu 28:53:4e:d5:db:b2[Na] Lost');
            const ev = c.ingest(lost, 5000);
            expect(ev.event_type).toBe('los');
            expect(ev.mac).toBe('28534ED5DBB2');
            expect(ev.slot).toBe('1');
            expect(ev.onu).toBe('22');
            expect(ev.correlated_with_dg).toBe(false);
        });
    });

    describe('createEventCorrelator grace window (syslog reorder safety)', () => {
        function makeManualTimers() {
            let pending = [];
            return {
                setTimeoutFn: (fn, ms) => { const t = { fn, ms }; pending.push(t); return t; },
                clearTimeoutFn: (t) => { pending = pending.filter((x) => x !== t); },
                flush: () => { const cur = pending; pending = []; cur.forEach((t) => t.fn()); },
                count: () => pending.length,
            };
        }

        test('Lost alone defers, then emits LOS after grace fires', () => {
            const timers = makeManualTimers();
            const emitted = [];
            const c = createEventCorrelator({
                source: 'syslog', lostGraceMs: 4000, onEvent: (e) => emitted.push(e),
                setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn,
            });
            const lost = { type: 'lost', mac: 'AABB', slot_onu: '0/1/1:1' };
            expect(c.ingest(lost, 1000)).toBeNull(); // deferred, no sync return
            expect(emitted).toHaveLength(0);          // nothing emitted yet
            expect(timers.count()).toBe(1);           // one timer pending
            timers.flush();                            // grace expires
            expect(emitted).toHaveLength(1);
            expect(emitted[0].event_type).toBe('los');
        });

        test('REORDER: Lost arrives first, DG within grace → DG (not LOS)', () => {
            const timers = makeManualTimers();
            const emitted = [];
            const c = createEventCorrelator({
                source: 'syslog', lostGraceMs: 4000, onEvent: (e) => emitted.push(e),
                setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn,
            });
            const lost = { type: 'lost', mac: 'AABB', slot_onu: '0/1/1:1' };
            const dg = { type: 'dying-gasp', mac: 'AABB', slot_onu: '0/1/1:1' };
            expect(c.ingest(lost, 1000)).toBeNull(); // Lost deferred
            expect(c.ingest(dg, 1001)).toBeNull();   // DG arrives → cancels timer, emits DG
            expect(timers.count()).toBe(0);          // timer cancelled
            expect(emitted).toHaveLength(1);
            expect(emitted[0].event_type).toBe('dying-gasp');
            expect(emitted[0].correlated_with_dg).toBe(true);
            // Flushing now must NOT produce a duplicate LOS.
            timers.flush();
            expect(emitted).toHaveLength(1);
        });

        test('NORMAL: DG first then Lost → DG synchronously (no defer/delay)', () => {
            const timers = makeManualTimers();
            const emitted = [];
            const c = createEventCorrelator({
                source: 'syslog', lostGraceMs: 4000, onEvent: (e) => emitted.push(e),
                setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn,
            });
            const dg = { type: 'dying-gasp', mac: 'AABB', slot_onu: '0/1/1:1' };
            const lost = { type: 'lost', mac: 'AABB', slot_onu: '0/1/1:1' };
            expect(c.ingest(dg, 1000)).toBeNull();
            const ev = c.ingest(lost, 1000); // synchronous DG
            expect(ev.event_type).toBe('dying-gasp');
            expect(timers.count()).toBe(0); // no defer needed
            expect(emitted).toHaveLength(0); // emitted synchronously via return, not callback
        });

        test('Discovery during grace cancels pending LOS', () => {
            const timers = makeManualTimers();
            const emitted = [];
            const c = createEventCorrelator({
                source: 'syslog', lostGraceMs: 4000, onEvent: (e) => emitted.push(e),
                setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn,
            });
            const lost = { type: 'lost', mac: 'AABB', slot_onu: '0/1/1:1' };
            const disc = { type: 'discovery', mac: 'AABB', slot_onu: '0/1/1:1' };
            c.ingest(lost, 1000);            // deferred
            const ev = c.ingest(disc, 2000); // discovery returns synchronously
            expect(ev.event_type).toBe('discovery');
            expect(timers.count()).toBe(0);  // LOS timer cancelled
            timers.flush();
            expect(emitted).toHaveLength(0); // no stale LOS emitted
        });

        test('synchronous mode (lostGraceMs=0) unchanged — Lost returns LOS immediately', () => {
            const c = createEventCorrelator({ source: 'scraper' }); // no grace, no onEvent
            const lost = { type: 'lost', mac: 'AABB', slot_onu: '0/1/1:1' };
            const ev = c.ingest(lost, 1000);
            expect(ev.event_type).toBe('los'); // immediate, backward compatible
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
