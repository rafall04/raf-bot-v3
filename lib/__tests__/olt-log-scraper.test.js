const oltScraper = require('../olt-log-scraper');

describe('olt-log-scraper runtime state', () => {
    const olt = {
        id: 'olt-1',
        name: 'OLT Pusat',
        host: '192.168.11.2'
    };

    afterEach(() => {
        oltScraper.__testHooks.resetDeviceStatuses();
    });

    test('marks first failure as degraded', () => {
        oltScraper.__testHooks.markDeviceFailure(olt, 'Request timeout');

        const state = oltScraper.__testHooks.getDeviceState(olt);
        expect(state.status).toBe('degraded');
        expect(state.failure_count).toBe(1);
        expect(oltScraper.__testHooks.shouldSkipDeviceScrape(olt)).toBe(false);
    });

    test('marks repeated failures as unreachable with backoff', () => {
        oltScraper.__testHooks.markDeviceFailure(olt, 'Request timeout');
        oltScraper.__testHooks.markDeviceFailure(olt, 'Request timeout');
        oltScraper.__testHooks.markDeviceFailure(olt, 'Request timeout');

        const state = oltScraper.__testHooks.getDeviceState(olt);
        expect(state.status).toBe('unreachable');
        expect(state.failure_count).toBe(3);
        expect(oltScraper.__testHooks.shouldSkipDeviceScrape(olt)).toBe(true);
    });

    test('resets device state to healthy after success', () => {
        oltScraper.__testHooks.markDeviceFailure(olt, 'socket hang up');
        oltScraper.__testHooks.markDeviceHealthy(olt);

        const state = oltScraper.__testHooks.getDeviceState(olt);
        expect(state.status).toBe('healthy');
        expect(state.failure_count).toBe(0);
        expect(state.last_error).toBeNull();
    });
});

/**
 * Korelasi DG↔Lost saat web log Hioso dipaginasi newest-page-first (akar bug "mass
 * outage salah vonis LOS"). processLog WAJIB menyortir kronologis dulu: tanpa itu
 * "Lost" (lebih baru, di halaman awal) diproses sebelum "dying-gasp" pasangannya
 * (halaman lebih lama) → salah vonis LOS justru saat mati total.
 */
describe('olt-log-scraper: korelasi DG↔Lost lintas-halaman', () => {
    const { processLog, sortLogLinesChronologically } = oltScraper.__testHooks;
    const norm = oltScraper.normalizeMAC;
    // processLog auto-offset timestamp ke "log terbaru", jadi tanggal apa pun aman asal
    // antar-baris berdekatan (di sini detik yang sama, sesuai ground-truth Hioso).
    const TS = 'Jun 10 11:00:53';

    test('sortLogLinesChronologically: dying-gasp mendahului Lost di detik yang sama', () => {
        const MAC = 'c0:f6:ec:1e:ff:da';
        const lostFirst = [
            `${TS} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`,
            `${TS} EPON: Onu 0/1/1:4 ${MAC} dying-gasp`,
        ];
        const sorted = sortLogLinesChronologically(lostFirst);
        expect(sorted[0]).toContain('dying-gasp');
        expect(sorted[1]).toContain('Lost');
    });

    test('MASS OUTAGE: Lost sebelum dying-gasp di array (newest-page-first) → tetap DYING-GASP', () => {
        const MAC = 'c0:f6:ec:1e:ff:da';
        const lines = [
            `${TS} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`,
            `${TS} EPON: Onu 0/1/1:4 ${MAC} dying-gasp`,
        ];
        const events = {};
        processLog(lines, events, 10);
        expect(events[norm(MAC)]).toBeDefined();
        expect(events[norm(MAC)].event_type).toBe('dying-gasp');
    });

    test('LOS sejati: Lost tanpa dying-gasp → los', () => {
        const MAC = 'aa:bb:cc:dd:ee:ff';
        const events = {};
        processLog([`${TS} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`], events, 10);
        expect(events[norm(MAC)].event_type).toBe('los');
    });

    test('campur banyak ONU urutan terbalik → tiap MAC terklasifikasi benar', () => {
        const A = '11:11:11:11:11:11'; // power outage (DG + Lost)
        const B = '22:22:22:22:22:22'; // fiber cut (Lost saja)
        const lines = [
            `${TS} EPON: Slot 0/1/1:4 Onu ${B}[Na] Lost`,
            `${TS} EPON: Slot 0/1/1:5 Onu ${A}[Na] Lost`,
            `${TS} EPON: Onu 0/1/1:5 ${A} dying-gasp`,
        ];
        const events = {};
        processLog(lines, events, 10);
        expect(events[norm(A)].event_type).toBe('dying-gasp');
        expect(events[norm(B)].event_type).toBe('los');
    });

    test('Discovery menghapus event offline (pulih)', () => {
        const MAC = '33:33:33:33:33:33';
        const events = {};
        processLog([`${TS} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`], events, 10);
        expect(events[norm(MAC)]).toBeDefined();
        processLog([`Jun 10 11:01:30 EPON: Onu 0/1/1:4 ${MAC} [Na] Discovery`], events, 10);
        expect(events[norm(MAC)]).toBeUndefined();
    });
});

/**
 * HWM (high-water-mark) reconciliation. Saat syslog HILANG (mis. link radio TNJ sempat
 * down), event terlewat tetap ada di buffer web OLT. Scrape backstop memprosesnya kembali
 * berbasis "event terakhir yang sudah dilihat" (HWM) — BUKAN filter jendela-waktu yang
 * dulu membuang event lama. Patokan per-event → celah radio ter-recover.
 *
 * Timestamp dibangun relatif terhadap `now` supaya tidak flaky lintas musim (parseTimestamp
 * meng-asumsikan tahun berjalan; tanggal yang masih di masa depan akan di-wrap ke tahun lalu).
 */
describe('olt-log-scraper: HWM reconciliation (pulihkan celah link/radio)', () => {
    const { processLog } = oltScraper.__testHooks;
    const norm = oltScraper.normalizeMAC;
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n) => String(n).padStart(2, '0');
    // Format Date → "Mon D HH:MM:SS" (gaya log Hioso).
    const fmt = (d) => `${MON[d.getMonth()]} ${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    // ms yang AKAN dihasilkan parseTimestamp untuk sebuah Date (detik, jam lokal, tahun berjalan).
    const logMs = (d) => new Date(`${new Date().getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`).getTime();
    const minsAgo = (m) => new Date(Date.now() - m * 60_000);

    test('tanpa HWM: event di luar jendela-waktu (10 mnt) dibuang (perilaku lama dipertahankan)', () => {
        const MAC = 'aa:bb:cc:dd:ee:01';
        const anchor = minsAgo(0);
        const gap = minsAgo(60); // 60 mnt lebih lama dari anchor → di luar window 10 mnt
        const lines = [
            `${fmt(anchor)} EPON: Slot 0/1/1:9 Onu 00:00:00:00:00:09[Na] Lost`,
            `${fmt(gap)} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`,
        ];
        const events = {};
        processLog(lines, events, 10);
        expect(events[norm(MAC)]).toBeUndefined();
    });

    test('HWM mode: event lama (di luar jendela) tapi > HWM TETAP dipulihkan', () => {
        const MAC = 'aa:bb:cc:dd:ee:01';
        const anchor = minsAgo(0);
        const gap = minsAgo(60);
        const lines = [
            `${fmt(anchor)} EPON: Slot 0/1/1:9 Onu 00:00:00:00:00:09[Na] Lost`,
            `${fmt(gap)} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`,
        ];
        const events = {};
        const report = {};
        processLog(lines, events, 10, { hwmMs: minsAgo(120).getTime(), report });
        expect(events[norm(MAC)]).toBeDefined();
        expect(events[norm(MAC)].event_type).toBe('los');
        // HWM baru = event terbaru yang diproses (anchor).
        expect(report.newHwmMs).toBe(logMs(anchor));
    });

    test('HWM mode: event <= HWM dilewati (sudah pernah diproses) & HWM tak mundur', () => {
        const MAC = 'aa:bb:cc:dd:ee:02';
        const gap = minsAgo(60);
        const hwm = minsAgo(30).getTime(); // HWM lebih BARU dari event
        const events = {};
        const report = {};
        processLog([`${fmt(gap)} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`], events, 10, { hwmMs: hwm, report });
        expect(events[norm(MAC)]).toBeUndefined();
        expect(report.newHwmMs).toBe(hwm);
    });

    test('HWM mode: korelasi DG↔Lost tetap benar untuk event yang dipulihkan (anti salah-vonis)', () => {
        const MAC = 'aa:bb:cc:dd:ee:03';
        const anchor = minsAgo(0);
        const gap = minsAgo(60);
        const lines = [
            `${fmt(anchor)} EPON: Slot 0/1/1:9 Onu 00:00:00:00:00:09[Na] Lost`,
            `${fmt(gap)} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`,        // urutan terbalik (newest-page-first)
            `${fmt(gap)} EPON: Onu 0/1/1:4 ${MAC} dying-gasp`,          // detik sama → DG
        ];
        const events = {};
        processLog(lines, events, 10, { hwmMs: minsAgo(120).getTime(), report: {} });
        expect(events[norm(MAC)].event_type).toBe('dying-gasp');
    });

    test('bootstrap (tanpa HWM): event TERBARU diproses (relative window) & HWM maju ke situ (anti deep-read ulang)', () => {
        const e1 = minsAgo(60);
        const e2 = minsAgo(45); // terbaru di buffer
        const lines = [
            `${fmt(e1)} EPON: Slot 0/1/1:4 Onu aa:bb:cc:dd:ee:10[Na] Lost`,
            `${fmt(e2)} EPON: Slot 0/1/1:5 Onu aa:bb:cc:dd:ee:11[Na] Lost`,
        ];
        const events = {};
        const report = {};
        // Window relatif ke log terbaru → event TERBARU (e2) diproses; HWM maju ke e2 supaya
        // siklus berikut tidak membaca ulang seluruh buffer.
        processLog(lines, events, 10, { report });
        expect(events[norm('aa:bb:cc:dd:ee:11')]).toBeDefined();
        expect(report.newHwmMs).toBe(logMs(e2));
    });

    test('HWM mode: guard reset jam OLT (HWM jauh di masa depan) → fallback jendela-waktu, tidak skip-semua', () => {
        const MAC = 'aa:bb:cc:dd:ee:04';
        const gap = minsAgo(5); // dalam jendela 10 mnt
        const events = {};
        const report = {};
        // HWM 2 hari LEBIH BARU dari event → naif-nya event di-skip; guard reset-jam mencegahnya.
        processLog([`${fmt(gap)} EPON: Slot 0/1/1:4 Onu ${MAC}[Na] Lost`], events, 10, {
            hwmMs: Date.now() + 2 * 24 * 60 * 60 * 1000,
            report,
        });
        expect(events[norm(MAC)]).toBeDefined();
    });
});
