"use strict";

/**
 * Header Doc
 * Purpose: Mengunci DUA cacat yang membuat SELURUH rekap tunggakan selalu nol di produksi —
 *   dan nol di sini bukan "tak ada yang menunggak", melainkan "tak ada yang diperiksa".
 *
 *   (1) Daftar pelanggan disaring `status IN ('aktif','isolir')` — dua ejaan yang tak pernah
 *       ditulis kode mana pun. Terukur 2026-08-10: 100% baris bernilai 'active' (60 Dander,
 *       98 Tanjungharjo) → query memulangkan NOL baris.
 *   (2) Tagihan dihitung dari `subscription_price` MENTAH, yang 0/kosong untuk 52/55 (Dander)
 *       dan 98/98 (Tanjungharjo) — harga sebenarnya ada di katalog paket.
 *
 *   Masing-masing sendirian sudah cukup membuat hasilnya nol; keduanya bertumpuk. Akibat
 *   terparah bukan angka di layar melainkan "Broadcast Terarah → penunggak" yang terukur
 *   mengirim ke 0 orang padahal 35 & 86 pelanggan benar-benar belum bayar.
 * Caller: Jest (`npx jest services/__tests__/arrears-blind-spot.test.js`).
 * Deps: `services/arrears.service` (repository + price owner disuntik), fs/path (pindai SQL).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");
const { createArrearsService } = require("../arrears.service");

const PERIODE = { periodMonth: 8, periodYear: 2026 };

/** Pelanggan seperti di produksi: harga TIDAK ada di kolomnya, hanya di katalog paket. */
const PELANGGAN_PROD = [
    { id: 1, name: "Budi", subscription: "PAKET-100K", subscription_price: 0, status: "active" },
    { id: 2, name: "Sari", subscription: "PAKET-100K", subscription_price: null, status: "active" },
    { id: 3, name: "Joko", subscription: "PAKET-150K", subscription_price: 150000, status: "active" }
];

function repoPalsu(customers, ledger = { payments: [], reversals: [] }) {
    return {
        listBillableCustomers: async () => customers,
        getLedgerEntriesUpToPeriod: async () => ledger
    };
}

// Katalog paket = satu-satunya tempat harga sebenarnya tinggal.
function hargaKatalog(customer) {
    if (Number(customer.subscription_price) > 0) return Number(customer.subscription_price);
    return { "PAKET-100K": 100000, "PAKET-150K": 150000 }[customer.subscription] || 0;
}

describe("tunggakan tak boleh nol hanya karena harga tak ada di kolom pelanggan", () => {
    test("pelanggan tanpa subscription_price TETAP terhitung menunggak", async () => {
        const svc = createArrearsService({
            repository: repoPalsu(PELANGGAN_PROD),
            getEffectivePrice: hargaKatalog
        });
        const hasil = await svc.getArrearsReadModel(PERIODE);

        expect(hasil.summary.total_customers_in_arrears).toBe(3);
        expect(hasil.summary.total_outstanding).toBe(100000 + 100000 + 150000);
        expect(hasil.summary.collection_rate_by_customer).toBe(0);
    });

    test("yang sudah bayar penuh TIDAK ikut terhitung", async () => {
        const svc = createArrearsService({
            repository: repoPalsu(PELANGGAN_PROD, {
                payments: [{ user_id: 1, amount_paid: 100000, amount_due: 100000, period_month: 8, period_year: 2026 }],
                reversals: []
            }),
            getEffectivePrice: hargaKatalog
        });
        const hasil = await svc.getArrearsReadModel(PERIODE);

        expect(hasil.summary.total_customers_in_arrears).toBe(2);
        expect(hasil.rows.map((r) => r.user_id).sort()).toEqual([2, 3]);
    });

    test("bayar SEBAGIAN menyisakan tunggakan sebesar sisanya", async () => {
        const svc = createArrearsService({
            repository: repoPalsu([PELANGGAN_PROD[0]], {
                payments: [{ user_id: 1, amount_paid: 40000, amount_due: 100000, period_month: 8, period_year: 2026 }],
                reversals: []
            }),
            getEffectivePrice: hargaKatalog
        });
        const hasil = await svc.getArrearsReadModel(PERIODE);
        expect(hasil.summary.total_outstanding).toBe(60000);
    });

    test("gratis SUNGGUHAN (harga efektif 0) tetap TIDAK dianggap menunggak", async () => {
        // Nol yang sah harus tetap nol — perbaikan ini tak boleh menagih orang yang tak berutang.
        const svc = createArrearsService({
            repository: repoPalsu([{ id: 9, name: "Gratis", subscription: "PAKET-GRATIS", subscription_price: 0, status: "active" }]),
            getEffectivePrice: () => 0
        });
        const hasil = await svc.getArrearsReadModel(PERIODE);
        expect(hasil.summary.total_customers_in_arrears).toBe(0);
        expect(hasil.summary.total_outstanding).toBe(0);
    });

    test("amount_due dari ledger tetap menang untuk periode yang punya baris pembayaran", async () => {
        // Nominal yang BENAR-BENAR ditagih saat itu, bukan harga hari ini.
        const svc = createArrearsService({
            repository: repoPalsu([PELANGGAN_PROD[0]], {
                payments: [{ user_id: 1, amount_paid: 0, amount_due: 75000, period_month: 8, period_year: 2026 }],
                reversals: []
            }),
            getEffectivePrice: hargaKatalog
        });
        const hasil = await svc.getArrearsReadModel(PERIODE);
        expect(hasil.summary.total_outstanding).toBe(75000);
    });

    test("layanan tak lagi membaca subscription_price mentah untuk menghitung tagihan", () => {
        const src = baca("services", "arrears.service.js");
        const kode = src.split(/\r?\n/).filter((b) => !/^\s*(\*|\/\*|\/\/)/.test(b)).join("\n");
        expect(kode).not.toMatch(/customer\.subscription_price/);
        expect(kode).toMatch(/getEffectivePrice/);
    });
});

describe("query pelanggan tak boleh menyaring dengan nilai status yang tak pernah ada", () => {
    const src = baca("repositories", "arrears.repository.js");
    // Komentar SENGAJA mengutip query lama sebagai penjelasan akar masalah — periksa KODE saja.
    const sql = src.split(/\r?\n/).filter((b) => !/^\s*(\*|\/\*|\/\/)/.test(b)).join("\n");

    test("daftar-putih 'aktif'/'isolir' sudah dibuang dari KODE", () => {
        expect(sql).not.toMatch(/status IN \('aktif'/);
    });

    test("memakai daftar-hitam + case-insensitive, jadi 'active' ikut terhitung", () => {
        expect(sql).toMatch(/LOWER\(COALESCE\(status, ?'active'\)\) NOT IN/);
        expect(sql).toMatch(/'nonaktif'/);
    });

    test("kolom diskon ikut diambil — tanpa itu pelanggan berdiskon salah tagih", () => {
        for (const kol of ["discount_percentage", "discount_amount", "discount_months", "discount_valid_until"]) {
            expect(sql).toContain(kol);
        }
    });

    test("akun infrastruktur tetap dikecualikan", () => {
        expect(sql).toMatch(/!= 'infrastruktur'/);
    });
});
