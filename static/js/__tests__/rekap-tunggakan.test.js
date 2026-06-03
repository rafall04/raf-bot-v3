/**
 * Header Doc
 * Purpose: Guardrail test helper frontend untuk halaman rekap tunggakan.
 * Caller: Jest test runner.
 * Deps: `../rekap-tunggakan.js`.
 * MainFuncs: Memverifikasi format bucket dan format label periode.
 * SideEffects: Tidak ada.
 */
"use strict";

const { formatBucketLabel, formatPeriodKey } = require("../rekap-tunggakan.js");

describe("rekap-tunggakan helpers", () => {
    test("maps bucket code to readable label", () => {
        expect(formatBucketLabel("3_PLUS_PERIODE")).toBe("3+ Periode");
    });

    test("formats period key into Indonesian month label", () => {
        expect(formatPeriodKey("2026-04")).toBe("Apr 2026");
    });
});
