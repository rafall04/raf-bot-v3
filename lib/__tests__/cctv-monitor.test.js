/**
 * Test cctv-monitor — semantik transisi (seed → down → broadcast/cancel/recovery)
 * pakai injeksi deps. TIDAK menyentuh jaringan/FS.
 */
const { createCctvMonitor } = require('../cctv-monitor');

function setup({ enabled = true, devices = [], confirmationMinutes = 1, cooldown = 30*60_000, notifyRecovery = true } = {}) {
    let nw = [];
    const sent = [];
    const incidents = [];
    let inc = [];
    let t = 1_700_000_000_000;
    const timers = [];
    const m = createCctvMonitor({
        getConfig: () => ({ enabled, pollIntervalMs: 60_000, confirmationMinutes, rebroadcastCooldownMs: cooldown, notifyRecovery }),
        getDevices: () => devices,
        fetchNetwatch: async () => nw,
        sendCritical: async (ph, msg, opts) => { sent.push({ phone: ph, label: opts.label, text: msg.text }); return { delivered: true, attempts: 1 }; },
        loadIncidents: () => inc.slice(),
        saveIncidents: (l) => { inc = l.slice(); incidents.length = 0; incidents.push(...l); },
        now: () => t,
        setTimeoutFn: (fn, ms) => { const id = timers.length; timers.push({ fn, ms, fired: false }); return { id, ms, unref: () => {} }; },
        clearTimeoutFn: (h) => { if (timers[h?.id]) timers[h.id].fired = true; },
        logger: { log() {}, warn() {}, error() {} },
    });
    return {
        m, sent, incidents,
        setNetwatch: (entries) => { nw = entries; },
        advance: (ms) => { t += ms; },
        fireTimers: () => { for (const tm of timers) if (!tm.fired) { tm.fired = true; tm.fn(); } },
    };
}

const DEV = { id: 'c1', name: 'CCTV Pasar', host: '192.168.99.1', phone: '628111', customerName: 'Pak Joko', enabled: true };

describe('cctv-monitor: semantik transisi', () => {
    test('cycle pertama hanya seed — CCTV sudah down tak memicu broadcast', async () => {
        const t = setup({ devices: [DEV] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // timer mungkin terpasang? harusnya tidak
        expect(t.sent).toHaveLength(0);
    });

    test('transisi up → down → confirmation → broadcast', async () => {
        const t = setup({ devices: [DEV], confirmationMinutes: 15 });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // seed up
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest(); // transisi → pending
        expect(t.sent).toHaveLength(0); // belum broadcast
        t.fireTimers(); // simulasi window selesai
        expect(t.sent).toHaveLength(1);
        expect(t.sent[0].label).toBe('cctv_down');
        expect(t.sent[0].text).toContain('Pak Joko');
        expect(t.sent[0].text).toContain('CCTV Pasar');
    });

    test('pulih sebelum window → BATAL (tidak broadcast)', async () => {
        const t = setup({ devices: [DEV] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih → cancel pending
        t.fireTimers(); // timer fire tapi pending sudah null → no-op
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
    });

    test('pulih SETELAH broadcast → kirim notif "pulih"', async () => {
        const t = setup({ devices: [DEV] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // broadcast down
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih
        const ups = t.sent.filter(x => x.label === 'cctv_up');
        expect(ups).toHaveLength(1);
        expect(ups[0].text).toContain('online kembali');
    });

    test('notifyRecovery=false → tidak kirim notif pulih', async () => {
        const t = setup({ devices: [DEV], notifyRecovery: false });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        expect(t.sent.filter(x => x.label === 'cctv_up')).toHaveLength(0);
    });

    test('CCTV terdaftar tapi tak ada di netwatch → tidak crash, tidak broadcast', async () => {
        const t = setup({ devices: [DEV] });
        t.setNetwatch([]); // netwatch kosong
        await t.m._pollOnceForTest();
        await t.m._pollOnceForTest();
        expect(t.sent).toHaveLength(0);
    });

    test('netwatch status "unknown" → diabaikan (tidak transisi)', async () => {
        const t = setup({ devices: [DEV] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'unknown' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'unknown' }]);
        await t.m._pollOnceForTest();
        expect(t.sent).toHaveLength(0);
    });

    test('per-CCTV confirmationMinutes menang atas global', async () => {
        const dev2 = { ...DEV, confirmationMinutes: 30 };
        const t = setup({ devices: [dev2], confirmationMinutes: 5 });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        // cek incident punya confirmationMinutes=30
        const pending = t.incidents.find(i => i.status === 'pending');
        expect(pending).toBeDefined();
        expect(pending.confirmationMinutes).toBe(30);
    });

    test('CCTV dengan customMessage → pakai template custom', async () => {
        const dev2 = { ...DEV, customMessage: 'CCTV custom {cctv_name} mati' };
        const t = setup({ devices: [dev2] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        expect(t.sent[0].text).toBe('CCTV custom CCTV Pasar mati');
    });

    test('CCTV disabled di registry → tak dipoll', async () => {
        const t = setup({ devices: [{ ...DEV, enabled: false }] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        expect(t.sent).toHaveLength(0);
    });

    test('config.enabled=false → poll skip total', async () => {
        const t = setup({ enabled: false, devices: [DEV] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        expect(t.sent).toHaveLength(0);
    });

    test('phone multi (pipe-separated) → broadcast ke semua', async () => {
        const dev2 = { ...DEV, phone: '628111|628222|628333' };
        const t = setup({ devices: [dev2] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        // notify() async; flush microtasks supaya semua nomor selesai dikirim
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(3);
    });

    test('re-down DALAM cooldown → broadcast kedua di-SKIP (anti-flap PLN-blink)', async () => {
        const t = setup({ devices: [DEV], confirmationMinutes: 1, cooldown: 30 * 60_000 });
        // insiden 1: up→down→broadcast
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // window → broadcast 1 (set lastBroadcast = sekarang)
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
        // pulih, lalu mati lagi 5 menit kemudian (< cooldown 30m)
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.advance(5 * 60_000);
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // window 2 → onConfirm cek cooldown → SKIP
        // tetap 1 broadcast down; insiden ke-2 ditandai cooldown_skipped
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
        expect(t.incidents.some(i => i.status === 'cooldown_skipped')).toBe(true);
    });

    test('outage baru SETELAH cooldown lewat → broadcast lagi', async () => {
        const t = setup({ devices: [DEV], confirmationMinutes: 1, cooldown: 30 * 60_000 });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // broadcast 1
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih
        t.advance(31 * 60_000); // lewati cooldown 30m
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // window 2 → cooldown lewat → broadcast 2
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(2);
    });

    test('tambah device saat insiden lain in-flight → state pending TIDAK hilang (poll hot-read, route tanpa restart)', async () => {
        const devices = [DEV];
        const t = setup({ devices, confirmationMinutes: 15 });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest(); // DEV pending (in-flight)
        // admin tambah CCTV baru → registry berubah; poll baca fresh TANPA clear state
        devices.push({ id: 'c2', name: 'CCTV Toko', host: '192.168.99.2', phone: '628999', customerName: 'Bu Sri', enabled: true });
        t.setNetwatch([
            { host: '192.168.99.1', status: 'down' },
            { host: '192.168.99.2', status: 'up' },
        ]);
        await t.m._pollOnceForTest(); // c2 ke-seed, DEV TETAP pending
        t.fireTimers(); // window DEV selesai → broadcast DEV tetap terkirim
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
    });
});
