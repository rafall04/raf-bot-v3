/**
 * Guard anti-overlap scrapeOltLog: dua siklus TIDAK boleh jalan barengan, kalau tidak
 * dua fetch ke OLT yang SAMA (httpd single-client) bisa ECONNREFUSED. Mirror pola
 * isPolling di lib/olt-rxpower-poller.js.
 *
 * File terpisah karena pakai jest.mock(fs/olt-manager) yang tidak boleh bocor ke test
 * processLog/fetchOltLog di olt-log-scraper.test.js.
 */

// Hindari tulis file nyata.
jest.mock('fs', () => {
    const real = jest.requireActual('fs');
    return {
        ...real,
        existsSync: jest.fn(() => false),
        readFileSync: jest.fn(() => '{}'),
        writeFileSync: jest.fn(),
    };
});

// olt-manager: enabled + 1 device host belum dikonfigurasi (ISI_) → jalur "skipped", TANPA
// HTTP/network. getOltDevices dipakai sebagai penanda "siklus benar-benar jalan".
const mockGetOltDevices = jest.fn(() => [{ id: 'olt1', name: 'OLT Test', host: 'ISI_HOST' }]);
jest.mock('../olt-manager', () => ({
    getOltDevices: mockGetOltDevices,
    getOltGlobalConfig: () => ({ enabled: true, webEnabled: true, scrapeInterval: 1, timeWindow: 10, maxLogPages: 20 }),
    getOltDevice: () => null,
    updateMacCache: () => {},
    saveMacCache: () => {},
    getOltFromMac: () => null,
}));

const scraper = require('../olt-log-scraper');

describe('olt-log-scraper: guard anti-overlap scrapeOltLog', () => {
    beforeEach(() => { mockGetOltDevices.mockClear(); });

    test('dua scrapeOltLog konkuren → siklus kedua di-SKIP (getOltDevices dipanggil 1×)', async () => {
        // p1 set isScraping=true lalu suspend di `await Promise.all`. p2 (sinkron) lihat
        // isScraping=true → return SEBELUM getOltDevices.
        const p1 = scraper.scrapeOltLog();
        const p2 = scraper.scrapeOltLog();
        await Promise.all([p1, p2]);
        expect(mockGetOltDevices).toHaveBeenCalledTimes(1);
    });

    test('setelah siklus selesai, scrapeOltLog berikut jalan lagi (guard di-reset di finally)', async () => {
        await scraper.scrapeOltLog();
        await scraper.scrapeOltLog();
        expect(mockGetOltDevices).toHaveBeenCalledTimes(2);
    });
});
