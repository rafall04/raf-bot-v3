/**
 * Header Doc
 * Purpose : GUARD cron siklus tagihan AKHIR BULAN — pemilihan fase relatif akhir bulan, no-op saat
 *           fitur OFF, filter kohort, dan penjaga struktural: 4 job siklus STANDAR wajib
 *           mengecualikan kohort (mengimpor & memakai isEndOfMonthBillingActive).
 * Caller  : jest
 * Deps    : lib/cron/jobs/billing-akhir-bulan + pemindaian sumber 4 job standar.
 * MainFuncs: —
 * SideEffects: set/reset global.config, global.users, global.packages.
 *
 * KENAPA ADA — kohort akhir-bulan ditangani jalur TERPISAH. Bila ada job standar berhenti
 * mengecualikan kohort, pelanggan bisa diisolir ~18 hari sebelum jatuh temponya (bug yang fitur ini
 * justru mencegah). Bila pemilihan fase salah hitung akhir bulan, tagihan/isolir jatuh di hari keliru.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const AKAR = path.join(__dirname, "..", "..", "..", "..");

const {
    runBillingAkhirBulanCycle,
    readFeatureConfig,
    isCohortMember,
} = require("../billing-akhir-bulan");

const cfgAsli = global.config;
const usersAsli = global.users;
const pkgAsli = global.packages;

afterEach(() => {
    global.config = cfgAsli;
    global.users = usersAsli;
    global.packages = pkgAsli;
});

function aktifkanFitur(extra = {}) {
    global.config = {
        billingAkhirBulan: { enabled: true, reminderDaysBefore: 5, graceDaysBefore: 2, isolirDaysBefore: 0 },
        isolir_profile: "ISOLIR",
        sync_to_mikrotik: false, // matikan sentuhan MikroTik dalam test
        ...extra,
    };
    global.users = []; // kohort kosong → fase jalan tapi tak ada I/O eksternal
    global.packages = [];
}

describe("billing-akhir-bulan — no-op saat fitur OFF", () => {
    test("fitur OFF → skipped feature-off, tak menghitung fase", async () => {
        global.config = { billingAkhirBulan: { enabled: false } };
        global.users = [];
        const hasil = await runBillingAkhirBulanCycle(new Date(2026, 7, 31));
        expect(hasil).toEqual({ skipped: "feature-off" });
    });

    test("config tak ada sama sekali → feature-off (tak crash)", async () => {
        global.config = {};
        global.users = [];
        const hasil = await runBillingAkhirBulanCycle(new Date(2026, 7, 31));
        expect(hasil).toEqual({ skipped: "feature-off" });
    });
});

describe("billing-akhir-bulan — pemilihan fase relatif AKHIR bulan", () => {
    test("Agustus (31 hari): H-5=26 reminder, H-2=29 tenggang, H-0=31 isolir", async () => {
        aktifkanFitur();
        expect((await runBillingAkhirBulanCycle(new Date(2026, 7, 26))).phases).toEqual(["reminder"]);
        expect((await runBillingAkhirBulanCycle(new Date(2026, 7, 29))).phases).toEqual(["tenggang"]);
        expect((await runBillingAkhirBulanCycle(new Date(2026, 7, 31))).phases).toEqual(["isolir"]);
    });

    test("bukan hari aksi → phases kosong (no-op)", async () => {
        aktifkanFitur();
        const hasil = await runBillingAkhirBulanCycle(new Date(2026, 7, 20)); // sisa 11
        expect(hasil.phases).toEqual([]);
        expect(hasil.daysUntilEnd).toBe(11);
    });

    test("adaptif panjang bulan — Februari 28 hari: H-5 = 23 Feb", async () => {
        aktifkanFitur();
        expect((await runBillingAkhirBulanCycle(new Date(2026, 1, 23))).phases).toEqual(["reminder"]);
        // 26 Feb = sisa 2 → tenggang
        expect((await runBillingAkhirBulanCycle(new Date(2026, 1, 26))).phases).toEqual(["tenggang"]);
        // 28 Feb = sisa 0 → isolir (hari terakhir Feb)
        expect((await runBillingAkhirBulanCycle(new Date(2026, 1, 28))).phases).toEqual(["isolir"]);
    });

    test("offset dapat dikonfigurasi", async () => {
        aktifkanFitur({ billingAkhirBulan: { enabled: true, reminderDaysBefore: 3, graceDaysBefore: 1, isolirDaysBefore: 0 } });
        // Agustus: H-3 = 28
        expect((await runBillingAkhirBulanCycle(new Date(2026, 7, 28))).phases).toEqual(["reminder"]);
        // H-5 (26) tak lagi jadi hari reminder
        expect((await runBillingAkhirBulanCycle(new Date(2026, 7, 26))).phases).toEqual([]);
    });
});

describe("billing-akhir-bulan — filter kohort & feature config", () => {
    test("isCohortMember: infra dikecualikan, hanya akhir_bulan yang masuk", () => {
        expect(isCohortMember({ billing_cycle: "akhir_bulan" })).toBe(true);
        expect(isCohortMember({ billing_cycle: "awal_bulan" })).toBe(false);
        expect(isCohortMember({ billing_cycle: "akhir_bulan", account_type: "infrastruktur" })).toBe(false);
    });

    test("readFeatureConfig: default aman bila tak diset", () => {
        global.config = { billingAkhirBulan: { enabled: true } };
        const feat = readFeatureConfig();
        expect(feat).toEqual({ enabled: true, reminderDaysBefore: 5, graceDaysBefore: 2, isolirDaysBefore: 0 });
    });

    test("readFeatureConfig: nilai negatif/invalid → jatuh ke default", () => {
        global.config = { billingAkhirBulan: { enabled: true, reminderDaysBefore: -1, graceDaysBefore: "x" } };
        const feat = readFeatureConfig();
        expect(feat.reminderDaysBefore).toBe(5);
        expect(feat.graceDaysBefore).toBe(2);
    });
});

describe("billing-akhir-bulan — penjaga struktural: 4 job standar mengecualikan kohort", () => {
    const JOBS = [
        "lib/cron/jobs/reminder.js",
        "lib/cron/jobs/grace-reminder.js",
        "lib/cron/jobs/isolir.js",
        "lib/cron/jobs/isolir-notification.js",
    ];
    for (const rel of JOBS) {
        test(`${rel.replace("lib/cron/jobs/", "")} mengimpor & memakai isEndOfMonthBillingActive`, () => {
            const s = fs.readFileSync(path.join(AKAR, rel), "utf8");
            expect(s).toMatch(/isEndOfMonthBillingActive/);
            // dipakai sebagai skip/continue (bukan sekadar diimpor)
            expect(s).toMatch(/isEndOfMonthBillingActive\s*\(\s*user\s*\)/);
        });
    }
});
