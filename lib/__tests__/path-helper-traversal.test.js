/**
 * Header Doc
 * Purpose: Membuktikan segmen path yang datang dari request tak bisa keluar dari direktori
 *          `uploads/` — akar celah tulis-berkas-sembarang pada upload foto tiket.
 * Caller: Jest test runner.
 * Deps: `../path-helper`, `path`.
 * MainFuncs: —
 * SideEffects: Tidak ada I/O; helper ini murni menghitung string path.
 */
"use strict";

const path = require("path");
const {
    getTicketsUploadsPathByTicket,
    getReportsUploadsPath,
    getTeknisiUploadsPathByTicket,
    getProjectRoot,
    isSegmenPathAman,
    assertDiDalamDirektori,
} = require("../path-helper");

const PEMBANGUN_PATH = [
    ["tickets", getTicketsUploadsPathByTicket],
    ["reports", getReportsUploadsPath],
    ["teknisi", getTeknisiUploadsPathByTicket],
];

// Muatan yang benar-benar bisa dikirim lewat ?ticketId= / x-ticket-id.
const MUATAN_TRAVERSAL = [
    "../../../../views/sb-admin",
    "..",
    "../",
    "a/../../b",
    "..\\..\\windows",
    "/etc/passwd",
    "C:\\Windows\\Temp",
    "tiket/../../keluar",
];

describe("path-helper menolak traversal pada segmen tiket", () => {
    describe.each(PEMBANGUN_PATH)("uploads/%s", (_namespace, bangun) => {
        test.each(MUATAN_TRAVERSAL)("menolak ticketId %p", (jahat) => {
            expect(() => bangun(2026, "08", jahat, __dirname)).toThrow(/tidak valid/i);
        });

        test("menerima ID tiket asli (7 karakter alfanumerik) dan tetap di dalam uploads/", () => {
            const hasil = bangun(2026, "08", "6A8ZJTL", __dirname);
            const akarUploads = path.join(getProjectRoot(__dirname), "uploads");

            expect(path.resolve(hasil).startsWith(path.resolve(akarUploads) + path.sep)).toBe(true);
            expect(hasil).toContain("6A8ZJTL");
        });

        test("tahun/bulan sampah tak menghasilkan segmen aneh dan tetap di dalam uploads/", () => {
            // `new Date('sampah')` → NaN → dulu jadi nama folder "NaN".
            const hasil = bangun(NaN, "../..", "6A8ZJTL", __dirname);
            const akarUploads = path.join(getProjectRoot(__dirname), "uploads");

            expect(path.resolve(hasil).startsWith(path.resolve(akarUploads) + path.sep)).toBe(true);
            expect(hasil).not.toContain("..");
        });
    });
});

describe("isSegmenPathAman", () => {
    test.each(["6A8ZJTL", "TKT-0001", "UNKNOWN", "a_b-C9"])("menerima %p", (nilai) => {
        expect(isSegmenPathAman(nilai)).toBe(true);
    });

    test.each(["..", "a/b", "a\\b", "", null, undefined, "a".repeat(65), "a b", "a.php"])(
        "menolak %p",
        (nilai) => {
            expect(isSegmenPathAman(nilai)).toBe(false);
        }
    );
});

describe("assertDiDalamDirektori", () => {
    test("melempar bila target keluar dari base", () => {
        expect(() => assertDiDalamDirektori("/srv/uploads", "/srv/uploads/../rahasia")).toThrow(
            /keluar dari direktori/i
        );
    });

    test("meloloskan target di dalam base", () => {
        expect(() =>
            assertDiDalamDirektori("/srv/uploads", "/srv/uploads/tickets/2026/08/ABC")
        ).not.toThrow();
    });

    test("tidak tertipu awalan yang mirip (uploads-lain vs uploads)", () => {
        expect(() => assertDiDalamDirektori("/srv/uploads", "/srv/uploads-lain/x")).toThrow(
            /keluar dari direktori/i
        );
    });
});
