/**
 * Header Doc
 * Purpose: Mengunci perilaku penerjemah nominal + parser perintah `#U` domain keuangan pribadi.
 *          Nominal adalah tempat paling gampang salah: "50.000" (titik = ribuan) dan "1,5jt"
 *          (koma = desimal) harus dibedakan, kalau tertukar catatan uang jadi ngawur 1000x.
 * Caller: Jest.
 * Deps: `lib/personal-finance-service`.
 * MainFuncs: -
 * SideEffects: Tidak ada (fungsi murni).
 */
"use strict";

const {
    parseAmount,
    inferCategory,
    parsePersonalFinanceCommand,
    formatRupiah,
    monthRange,
    dayRange,
    weekRange,
    previousRange,
    hitungTren,
    toCsv,
    buildDailySeries,
    TRIGGER_WORDS
} = require("../personal-finance-service");

describe("parseAmount — nominal gaya Indonesia", () => {
    test.each([
        ["50rb", 50000],
        ["50 rb", 50000],
        ["50k", 50000],
        ["50K", 50000],
        ["50ribu", 50000],
        ["2jt", 2000000],
        ["2juta", 2000000],
        ["50000", 50000],
        ["Rp50000", 50000],
        ["500", 500]
    ])("%s → %i", (masukan, harapan) => {
        expect(parseAmount(masukan)).toBe(harapan);
    });

    test("titik/koma TANPA satuan = pemisah ribuan", () => {
        expect(parseAmount("50.000")).toBe(50000);
        expect(parseAmount("1.500.000")).toBe(1500000);
        expect(parseAmount("50,000")).toBe(50000);
    });

    test("titik/koma DENGAN satuan = desimal", () => {
        expect(parseAmount("1,5jt")).toBe(1500000);
        expect(parseAmount("2.5jt")).toBe(2500000);
        expect(parseAmount("1,5rb")).toBe(1500);
    });

    test("masukan tak masuk akal ditolak (null), bukan 0", () => {
        for (const buruk of ["", "abc", "0", "-5rb", "rb", null, undefined, "50rb50"]) {
            expect(parseAmount(buruk)).toBeNull();
        }
    });
});

describe("inferCategory", () => {
    test("cocok per-KATA, bukan substring — 'fotokopi' bukan kategori makan", () => {
        expect(inferCategory("kopi pagi")).toBe("makan");
        expect(inferCategory("fotokopi berkas")).toBe("lain");
    });

    test("kata kunci umum terpetakan", () => {
        expect(inferCategory("bensin motor")).toBe("transport");
        expect(inferCategory("bayar listrik")).toBe("tagihan");
        expect(inferCategory("gaji bulanan")).toBe("gaji");
    });

    test("catatan kosong → lain", () => {
        expect(inferCategory("")).toBe("lain");
        expect(inferCategory(null)).toBe("lain");
    });

    // REGRESI (ditemukan saat live-test di prod 2026-07-23): `config.personalFinance.categories`
    // defaultnya `{}` — objek kosong yang TRUTHY, sehingga `categories || DEFAULT` meloloskannya
    // dan mematikan seluruh inferensi diam-diam: setiap catatan jatuh ke "lain" di WA maupun web.
    test("peta kategori kosong/tak valid JATUH KE DEFAULT, bukan mematikan inferensi", () => {
        expect(inferCategory("bensin", {})).toBe("transport");
        expect(inferCategory("bensin", null)).toBe("transport");
        expect(inferCategory("bensin", undefined)).toBe("transport");
        expect(inferCategory("bensin", [])).toBe("transport");
        expect(inferCategory("bensin", "bukan objek")).toBe("transport");
    });

    test("peta kategori kustom yang BERISI tetap dihormati (bukan ditimpa default)", () => {
        expect(inferCategory("bensin", { rokok: ["bensin"] })).toBe("rokok");
        expect(inferCategory("apapun", { rokok: ["sampoerna"] })).toBe("lain");
    });
});

describe("parsePersonalFinanceCommand — TANPA prefix (#U dibuang)", () => {
    test("catat pengeluaran lengkap", () => {
        expect(parsePersonalFinanceCommand("keluar 50rb bensin")).toEqual({
            action: "add",
            kind: "out",
            amount: 50000,
            note: "bensin",
            category: "transport"
        });
    });

    test("catat pemasukan", () => {
        const r = parsePersonalFinanceCommand("masuk 2jt gaji");
        expect(r).toMatchObject({ action: "add", kind: "in", amount: 2000000, category: "gaji" });
    });

    test("singkatan pemicu diterima", () => {
        expect(parsePersonalFinanceCommand("kluar 10rb parkir").kind).toBe("out");
        expect(parsePersonalFinanceCommand("msk 10rb").kind).toBe("in");
    });

    test("periode laporan: minggu, minggu lalu, kemarin, bulan lalu", () => {
        expect(parsePersonalFinanceCommand("uang minggu")).toEqual({ action: "report", scope: "week", geser: 0 });
        expect(parsePersonalFinanceCommand("uang minggu lalu")).toEqual({ action: "report", scope: "week", geser: -1 });
        expect(parsePersonalFinanceCommand("uang pekan")).toMatchObject({ scope: "week" });
        expect(parsePersonalFinanceCommand("uang kemarin")).toEqual({ action: "report", scope: "day", geser: -1 });
        expect(parsePersonalFinanceCommand("uang bulan lalu")).toEqual({ action: "report", scope: "month", geser: -1 });
    });

    test("payung `uang` — rekap, bulan, hapus, bantuan", () => {
        expect(parsePersonalFinanceCommand("uang")).toEqual({ action: "report", scope: "day" });
        expect(parsePersonalFinanceCommand("uang lapor")).toEqual({ action: "report", scope: "day" });
        expect(parsePersonalFinanceCommand("uang bulan")).toEqual({ action: "report", scope: "month", month: null });
        expect(parsePersonalFinanceCommand("uang bulan 2026-06")).toEqual({
            action: "report",
            scope: "month",
            month: "2026-06"
        });
        expect(parsePersonalFinanceCommand("uang hapus 12")).toEqual({ action: "delete", id: 12 });
        expect(parsePersonalFinanceCommand("uang bantuan").action).toBe("help");
    });

    test("sinonim payung ikut jalan", () => {
        for (const w of ["duit", "dompet"]) {
            expect(parsePersonalFinanceCommand(w)).toEqual({ action: "report", scope: "day" });
        }
    });

    // `kas` dipindah ke KAS USAHA. Kalau ia kembali jadi pemicu dompet pribadi,
    // pengeluaran usaha akan tercatat di dompet pribadi — pencampuran yang justru
    // seluruh desain ini hindari.
    test("`kas` BUKAN lagi pemicu dompet pribadi (milik kas usaha)", () => {
        expect(TRIGGER_WORDS).not.toContain("kas");
        expect(parsePersonalFinanceCommand("kas 150rb kabel").action).toBe("unknown");
    });

    test("`uang <ngawur>` menampilkan bantuan, tidak didiamkan", () => {
        expect(parsePersonalFinanceCommand("uang asdfgh").action).toBe("help");
    });

    test("hapus butuh id valid", () => {
        expect(parsePersonalFinanceCommand("uang hapus abc").action).toBe("unknown");
        expect(parsePersonalFinanceCommand("uang hapus 0").action).toBe("unknown");
    });

    test("nominal tak terbaca dilaporkan sebagai alasan, bukan dicatat diam-diam", () => {
        expect(parsePersonalFinanceCommand("keluar banyak sekali")).toEqual({
            action: "unknown",
            reason: "nominal_tidak_terbaca"
        });
    });

    test("jenis tak dikenal tidak pernah jadi catatan", () => {
        expect(parsePersonalFinanceCommand("halo 50rb").reason).toBe("jenis_tidak_dikenal");
    });

    // REGRESI: cfg.categories `{}` dari config.json prod tak boleh mematikan inferensi jalur WA.
    test("kategori tetap tertebak walau config mengirim peta kosong", () => {
        expect(parsePersonalFinanceCommand("keluar 50rb bensin", { categories: {} }).category).toBe("transport");
        expect(parsePersonalFinanceCommand("masuk 2jt gaji", { categories: {} }).category).toBe("gaji");
    });
});

describe("buildDailySeries", () => {
    // Hari tanpa catatan WAJIB ikut sebagai nol. Kalau tidak, batang 11 Juli tampak
    // bersebelahan dengan 3 Juli dan "tanggal berapa saya boros" jadi salah baca.
    test("mengisi hari kosong dengan nol", () => {
        const rows = [
            { tanggal: "2026-07-02", kind: "out", total: 50000, jumlah: 2 },
            { tanggal: "2026-07-05", kind: "in", total: 2000000, jumlah: 1 }
        ];
        const seri = buildDailySeries(rows, "2026-07-01", "2026-07-07");

        expect(seri).toHaveLength(7);
        expect(seri.map((d) => d.hari)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(seri[0]).toMatchObject({ tanggal: "2026-07-01", masuk: 0, keluar: 0, jumlah: 0 });
        expect(seri[1]).toMatchObject({ tanggal: "2026-07-02", keluar: 50000, jumlah: 2 });
        expect(seri[4]).toMatchObject({ tanggal: "2026-07-05", masuk: 2000000, selisih: 2000000 });
    });

    test("menjumlah masuk dan keluar pada tanggal yang sama", () => {
        const seri = buildDailySeries(
            [
                { tanggal: "2026-07-03", kind: "out", total: 30000, jumlah: 1 },
                { tanggal: "2026-07-03", kind: "in", total: 100000, jumlah: 1 }
            ],
            "2026-07-03",
            "2026-07-03"
        );
        expect(seri).toHaveLength(1);
        expect(seri[0]).toMatchObject({ masuk: 100000, keluar: 30000, selisih: 70000, jumlah: 2 });
    });

    test("melintasi batas bulan dengan benar (Februari kabisat)", () => {
        const seri = buildDailySeries([], "2024-02-27", "2024-03-02");
        expect(seri.map((d) => d.tanggal)).toEqual([
            "2024-02-27",
            "2024-02-28",
            "2024-02-29",
            "2024-03-01",
            "2024-03-02"
        ]);
    });

    test("rentang tak valid → array kosong, bukan lemparan", () => {
        expect(buildDailySeries([], "ngawur", "2026-07-31")).toEqual([]);
        expect(buildDailySeries([], "", "")).toEqual([]);
    });

    test("rentang terbalik tidak membuat loop tak berujung", () => {
        expect(buildDailySeries([], "2026-07-10", "2026-07-01")).toEqual([]);
    });
});

describe("weekRange & dayRange", () => {
    // 2026-07-23 = Kamis. Minggu Indonesia mulai SENIN, bukan Minggu — kalau salah,
    // "laporan minggu ini" pada hari Minggu akan menampilkan minggu yang keliru.
    const kamis = new Date(2026, 6, 23);

    test("minggu ini = Senin s/d Minggu", () => {
        expect(weekRange(0, kamis)).toMatchObject({ from: "2026-07-20", to: "2026-07-26" });
    });

    test("minggu lalu digeser tepat 7 hari", () => {
        expect(weekRange(-1, kamis)).toMatchObject({ from: "2026-07-13", to: "2026-07-19" });
    });

    test("hari MINGGU tetap masuk minggu yang sedang berjalan (bukan minggu berikutnya)", () => {
        const minggu = new Date(2026, 6, 26); // Minggu
        expect(weekRange(0, minggu)).toMatchObject({ from: "2026-07-20", to: "2026-07-26" });
    });

    test("minggu boleh melintasi batas bulan", () => {
        const rabu = new Date(2026, 6, 1); // 1 Juli 2026 = Rabu
        expect(weekRange(0, rabu)).toMatchObject({ from: "2026-06-29", to: "2026-07-05" });
    });

    test("dayRange: hari ini & kemarin", () => {
        expect(dayRange(0, kamis)).toMatchObject({ from: "2026-07-23", to: "2026-07-23" });
        expect(dayRange(-1, kamis)).toMatchObject({ from: "2026-07-22", to: "2026-07-22" });
    });

    test("kemarin boleh melintasi batas bulan", () => {
        expect(dayRange(-1, new Date(2026, 6, 1))).toMatchObject({ from: "2026-06-30" });
    });
});

describe("previousRange", () => {
    // Bulan penuh HARUS dibandingkan dengan bulan kalender sebelumnya. Kalau digeser
    // "N hari", Maret (31 hari) dibandingkan dengan 29 Jan–28 Feb — bukan Februari.
    test("bulan penuh → bulan kalender sebelumnya", () => {
        expect(previousRange("2026-03-01", "2026-03-31")).toEqual({
            from: "2026-02-01",
            to: "2026-02-28",
            label: "bulan lalu"
        });
        expect(previousRange("2026-01-01", "2026-01-31")).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
        expect(previousRange("2024-03-01", "2024-03-31")).toMatchObject({ from: "2024-02-01", to: "2024-02-29" });
    });

    test("rentang bebas → digeser sepanjang jumlah harinya", () => {
        expect(previousRange("2026-07-10", "2026-07-16")).toMatchObject({ from: "2026-07-03", to: "2026-07-09" });
    });

    test("rentang satu hari → hari sebelumnya", () => {
        expect(previousRange("2026-07-01", "2026-07-01")).toMatchObject({ from: "2026-06-30", to: "2026-06-30" });
    });

    test("masukan tak valid → null, bukan lemparan", () => {
        expect(previousRange("ngawur", "2026-07-31")).toBeNull();
        expect(previousRange("", "")).toBeNull();
    });
});

describe("hitungTren", () => {
    test("pengeluaran naik = MEMBURUK, pemasukan naik = membaik", () => {
        expect(hitungTren(150, 100, true)).toMatchObject({ arah: "naik", persen: 50, membaik: false });
        expect(hitungTren(150, 100, false)).toMatchObject({ arah: "naik", persen: 50, membaik: true });
        expect(hitungTren(50, 100, true)).toMatchObject({ arah: "turun", persen: -50, membaik: true });
    });

    test("pembanding nol → tanpa persen (bukan bagi nol / Infinity)", () => {
        const t = hitungTren(100, 0);
        expect(t.persen).toBeNull();
        expect(t.arah).toBe("naik");
        expect(Number.isFinite(t.selisih)).toBe(true);
    });

    test("tak berubah → tetap", () => {
        expect(hitungTren(100, 100)).toMatchObject({ arah: "tetap", membaik: null });
    });
});

describe("toCsv", () => {
    const baris = [
        { id: 1, ts: "2026-07-02 08:15:00", tanggal: "2026-07-02", kind: "out", amount: 50000, category: "transport", note: "bensin", source: "wa" }
    ];

    test("diawali BOM UTF-8 agar Excel Windows tak mojibake", () => {
        expect(toCsv(baris).charCodeAt(0)).toBe(0xfeff);
    });

    test("header + isi, pemisah titik-koma (Excel lokal Indonesia)", () => {
        const isi = toCsv(baris).replace(/^﻿/, "").split("\r\n");
        expect(isi[0]).toBe("id;tanggal;waktu;jenis;nominal;kategori;catatan;asal");
        expect(isi[1]).toBe("1;2026-07-02;08:15;keluar;50000;transport;bensin;wa");
    });

    // Catatan pemakai bisa memuat ; atau kutip — tanpa escaping, kolomnya bergeser diam-diam.
    test("nilai berisi pemisah/kutip/baris-baru di-escape", () => {
        const nakal = [{ ...baris[0], note: 'beli "gas"; dan galon\nbaris dua' }];
        const isi = toCsv(nakal).replace(/^﻿/, "").split("\r\n");
        expect(isi[1]).toContain('"beli ""gas""; dan galon');
    });

    test("daftar kosong tetap menghasilkan header", () => {
        expect(toCsv([]).replace(/^﻿/, "").trim()).toBe("id;tanggal;waktu;jenis;nominal;kategori;catatan;asal");
    });
});

describe("TRIGGER_WORDS — pemicu telanjang harus SEMPIT", () => {
    test("hanya kata tak-bermakna-lain yang memicu", () => {
        // `kas` TIDAK di sini — sudah dipindah ke kas usaha (lib/business-expense-service).
        expect([...TRIGGER_WORDS].sort()).toEqual(
            ["dompet", "duit", "keluar", "kluar", "masuk", "msk", "uang"].sort()
        );
    });

    // Tanpa prefix, pemicu yang longgar akan menelan percakapan bisnis pemilik sendiri.
    // Alias ini tetap sah sebagai kata kedua, tapi TIDAK boleh membuka dompet sendirian.
    test("kata bisnis yang ambigu TIDAK ikut memicu", () => {
        for (const w of ["bayar", "beli", "belanja", "pakai", "terima", "dapat", "lapor", "laporan", "k", "m"]) {
            expect(TRIGGER_WORDS).not.toContain(w);
        }
    });
});

describe("formatRupiah & monthRange", () => {
    test("format ribuan Indonesia", () => {
        expect(formatRupiah(50000)).toBe("Rp50.000");
        expect(formatRupiah(1500000)).toBe("Rp1.500.000");
        expect(formatRupiah(0)).toBe("Rp0");
        expect(formatRupiah(-25000)).toBe("-Rp25.000");
    });

    test("rentang bulan menutup hari terakhir yang benar", () => {
        expect(monthRange("2026-02")).toEqual({ month: "2026-02", from: "2026-02-01", to: "2026-02-28" });
        expect(monthRange("2024-02")).toEqual({ month: "2024-02", from: "2024-02-01", to: "2024-02-29" });
        expect(monthRange("2026-01")).toEqual({ month: "2026-01", from: "2026-01-01", to: "2026-01-31" });
    });

    test("bulan tak valid → jatuh ke bulan berjalan", () => {
        const r = monthRange("ngawur", new Date(2026, 6, 23));
        expect(r.month).toBe("2026-07");
    });
});
