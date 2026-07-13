/**
 * Header Doc
 * Purpose: Uji kendali per-SEGMEN (Slice B1, read/dry-run) di customer-steering-service:
 *          buildSegmentMap (jalur base tiap segmen dari list live + hitung aktif + honor disabled +
 *          override RAF-STEER) & previewSegmentMove (operasi PERSIS yg akan dijalankan B2, TANPA
 *          menulis router: enable target + disable/other, add bila entri belum ada, noop, tolak
 *          jalur/segmen invalid). Semua dependency disuntik (tanpa router nyata).
 * Caller: Jest.
 * Deps: -
 * MainFuncs: -
 * SideEffects: set global.config per test.
 */
'use strict';

const svc = require('../customer-steering-service');

const E = (id, address, disabled = false) => ({ id, address, disabled, dynamic: false });

// State pool ala prod: freedns aktif 61/62/71, lokaldns aktif 70; 61/62 juga ADA di lokaldns tapi disabled.
function prodLists() {
    return {
        freedns: [E('*f61', '192.168.61.0/24'), E('*f62', '192.168.62.0/24'), E('*f71', '192.168.71.0/24'), E('*f70', '192.168.70.0/24', true)],
        lokaldns: [E('*l70', '192.168.70.0/24'), E('*l61', '192.168.61.0/24', true), E('*l62', '192.168.62.0/24', true)],
        'RAF-STEER-GMDP': [], 'RAF-STEER-IH': [], 'RAF-STEER-MNI': [], 'RAF-STEER-SF': [],
    };
}

function makeDeps(lists, actives = []) {
    const runBridge = jest.fn(async (spec) => {
        if (spec.mode === 'list') return { status: 'success', data: { lists } };
        return { status: 'success', data: { entries: [] } };
    });
    return { runBridge, getActives: async () => actives };
}

beforeEach(() => {
    global.config = { customerSteering: { host: '10.0.0.1', user: 'x', password: 'y' } }; // valid=true, enabled=false (read boleh)
});

describe('buildSegmentMap', () => {
    test('jalur base tiap segmen dari state prod (61/62/71→mni, 70→gmdp) + hitung aktif', async () => {
        const actives = [
            { name: 'a@x', address: '192.168.61.10' }, { name: 'b@x', address: '192.168.61.11' }, // 2× 110k
            { name: 'c@x', address: '192.168.70.5' }, // 1× reguler
        ];
        const deps = makeDeps(prodLists(), actives);
        const map = await svc.buildSegmentMap(deps);
        expect(map.ok).toBe(true);
        const by = Object.fromEntries(map.segments.map((s) => [s.id, s]));
        expect(by['110k'].currentPath).toBe('mni');
        expect(by['110k'].basis).toBe('pool:freedns');
        expect(by['110k'].activeCount).toBe(2);
        expect(by['reguler'].currentPath).toBe('gmdp');
        expect(by['reguler'].activeCount).toBe(1);
        expect(by['free'].currentPath).toBe('mni');
        // hanya BACA (mode:list), tak ada tulis
        expect(deps.runBridge.mock.calls.every((c) => c[0].mode === 'list')).toBe(true);
    });

    test('override RAF-STEER (subnet di RAF-STEER-SF) MENANG atas pool', async () => {
        const lists = prodLists();
        lists['RAF-STEER-SF'] = [E('*s61', '192.168.61.0/24')];
        const map = await svc.buildSegmentMap(makeDeps(lists));
        const by = Object.fromEntries(map.segments.map((s) => [s.id, s]));
        expect(by['110k'].currentPath).toBe('sf');
        expect(by['110k'].basis).toBe('override:RAF-STEER-SF');
    });

    test('kredensial kosong → ok:false (tak baca router)', async () => {
        global.config = { customerSteering: {} };
        const map = await svc.buildSegmentMap(makeDeps(prodLists()));
        expect(map.ok).toBe(false);
    });
});

describe('previewSegmentMove (DRY-RUN)', () => {
    test('110k mni → gmdp: aktifkan lokaldns + nonaktifkan freedns (2 ops, tanpa tulis)', async () => {
        const deps = makeDeps(prodLists());
        const p = await svc.previewSegmentMove({ segment: '110k', path: 'gmdp' }, deps);
        expect(p.ok).toBe(true);
        expect(p.from).toBe('mni');
        expect(p.to).toBe('gmdp');
        expect(p.noop).toBe(false);
        expect(p.ops).toEqual([
            { action: 'toggle', list: 'lokaldns', id: '*l61', disabled: false, desc: expect.any(String) },
            { action: 'toggle', list: 'freedns', id: '*f61', disabled: true, desc: expect.any(String) },
        ]);
        expect(deps.runBridge.mock.calls.every((c) => c[0].mode === 'list')).toBe(true); // NOL tulis
    });

    test('FREE mni → gmdp: lokaldns belum punya 71 → ops ADD + nonaktifkan freedns', async () => {
        const p = await svc.previewSegmentMove({ segment: 'free', path: 'gmdp' }, makeDeps(prodLists()));
        expect(p.ops[0]).toEqual({ action: 'add', list: 'lokaldns', address: '192.168.71.0/24', desc: expect.any(String) });
        expect(p.ops).toContainEqual({ action: 'toggle', list: 'freedns', id: '*f71', disabled: true, desc: expect.any(String) });
    });

    test('110k → mni padahal sudah mni → noop (nol operasi)', async () => {
        const p = await svc.previewSegmentMove({ segment: '110k', path: 'mni' }, makeDeps(prodLists()));
        expect(p.noop).toBe(true);
        expect(p.ops).toEqual([]);
    });

    test('jalur ih/sf ditolak di v1 (arahkan ke override per-pelanggan)', async () => {
        const p = await svc.previewSegmentMove({ segment: '110k', path: 'ih' }, makeDeps(prodLists()));
        expect(p.ok).toBe(false);
        expect(p.error).toMatch(/v1|per-pelanggan/i);
    });

    test('segmen tak dikenal → ok:false', async () => {
        const p = await svc.previewSegmentMove({ segment: 'ngawur', path: 'mni' }, makeDeps(prodLists()));
        expect(p.ok).toBe(false);
    });
});

// Router palsu STATEFUL: toggle/add/remove betul-betul mengubah state → mode:list berikutnya
// mencerminkannya (utk uji apply→verify→rollback end-to-end).
function statefulRouter(initial, { breakWrites = false } = {}) {
    const lists = JSON.parse(JSON.stringify(initial));
    let n = 0;
    const runBridge = jest.fn(async (spec) => {
        if (spec.mode === 'list') {
            const out = {};
            for (const name of spec.lists) out[name] = lists[name] || [];
            return { status: 'success', data: { lists: out } };
        }
        if (breakWrites) return { status: 'success', data: {} }; // sukses tapi TAK mengubah state
        if (spec.mode === 'entry-toggle') {
            for (const name of Object.keys(lists)) { const e = lists[name].find((x) => x.id === spec.id); if (e) e.disabled = spec.disabled === true; }
            return { status: 'success', data: {} };
        }
        if (spec.mode === 'entry-add') {
            const id = `*NEW${++n}`;
            (lists[spec.list] = lists[spec.list] || []).push({ id, address: spec.address, disabled: false, dynamic: false });
            return { status: 'success', data: { id } };
        }
        if (spec.mode === 'entry-remove') {
            for (const name of Object.keys(lists)) lists[name] = lists[name].filter((x) => x.id !== spec.id);
            return { status: 'success', data: {} };
        }
        return { status: 'error', message: 'mode?' };
    });
    return { runBridge, getActives: async () => [], _lists: () => lists };
}

describe('applySegmentMove (TULIS router — verify + rollback)', () => {
    test('confirm belum true → needConfirm, NOL tulis', async () => {
        const deps = statefulRouter(prodLists());
        const r = await svc.applySegmentMove({ segment: 'free', path: 'gmdp', confirm: false }, deps);
        expect(r.ok).toBe(false);
        expect(r.needConfirm).toBe(true);
        expect(deps.runBridge.mock.calls.every((c) => c[0].mode === 'list')).toBe(true);
    });

    test('FREE mni→gmdp confirm: ops jalan, VERIFY lolos, state berubah', async () => {
        const deps = statefulRouter(prodLists());
        const r = await svc.applySegmentMove({ segment: 'free', path: 'gmdp', confirm: true, actor: 'test' }, deps);
        expect(r.ok).toBe(true);
        expect(r.verified).toBe(true);
        expect(r.from).toBe('mni');
        expect(r.to).toBe('gmdp');
        // state akhir: lokaldns punya 71 aktif, freedns 71 disabled
        const lists = deps._lists();
        expect(lists.lokaldns.some((e) => e.address === '192.168.71.0/24' && !e.disabled)).toBe(true);
        expect(lists.freedns.find((e) => e.id === '*f71').disabled).toBe(true);
    });

    test('round-trip: gmdp lalu balik ke mni → state pulih (freedns 71 aktif lagi)', async () => {
        const deps = statefulRouter(prodLists());
        await svc.applySegmentMove({ segment: 'free', path: 'gmdp', confirm: true }, deps);
        const back = await svc.applySegmentMove({ segment: 'free', path: 'mni', confirm: true }, deps);
        expect(back.ok).toBe(true);
        expect(back.verified).toBe(true);
        expect(deps._lists().freedns.find((e) => e.id === '*f71').disabled).toBe(false);
    });

    test('VERIFY gagal (tulis "sukses" tapi state tak berubah) → ROLLBACK, ok:false', async () => {
        const deps = statefulRouter(prodLists(), { breakWrites: true });
        const r = await svc.applySegmentMove({ segment: 'free', path: 'gmdp', confirm: true }, deps);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/verify/i);
        // ada percobaan tulis (bukan cuma list) + percobaan rollback sesudahnya
        expect(deps.runBridge.mock.calls.some((c) => c[0].mode !== 'list')).toBe(true);
    });

    test('noop (sudah di target) → tak menulis', async () => {
        const deps = statefulRouter(prodLists());
        const r = await svc.applySegmentMove({ segment: 'free', path: 'mni', confirm: true }, deps);
        expect(r.ok).toBe(true);
        expect(r.noop).toBe(true);
        expect(deps.runBridge.mock.calls.every((c) => c[0].mode === 'list')).toBe(true);
    });
});
