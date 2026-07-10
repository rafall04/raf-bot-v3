/**
 * Header Doc
 * Purpose: Mengunci guard "jadwal isolir yang mustahil bertindak". Kasus nyata prod
 *          (RAF-TANJUNGHARJO): cron `0 0 15 * *` + `tanggal_isolir=16` → job SELALU skip,
 *          nol baris audit, 87 pelanggan unpaid tak pernah tersentuh, tanpa satu pun error.
 * Caller: jest.
 * Deps: `lib/cron/jobs/isolir` (_internal).
 * MainFuncs: -
 * SideEffects: Menyetel global.config sementara; memata-matai console.error.
 */
"use strict";

const { _internal } = require("../jobs/isolir");
const { fixedDayOfMonth, warnIfScheduleCanNeverAct } = _internal;

describe("fixedDayOfMonth", () => {
    test.each([
        ["0 0 16 * *", 16],
        ["0 8 11 * *", 11],
        ["30 9 2 * *", 2]
    ])("%s → hari %i", (expr, day) => expect(fixedDayOfMonth(expr)).toBe(day));

    test.each(["* * * * *", "0 0 1,15 * *", "0 0 */2 * *", "0 0 1-5 * *", ""])(
        "%s → null (tak bisa disimpulkan)",
        (expr) => expect(fixedDayOfMonth(expr)).toBeNull()
    );
});

describe("warnIfScheduleCanNeverAct", () => {
    let spy;
    beforeEach(() => {
        spy = jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
        spy.mockRestore();
        delete global.config;
    });

    test("cron tgl 15 + tanggal_isolir 16 (kasus Tanjungharjo) → berteriak", () => {
        global.config = { tanggal_isolir: 16 };
        warnIfScheduleCanNeverAct("0 0 15 * *");
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatch(/TIDAK AKAN PERNAH mengisolir/);
    });

    test("cron tgl 16 + tanggal_isolir 16 (kasus Dander) → diam", () => {
        global.config = { tanggal_isolir: 16 };
        warnIfScheduleCanNeverAct("0 0 16 * *");
        expect(spy).not.toHaveBeenCalled();
    });

    test("cron sesudah tanggal_isolir → diam (job tetap bertindak)", () => {
        global.config = { tanggal_isolir: 16 };
        warnIfScheduleCanNeverAct("0 0 20 * *");
        expect(spy).not.toHaveBeenCalled();
    });

    test("pola non-tunggal tak dituduh (tak bisa disimpulkan)", () => {
        global.config = { tanggal_isolir: 16 };
        warnIfScheduleCanNeverAct("0 0 * * *");
        expect(spy).not.toHaveBeenCalled();
    });

    test("tanpa config → default tanggal_isolir 11", () => {
        warnIfScheduleCanNeverAct("0 0 5 * *");
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
