/**
 * Header Doc
 * Purpose: Menjaga siklus penagihan tetap KOHEREN. Tiga cacat nyata pernah lolos ke produksi
 *          karena tak ada yang memeriksa hubungan antar-jadwal:
 *            1) aksi isolir dijadwalkan SEBELUM `tanggal_isolir` → guard di dalam job selalu skip,
 *               auto-isolir tak pernah jalan (RAF-TANJUNGHARJO: cron tgl 15 vs tanggal_isolir 16).
 *            2) notifikasi "saat ini terisolir" dikirim SEBELUM aksi → job hanya mengirim ke
 *               pelanggan yang profil PPPoE-nya sudah ISOLIR, jadi ia bisu (tak ada yang tahu).
 *            3) masa tenggang & notifikasi isolir di MENIT yang sama → dua pesan berbeda sekaligus.
 * Caller: jest.
 * Deps: `database/cron.json`, `config.example.json`.
 * MainFuncs: -
 * SideEffects: Tidak ada (baca berkas saja).
 */
"use strict";

const cronCfg = require("../../../database/cron.json");
const exampleCfg = require("../../../config.example.json");

/** ["menit","jam","hari",...] → { day, hour, minute } bila hari & jam berupa angka tunggal. */
function parts(expr) {
    const [minute, hour, day] = String(expr || "").trim().split(/\s+/);
    const num = (v) => (/^\d{1,2}$/.test(v) ? parseInt(v, 10) : null);
    return { minute: num(minute), hour: num(hour), day: num(day) };
}
const minutesOfMonth = (p) => p.day * 1440 + p.hour * 60 + p.minute;

const isolirDay = parseInt(exampleCfg.tanggal_isolir, 10);
const batasBayar = parseInt(exampleCfg.tanggal_batas_bayar, 10);

describe("koherensi siklus penagihan (database/cron.json vs config.example.json)", () => {
    const aksi = parts(cronCfg.schedule_unpaid_action);
    const notif = parts(cronCfg.schedule_isolir_notification);
    const tenggang = parts(cronCfg.schedule_masa_tenggang);

    test("ketiga jadwal memakai hari & jam yang pasti (bukan pola)", () => {
        [aksi, notif, tenggang].forEach((p) => {
            expect(p.day).not.toBeNull();
            expect(p.hour).not.toBeNull();
        });
    });

    // Guard di lib/cron/jobs/isolir.js: `if (currentDay < tanggal_isolir) skip`.
    test("aksi isolir jatuh pada/ sesudah tanggal_isolir — kalau tidak, job SELALU skip", () => {
        expect(aksi.day).toBeGreaterThanOrEqual(isolirDay);
    });

    // isolir-notification hanya mengirim bila profil PPPoE live == isolir_profile.
    test("notifikasi 'saat ini terisolir' dikirim SESUDAH aksi isolir", () => {
        expect(minutesOfMonth(notif)).toBeGreaterThan(minutesOfMonth(aksi));
    });

    test("masa tenggang mendahului aksi isolir (masih ada waktu membayar)", () => {
        expect(minutesOfMonth(tenggang)).toBeLessThan(minutesOfMonth(aksi));
    });

    test("masa tenggang jatuh sesudah tanggal jatuh tempo", () => {
        expect(tenggang.day).toBeGreaterThan(batasBayar - 1);
    });

    test("masa tenggang & notifikasi isolir tidak bertabrakan di menit yang sama", () => {
        expect(cronCfg.schedule_masa_tenggang).not.toBe(cronCfg.schedule_isolir_notification);
    });

    test("task masa tenggang aktif secara eksplisit (jangan bergantung pada default)", () => {
        expect(cronCfg.status_masa_tenggang).toBe(true);
    });
});

// #b304 — split-brain dua-gerbang siklus AKHIR BULAN. Eksklusi kohort dari job standar dibaca dari
// config.json (billingAkhirBulan.enabled + cron status, fail-closed), penjadwalan dari cron.json.
// Jaga agar cron.json yang DIKIRIM repo selalu menjadwalkan job (agar fail-closed tak nyala palsu),
// dan blok config contoh berbentuk benar.
describe("koherensi siklus AKHIR BULAN (#b304)", () => {
    test("cron.json menjadwalkan job akhir-bulan (status true + schedule 5-field)", () => {
        expect(cronCfg.status_billing_akhir_bulan).toBe(true);
        expect(typeof cronCfg.schedule_billing_akhir_bulan).toBe("string");
        expect(cronCfg.schedule_billing_akhir_bulan.trim().split(/\s+/).length).toBe(5);
    });

    test("config.example memuat blok billingAkhirBulan berbentuk benar (enabled boolean, offset angka)", () => {
        const b = exampleCfg.billingAkhirBulan;
        expect(b).toBeTruthy();
        expect(typeof b.enabled).toBe("boolean");
        for (const k of ["reminderDaysBefore", "graceDaysBefore", "isolirDaysBefore"]) {
            expect(Number.isInteger(b[k])).toBe(true);
            expect(b[k]).toBeGreaterThanOrEqual(0);
        }
    });

    test("bila contoh MENGAKTIFKAN fitur, cron WAJIB terjadwal (cegah split-brain di config yg dikirim)", () => {
        if (exampleCfg.billingAkhirBulan && exampleCfg.billingAkhirBulan.enabled === true) {
            expect(cronCfg.status_billing_akhir_bulan).toBe(true);
            expect(cronCfg.schedule_billing_akhir_bulan.trim().split(/\s+/).length).toBe(5);
        } else {
            expect(true).toBe(true); // contoh default OFF — tak ada yang perlu ditegakkan
        }
    });
});
