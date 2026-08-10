"use strict";

/**
 * Header Doc
 * Purpose: Mengunci kartu ARUS KAS + grafik pengeluaran di /kas-usaha.
 *   Yang paling mudah salah di sini bukan rumusnya, melainkan CARA MELAPOR:
 *   (1) "omset tanpa isolir" hanya sah kalau status isolir BENAR-BENAR terbaca. MikroTik tak
 *       terjangkau lalu diam-diam mengurangi (atau diam-diam tidak) = angka yang salah tanpa
 *       ada yang tahu. Karena itu `isolirTerbaca` dipulangkan dan dikatakan di layar.
 *   (2) `sisa` tak boleh dihitung dari nilai yang tak terbaca — null yang diam-diam jadi 0
 *       melaporkan untung/rugi yang tak pernah diukur.
 *   (3) omset penuh vs tanpa-isolir DIJELASKAN selisihnya; dua angka bernama "omset" yang
 *       berbeda tanpa keterangan membuat pemiliknya tak percaya keduanya.
 * Caller: Jest (`npx jest routes/__tests__/kas-cashflow.test.js`).
 * Deps: fs/path (pindai route, view, js) + `lib/owner-cockpit-service` (dep-injected).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");
const { buildOmsetAktif } = require("../../lib/owner-cockpit-service");

const PELANGGAN = [
    { id: 1, name: "Aktif A", pppoe_username: "aktifa", subscription_price: 150000 },
    { id: 2, name: "Aktif B", pppoe_username: "aktifb", subscription_price: 100000 },
    { id: 3, name: "Kena isolir", pppoe_username: "isolirc", subscription_price: 200000 }
];

function deps(petaProfil) {
    return {
        getUsers: () => PELANGGAN,
        isInfrastructure: () => false,
        getEffectivePrice: (u) => Number(u.subscription_price) || 0,
        getIsolirProfile: () => "ISOLIR",
        getProfileMap: async () => petaProfil
    };
}

describe("omset aktif: pelanggan terisolir dikeluarkan", () => {
    test("mengurangi yang profil PPPoE-nya = profil isolir", async () => {
        const peta = new Map([["aktifa", "PAKET"], ["aktifb", "PAKET"], ["isolirc", "ISOLIR"]]);
        const r = await buildOmsetAktif(deps(peta));

        expect(r.isolirTerbaca).toBe(true);
        expect(r.mrr).toBe(450000);          // potensi penuh
        expect(r.omsetAktif).toBe(250000);   // tanpa yang terisolir
        expect(r.isolirJumlah).toBe(1);
        expect(r.isolirNilai).toBe(200000);
    });

    test("cocokkan profil TANPA peduli besar-kecil huruf", async () => {
        const peta = new Map([["aktifa", "paket"], ["aktifb", "PAKET"], ["isolirc", "isolir"]]);
        const r = await buildOmsetAktif(deps(peta));
        expect(r.omsetAktif).toBe(250000);
    });

    test("MikroTik tak terbaca -> TIDAK mengurangi apa pun, dan mengatakannya", async () => {
        // Diam-diam mengurangi berdasarkan tebakan lebih berbahaya daripada angka penuh
        // yang jujur menyebut dirinya belum disaring.
        const r = await buildOmsetAktif({ ...deps(null), getProfileMap: async () => { throw new Error("RouterOS mati"); } });
        expect(r.isolirTerbaca).toBe(false);
        expect(r.omsetAktif).toBe(450000);
        expect(r.omsetAktif).toBe(r.mrr);
        expect(r.isolirJumlah).toBeNull();
    });

    test("profil isolir belum diset di config -> tak menyaring, ditandai tak terbaca", async () => {
        const r = await buildOmsetAktif({ ...deps(new Map()), getIsolirProfile: () => "" });
        expect(r.isolirTerbaca).toBe(false);
        expect(r.omsetAktif).toBe(r.mrr);
    });

    test("pelanggan tanpa pppoe_username tak dianggap terisolir", async () => {
        const peta = new Map([["isolirc", "ISOLIR"]]);
        const r = await buildOmsetAktif({
            ...deps(peta),
            getUsers: () => [{ id: 9, name: "Tanpa PPPoE", subscription_price: 75000 }]
        });
        expect(r.omsetAktif).toBe(75000);
        expect(r.isolirJumlah).toBe(0);
    });
});

describe("endpoint cashflow melapor jujur", () => {
    const route = baca("routes", "admin-kas-usaha-routes.js");

    test("tersedia dan membawa semua pos arus kas", () => {
        expect(route).toContain("/api/kas-usaha/cashflow");
        const idx = route.indexOf("/api/kas-usaha/cashflow");
        const blok = route.slice(idx, route.indexOf("Ringkasan kas bulan berjalan", idx));
        for (const pos of ["masuk", "keluar", "sisa", "omsetAktif", "omsetPenuh", "perKategori", "belumMasuk"]) {
            expect(blok).toContain(pos);
        }
    });

    test("sisa TIDAK dihitung saat salah satu sisi tak terbaca", () => {
        const idx = route.indexOf("/api/kas-usaha/cashflow");
        const blok = route.slice(idx, route.indexOf("Ringkasan kas bulan berjalan", idx));
        expect(blok).toMatch(/masuk != null && keluar != null \? masuk - keluar : null/);
    });

    test("sumber yang gagal dicatat, bukan disamarkan jadi nol", () => {
        const idx = route.indexOf("/api/kas-usaha/cashflow");
        const blok = route.slice(idx, route.indexOf("Ringkasan kas bulan berjalan", idx));
        expect(blok).toMatch(/gagal\.push\("pengeluaran"\)/);
        expect(blok).toMatch(/gagal\.push\("pemasukan"\)/);
    });
});

describe("tampilan arus kas", () => {
    const view = baca("views", "sb-admin", "kas-usaha.php");
    const js = baca("static", "js", "kas-usaha.js");

    test("empat pos + kanvas grafik ada di halaman", () => {
        for (const id of ["ku-omset", "ku-masuk", "ku-total", "ku-sisa", "ku-grafik", "ku-grafik-kosong"]) {
            expect(view).toContain(`id="${id}"`);
        }
        expect(view).toMatch(/chart\.js\/Chart\.min\.js/);
    });

    test("nilai tak terbaca ditulis '—', BUKAN Rp0", () => {
        expect(js).toMatch(/function nilai\(n\)/);
        expect(js).toMatch(/n == null \? "—"/);
    });

    test("selisih omset penuh vs tanpa-isolir dijelaskan di layar", () => {
        expect(js).toMatch(/Status isolir tak terbaca/);
        expect(js).toMatch(/terisolir dikeluarkan/);
    });

    test("keadaan kosong dibedakan dari grafik yang gagal digambar", () => {
        expect(js).toMatch(/Belum ada pengeluaran|ku-grafik-kosong/);
        expect(js).toMatch(/grafikKas\.destroy\(\)/);
    });
});

describe("tagihan yang BELUM jatuh tempo: ditampilkan, tapi tak dicampur ke pengeluaran", () => {
    const route = baca("routes", "admin-kas-usaha-routes.js");
    const js = baca("static", "js", "kas-usaha.js");
    const view = baca("views", "sb-admin", "kas-usaha.php");

    test("akanKeluar dihitung dari biaya rutin yang belum dituntaskan periode ini", () => {
        const idx = route.indexOf("/api/kas-usaha/cashflow");
        const blok = route.slice(idx, route.indexOf("Ringkasan kas bulan berjalan", idx));
        expect(blok).toMatch(/r\.last_settled_period === periode/);
        expect(blok).toMatch(/if \(!r\.aktif\) continue/);
        expect(blok).toMatch(/akanPerKategori/);
    });

    test("TIDAK dijumlahkan ke `keluar` — satu baris pengeluaran = uang benar-benar keluar", () => {
        const idx = route.indexOf("/api/kas-usaha/cashflow");
        const blok = route.slice(idx, route.indexOf("Ringkasan kas bulan berjalan", idx));
        // `keluar` hanya diisi dari listExpenses, tak pernah ditambah akanKeluar.
        expect(blok).not.toMatch(/keluar \+= akanKeluar|keluar = keluar \+ akan/);
        expect(blok).toMatch(/akanKeluar \+= n/);
    });

    test("tanggal 29-31 di bulan pendek dijepit ke hari terakhir (sama dengan cron)", () => {
        const idx = route.indexOf("/api/kas-usaha/cashflow");
        const blok = route.slice(idx, route.indexOf("Ringkasan kas bulan berjalan", idx));
        expect(blok).toMatch(/Math\.min\(Number\(r\.tanggal\) \|\| 1, hariTerakhir\)/);
    });

    test("proyeksi hanya dihitung kalau kedua bahannya terbaca", () => {
        const idx = route.indexOf("/api/kas-usaha/cashflow");
        const blok = route.slice(idx, route.indexOf("Ringkasan kas bulan berjalan", idx));
        expect(blok).toMatch(/sisa != null && akanKeluar != null \? sisa - akanKeluar : null/);
    });

    test("layar menyebutnya terpisah + memperingatkan kalau proyeksinya minus", () => {
        expect(view).toMatch(/id="ku-keluar-jejak"/);
        expect(view).toMatch(/sudah keluar/);
        expect(js).toMatch(/akan jatuh tempo/);
        expect(js).toMatch(/Setelah tagihan rutin/);
        expect(js).toMatch(/akan minus/);
    });

    test("grafik memakai DUA deret, bukan satu batang campuran", () => {
        expect(js).toMatch(/label: "Sudah keluar"/);
        expect(js).toMatch(/label: "Akan jatuh tempo"/);
        expect(js).toMatch(/gambarGrafik\(d\.perKategori, d\.akanPerKategori\)/);
    });
});
