/**
 * Test cctv-monitor — semantik transisi (seed → down → broadcast/cancel/recovery)
 * pakai injeksi deps. TIDAK menyentuh jaringan/FS.
 */
const { createCctvMonitor, isWithinQuiet } = require('../cctv-monitor');

function setup({ enabled = true, devices = [], confirmationMinutes = 1, cooldown = 30*60_000, notifyRecovery = true, massOutageThreshold = 0, massOutageAdminPhone = '', quietHoursEnabled = false, quietStart = '22:00', quietEnd = '06:00', quietApplyCustomer = true, quietApplyCoordinator = true, quietApplyGroup = true, coordinators = {}, seedIncidents = [], powerOutageGateEnabled = true, powerOutageDgThreshold = 3, powerOutageAdminPhone = '', powerOutageContext = { dgOnu: 0, customers: [], firstAtMs: null }, powerOutageThrows = false, adminJids = ['628999@s.whatsapp.net'] } = {}) {
    let nw = [];
    const sent = [];
    const incidents = seedIncidents.slice();
    let inc = seedIncidents.slice();
    let t = 1_700_000_000_000;
    const timers = [];
    let powerCalls = 0;
    const m = createCctvMonitor({
        getConfig: () => ({ enabled, pollIntervalMs: 60_000, confirmationMinutes, rebroadcastCooldownMs: cooldown, notifyRecovery, massOutageThreshold, massOutageAdminPhone, quietHoursEnabled, quietStart, quietEnd, quietApplyCustomer, quietApplyCoordinator, quietApplyGroup, powerOutageGateEnabled, powerOutageDgThreshold, powerOutageAdminPhone, powerOutageLookbackMs: 6 * 60_000, powerOutageForwardMs: 2 * 60_000, powerOutageCooldownMs: 30 * 60_000 }),
        getDevices: () => devices,
        fetchNetwatch: async () => nw,
        sendCritical: async (ph, msg, opts) => { sent.push({ phone: ph, label: opts.label, text: msg.text }); return { delivered: true, attempts: 1 }; },
        getAreaCoordinator: (area) => coordinators[String(area || '').trim().toLowerCase()] || null,
        getPowerOutageContext: async () => { powerCalls++; if (powerOutageThrows) throw new Error('gate-boom'); return powerOutageContext; },
        getAdminJids: () => adminJids,
        loadIncidents: () => inc.slice(),
        saveIncidents: (l) => { inc = l.slice(); incidents.length = 0; incidents.push(...l); },
        now: () => t,
        setTimeoutFn: (fn, ms) => { const id = timers.length; timers.push({ fn, ms, fired: false, kind: ms >= 80000 ? 'batch' : 'confirm' }); return { id, ms, unref: () => {} }; },
        clearTimeoutFn: (h) => { if (timers[h?.id]) timers[h.id].fired = true; },
        logger: { log() {}, warn() {}, error() {} },
    });
    return {
        m, sent, incidents,
        powerCalls: () => powerCalls,
        setNetwatch: (entries) => { nw = entries; },
        advance: (ms) => { t += ms; },
        fireTimers: () => { for (const tm of timers) if (!tm.fired) { tm.fired = true; tm.fn(); } },
        // Fire hanya timer jenis tertentu: 'confirm' (window konfirmasi) atau 'batch' (jendela agregasi).
        fireKind: (kind) => { for (const tm of timers) if (!tm.fired && tm.kind === kind) { tm.fired = true; tm.fn(); } },
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
        expect(t.sent[0].text).not.toMatch(/menit menit/); // regresi: {minutes_down} sudah memuat unit
        expect(t.sent[0].text).toContain('Durasi:');
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

    test('mass-outage: banyak CCTV down serempak → broadcast pelanggan DITAHAN + 1 alert admin', async () => {
        const devices = [
            { id: 'a', name: 'CCTV A', host: '10.0.0.1', phone: '6281', enabled: true },
            { id: 'b', name: 'CCTV B', host: '10.0.0.2', phone: '6282', enabled: true },
            { id: 'c', name: 'CCTV C', host: '10.0.0.3', phone: '6283', enabled: true },
        ];
        const t = setup({ devices, confirmationMinutes: 1, massOutageThreshold: 3, massOutageAdminPhone: '628999' });
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'up' })));
        await t.m._pollOnceForTest(); // seed up
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'down' })));
        await t.m._pollOnceForTest(); // ketiganya down → pending
        t.fireTimers(); // window → onConfirm: countDown=3 >= 3 → tahan broadcast pelanggan
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0); // pelanggan TIDAK di-broadcast
        const alerts = t.sent.filter(x => x.label === 'cctv_mass_outage');
        expect(alerts).toHaveLength(1); // 1 ringkasan ke admin (cooldown menahan duplikat)
        expect(alerts[0].phone).toBe('628999');
        expect(alerts[0].text).toContain('3');
        expect(t.incidents.filter(i => i.status === 'mass_suppressed').length).toBe(3);
    });

    test('di bawah ambang → broadcast normal (bukan mass-outage)', async () => {
        const devices = [
            { id: 'a', name: 'CCTV A', host: '10.0.0.1', phone: '6281', enabled: true },
            { id: 'b', name: 'CCTV B', host: '10.0.0.2', phone: '6282', enabled: true },
        ];
        const t = setup({ devices, confirmationMinutes: 1, massOutageThreshold: 3, massOutageAdminPhone: '628999' });
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'up' })));
        await t.m._pollOnceForTest();
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'down' })));
        await t.m._pollOnceForTest();
        t.fireTimers(); // 2 down < 3 → broadcast normal
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(2);
        expect(t.sent.filter(x => x.label === 'cctv_mass_outage')).toHaveLength(0);
    });

    test('opt-out (notifyCustomer=false) → tidak broadcast ke pelanggan', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '192.168.99.1', phone: '628111', enabled: true, notifyCustomer: false };
        const t = setup({ devices: [dev], confirmationMinutes: 1 });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
        expect(t.incidents.some(i => i.status === 'customer_optout')).toBe(true);
    });

    test('isWithinQuiet menangani window normal & lewat tengah malam', () => {
        expect(isWithinQuiet('23:30', '22:00', '06:00')).toBe(true);
        expect(isWithinQuiet('05:00', '22:00', '06:00')).toBe(true);
        expect(isWithinQuiet('12:00', '22:00', '06:00')).toBe(false);
        expect(isWithinQuiet('06:00', '22:00', '06:00')).toBe(false); // end eksklusif
        expect(isWithinQuiet('13:00', '09:00', '17:00')).toBe(true);
        expect(isWithinQuiet('08:00', '09:00', '17:00')).toBe(false);
    });

    test('jam tenang: DOWN ditahan, lalu terkirim saat jam tenang berakhir', async () => {
        // now() test = 1.7e12 → 05:13 WIB → di dalam jam tenang 22:00–06:00
        const t = setup({ devices: [DEV], confirmationMinutes: 1, quietHoursEnabled: true, quietStart: '22:00', quietEnd: '06:00' });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // onConfirm di jam tenang → ditahan
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
        expect(t.incidents.some(i => i.status === 'deferred_quiet')).toBe(true);
        t.advance(60 * 60_000); // +1 jam → 06:13 WIB (lewat jam tenang)
        await t.m._pollOnceForTest(); // sweep: masih down → antre broadcast
        t.fireTimers(); // flush jendela gabung → kirim
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
    });

    test('jam tenang: pulih sebelum pagi → tak terkirim (deferred_resolved)', async () => {
        const t = setup({ devices: [DEV], confirmationMinutes: 1, quietHoursEnabled: true });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // ditahan
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih (masih jam tenang) → sweep: status up → resolved
        t.advance(60 * 60_000);
        await t.m._pollOnceForTest();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
        expect(t.incidents.some(i => i.status === 'deferred_resolved')).toBe(true);
    });

    test('gabung per-penerima: 2 CCTV nomor sama → 1 pesan gabungan', async () => {
        const devices = [
            { id: 'a', name: 'CCTV A', host: '10.0.0.1', phone: '628777', customerName: 'Pak RT', enabled: true },
            { id: 'b', name: 'CCTV B', host: '10.0.0.2', phone: '628777', customerName: 'Pak RT', enabled: true },
        ];
        const t = setup({ devices, confirmationMinutes: 1 });
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'up' })));
        await t.m._pollOnceForTest();
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'down' })));
        await t.m._pollOnceForTest();
        t.fireTimers(); // 2 onConfirm → antre → flush jendela gabung → 1 pesan ke 628777
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs).toHaveLength(1);
        expect(downs[0].phone).toBe('628777');
        expect(downs[0].text).toContain('CCTV A');
        expect(downs[0].text).toContain('CCTV B');
    });

    test('nomor berbeda → tetap pesan terpisah (bukan gabung)', async () => {
        const devices = [
            { id: 'a', name: 'CCTV A', host: '10.0.0.1', phone: '628111', enabled: true },
            { id: 'b', name: 'CCTV B', host: '10.0.0.2', phone: '628222', enabled: true },
        ];
        const t = setup({ devices, confirmationMinutes: 1 });
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'up' })));
        await t.m._pollOnceForTest();
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'down' })));
        await t.m._pollOnceForTest();
        t.fireTimers();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(2);
    });

    test('koordinator area dinotif saat CCTV di areanya mati (flat: pelanggan + koordinator)', async () => {
        const dev = { id: 'c1', name: 'CCTV Lapangan', host: '10.0.0.1', phone: '628111', customerName: 'Warga', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, coordinators: { dander: { coordinatorPhone: '628RT', coordinatorName: 'Pak RT', enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs).toHaveLength(2); // pelanggan + koordinator
        const coord = downs.find(x => x.phone === '628RT');
        expect(coord).toBeTruthy();
        expect(coord.text).toContain('DANDER');
        expect(coord.text).toContain('Pak RT');
        expect(downs.find(x => x.phone === '628111')).toBeTruthy();
    });

    test('opt-out pelanggan tetap kirim ke koordinator area', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', area: 'DANDER', enabled: true, notifyCustomer: false };
        const t = setup({ devices: [dev], confirmationMinutes: 1, coordinators: { dander: { coordinatorPhone: '628RT', enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs).toHaveLength(1);
        expect(downs[0].phone).toBe('628RT'); // koordinator saja, pelanggan di-skip
    });

    test('koordinator: 2 CCTV satu area → 1 pesan gabungan ke koordinator', async () => {
        const devices = [
            { id: 'a', name: 'CCTV A', host: '10.0.0.1', phone: '628a', area: 'DANDER', enabled: true },
            { id: 'b', name: 'CCTV B', host: '10.0.0.2', phone: '628b', area: 'DANDER', enabled: true },
        ];
        const t = setup({ devices, confirmationMinutes: 1, coordinators: { dander: { coordinatorPhone: '628RT', coordinatorName: 'Pak RT', enabled: true } } });
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'up' })));
        await t.m._pollOnceForTest();
        t.setNetwatch(devices.map(d => ({ host: d.host, status: 'down' })));
        await t.m._pollOnceForTest();
        t.fireTimers();
        const toCoord = t.sent.filter(x => x.label === 'cctv_down' && x.phone === '628RT');
        expect(toCoord).toHaveLength(1); // 1 pesan gabungan ke koordinator
        expect(toCoord[0].text).toContain('CCTV A');
        expect(toCoord[0].text).toContain('CCTV B');
    });

    test('grup WA RT dinotif saat CCTV di areanya mati (target = grup @g.us)', async () => {
        const dev = { id: 'c1', name: 'CCTV Lapangan', host: '10.0.0.1', phone: '628111', customerName: 'Warga', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, coordinators: { dander: { coordinatorGroupId: '12036300@g.us', coordinatorName: 'Grup RT', enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        const grp = downs.find(x => x.phone === '12036300@g.us'); // JID grup diteruskan apa adanya
        expect(grp).toBeTruthy();
        expect(grp.text).toContain('DANDER');
        expect(downs.find(x => x.phone === '628111')).toBeTruthy(); // pelanggan tetap dapat
    });

    test('warga di grup (customersInGroup): pelanggan TIDAK dijapri, cukup ke grup', async () => {
        const dev = { id: 'c1', name: 'CCTV Lapangan', host: '10.0.0.1', phone: '628111', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, coordinators: { dander: { coordinatorGroupId: '12036300@g.us', coordinatorName: 'Grup RT', customersInGroup: true, enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs).toHaveLength(1); // hanya grup
        expect(downs[0].phone).toBe('12036300@g.us');
        expect(t.sent.find(x => x.phone === '628111')).toBeFalsy(); // pelanggan TIDAK dijapri (sudah di grup)
    });

    test('runTestBroadcast: tetap kirim ke koordinator + grup walau nomor pelanggan KOSONG', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], coordinators: { dander: { coordinatorPhone: '628RT', coordinatorGroupId: '12036300@g.us', coordinatorName: 'Pak RT', enabled: true } } });
        const r = await t.m.runTestBroadcast(dev);
        expect(r.total).toBe(2); // koordinator + grup (pelanggan kosong → tak dihitung)
        expect(r.recipients.map(x => x.role).sort()).toEqual(['coordinator', 'group']);
        const tests = t.sent.filter(x => x.label === 'cctv_test');
        expect(tests).toHaveLength(2);
        expect(tests.every(x => /PESAN TES/.test(x.text))).toBe(true); // semua bertanda tes
    });

    test('coordinatorInGroup: nomor pribadi koordinator TIDAK dijapri (cukup grup)', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, coordinators: { dander: { coordinatorPhone: '628RT', coordinatorGroupId: '12036300@g.us', coordinatorInGroup: true, enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs).toHaveLength(1); // hanya grup
        expect(downs[0].phone).toBe('12036300@g.us');
        expect(t.sent.find(x => x.phone === '628RT')).toBeFalsy(); // nomor koordinator TIDAK dijapri
    });

    test('notif PULIH dikirim ke koordinator + grup (bukan cuma pelanggan)', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, coordinators: { dander: { coordinatorPhone: '628RT', coordinatorGroupId: '12036300@g.us', coordinatorName: 'Pak RT', enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // broadcast DOWN
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih → broadcastUp (fire-and-forget, multi penerima)
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        const ups = t.sent.filter(x => x.label === 'cctv_up');
        expect(ups.find(x => x.phone === '628111')).toBeTruthy();        // pelanggan
        expect(ups.find(x => x.phone === '628RT')).toBeTruthy();         // koordinator
        expect(ups.find(x => x.phone === '12036300@g.us')).toBeTruthy(); // grup
    });

    test('snooze/maintenance: down saat snooze TIDAK broadcast; setelah snooze habis & masih down → broadcast', async () => {
        const NOWMS = 1_700_000_000_000;
        const dev = { id: 'c1', name: 'CCTV X', host: '192.168.99.1', phone: '628111', enabled: true, snoozeUntil: NOWMS + 60 * 60_000 }; // snooze 1 jam
        const t = setup({ devices: [dev], confirmationMinutes: 1 });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // seed up
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest(); // down SAAT snooze → status dibekukan, tak ada pending
        t.fireTimers();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0); // dibisukan
        t.advance(61 * 60_000); // lewati snooze
        await t.m._pollOnceForTest(); // snooze habis + masih down → transisi terdeteksi → pending
        t.fireTimers();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1); // baru broadcast setelah snooze
    });

    test('jam tenang per-jenis: koordinator dikecualikan → dialert langsung, pelanggan ditahan lalu dikirim saat pagi', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, quietHoursEnabled: true, quietApplyCoordinator: false, coordinators: { dander: { coordinatorPhone: '628RT', coordinatorName: 'Pak RT', enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // jam tenang: koordinator (dikecualikan) dikirim, pelanggan ditahan
        let downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs).toHaveLength(1);
        expect(downs[0].phone).toBe('628RT'); // koordinator dialert walau jam tenang
        expect(t.sent.find(x => x.phone === '628111')).toBeFalsy(); // pelanggan ditahan
        t.advance(60 * 60_000); // 05:13→06:13 WIB → jam tenang berakhir
        await t.m._pollOnceForTest(); // sweep → antre pelanggan yg ditahan (jendela agregasi)
        t.fireTimers(); // jendela agregasi → kirim
        downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs.find(x => x.phone === '628111')).toBeTruthy(); // pelanggan dikirim setelah jam tenang
    });

    test('jam tenang default (semua jenis): seluruh broadcast ditahan sampai jam tenang berakhir', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, quietHoursEnabled: true, coordinators: { dander: { coordinatorPhone: '628RT', enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0); // semua ditahan (default semua jenis)
        t.advance(60 * 60_000);
        await t.m._pollOnceForTest();
        t.fireTimers();
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs.find(x => x.phone === '628111')).toBeTruthy();
        expect(downs.find(x => x.phone === '628RT')).toBeTruthy();
    });

    test('jam tenang per-area: area "off" → broadcast langsung walau jam tenang GLOBAL aktif', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', area: 'PASAR', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, quietHoursEnabled: true, coordinators: { pasar: { coordinatorPhone: '628RT', enabled: true, quietMode: 'off' } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // area "off" → tak ditahan → kirim langsung walau global jam tenang
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs.find(x => x.phone === '628111')).toBeTruthy();
    });

    test('jam tenang per-area: area "custom" → ditahan walau jam tenang GLOBAL mati', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', area: 'PASAR', enabled: true };
        // global OFF, area custom dgn jendela mencakup waktu test (≈05:13 WIB)
        const t = setup({ devices: [dev], confirmationMinutes: 1, quietHoursEnabled: false, coordinators: { pasar: { coordinatorPhone: '628RT', enabled: true, quietMode: 'custom', quietStart: '00:00', quietEnd: '06:00' } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0); // ditahan oleh jam tenang AREA
    });

    test('anti tak-sinkron: pulih saat DOWN masih di antrean → UP terkirim, DOWN di-skip (bukan nyusul)', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1 }); // aggregateWindowMs=90000 (default) → DOWN diantre
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireKind('confirm'); // window konfirmasi → onConfirm → DOWN MASUK antrean agregasi (belum terkirim)
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih SAAT DOWN masih di antrean → UP dikirim
        t.fireKind('batch'); // jendela agregasi habis → flush: CCTV sudah 'up' → DOWN di-skip
        expect(t.sent.filter(x => x.label === 'cctv_up')).toHaveLength(1);    // UP terkirim
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);  // DOWN TIDAK nyusul (CCTV sudah pulih)
    });

    test('agregasi: saat flush hanya CCTV yang MASIH mati dikirim DOWN; yg pulih di-skip + dapat UP', async () => {
        const devs = [
            { id: 'a', name: 'CCTV A', host: '10.0.0.1', phone: '628a', enabled: true },
            { id: 'b', name: 'CCTV B', host: '10.0.0.2', phone: '628b', enabled: true },
        ];
        const t = setup({ devices: devs, confirmationMinutes: 1 });
        t.setNetwatch(devs.map(d => ({ host: d.host, status: 'up' }))); await t.m._pollOnceForTest();
        t.setNetwatch(devs.map(d => ({ host: d.host, status: 'down' }))); await t.m._pollOnceForTest();
        t.fireKind('confirm'); // A & B → onConfirm → keduanya masuk antrean agregasi
        // A pulih sebelum flush, B masih mati
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }, { host: '10.0.0.2', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireKind('batch'); // flush
        const downs = t.sent.filter(x => x.label === 'cctv_down');
        expect(downs.find(x => x.phone === '628b')).toBeTruthy();  // B (masih mati) dapat DOWN
        expect(downs.find(x => x.phone === '628a')).toBeFalsy();    // A (sudah pulih) TIDAK dapat DOWN
        expect(t.sent.filter(x => x.label === 'cctv_up').find(x => x.phone === '628a')).toBeTruthy(); // A dapat UP
    });

    test('regresi: pulih SETELAH DOWN benar-benar terkirim → UP tetap dikirim (urut)', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1 });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireKind('confirm'); t.fireKind('batch'); // DOWN benar-benar terkirim
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih setelah DOWN terkirim → UP wajar
        expect(t.sent.filter(x => x.label === 'cctv_up')).toHaveLength(1);
    });

    test('jam tenang per-jenis: pulih sebelum pagi → "pulih" HANYA ke yg tadi dapat "mati"', async () => {
        const dev = { id: 'c1', name: 'CCTV X', host: '10.0.0.1', phone: '628111', area: 'DANDER', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 1, quietHoursEnabled: true, quietApplyCoordinator: false, coordinators: { dander: { coordinatorPhone: '628RT', coordinatorName: 'Pak RT', enabled: true } } });
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '10.0.0.1', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers(); // koordinator dapat "mati", pelanggan ditahan
        t.setNetwatch([{ host: '10.0.0.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih saat masih jam tenang
        await new Promise(r => setImmediate(r));
        const ups = t.sent.filter(x => x.label === 'cctv_up');
        expect(ups.find(x => x.phone === '628RT')).toBeTruthy();   // koordinator dapat "pulih"
        expect(ups.find(x => x.phone === '628111')).toBeFalsy();   // pelanggan tak dapat "pulih" (tak pernah dapat "mati")
    });

    test('tahan-restart: insiden pending dipulihkan → broadcast saat sisa window habis', async () => {
        const NOWMS = 1_700_000_000_000;
        const dev = { id: 'c1', name: 'CCTV X', host: '192.168.99.1', phone: '628111', enabled: true };
        const t = setup({ devices: [dev], confirmationMinutes: 15, seedIncidents: [
            { incidentId: 'i1', host: '192.168.99.1', detectedAt: new Date(NOWMS - 5 * 60_000).toISOString(), confirmationMinutes: 15, status: 'pending' },
        ] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]); // masih mati saat boot
        await t.m._pollOnceForTest(); // seed + restore → pending dipulihkan (sisa ~10 menit)
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
        t.fireTimers(); // sisa window habis → broadcast (notif yang nyaris hilang akibat restart)
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
    });

    test('tahan-restart: insiden broadcasted dipulihkan → notif pulih tetap jalan', async () => {
        const NOWMS = 1_700_000_000_000;
        const dev = { id: 'c1', name: 'CCTV X', host: '192.168.99.1', phone: '628111', enabled: true };
        const t = setup({ devices: [dev], seedIncidents: [
            { incidentId: 'i1', host: '192.168.99.1', detectedAt: new Date(NOWMS - 20 * 60_000).toISOString(), broadcastedAt: new Date(NOWMS - 19 * 60_000).toISOString(), status: 'broadcasted' },
        ] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'down' }]);
        await t.m._pollOnceForTest(); // restore active
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih → notif up
        expect(t.sent.filter(x => x.label === 'cctv_up')).toHaveLength(1);
    });

    test('tahan-restart: insiden terbuka tapi host sudah UP → ditutup (recovered), tak broadcast', async () => {
        const NOWMS = 1_700_000_000_000;
        const dev = { id: 'c1', name: 'CCTV X', host: '192.168.99.1', phone: '628111', enabled: true };
        const t = setup({ devices: [dev], seedIncidents: [
            { incidentId: 'i1', host: '192.168.99.1', detectedAt: new Date(NOWMS - 60 * 60_000).toISOString(), status: 'pending' },
        ] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]); // sudah pulih saat boot
        await t.m._pollOnceForTest(); // restore: host up + insiden terbuka → ditutup
        const inc = t.incidents.find(i => i.incidentId === 'i1');
        expect(inc && inc.recoveredAt).toBeTruthy();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
    });

    test('tahan-restart: insiden BROADCASTED + host sudah UP saat boot → notif "pulih" SUSULAN (pelanggan sudah dapat "mati")', async () => {
        const NOWMS = 1_700_000_000_000;
        const dev = { id: 'c1', name: 'CCTV X', host: '192.168.99.1', phone: '628111', customerName: 'Pak Joko', enabled: true };
        const t = setup({ devices: [dev], seedIncidents: [
            { incidentId: 'i1', host: '192.168.99.1', detectedAt: new Date(NOWMS - 30 * 60_000).toISOString(), broadcastedAt: new Date(NOWMS - 29 * 60_000).toISOString(), status: 'broadcasted' },
        ] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]); // pulih persis saat bot restart
        await t.m._pollOnceForTest(); // seed up + restore → WAJIB kirim "pulih" susulan (dulu diam-diam)
        const ups = t.sent.filter(x => x.label === 'cctv_up');
        expect(ups).toHaveLength(1);
        expect(ups[0].text).toContain('online kembali');
        const inc = t.incidents.find(i => i.incidentId === 'i1');
        expect(inc && inc.recoveredAt).toBeTruthy(); // insiden tetap ditutup (akurasi uptime)
    });

    test('tahan-restart: BROADCASTED + host UP + notifyRecovery=false → tidak kirim notif pulih', async () => {
        const NOWMS = 1_700_000_000_000;
        const dev = { id: 'c1', name: 'CCTV X', host: '192.168.99.1', phone: '628111', enabled: true };
        const t = setup({ devices: [dev], notifyRecovery: false, seedIncidents: [
            { incidentId: 'i1', host: '192.168.99.1', detectedAt: new Date(NOWMS - 30 * 60_000).toISOString(), broadcastedAt: new Date(NOWMS - 29 * 60_000).toISOString(), status: 'broadcasted' },
        ] });
        t.setNetwatch([{ host: '192.168.99.1', status: 'up' }]);
        await t.m._pollOnceForTest();
        expect(t.sent.filter(x => x.label === 'cctv_up')).toHaveLength(0);
    });
});

// Gerbang SADAR-MODEM: silang-cek CCTV-down ke kluster dying-gasp OLT → tahan broadcast saat mati listrik area.
describe('cctv-monitor: gerbang mati-listrik (dying-gasp)', () => {
    const AREADEV = { id: 'c1', name: 'CCTV Selatan Ahass', host: '192.168.13.8', phone: '628111', customerName: 'Pak Joko', area: 'DANDER', enabled: true };

    async function downThenConfirm(t, host = '192.168.13.8') {
        t.setNetwatch([{ host, status: 'up' }]);
        await t.m._pollOnceForTest();               // seed up
        t.setNetwatch([{ host, status: 'down' }]);
        await t.m._pollOnceForTest();               // transisi → pending + tangkap verdikt outage
        t.fireTimers();                             // window konfirmasi habis → onConfirm (sinkron)
    }

    test('mati listrik area (dg ≥ ambang) → broadcast pelanggan DITAHAN + 1 ringkasan admin', async () => {
        const t = setup({
            devices: [AREADEV], confirmationMinutes: 15, powerOutageDgThreshold: 3, powerOutageAdminPhone: '628700',
            powerOutageContext: { dgOnu: 32, customers: ['Mas Sandi', 'CCTV Selatan Ahass', 'Widodo'], firstAtMs: 1_700_000_000_000 - 6 * 60_000 },
        });
        await downThenConfirm(t);
        // Pelanggan TIDAK dikirimi "CCTV mati".
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
        // Admin dapat 1 ringkasan mati-listrik.
        const alerts = t.sent.filter(x => x.label === 'cctv_power_outage');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].phone).toBe('628700');
        expect(alerts[0].text).toContain('32 modem');
        expect(alerts[0].text).toContain('DANDER');
        expect(alerts[0].text).toContain('Mas Sandi');
        // Insiden ditandai power_outage_suppressed dengan jumlah dg.
        const inc = t.incidents.find(i => i.status === 'power_outage_suppressed');
        expect(inc).toBeDefined();
        expect(inc.dgOnu).toBe(32);
    });

    test('dg di BAWAH ambang → broadcast normal ke pelanggan (bukan outage)', async () => {
        const t = setup({
            devices: [AREADEV], confirmationMinutes: 15, powerOutageDgThreshold: 3,
            powerOutageContext: { dgOnu: 2, customers: ['A', 'B'], firstAtMs: 1 },
        });
        await downThenConfirm(t);
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
        expect(t.sent.filter(x => x.label === 'cctv_power_outage')).toHaveLength(0);
    });

    test('gerbang dinonaktifkan → broadcast normal walau banyak dying-gasp (gate tak dipanggil)', async () => {
        const t = setup({
            devices: [AREADEV], confirmationMinutes: 15, powerOutageGateEnabled: false,
            powerOutageContext: { dgOnu: 50, customers: [], firstAtMs: 1 },
        });
        await downThenConfirm(t);
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
        expect(t.powerCalls()).toBe(0); // pollOnce lewati capture pass saat gerbang mati
    });

    test('gate error → FAIL-OPEN: broadcast tetap terkirim (jangan menahan karena buta)', async () => {
        const t = setup({ devices: [AREADEV], confirmationMinutes: 15, powerOutageThrows: true });
        await downThenConfirm(t);
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(1);
        expect(t.sent.filter(x => x.label === 'cctv_power_outage')).toHaveLength(0);
    });

    test('ditahan karena outage → TIDAK ada notif "pulih" saat CCTV nyala lagi', async () => {
        const t = setup({
            devices: [AREADEV], confirmationMinutes: 15, powerOutageDgThreshold: 3, powerOutageAdminPhone: '628700',
            powerOutageContext: { dgOnu: 32, customers: ['X'], firstAtMs: 1 },
        });
        await downThenConfirm(t);
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
        t.setNetwatch([{ host: '192.168.13.8', status: 'up' }]);
        await t.m._pollOnceForTest(); // pulih
        expect(t.sent.filter(x => x.label === 'cctv_up')).toHaveLength(0); // tak pernah "mati" → tak ada "pulih"
    });

    test('ringkasan admin fallback ke getAdminJids saat nomor admin kosong', async () => {
        const t = setup({
            devices: [AREADEV], confirmationMinutes: 15, powerOutageDgThreshold: 3,
            powerOutageAdminPhone: '', massOutageAdminPhone: '', adminJids: ['628999@s.whatsapp.net'],
            powerOutageContext: { dgOnu: 5, customers: ['X'], firstAtMs: 1 },
        });
        await downThenConfirm(t);
        const alerts = t.sent.filter(x => x.label === 'cctv_power_outage');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].phone).toBe('628999@s.whatsapp.net');
    });

    test('cooldown: dua CCTV ditahan berbarengan → hanya 1 ringkasan admin, dua insiden ditandai', async () => {
        const dev2 = { ...AREADEV, id: 'c2', name: 'CCTV Pertigaan', host: '192.168.12.4' };
        const t = setup({
            devices: [AREADEV, dev2], confirmationMinutes: 15, powerOutageDgThreshold: 3, powerOutageAdminPhone: '628700',
            powerOutageContext: { dgOnu: 32, customers: ['X'], firstAtMs: 1 },
        });
        t.setNetwatch([{ host: '192.168.13.8', status: 'up' }, { host: '192.168.12.4', status: 'up' }]);
        await t.m._pollOnceForTest();
        t.setNetwatch([{ host: '192.168.13.8', status: 'down' }, { host: '192.168.12.4', status: 'down' }]);
        await t.m._pollOnceForTest();
        t.fireTimers();
        expect(t.sent.filter(x => x.label === 'cctv_down')).toHaveLength(0);
        expect(t.sent.filter(x => x.label === 'cctv_power_outage')).toHaveLength(1); // cooldown → 1 ringkasan
        expect(t.incidents.filter(i => i.status === 'power_outage_suppressed')).toHaveLength(2);
    });
});
