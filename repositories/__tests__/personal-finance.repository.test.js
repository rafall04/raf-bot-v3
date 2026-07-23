/**
 * Header Doc
 * Purpose: Menguji persistensi keuangan pribadi di SQLite sungguhan (file sementara) — simpan,
 *          daftar, rekap per kategori, hapus — plus penolakan nominal 0/negatif/pecahan yang
 *          mencerminkan aturan saldo pelanggan walau ledgernya terpisah.
 * Caller: Jest.
 * Deps: `repositories/personal-finance.repository`, `sqlite3`, `fs`, `os`, `path`.
 * MainFuncs: -
 * SideEffects: Membuat & menghapus file SQLite sementara di direktori temp OS.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { createPersonalFinanceRepository } = require("../personal-finance.repository");

describe("personal-finance.repository", () => {
    let dir;
    let repo;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
        repo = createPersonalFinanceRepository({
            getDatabasePath: () => path.join(dir, "personal_finance.sqlite")
        });
    });

    afterEach(() => {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch (_e) {
            /* abaikan */
        }
    });

    test("simpan lalu baca kembali", async () => {
        const entry = await repo.addEntry({
            kind: "out",
            amount: 50000,
            category: "transport",
            note: "bensin",
            ts: "2026-07-23 09:00:00"
        });

        expect(entry.id).toBeGreaterThan(0);
        expect(entry.tanggal).toBe("2026-07-23");

        const rows = await repo.listEntries({});
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: "out", amount: 50000, category: "transport", note: "bensin" });
    });

    test("nominal 0 / negatif / pecahan DITOLAK — cermin aturan saldo", async () => {
        for (const buruk of [0, -1000, 1500.5, null, undefined, NaN, "abc"]) {
            await expect(repo.addEntry({ kind: "out", amount: buruk })).rejects.toThrow(/amount/i);
        }
        expect(await repo.listEntries({})).toHaveLength(0);
    });

    test("jenis selain in/out ditolak", async () => {
        await expect(repo.addEntry({ kind: "transfer", amount: 1000 })).rejects.toThrow(/kind/i);
    });

    test("rekap menjumlah masuk/keluar dan selisih", async () => {
        await repo.addEntry({ kind: "in", amount: 2000000, category: "gaji", ts: "2026-07-01 08:00:00" });
        await repo.addEntry({ kind: "out", amount: 50000, category: "transport", ts: "2026-07-02 08:00:00" });
        await repo.addEntry({ kind: "out", amount: 25000, category: "makan", ts: "2026-07-03 08:00:00" });

        const rekap = await repo.summary({ from: "2026-07-01", to: "2026-07-31" });
        expect(rekap.masuk).toBe(2000000);
        expect(rekap.keluar).toBe(75000);
        expect(rekap.selisih).toBe(1925000);
        expect(rekap.jumlahCatatan).toBe(3);

        const keluar = rekap.perKategori.filter((r) => r.kind === "out").map((r) => r.category);
        expect(keluar).toEqual(expect.arrayContaining(["transport", "makan"]));
    });

    test("filter periode benar-benar memotong di batas", async () => {
        await repo.addEntry({ kind: "out", amount: 1000, ts: "2026-06-30 23:00:00" });
        await repo.addEntry({ kind: "out", amount: 2000, ts: "2026-07-01 00:30:00" });
        await repo.addEntry({ kind: "out", amount: 4000, ts: "2026-07-31 23:30:00" });
        await repo.addEntry({ kind: "out", amount: 8000, ts: "2026-08-01 00:10:00" });

        const juli = await repo.summary({ from: "2026-07-01", to: "2026-07-31" });
        expect(juli.keluar).toBe(6000);
    });

    test("hapus catatan", async () => {
        const e = await repo.addEntry({ kind: "out", amount: 12000, note: "kopi" });
        expect(await repo.getEntry(e.id)).toMatchObject({ amount: 12000 });

        expect(await repo.deleteEntry(e.id)).toEqual({ deleted: true });
        expect(await repo.getEntry(e.id)).toBeNull();
        expect(await repo.deleteEntry(9999)).toEqual({ deleted: false });
    });

    test("kategori kosong jatuh ke 'lain', bukan null", async () => {
        const e = await repo.addEntry({ kind: "out", amount: 5000 });
        expect(e.category).toBe("lain");
    });

    describe("filter daftar catatan", () => {
        beforeEach(async () => {
            await repo.addEntry({ kind: "out", amount: 50000, category: "transport", note: "bensin motor", ts: "2026-07-02 08:00:00" });
            await repo.addEntry({ kind: "out", amount: 25000, category: "makan", note: "warung padang", ts: "2026-07-02 12:00:00" });
            await repo.addEntry({ kind: "in", amount: 2000000, category: "gaji", note: "gaji juli", ts: "2026-07-01 09:00:00" });
        });

        test("saring per jenis", async () => {
            expect(await repo.listEntries({ kind: "out" })).toHaveLength(2);
            expect(await repo.listEntries({ kind: "in" })).toHaveLength(1);
        });

        test("saring per kategori (tak peka huruf besar-kecil)", async () => {
            expect(await repo.listEntries({ category: "TRANSPORT" })).toHaveLength(1);
            expect(await repo.listEntries({ category: "tak-ada" })).toHaveLength(0);
        });

        test("cari mencakup catatan DAN kategori", async () => {
            expect(await repo.listEntries({ search: "bensin" })).toHaveLength(1); // dari note
            expect(await repo.listEntries({ search: "makan" })).toHaveLength(1); // dari category
            expect(await repo.listEntries({ search: "WARUNG" })).toHaveLength(1); // tak peka huruf
        });

        // `%` milik pemakai harus dicari harfiah, bukan jadi wildcard yang mengembalikan semua.
        test("wildcard LIKE dari pemakai di-escape", async () => {
            expect(await repo.listEntries({ search: "%" })).toHaveLength(0);
            expect(await repo.listEntries({ search: "_" })).toHaveLength(0);
            await repo.addEntry({ kind: "out", amount: 1000, note: "diskon 50%" });
            expect(await repo.listEntries({ search: "50%" })).toHaveLength(1);
        });

        test("filter bisa digabung", async () => {
            expect(await repo.listEntries({ kind: "out", search: "bensin" })).toHaveLength(1);
            expect(await repo.listEntries({ kind: "in", search: "bensin" })).toHaveLength(0);
        });
    });

    describe("dailyTotals", () => {
        test("mengelompokkan per tanggal dan jenis", async () => {
            await repo.addEntry({ kind: "out", amount: 50000, ts: "2026-07-02 08:00:00" });
            await repo.addEntry({ kind: "out", amount: 25000, ts: "2026-07-02 19:00:00" });
            await repo.addEntry({ kind: "in", amount: 2000000, ts: "2026-07-05 09:00:00" });

            const rows = await repo.dailyTotals({ from: "2026-07-01", to: "2026-07-31" });
            const keluar02 = rows.find((r) => r.tanggal === "2026-07-02" && r.kind === "out");
            expect(keluar02.total).toBe(75000);
            expect(keluar02.jumlah).toBe(2);
            expect(rows.find((r) => r.tanggal === "2026-07-05" && r.kind === "in").total).toBe(2000000);
            // Hanya tanggal yang PUNYA catatan — hari kosong diisi buildDailySeries.
            expect(rows.every((r) => ["2026-07-02", "2026-07-05"].includes(r.tanggal))).toBe(true);
        });

        test("menghormati batas periode", async () => {
            await repo.addEntry({ kind: "out", amount: 1000, ts: "2026-06-30 23:00:00" });
            await repo.addEntry({ kind: "out", amount: 2000, ts: "2026-07-01 01:00:00" });
            const rows = await repo.dailyTotals({ from: "2026-07-01", to: "2026-07-31" });
            expect(rows).toHaveLength(1);
            expect(rows[0].tanggal).toBe("2026-07-01");
        });
    });
});
