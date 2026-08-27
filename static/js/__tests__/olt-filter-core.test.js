/**
 * Header Doc
 * Purpose: Mengunci penyaringan Monitor OLT (#b284) — asal identitas baris & kelas redaman,
 *          plus WIRING-nya (modul bersama harus benar-benar dimuat kedua halaman).
 * Caller: Jest
 * Deps: ../olt-filter-core (murni), pemindaian berkas halaman.
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA: pelanggan yang PPPoE-nya ada di MikroTik tapi belum didaftarkan admin dulu
 * tampil sebagai BARIS KOSONG (ONU EPON tak membawa description/serial), jadi teknisi tak
 * bisa mengerjakannya. Terukur di produksi: 5 baris di Dander + 1 di Tanjungharjo, tiga di
 * antaranya redaman buruk (-26,2 · -28,54 · -26,58).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../olt-filter-core");

const AKAR = path.join(__dirname, "..", "..", "..");   // static/js/__tests__ -> akar repo

const BARIS = [
    { id: "a", identitas_sumber: "bot", matched: true, rx_power: -21.5, rx_power_valid: true },
    { id: "b", identitas_sumber: "mikrotik", matched: false, rx_power: -28.54, rx_power_valid: true },
    { id: "c", identitas_sumber: "mikrotik", matched: false, rx_power: -17.8, rx_power_valid: true },
    { id: "d", identitas_sumber: null, matched: false, rx_power: "N/A" },
];

describe("saringIdentitas — asal identitas baris", () => {
    test("'all' mengembalikan semuanya", () => {
        expect(core.saringIdentitas(BARIS, "all")).toHaveLength(4);
        expect(core.saringIdentitas(BARIS, "")).toHaveLength(4);
    });

    test("!! 'mikrotik' = pelanggan yang ADA di MikroTik tapi BELUM didaftarkan", () => {
        const r = core.saringIdentitas(BARIS, "mikrotik");
        expect(r.map((x) => x.id)).toEqual(["b", "c"]);
        // Justru kelompok inilah yang dulu tak terlihat sama sekali.
        expect(r.every((x) => x.matched === false)).toBe(true);
    });

    test("'bot' hanya pelanggan terdaftar; 'tanpa' hanya yang tak beridentitas", () => {
        expect(core.saringIdentitas(BARIS, "bot").map((x) => x.id)).toEqual(["a"]);
        expect(core.saringIdentitas(BARIS, "tanpa").map((x) => x.id)).toEqual(["d"]);
    });

    test("nilai lama 'matched' tetap bekerja (tombol yang digantikan dropdown)", () => {
        expect(core.saringIdentitas(BARIS, "matched").map((x) => x.id)).toEqual(["a"]);
    });

    test("masukan cacat tidak melempar", () => {
        expect(core.saringIdentitas(null, "bot")).toEqual([]);
        expect(core.saringIdentitas(undefined, "all")).toEqual([]);
        expect(() => core.saringIdentitas([null, undefined], "mikrotik")).not.toThrow();
    });
});

describe("kelasRedaman — ambang harus sama dengan warna di layar", () => {
    test.each([
        [-30, "kritis"],
        [-25.01, "kritis"],
        [-25, "peringatan"],     // batas: -25 TIDAK kritis (v < -25)
        [-20.01, "peringatan"],
        [-20, "baik"],           // batas: -20 sudah baik (v < -20 utk peringatan)
        [-9.57, "baik"],
    ])("rx %s → %s", (rx, harap) => {
        expect(core.kelasRedaman({ rx_power: rx, rx_power_valid: true })).toBe(harap);
    });

    test("ambang yang diekspor sama dengan yang dipakai renderRxPower di halaman", () => {
        expect(core.AMBANG_KRITIS).toBe(-25);
        expect(core.AMBANG_PERINGATAN).toBe(-20);
        for (const f of ["admin-olt.js", "teknisi-olt.js"]) {
            const src = fs.readFileSync(path.join(AKAR, "static", "js", f), "utf8");
            // !! Ambangnya dipakai di DUA tempat per halaman (tabel & modal). Memeriksa
            // 'ada setidaknya satu -25' TIDAK cukup — mutasi pada salah satunya lolos
            // (terbukti). Jadi periksa SETIAP kemunculan `val < -NN`.
            const semua = [...src.matchAll(/val\s*<\s*(-\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
            expect(semua.length).toBeGreaterThanOrEqual(2);   // tabel + modal
            const diizinkan = new Set([core.AMBANG_KRITIS, core.AMBANG_PERINGATAN]);
            expect({ berkas: f, ambangAsing: semua.filter((v) => !diizinkan.has(v)) })
                .toEqual({ berkas: f, ambangAsing: [] });
            expect(semua).toContain(core.AMBANG_KRITIS);
            expect(semua).toContain(core.AMBANG_PERINGATAN);
        }
    });

    test("!! redaman ONU yang TIDAK online = pembacaan basi → 'takterbaca', bukan 'kritis'", () => {
        // Kalau ini rusak, daftar 'kritis' akan penuh modem yang sudah lama mati.
        expect(core.kelasRedaman({ rx_power: -31.2, rx_power_valid: false })).toBe("takterbaca");
        expect(core.kelasRedaman({ rx_power: -31.2, status_known: false })).toBe("takterbaca");
    });

    test("nilai kosong / sentinel bukan angka", () => {
        for (const rx of [null, undefined, "", "N/A", "--", "-inf"]) {
            expect(core.kelasRedaman({ rx_power: rx, rx_power_valid: true })).toBe("takterbaca");
        }
        expect(core.kelasRedaman(null)).toBe("takterbaca");
    });

    test("cocokRedaman: pilihan kosong meloloskan apa pun", () => {
        expect(core.cocokRedaman({ rx_power: -30, rx_power_valid: true }, "")).toBe(true);
        expect(core.cocokRedaman({ rx_power: -30, rx_power_valid: true }, "kritis")).toBe(true);
        expect(core.cocokRedaman({ rx_power: -30, rx_power_valid: true }, "baik")).toBe(false);
    });
});

describe("wiring — tanpa ini halamannya mati diam-diam", () => {
    const baca = (p) => fs.readFileSync(path.join(AKAR, p), "utf8");

    test("!! kedua halaman memuat olt-filter-core.js SEBELUM skrip halamannya", () => {
        for (const [php, js] of [
            ["views/sb-admin/admin-olt.php", "/js/admin-olt.js"],
            ["views/sb-admin/teknisi-olt.php", "/js/teknisi-olt.js"],
        ]) {
            const src = baca(php);
            const iCore = src.indexOf("/js/olt-filter-core.js");
            const iHal = src.indexOf(js);
            expect(iCore).toBeGreaterThan(-1);
            expect(iHal).toBeGreaterThan(-1);
            // Halaman membaca window.OltFilterCore saat inisialisasi — urutan menentukan.
            expect(iCore).toBeLessThan(iHal);
        }
    });

    test("aturan penyaringan TIDAK diduplikasi lagi di halaman", () => {
        for (const f of ["static/js/admin-olt.js", "static/js/teknisi-olt.js"]) {
            const src = baca(f);
            expect(src).toMatch(/window\.OltFilterCore/);
            // Definisi tandingan = dua halaman bisa berbeda pendapat.
            expect(src).not.toMatch(/function\s+saringIdentitas\s*\(/);
            expect(src).not.toMatch(/function\s+kelasRedaman\s*\(/);
        }
    });

    test("kedua halaman punya dropdown identitas & redaman dengan pilihan yang sama", () => {
        for (const php of ["views/sb-admin/admin-olt.php", "views/sb-admin/teknisi-olt.php"]) {
            const src = baca(php);
            expect(src).toMatch(/id="identitasFilter"/);
            expect(src).toMatch(/id="redamanFilter"/);
            for (const v of ["all", "bot", "mikrotik", "tanpa"]) {
                expect(src).toContain('value="' + v + '"');
            }
            for (const v of ["kritis", "peringatan", "baik", "takterbaca"]) {
                expect(src).toContain('value="' + v + '"');
            }
        }
    });

    test("!! penyaring status & redaman DIGABUNG (ext.search itu array global)", () => {
        for (const f of ["static/js/admin-olt.js", "static/js/teknisi-olt.js"]) {
            const src = baca(f);
            expect(src).toMatch(/function terapkanFilterTabel\(\)/);
            // Dua fungsi terpisah yang sama-sama menimpa ext.search akan saling menghapus.
            const timpa = (src.match(/\$\.fn\.dataTable\.ext\.search\s*=\s*\[\]/g) || []).length;
            expect(timpa).toBe(1);
        }
    });
});
