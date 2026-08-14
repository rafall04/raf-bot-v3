/**
 * Header Doc
 * Purpose: Tes regresi gerbang peran untuk perbaikan Gelombang 1 — memastikan endpoint yang
 *          dulu terbuka (katalog paket, config, handler generik `/api/:type`) menolak
 *          anonim/pelanggan/teknisi sesuai kewenangannya, dan TETAP melayani peran yang berhak.
 * Caller: Jest test runner.
 * Deps: `express`, `./helpers/panggil-http`, router asli `../packages` & `../stats`.
 * MainFuncs: `bangunApp`, `panggil`.
 * SideEffects: Membuka server HTTP ephemeral di 127.0.0.1 dan menulis `global.packages`/
 *              `global.config`/`global.accounts` di memori tes. Tidak menyentuh berkas/DB.
 *
 * CATATAN: Sengaja memakai router ASLI, bukan tiruan. Bug yang ditutup Gelombang 1 justru
 * lahir dari middleware yang HILANG — router tiruan akan selalu hijau dan tak membuktikan apa pun.
 *
 * PENTING: `savePackages()` di routes/packages.js menulis `database/packages.json` SUNGGUHAN.
 * Jalur tulis di-mock di bawah — tanpa itu, tes jalur-bahagia admin menimpa katalog produksi
 * dengan data uji (sudah pernah terjadi saat tes ini ditulis).
 */
"use strict";

const fs = require("fs");
const express = require("express");
const { panggilHttp } = require("./helpers/panggil-http");

// Bendung SEMUA penulisan ke database/packages.json selama suite ini berjalan.
let penulisanTercegat = [];
const writeFileSyncAsli = fs.writeFileSync;

beforeAll(() => {
    fs.writeFileSync = (target, isi, ...sisa) => {
        if (String(target).replace(/\\/g, "/").endsWith("database/packages.json")) {
            penulisanTercegat.push(isi);
            return undefined;
        }
        return writeFileSyncAsli(target, isi, ...sisa);
    };
});

afterAll(() => {
    fs.writeFileSync = writeFileSyncAsli;
});

beforeEach(() => {
    penulisanTercegat = [];
});

const PERAN = {
    anonim: null,
    pelanggan: "__customer__",
    teknisi: { id: 9, username: "teknisi1", role: "teknisi" },
    agen: { id: 8, username: "agen1", role: "agen" },
    admin: { id: 1, username: "admin", role: "admin" },
};

// Meniru urutan nyata: middleware auth global mengisi `req.user` ATAU `req.customer`,
// lalu router dipasang di belakangnya.
function bangunApp(router, mountPath, peran) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const aktor = PERAN[peran];
        if (aktor === "__customer__") {
            req.customer = { id: 77, name: "Pelanggan Uji" };
        } else if (aktor) {
            req.user = aktor;
        }
        next();
    });
    app.use(mountPath, router);
    return app;
}

// Request lewat helper bersama (http.request TANPA keep-alive). Versi pertama memakai
// `fetch`, yang connection pool-nya sesekali menabrak server yang sudah ditutup
// (`TypeError: fetch failed`) — flaky, dan tes flaky sama tak bergunanya dengan tes salah.
async function panggil(router, mountPath, peran, metode, path, badan) {
    return panggilHttp(bangunApp(router, mountPath, peran), metode, path, badan);
}

describe("Gelombang 1 — gerbang katalog paket (routes/packages.js)", () => {
    const packagesRouter = require("../packages");

    beforeEach(() => {
        global.packages = [
            { id: "1", name: "Paket 10Mbps", price: 150000, profile: "PROFIL-INTERNAL-10M" },
        ];
    });

    const mutasi = [
        ["POST", "/api/packages"],
        ["PUT", "/api/packages/1"],
        ["DELETE", "/api/packages/1"],
    ];

    describe.each(["anonim", "pelanggan", "teknisi", "agen"])("peran %s", (peran) => {
        test.each(mutasi)("%s %s ditolak dan katalog tak berubah", async (metode, path) => {
            const res = await panggil(packagesRouter, "/", peran, metode, path, {
                name: "Sabotase",
                price: 1,
            });

            expect([401, 403]).toContain(res.status);
            expect(global.packages).toHaveLength(1);
            expect(global.packages[0].price).toBe(150000);
            // Bukti terkuat: tak ada satu pun percobaan menulis katalog ke disk.
            expect(penulisanTercegat).toHaveLength(0);
        });
    });

    test("anonim tak bisa membaca katalog staf (yang membawa profil MikroTik internal)", async () => {
        const res = await panggil(packagesRouter, "/", "anonim", "GET", "/api/packages");

        expect([401, 403]).toContain(res.status);
        expect(res.teks).not.toContain("PROFIL-INTERNAL-10M");
    });

    test("teknisi TETAP bisa membaca katalog — halaman teknisi-pelanggan memakainya", async () => {
        const res = await panggil(packagesRouter, "/", "teknisi", "GET", "/api/packages");

        expect(res.status).toBe(200);
        expect(res.json.data).toHaveLength(1);
    });

    test("admin tetap bisa membuat paket", async () => {
        const res = await panggil(packagesRouter, "/", "admin", "POST", "/api/packages", {
            name: "Paket Baru",
            price: 200000,
        });

        expect(res.status).toBe(200);
        expect(global.packages).toHaveLength(2);
        // Jalur bahagia BENAR-BENAR sampai ke penyimpanan (dicegat, bukan ditulis ke disk).
        expect(penulisanTercegat).toHaveLength(1);
        expect(penulisanTercegat[0]).toContain("Paket Baru");
    });

    test("varian publik tetap terbuka DAN tetap meredaksi profil MikroTik internal", async () => {
        const res = await panggil(packagesRouter, "/", "anonim", "GET", "/api/packages/public");

        expect(res.status).toBe(200);
        expect(res.json.data[0].name).toBe("Paket 10Mbps");
        expect(res.teks).not.toContain("PROFIL-INTERNAL-10M");
    });
});

describe("Gelombang 1 — /api/packages tidak lagi terdaftar publik", () => {
    test("PUBLIC_PATHS hanya memuat varian /public", () => {
        const isi = require("fs").readFileSync(
            require("path").join(__dirname, "..", "..", "lib", "http-auth-bootstrap.js"),
            "utf8"
        );

        expect(isi).toContain('"/api/packages/public"');
        // Entri polos `"/api/packages",` membuka POST/PUT/DELETE karena isPublicPath()
        // mencocokkan path TANPA memandang HTTP method.
        expect(isi).not.toMatch(/"\/api\/packages",/);
    });
});

describe("Gelombang 1 — gerbang routes/stats.js", () => {
    const statsRouter = require("../stats");

    test("pelanggan tak bisa mematikan bot WhatsApp lewat /api/stop", async () => {
        const res = await panggil(statsRouter, "/api", "pelanggan", "GET", "/api/stop");
        expect([401, 403]).toContain(res.status);
    });

    test("teknisi pun tak bisa mematikan bot — /api/stop tak punya konsumen UI", async () => {
        const res = await panggil(statsRouter, "/api", "teknisi", "GET", "/api/stop");
        expect(res.status).toBe(403);
    });

    test("pelanggan tak menerima apa pun dari /api/stats/config", async () => {
        const res = await panggil(statsRouter, "/api", "pelanggan", "GET", "/api/stats/config");
        expect([401, 403]).toContain(res.status);
    });

    test("/api/stats/config TAK PERNAH membocorkan rahasia, bahkan untuk admin", async () => {
        global.config = {
            jwt: "RAHASIA-PENANDA-TANGAN-TOKEN",
            ipaymuSecret: "RAHASIA-IPAYMU",
            defaultPPPoEPassword: "RAHASIA-PPPOE",
            tanggal_batas_bayar: "10",
            accessLimit: "5",
        };

        const res = await panggil(statsRouter, "/api", "admin", "GET", "/api/stats/config");

        expect(res.status).toBe(200);
        expect(res.teks).not.toContain("RAHASIA-PENANDA-TANGAN-TOKEN");
        expect(res.teks).not.toContain("RAHASIA-IPAYMU");
        expect(res.teks).not.toContain("RAHASIA-PPPOE");
        expect(res.json.data).not.toHaveProperty("jwt");
    });

    test("teknisi TETAP mendapat kunci yang memang dibutuhkan halamannya", async () => {
        global.config = { jwt: "RAHASIA", tanggal_batas_bayar: "10", accessLimit: "5" };

        const res = await panggil(statsRouter, "/api", "teknisi", "GET", "/api/stats/config");

        expect(res.status).toBe(200);
        // teknisi-pembayaran.js membaca tanggal_batas_bayar; import-mikrotik.js membaca accessLimit.
        expect(res.json.data.tanggal_batas_bayar).toBe("10");
        expect(res.json.data.accessLimit).toBe("5");
        expect(res.json.data).not.toHaveProperty("jwt");
    });

    test("teknisi tak bisa membaca config penuh lewat /api/config", async () => {
        global.config = { jwt: "RAHASIA-PENANDA-TANGAN-TOKEN" };

        const res = await panggil(statsRouter, "/api", "teknisi", "GET", "/api/config");

        expect(res.status).toBe(403);
        expect(res.teks).not.toContain("RAHASIA-PENANDA-TANGAN-TOKEN");
    });

    test("teknisi tak bisa menarik daftar akun staf lewat handler generik", async () => {
        global.accounts = [{ id: 1, username: "admin", password: "HASH-RAHASIA" }];

        const res = await panggil(statsRouter, "/api", "teknisi", "GET", "/api/accounts");

        expect(res.status).toBe(403);
        expect(res.teks).not.toContain("HASH-RAHASIA");
    });
});
