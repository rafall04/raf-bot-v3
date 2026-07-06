/**
 * Header Doc
 * Purpose: Unit test olt-los-verifier — verifikasi LOS↔DG via scrape web log OLT dengan deps
 *          terinjeksi (mock scraper + oltManager), tanpa HTTP nyata. Fokus: HANYA vonis 'dying-gasp'
 *          yang disaring; selain itu (los/gagal/busy/tak-ada-device/absen) → 'unknown' (fallback aman).
 * Caller: Jest.
 * Deps: `lib/olt-los-verifier`.
 */
"use strict";

const { verifyLosBatch } = require("../olt-los-verifier");

function normalize(x) { return String(x || "").replace(/[^0-9a-f]/gi, "").toUpperCase(); }
const silent = { log() {}, warn() {}, error() {} };
const dev = { host: "1.1.1.1", webUsername: "u", webPassword: "p" };
const baseCfg = { enabled: true, maxPages: 5, timeWindowMinutes: 5 };

function mockScraper(opts = {}) {
    return {
        normalizeMAC: normalize,
        isScraperBusy: () => !!opts.busy,
        fetchOltLog: jest.fn(async () => {
            if (opts.fetchThrows) throw new Error("ECONNREFUSED");
            return opts.lines || ["line"];
        }),
        processLog: (lines, events) => { Object.assign(events, opts.events || {}); return events; },
    };
}

function run(macs, { scraper, devices = [dev], config = baseCfg } = {}) {
    return verifyLosBatch(macs, {
        getScraper: () => scraper,
        getOltManager: () => ({ getOltDevices: () => devices }),
        getConfig: () => config,
        logger: silent,
    });
}

describe("olt-los-verifier", () => {
    test("web log buktikan DG → 'dying-gasp' (akan disaring caller)", async () => {
        const r = await run(["aa:bb:cc"], { scraper: mockScraper({ events: { AABBCC: { event_type: "dying-gasp" } } }) });
        expect(r.get("aa:bb:cc")).toBe("dying-gasp");
    });

    test("web log konfirmasi LOS → 'los' (lanjut)", async () => {
        const r = await run(["aa:bb:cc"], { scraper: mockScraper({ events: { AABBCC: { event_type: "los" } } }) });
        expect(r.get("aa:bb:cc")).toBe("los");
    });

    test("MAC absen di web log → 'unknown' (fallback, TIDAK disaring)", async () => {
        const r = await run(["aa:bb:cc"], { scraper: mockScraper({ events: {} }) });
        expect(r.get("aa:bb:cc")).toBe("unknown");
    });

    test("scrape gagal semua OLT → 'unknown' (fallback aman)", async () => {
        const r = await run(["aa:bb:cc"], { scraper: mockScraper({ fetchThrows: true }) });
        expect(r.get("aa:bb:cc")).toBe("unknown");
    });

    test("scraper periodik sedang jalan → skip verify, tak nge-fetch (anti-tabrakan)", async () => {
        const sc = mockScraper({ busy: true, events: { AABBCC: { event_type: "dying-gasp" } } });
        const r = await run(["aa:bb:cc"], { scraper: sc });
        expect(r.get("aa:bb:cc")).toBe("unknown");
        expect(sc.fetchOltLog).not.toHaveBeenCalled();
    });

    test("tak ada device web OLT → 'unknown' (degrade, tanpa scrape)", async () => {
        const sc = mockScraper({ events: { AABBCC: { event_type: "dying-gasp" } } });
        const r = await run(["aa:bb:cc"], { scraper: sc, devices: [] });
        expect(r.get("aa:bb:cc")).toBe("unknown");
        expect(sc.fetchOltLog).not.toHaveBeenCalled();
    });

    test("fitur nonaktif → 'unknown' tanpa scrape", async () => {
        const sc = mockScraper({ events: { AABBCC: { event_type: "dying-gasp" } } });
        const r = await run(["aa:bb:cc"], { scraper: sc, config: { enabled: false } });
        expect(r.get("aa:bb:cc")).toBe("unknown");
        expect(sc.fetchOltLog).not.toHaveBeenCalled();
    });

    test("input kosong → Map kosong", async () => {
        const r = await verifyLosBatch([], {});
        expect(r.size).toBe(0);
    });

    test("campur: DG disaring, LOS lolos, absen unknown", async () => {
        const r = await run(["aa:00:01", "aa:00:02", "aa:00:03"], {
            scraper: mockScraper({ events: { AA0001: { event_type: "dying-gasp" }, AA0002: { event_type: "los" } } }),
        });
        expect(r.get("aa:00:01")).toBe("dying-gasp");
        expect(r.get("aa:00:02")).toBe("los");
        expect(r.get("aa:00:03")).toBe("unknown");
    });

    test("webPort device diteruskan ke fetchOltLog (dukung OLT web :81/:82)", async () => {
        const sc = mockScraper({ events: {} });
        await run(["aa:bb:cc"], { scraper: sc, devices: [{ host: "172.17.41.3", webUsername: "u", webPassword: "p", webPort: 82 }] });
        expect(sc.fetchOltLog).toHaveBeenCalled();
        const args = sc.fetchOltLog.mock.calls[0];
        expect(args[0]).toBe("172.17.41.3"); // host
        expect(args[6]).toBe(82);            // port = arg ke-7
    });

    test("NEVER-THROW: getScraper meledak → semua 'unknown'", async () => {
        const r = await verifyLosBatch(["aa:bb:cc"], {
            getScraper: () => { throw new Error("boom"); },
            getConfig: () => baseCfg,
            logger: silent,
        });
        expect(r.get("aa:bb:cc")).toBe("unknown");
    });
});
