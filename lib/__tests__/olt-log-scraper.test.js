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
