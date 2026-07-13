/**
 * Header Doc
 * Purpose: Uji checkOnce pemantau drift steering: fail-closed saat router tak terbaca, diam saat
 *          selaras, kirim alert admin saat drift baru, DEBOUNCE saat tanda-tangan sama < 24 jam,
 *          dan alert ulang saat > 24 jam. Semua dependency disuntik (tanpa router/WA nyata).
 * Caller: Jest.
 * Deps: -
 * MainFuncs: -
 * SideEffects: -
 */
'use strict';

const { checkOnce, _internal } = require('../steering-drift-monitor');

const DRIFT = [{ cidr: '192.168.70.0/24', poolPath: 'gmdp', livePath: 'mni' }];
const NOW = 1_700_000_000_000;

function baseDeps(over = {}) {
    return {
        getSnapshot: async () => ({ profiles: { freedns: [], lokaldns: [] } }),
        computeDrift: () => DRIFT,
        send: jest.fn(async () => ({ delivered: true })),
        getAdminJids: () => ['628111@s.whatsapp.net', '628222@s.whatsapp.net'],
        renderResponseTemplate: (_k, fb) => fb,
        loadState: () => ({ signature: '', lastAlertAt: 0 }),
        saveState: jest.fn(),
        nowMs: () => NOW,
        ...over,
    };
}

describe('steering-drift-monitor.checkOnce', () => {
    test('router tak terbaca → fail-closed, tak kirim', async () => {
        const deps = baseDeps({ getSnapshot: async () => { throw new Error('unreadable'); } });
        const r = await checkOnce(deps);
        expect(r.reason).toBe('router-unreadable');
        expect(deps.send).not.toHaveBeenCalled();
    });

    test('selaras (drift kosong) → diam', async () => {
        const deps = baseDeps({ computeDrift: () => [] });
        const r = await checkOnce(deps);
        expect(r.reason).toBe('aligned');
        expect(deps.send).not.toHaveBeenCalled();
        expect(deps.saveState).not.toHaveBeenCalled();
    });

    test('drift baru → kirim ke SEMUA admin + simpan state', async () => {
        const deps = baseDeps();
        const r = await checkOnce(deps);
        expect(r.alerted).toBe(true);
        expect(deps.send).toHaveBeenCalledTimes(2);
        expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({ lastAlertAt: NOW }));
    });

    test('tanda-tangan sama < 24 jam → DEBOUNCE (tak kirim ulang)', async () => {
        const sig = _internal.driftSignature(DRIFT);
        const deps = baseDeps({ loadState: () => ({ signature: sig, lastAlertAt: NOW - 60_000 }) });
        const r = await checkOnce(deps);
        expect(r.reason).toBe('debounced');
        expect(deps.send).not.toHaveBeenCalled();
    });

    test('tanda-tangan sama TAPI > 24 jam → alert ulang', async () => {
        const sig = _internal.driftSignature(DRIFT);
        const deps = baseDeps({ loadState: () => ({ signature: sig, lastAlertAt: NOW - 25 * 60 * 60 * 1000 }) });
        const r = await checkOnce(deps);
        expect(r.alerted).toBe(true);
        expect(deps.send).toHaveBeenCalledTimes(2);
    });

    test('driftSignature stabil & urut (independen urutan input)', () => {
        const a = _internal.driftSignature([
            { cidr: '192.168.70.0/24', poolPath: 'gmdp', livePath: 'mni' },
            { cidr: '10.10.50.0/24', poolPath: 'mni', livePath: 'gmdp' },
        ]);
        const b = _internal.driftSignature([
            { cidr: '10.10.50.0/24', poolPath: 'mni', livePath: 'gmdp' },
            { cidr: '192.168.70.0/24', poolPath: 'gmdp', livePath: 'mni' },
        ]);
        expect(a).toBe(b);
    });
});
