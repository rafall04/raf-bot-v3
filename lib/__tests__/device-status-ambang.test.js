/**
 * Header Doc
 * Purpose: Mengunci ambang "modem online" (#b257) agar tak pernah turun lagi di bawah satu
 *          siklus inform periodik. Ambang lama 5 menit memvonis MATI 79% modem yang sehat.
 * Caller: Jest test runner.
 * Deps: `lib/device-status`.
 * MainFuncs: —
 * SideEffects: Tidak ada (getDeviceById dimock).
 */
"use strict";

jest.mock("../genieacs", () => ({
    getDeviceById: jest.fn(),
    getGenieAcsConfig: jest.fn(() => ({ valid: true }))
}));

const { getDeviceById } = require("../genieacs");
const { isDeviceOnline, DEFAULT_MAX_INFORM_MINUTES } = require("../device-status");

const informLalu = (menit) => {
    getDeviceById.mockResolvedValue({ ok: true, data: { _lastInform: new Date(Date.now() - menit * 60000).toISOString() } });
};

describe("#b257 — ambang online harus melebihi satu siklus inform", () => {
    test("bawaan minimal DUA siklus inform (interval terukur 900 detik = 15 menit)", () => {
        expect(DEFAULT_MAX_INFORM_MINUTES).toBeGreaterThanOrEqual(30);
    });

    test.each([1, 6, 9.7, 13.7, 15, 25])("modem sehat (inform %p menit lalu) TIDAK divonis mati", async (m) => {
        // 9,7 = median terukur di ACS prod; 13,7 = modem yang terbukti menjawab summon HTTP 200.
        informLalu(m);
        expect((await isDeviceOnline("dev-1")).online).toBe(true);
    });

    test.each([31, 45, 266, 69120])("modem yang benar-benar hilang (%p menit) tetap terdeteksi mati", async (m) => {
        // 266 menit & 48 hari = dua modem yang MEMANG mati di ACS prod — menaikkan ambang tidak
        // boleh menyembunyikan mereka.
        informLalu(m);
        expect((await isDeviceOnline("dev-1")).online).toBe(false);
    });

    test("pemanggil tetap boleh memaksa ambangnya sendiri", async () => {
        informLalu(20);
        expect((await isDeviceOnline("dev-1", 45)).online).toBe(true);
        expect((await isDeviceOnline("dev-1", 10)).online).toBe(false);
    });

    test("tanpa data inform → false, bukan melempar", async () => {
        getDeviceById.mockResolvedValue({ ok: true, data: {} });
        const r = await isDeviceOnline("dev-1");
        expect(r.online).toBe(false);
        expect(r.lastInform).toBeNull();
    });
});
