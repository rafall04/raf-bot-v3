"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const stats = require("../psb-install-stats");

describe("psb-install-stats", () => {
    const TMP = path.join(os.tmpdir(), `psb-stats-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    const JULY = Date.parse("2026-07-15T10:00:00Z");
    const AUG = Date.parse("2026-08-02T10:00:00Z");

    beforeAll(() => stats.setStatsPathForTest(TMP));
    afterAll(() => { try { fs.unlinkSync(TMP); } catch (_e) { /* noop */ } stats.setStatsPathForTest(null); });
    beforeEach(() => { try { fs.unlinkSync(TMP); } catch (_e) { /* noop */ } });

    test("monthKey format YYYY-MM", () => {
        expect(stats.monthKey(JULY)).toBe("2026-07");
        expect(stats.monthKey(AUG)).toBe("2026-08");
    });

    test("recordInstall menaikkan hitungan bulan berjalan & terpisah per bulan", () => {
        expect(stats.getMonthCount(JULY)).toBe(0);
        expect(stats.recordInstall(JULY)).toBe(1);
        expect(stats.recordInstall(JULY)).toBe(2);
        expect(stats.getMonthCount(JULY)).toBe(2);
        expect(stats.recordInstall(AUG)).toBe(1);
        expect(stats.getMonthCount(JULY)).toBe(2); // bulan lain tak terpengaruh
        expect(stats.getMonthCount(AUG)).toBe(1);
    });
});
