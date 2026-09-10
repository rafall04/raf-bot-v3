/**
 * Header Doc
 * Purpose: Guard BAGIAN 1 — helper penjadwalan ganti paket tertunda. Kunci: effective-date = awal
 *   bulan KALENDER berikutnya (WIB), isDue instant-based, gate config, format tanggal WIB.
 * Caller: Jest.
 * Deps: ../package-change-scheduler.
 * SideEffects: -
 */
"use strict";

process.env.TZ = "Asia/Jakarta"; // computeNextCycleEffective pakai bulan LOKAL; prod dipaksa WIB.

const { isDeferEnabled, computeNextCycleEffective, isDue, formatTanggalWIB } = require("../package-change-scheduler");

describe("computeNextCycleEffective — awal bulan berikutnya (WIB)", () => {
    test("10 Sep 2026 → 1 Okt 2026 00:00 WIB", () => {
        const eff = computeNextCycleEffective(new Date("2026-09-10T10:00:00+07:00"));
        expect(formatTanggalWIB(eff)).toBe("1 Oktober 2026");
    });
    test("pergantian tahun: 20 Des → 1 Jan tahun depan", () => {
        const eff = computeNextCycleEffective(new Date("2026-12-20T23:00:00+07:00"));
        expect(formatTanggalWIB(eff)).toBe("1 Januari 2027");
    });
    test("akhir bulan: 30 Sep 23:59 WIB tetap → 1 Okt (belum lewat tengah malam)", () => {
        const eff = computeNextCycleEffective(new Date("2026-09-30T23:59:00+07:00"));
        expect(formatTanggalWIB(eff)).toBe("1 Oktober 2026");
    });
});

describe("isDue", () => {
    const eff = computeNextCycleEffective(new Date("2026-09-10T10:00:00+07:00")); // 1 Okt 00:00 WIB
    test("sebelum tanggal berlaku → belum due", () => {
        expect(isDue(eff, Date.parse("2026-09-30T16:59:00Z"))).toBe(false); // 30 Sep 23:59 WIB
    });
    test("tepat/di atas tanggal berlaku → due", () => {
        expect(isDue(eff, Date.parse("2026-09-30T17:00:00Z"))).toBe(true); // 1 Okt 00:00 WIB
        expect(isDue(eff, Date.parse("2026-10-01T05:00:00Z"))).toBe(true);
    });
    test("iso invalid → tidak due", () => {
        expect(isDue("bukan-tanggal", Date.now())).toBe(false);
    });
});

describe("isDeferEnabled — gate", () => {
    test("default/absen → false (perilaku lama)", () => {
        expect(isDeferEnabled({})).toBe(false);
        expect(isDeferEnabled(null)).toBe(false);
        expect(isDeferEnabled({ packageChangeDeferred: {} })).toBe(false);
    });
    test("enabled:true → true", () => {
        expect(isDeferEnabled({ packageChangeDeferred: { enabled: true } })).toBe(true);
    });
});
