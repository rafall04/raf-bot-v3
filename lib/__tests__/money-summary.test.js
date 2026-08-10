"use strict";

/**
 * Header Doc
 * Purpose: Mengunci RINGKASAN UANG grup kas. Dua sifat yang paling mahal kalau salah:
 *   (1) angkanya DIBACA dari pemilik yang sudah ada (owner-cockpit + buku besar), tak dihitung
 *       ulang — dua tempat menghitung omset sendiri menghasilkan angka yang tak pernah cocok;
 *   (2) sumber yang GAGAL DIBACA tampil sebagai "tak terbaca", BUKAN Rp0. "Pemasukan Rp0" adalah
 *       kabar buruk yang menuntut tindakan; "tak terbaca" adalah bot yang sedang buta. Menyamakan
 *       keduanya membuat pemilik panik, atau lebih buruk: tenang padahal tak ada yang tahu.
 *   Ikut dikunci: filter periode buku besar memakai {month, year} — nama filter yang salah
 *   diabaikan DIAM-DIAM sehingga "sisa bulan ini" sebenarnya total sepanjang masa.
 * Caller: Jest (`npx jest lib/__tests__/money-summary.test.js`).
 * Deps: `lib/services/money-summary` (dep-injected, tak menyentuh jaringan/DB).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");
const { buildMoneySummary, buildMoneySummaryText } = require("../services/money-summary");

const KARTU_SEHAT = {
    ok: true,
    netPaid: 12500000,
    todayCount: 3,
    todayAmount: 450000,
    mrr: 18000000,
    totalCustomers: 120,
    lunas: 90,
    collectionRate: 75,
    arrearsCustomers: 30,
    arrearsOutstanding: 4500000,
    trendPct: 12
};

// buildMoneySummary kini juga membaca omset (tanpa isolir), pengeluaran nyata, dan biaya
// rutin. Helper ini menyediakan semuanya supaya tiap test hanya menyebut yang ia pedulikan.
function depsLengkap(tambahan = {}) {
    return {
        cockpit: {
            buildIncomeOnly: async () => KARTU_SEHAT,
            buildOmsetAktif: async () => ({ ok: true, isolirTerbaca: true, mrr: 18000000, omsetAktif: 17000000, isolirJumlah: 5, isolirNilai: 1000000 })
        },
        ledger: ledgerPalsu([]),
        expenseManager: { listExpenses: async () => [] },
        recurring: { listAll: async () => [], periodeSekarang: () => "2026-08" },
        ...tambahan
    };
}

function ledgerPalsu(entries, jejak = []) {
    return {
        getFinancialLedgerReport: async (filters) => {
            jejak.push(filters);
            return { entries };
        },
        buildCashflowSummary: (rows) => ({
            totalIncome: rows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0),
            totalExpense: rows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0),
            netTotal:
                rows.filter((r) => r.direction === "credit").reduce((s, r) => s + r.amount, 0) -
                rows.filter((r) => r.direction === "debit").reduce((s, r) => s + r.amount, 0)
        })
    };
}

describe("ringkasan uang: membaca, bukan menghitung ulang", () => {
    test("angka diambil apa adanya dari kartu pemasukan cockpit", async () => {
        const data = await buildMoneySummary({
            period: { periodMonth: 8, periodYear: 2026 },
            deps: depsLengkap({
                ledger: ledgerPalsu([{ direction: "credit", amount: 12500000 }, { direction: "debit", amount: 3000000 }])
            })
        });

        expect(data.netPaid).toBe(12500000);
        expect(data.mrr).toBe(18000000);
        expect(data.collectionRate).toBe(75);
        expect(data.arrearsOutstanding).toBe(4500000);
        expect(data.totalExpense).toBe(3000000);
        expect(data.netTotal).toBe(9500000);
        expect(data.gagal).toEqual([]);
    });

    test("OMSET yang dilaporkan mengecualikan terisolir — beda dari mrr, dan selisihnya dibawa", async () => {
        // Ini yang membuat perintah `omset` di WhatsApp dan halaman menjawab hal yang sama.
        const data = await buildMoneySummary({ deps: depsLengkap() });
        expect(data.mrr).toBe(18000000);        // potensi penuh
        expect(data.omsetAktif).toBe(17000000); // yang layanannya menyala
        expect(data.isolirJumlah).toBe(5);
        expect(data.isolirNilai).toBe(1000000);
        expect(data.isolirTerbaca).toBe(true);
        // Belum masuk dihitung dari omset AKTIF, bukan potensi penuh.
        expect(data.belumMasuk).toBe(17000000 - 12500000);
    });

    test("proyeksi sisa = masuk - keluar - tagihan rutin yang belum tuntas", async () => {
        const data = await buildMoneySummary({
            now: new Date(2026, 7, 10),
            period: { periodMonth: 8, periodYear: 2026 },
            deps: depsLengkap({
                expenseManager: { listExpenses: async () => [{ category: "operasional", amount: 500000 }] },
                recurring: {
                    listAll: async () => [
                        { aktif: 1, perkiraan: 1500000, kategori: "operasional", tanggal: 15, last_settled_period: null },
                        { aktif: 1, perkiraan: 900000, kategori: "operasional", tanggal: 5, last_settled_period: null },
                        // Sudah dituntaskan bulan ini -> TIDAK dihitung lagi.
                        { aktif: 1, perkiraan: 700000, kategori: "operasional", tanggal: 3, last_settled_period: "2026-08" },
                        // Nonaktif -> tak dihitung.
                        { aktif: 0, perkiraan: 400000, kategori: "operasional", tanggal: 8, last_settled_period: null }
                    ],
                    periodeSekarang: () => "2026-08"
                }
            })
        });
        expect(data.keluar).toBe(500000);
        expect(data.akanKeluar).toBe(2400000);
        expect(data.akanJumlah).toBe(2);
        expect(data.akanTerlewat).toBe(1); // tgl 5 sudah lewat, tgl 15 belum
        expect(data.sisa).toBe(12500000 - 500000);
        expect(data.proyeksiSisa).toBe(12500000 - 500000 - 2400000);
    });

    test("memakai jalur RINGAN (buildIncomeOnly), bukan cockpit penuh yang memanggil MikroTik", async () => {
        let dipanggil = null;
        await buildMoneySummary({
            deps: {
                cockpit: {
                    buildIncomeOnly: async () => { dipanggil = "ringan"; return KARTU_SEHAT; },
                    buildCockpit: async () => { dipanggil = "penuh"; return { income: KARTU_SEHAT }; }
                },
                ledger: ledgerPalsu([])
            }
        });
        expect(dipanggil).toBe("ringan");
    });

    test("filter buku besar memakai {month, year} — bukan dateFrom/dateTo yang diabaikan diam-diam", async () => {
        const jejak = [];
        await buildMoneySummary({
            period: { periodMonth: 8, periodYear: 2026 },
            deps: { cockpit: { buildIncomeOnly: async () => KARTU_SEHAT }, ledger: ledgerPalsu([], jejak) }
        });
        expect(jejak[0]).toEqual({ month: 8, year: 2026 });
        expect(jejak[0].dateFrom).toBeUndefined();
    });
});

describe("gagal baca TIDAK boleh tampil sebagai Rp0", () => {
    test("kartu pemasukan gagal → nilainya null + ditandai di daftar gagal", async () => {
        const data = await buildMoneySummary({
            deps: {
                cockpit: { buildIncomeOnly: async () => ({ ok: false, error: "sumber mati" }) },
                ledger: ledgerPalsu([{ direction: "debit", amount: 200000 }])
            }
        });
        expect(data.netPaid).toBeNull();
        expect(data.mrr).toBeNull();
        expect(data.gagal).toContain("pemasukan");
        // Arus kas tetap terbaca — satu sumber gagal tak menjatuhkan yang lain.
        expect(data.totalExpense).toBe(200000);
    });

    test("cockpit MELEMPAR pun tak menjatuhkan ringkasan", async () => {
        const data = await buildMoneySummary({
            deps: {
                cockpit: { buildIncomeOnly: async () => { throw new Error("meledak"); } },
                ledger: ledgerPalsu([])
            }
        });
        expect(data.gagal).toContain("pemasukan");
        expect(data.netPaid).toBeNull();
    });

    test("buku besar gagal → arus kas null, bukan nol", async () => {
        const data = await buildMoneySummary({
            deps: {
                cockpit: { buildIncomeOnly: async () => KARTU_SEHAT },
                ledger: { getFinancialLedgerReport: async () => { throw new Error("db tutup"); }, buildCashflowSummary: () => ({}) }
            }
        });
        expect(data.totalExpense).toBeNull();
        expect(data.netTotal).toBeNull();
        expect(data.gagal).toContain("arus_kas");
    });

    test("teksnya menulis 'tak terbaca', BUKAN Rp0, dan memperingatkan", async () => {
        const data = await buildMoneySummary({
            deps: {
                cockpit: { buildIncomeOnly: async () => ({ ok: false }) },
                ledger: { getFinancialLedgerReport: async () => { throw new Error("x"); }, buildCashflowSummary: () => ({}) }
            }
        });
        const teks = String(buildMoneySummaryText(data, { judul: "UJI" }));
        expect(teks).toMatch(/tak terbaca/);
        expect(teks).not.toMatch(/Rp\s?0\b/);
        expect(teks).toMatch(/bukan berarti nol/i);
    });
});

describe("teks ringkasan", () => {
    test("memuat semua pos dan tak menyisakan slot", async () => {
        const data = await buildMoneySummary({
            deps: {
                cockpit: { buildIncomeOnly: async () => KARTU_SEHAT },
                ledger: ledgerPalsu([{ direction: "credit", amount: 12500000 }, { direction: "debit", amount: 3000000 }])
            }
        });
        const teks = String(buildMoneySummaryText(data));
        for (const pos of ["MASUK", "KELUAR", "SISA", "omset", "Tunggakan"]) {
            expect(teks).toContain(pos);
        }
        // Tak ada slot yang gagal tersubstitusi.
        expect(teks).not.toMatch(/\$\{[a-zA-Z0-9_]+\}/);
        // Bukan teks error template.
        expect(teks).not.toMatch(/^Error: Template/);
    });

    test("template terdaftar di store dengan bentuk yang benar", () => {
        const t = JSON.parse(baca("database", "response_templates.json"));
        for (const key of ["be_ringkasan_uang", "kas_notif_gaji", "kas_notif_pengeluaran_besar", "be_rutin_tambah"]) {
            expect(t[key]).toBeDefined();
            expect(typeof t[key].template).toBe("string");
            expect(t[key].template.trim()).not.toBe("");
        }
        // Slot yang dihitung kode WAJIB ada di template tersimpan — kalau tidak, bagiannya
        // dihitung lalu tak pernah terkirim (template tersimpan menimpa fallback).
        // Slot yang dihitung kode WAJIB ada di template TERSIMPAN. Kalau tidak, bagiannya
        // dihitung lalu tak pernah terkirim — persis yang terjadi saat template masih memuat
        // `${mrr}` sementara kode sudah memakai `${omset_aktif}`.
        for (const slot of ["${omset_aktif}", "${isolir_info}", "${belum_masuk}", "${akan_info}", "${proyeksi_info}", "${tunggakan}", "${sisa_bersih}"]) {
            expect(t.be_ringkasan_uang.template).toContain(slot);
        }
    });
});
