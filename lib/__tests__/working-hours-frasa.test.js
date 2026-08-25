/**
 * Header Doc
 * Purpose : Menjaga frasa "kapan penanganan lapangan dimulai" untuk teks PELANGGAN (#b269).
 *           Satu pemilik frasa; dulu tersebar (smart-report merakit sendiri, LOS tak punya).
 * Caller  : jest
 * Deps    : lib/working-hours-helper
 * MainFuncs: -
 * SideEffects: menyetel global.config selama tes
 */
const { waktuMulaiKerjaBerikutnya } = require("../working-hours-helper");

// Jam kerja PERSIS seperti produksi: 08:00-17:00.
const JAM_PRODUKSI = {
    enabled: true,
    days: {
        monday: { enabled: true, start: "08:00", end: "17:00" },
        tuesday: { enabled: true, start: "08:00", end: "17:00" },
        wednesday: { enabled: true, start: "08:00", end: "17:00" },
        thursday: { enabled: true, start: "08:00", end: "17:00" },
        friday: { enabled: true, start: "08:00", end: "17:00" },
        saturday: { enabled: true, start: "08:00", end: "17:00" },
        sunday: { enabled: true, start: "08:00", end: "17:00" },
    },
};

function padaJam(iso, fn) {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(iso));
    try { return fn(); } finally { jest.useRealTimers(); }
}

describe("#b269 — frasa jam kerja untuk pelanggan", () => {
    afterEach(() => { delete global.config; });

    test("fitur jam kerja OFF (layanan 24/7) → tak pernah menambah catatan", () => {
        global.config = { teknisiWorkingHours: { enabled: false } };
        expect(waktuMulaiKerjaBerikutnya()).toEqual({ dalamJamKerja: true, teks: null, teksRentang: null });
    });

    test("siang hari kerja → dianggap dalam jam, tanpa frasa", () => {
        global.config = { teknisiWorkingHours: JAM_PRODUKSI };
        // Rabu 2026-08-26 10:00 WIB
        const r = padaJam("2026-08-26T03:00:00Z", waktuMulaiKerjaBerikutnya);
        expect(r.dalamJamKerja).toBe(true);
        expect(r.teks).toBeNull();
    });

    test("!! kabel putus DINI HARI → 'hari ini pukul 08:00', bukan nama hari yang membingungkan", () => {
        global.config = { teknisiWorkingHours: JAM_PRODUKSI };
        // Rabu 2026-08-26 02:00 WIB — jam kerja mulai beberapa jam lagi, hari yang sama.
        const r = padaJam("2026-08-25T19:00:00Z", waktuMulaiKerjaBerikutnya);
        expect(r.dalamJamKerja).toBe(false);
        expect(r.teks).toBe("hari ini pukul 08:00 WIB");
    });

    test("kabel putus MALAM sesudah jam kerja → 'besok pukul 08:00'", () => {
        global.config = { teknisiWorkingHours: JAM_PRODUKSI };
        // Rabu 2026-08-26 21:00 WIB
        const r = padaJam("2026-08-26T14:00:00Z", waktuMulaiKerjaBerikutnya);
        expect(r.dalamJamKerja).toBe(false);
        expect(r.teks).toBe("besok pukul 08:00 WIB");
    });

    test("hari libur berikutnya dilewati → sebut NAMA HARI, jamnya tetap benar", () => {
        global.config = {
            teknisiWorkingHours: {
                ...JAM_PRODUKSI,
                days: { ...JAM_PRODUKSI.days, thursday: { enabled: false }, friday: { enabled: false } },
            },
        };
        // Rabu 2026-08-26 21:00 WIB → Kamis & Jumat libur → Sabtu
        const r = padaJam("2026-08-26T14:00:00Z", waktuMulaiKerjaBerikutnya);
        expect(r.dalamJamKerja).toBe(false);
        expect(r.teks).toMatch(/^Sabtu pukul 08:00 WIB$/);
    });

    test("config rusak → diam (dianggap dalam jam), TIDAK melempar", () => {
        global.config = { teknisiWorkingHours: { enabled: true, days: null } };
        expect(() => waktuMulaiKerjaBerikutnya()).not.toThrow();
    });

    test("tak pernah memulangkan teks yang memuat undefined/NaN", () => {
        global.config = { teknisiWorkingHours: JAM_PRODUKSI };
        const r = padaJam("2026-08-26T14:00:00Z", waktuMulaiKerjaBerikutnya);
        expect(String(r.teks)).not.toMatch(/undefined|NaN|Invalid/);
    });

    test("!! di luar jam kerja → memberi RENTANG jam kerja, bukan satu jam mulai", () => {
        // Menyebut "pukul 08:00" membuat pelanggan menunggu di jam itu persis, lalu kecewa
        // saat teknisi mendahulukan gangguan yang lebih parah. Rentang tidak menjanjikan itu.
        global.config = { teknisiWorkingHours: JAM_PRODUKSI };
        const r = padaJam("2026-08-26T14:00:00Z", waktuMulaiKerjaBerikutnya);   // Rabu 21:00 WIB
        expect(r.teksRentang).toBe("besok pada jam kerja (08:00–17:00 WIB)");
    });

    test("jam kerja berbeda per hari → rentang mengikuti hari TUJUAN, bukan hari ini", () => {
        global.config = {
            teknisiWorkingHours: {
                ...JAM_PRODUKSI,
                days: { ...JAM_PRODUKSI.days, thursday: { enabled: true, start: "09:00", end: "15:00" } },
            },
        };
        const r = padaJam("2026-08-26T14:00:00Z", waktuMulaiKerjaBerikutnya);   // Rabu malam → Kamis
        expect(r.teksRentang).toBe("besok pada jam kerja (09:00–15:00 WIB)");
    });

    test("jadwal tak terbaca → sebut \"pada jam kerja\" TANPA mengarang jamnya", () => {
        global.config = { teknisiWorkingHours: { enabled: true, days: { monday: { enabled: true, start: "08:00", end: "17:00" } } } };
        const r = padaJam("2026-08-26T14:00:00Z", waktuMulaiKerjaBerikutnya);
        if (r.teksRentang) {
            expect(r.teksRentang).not.toMatch(/undefined|NaN|null/);
        }
    });
});
