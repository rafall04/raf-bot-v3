/**
 * Test cctv-power-outage-gate — hitung kluster dying-gasp OLT dari repo event (injeksi),
 * dedup per-MAC, jendela waktu, cache, dan fail-open. TIDAK menyentuh SQLite nyata.
 */
const { createPowerOutageGate } = require('../cctv-power-outage-gate');

function fakeRepo(rows, opts = {}) {
    const calls = { listEvents: 0, lastFilter: null };
    const repo = {
        async listEvents(filter) {
            calls.listEvents++;
            calls.lastFilter = filter;
            if (opts.throws) throw new Error('db-boom');
            // Saring seperti repo asli: type + rentang from/to.
            return rows.filter((r) =>
                (!filter.type || r.event_type === filter.type) &&
                (!Number.isFinite(filter.from) || r.ts_ms >= filter.from) &&
                (!Number.isFinite(filter.to) || r.ts_ms <= filter.to));
        },
    };
    return { repo, calls };
}

const AT = 1_700_000_000_000;

describe('cctv-power-outage-gate', () => {
    test('hitung ONU dying-gasp BERBEDA di jendela (dedup per-MAC)', async () => {
        const rows = [
            { event_type: 'dying-gasp', mac: 'E00CE5422B1E', customer_name: 'Mas Sandi', ts_ms: AT - 30_000 },
            { event_type: 'dying-gasp', mac: 'e00ce5422b1e', customer_name: 'Mas Sandi', ts_ms: AT - 29_000 }, // MAC sama (case beda) → 1
            { event_type: 'dying-gasp', mac: 'E43EC6131724', customer_name: 'CCTV Selatan Ahass', ts_ms: AT - 28_000 },
            { event_type: 'dying-gasp', mac: 'CCBCE3B1F721', customer_name: 'Widodo', ts_ms: AT - 27_000 },
        ];
        const { repo } = fakeRepo(rows);
        const g = createPowerOutageGate({ getRepo: () => repo, now: () => AT });
        const ctx = await g.getContext({ at: AT, lookbackMs: 6 * 60_000, forwardMs: 2 * 60_000 });
        expect(ctx.dgOnu).toBe(3);
        expect(ctx.customers).toContain('Mas Sandi');
        expect(ctx.customers).toContain('Widodo');
        expect(ctx.firstAtMs).toBe(AT - 30_000);
    });

    test('hanya event dalam jendela [at-lookback, at+forward] yang dihitung', async () => {
        const rows = [
            { event_type: 'dying-gasp', mac: 'AA11', ts_ms: AT - 5 * 60_000 },   // di dalam
            { event_type: 'dying-gasp', mac: 'BB22', ts_ms: AT - 20 * 60_000 },  // terlalu lama → keluar
            { event_type: 'dying-gasp', mac: 'CC33', ts_ms: AT + 90_000 },       // sedikit di depan → masuk (forward 2m)
        ];
        const { repo } = fakeRepo(rows);
        const g = createPowerOutageGate({ getRepo: () => repo, now: () => AT });
        const ctx = await g.getContext({ at: AT, lookbackMs: 6 * 60_000, forwardMs: 2 * 60_000 });
        expect(ctx.dgOnu).toBe(2);
    });

    test('hanya type dying-gasp (los/discovery diabaikan)', async () => {
        const rows = [
            { event_type: 'dying-gasp', mac: 'AA11', ts_ms: AT - 10_000 },
            { event_type: 'los', mac: 'BB22', ts_ms: AT - 10_000 },
            { event_type: 'discovery', mac: 'CC33', ts_ms: AT - 10_000 },
        ];
        const { repo, calls } = fakeRepo(rows);
        const g = createPowerOutageGate({ getRepo: () => repo, now: () => AT });
        const ctx = await g.getContext({ at: AT });
        expect(ctx.dgOnu).toBe(1);
        expect(calls.lastFilter.type).toBe('dying-gasp');
    });

    test('cache: query jendela identik dalam TTL → 1 panggilan repo (dedup burst)', async () => {
        const rows = [{ event_type: 'dying-gasp', mac: 'AA11', ts_ms: AT - 10_000 }];
        const { repo, calls } = fakeRepo(rows);
        let clock = AT;
        const g = createPowerOutageGate({ getRepo: () => repo, now: () => clock, cacheTtlMs: 30_000 });
        await g.getContext({ at: AT });
        await g.getContext({ at: AT }); // jendela sama → cache hit
        expect(calls.listEvents).toBe(1);
        clock = AT + 31_000;             // TTL lewat
        await g.getContext({ at: AT });
        expect(calls.listEvents).toBe(2);
    });

    test('fail-open: repo error → { dgOnu: 0 } (jangan menahan broadcast karena buta)', async () => {
        const { repo } = fakeRepo([], { throws: true });
        const g = createPowerOutageGate({ getRepo: () => repo, now: () => AT });
        const ctx = await g.getContext({ at: AT });
        expect(ctx.dgOnu).toBe(0);
        expect(ctx.error).toBeTruthy();
    });
});
