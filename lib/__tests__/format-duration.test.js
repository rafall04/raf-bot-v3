/**
 * Header Doc
 * Purpose: Mengunci penulisan durasi untuk teks PELANGGAN (#b260) — satuan nol tak pernah
 *          ditulis, dan rentang lebih dari sehari memakai satuan HARI.
 * Caller: Jest test runner.
 * Deps: `lib/format-duration`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const { formatDurasi } = require("../format-duration");
const menit = (n) => n * 60000;

describe("#b260 — penulisan durasi untuk pelanggan", () => {
    test.each([
        [menit(1), "1 menit"],
        [menit(14), "14 menit"],        // durasi LOS paling sering di produksi
        [menit(59), "59 menit"],
        [menit(60), "1 jam"],           // dulu: "1 jam 0 menit"
        [menit(107), "1 jam 47 menit"], // insiden nyata
        [menit(120), "2 jam"],          // dulu: "2 jam 0 menit"
        [menit(527), "8 jam 47 menit"], // insiden nyata
        [menit(759), "12 jam 39 menit"],// insiden nyata
        [menit(1440), "1 hari"],
        [menit(2258), "1 hari 13 jam"], // insiden nyata — dulu "37 jam 38 menit"
        [menit(2880), "2 hari"],
        [menit(4642), "3 hari 5 jam"]
    ])("%p ms -> %p", (ms, harap) => {
        expect(formatDurasi(ms)).toBe(harap);
    });

    test("satuan NOL tak pernah muncul di teks pelanggan", () => {
        for (let m = 1; m <= 4400; m += 7) {
            const t = formatDurasi(menit(m));
            expect(t).not.toMatch(/\b0 (menit|jam|hari)\b/);
        }
    });

    test("masukan tak wajar → null, bukan teks aneh", () => {
        [null, undefined, NaN, -1, "x", Infinity].forEach((x) => expect(formatDurasi(x)).toBeNull());
    });

    test("dibulatkan ke menit terdekat, minimal 1 menit (jangan pernah '0 menit')", () => {
        expect(formatDurasi(1000)).toBe("1 menit");
        expect(formatDurasi(0)).toBe("1 menit");
    });
});
