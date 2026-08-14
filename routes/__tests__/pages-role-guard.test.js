/**
 * Header Doc
 * Purpose: Mengunci penjagaan peran halaman SB Admin — handler generik `/:type([^.]+)` di
 *          `routes/pages.js` harus GAGAL-TERTUTUP (admin-only), halaman bergerbang-sendiri
 *          (dompet pribadi owner) harus 404 untuk semua peran, dan halaman yang memang milik
 *          teknisi/agen harus TETAP terbuka lewat rute eksplisitnya.
 * Caller: Jest test runner.
 * Deps: `express`, `../pages`, sumber `routes/pages.js` & `routes/saldo.js` (pemindaian teks).
 * MainFuncs: `mintaHalaman(peran, path)` menjalankan rantai middleware Express yang SEBENARNYA.
 * SideEffects: Membuka listener HTTP ephemeral per permintaan, ditutup lagi setelahnya.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");

const SUMBER_PAGES = fs.readFileSync(path.join(__dirname, "..", "pages.js"), "utf8");

// Layar 403/404 ber-tema butuh view engine PHP; di test cukup dicatat statusnya.
jest.mock("../../lib/http-error-page", () => ({
    sendErrorPage: (res, opts) => res.status(opts.status || 403).json({ ditolak: true, title: opts.title })
}));

const pagesRouter = require("../pages");

// Dipatok supaya hasil tes tidak bergantung pada config mesin yang menjalankannya: rute resmi
// `/keuangan-pribadi*` membaca `personalFinance.enabled` dan berperilaku beda saat fitur menyala.
beforeAll(() => { global.config = { ...(global.config || {}), personalFinance: { enabled: false } }; });

// Menjalankan permintaan sungguhan melalui router — bukan memeriksa `router.stack` — supaya
// URUTAN middleware (tolakHalamanBergerbangSendiri sebelum checkRole) ikut teruji.
function mintaHalaman(peran, jalur) {
    const app = express();
    app.use((req, res, next) => {
        if (peran) req.user = { id: 1, username: `uji-${peran}`, role: peran };
        req.cookies = {};
        // Render dipalsukan: view PHP tak bisa dirender di Jest, yang diuji adalah IZINnya.
        res.render = (view) => res.json({ view });
        next();
    });
    app.use(pagesRouter);

    return new Promise((resolve, reject) => {
        const srv = app.listen(0, async () => {
            try {
                const r = await fetch(`http://127.0.0.1:${srv.address().port}${jalur}`, { redirect: "manual" });
                const teks = await r.text();
                let body = null;
                try { body = JSON.parse(teks); } catch (_e) { /* halaman non-JSON */ }
                resolve({ status: r.status, body });
            } catch (e) { reject(e); } finally { srv.close(); }
        });
    });
}

describe("penjagaan peran halaman SB Admin", () => {
    // Halaman yang dulunya terbuka untuk SETIAP akun staf yang login karena hanya terlayani
    // handler generik. Bukan daftar hafalan: semuanya benar-benar ada di views/sb-admin.
    const HALAMAN_SENSITIF = ["config", "accounts", "saldo-management", "transaction", "payment-method", "broadcast", "cron"];

    test.each(HALAMAN_SENSITIF)("teknisi DITOLAK membuka /%s", async (halaman) => {
        const res = await mintaHalaman("teknisi", `/${halaman}`);
        expect(res.status).toBe(403);
    });

    test.each(HALAMAN_SENSITIF)("agen DITOLAK membuka /%s", async (halaman) => {
        const res = await mintaHalaman("agen", `/${halaman}`);
        expect(res.status).toBe(403);
    });

    test("admin tetap bisa membuka halaman lewat handler generik", async () => {
        const res = await mintaHalaman("admin", "/config");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ view: "sb-admin/config.php" });
    });

    // Rute ber-guard yang PATH-nya beda dari nama berkas dulu bisa ditembus lewat nama berkas:
    // `/owner` dijaga, `/owner-cockpit` tidak. Handler generik yang gagal-tertutup menutupnya.
    test.each([
        ["owner-cockpit", "/owner"],
        ["tiket", "/admin/daftar-tiket"],
        ["bulk-ssid-diff", "/penyesuaian-bulk"]
    ])("nama berkas /%s tak lagi jadi pintu belakang untuk %s", async (berkas) => {
        const res = await mintaHalaman("teknisi", `/${berkas}`);
        expect(res.status).toBe(403);
    });

    // `:type([^.]+)` ikut mencocokkan garis miring, jadi halaman bersarang harus ikut dijaga.
    test("halaman bersarang /pembayaran/otorisasi ikut dijaga", async () => {
        expect((await mintaHalaman("teknisi", "/pembayaran/otorisasi")).status).toBe(403);
        expect((await mintaHalaman("admin", "/pembayaran/otorisasi")).status).toBe(200);
    });

    // Dompet PRIBADI owner punya sesi sendiri; handler generik tak boleh jadi pintu belakang —
    // termasuk untuk admin. 404, bukan 403, supaya keberadaan halamannya tidak bocor.
    describe("halaman bergerbang-sendiri (dompet pribadi owner)", () => {
        const DOMPET = ["keuangan-pribadi", "keuangan-pribadi-login", "keuangan-pribadi-catatan",
            "keuangan-pribadi-anggaran", "keuangan-pribadi-panduan", "keuangan-pribadi-pengaturan"];

        test.each(DOMPET)("/%s dijawab 404 untuk ADMIN sekalipun", async (halaman) => {
            const res = await mintaHalaman("admin", `/${halaman}`);
            expect(res.status).toBe(404);
        });

        test.each(DOMPET)("/%s dijawab 404 — BUKAN 403 — untuk teknisi", async (halaman) => {
            const res = await mintaHalaman("teknisi", `/${halaman}`);
            expect(res.status).toBe(404);
        });
    });

    // Sisi lain dari gagal-tertutup: jangan sampai justru mengunci pemilik sahnya.
    describe("halaman milik teknisi & agen tetap terbuka", () => {
        test.each(["/teknisi-tiket", "/teknisi-pelanggan", "/teknisi-tutorial", "/pembayaran/teknisi", "/papan-psb"])(
            "teknisi tetap boleh membuka %s", async (jalur) => {
                expect((await mintaHalaman("teknisi", jalur)).status).toBe(200);
            });

        test.each(["/agen-pembayaran", "/agen-tutorial"])("agen tetap boleh membuka %s", async (jalur) => {
            expect((await mintaHalaman("agen", jalur)).status).toBe(200);
        });
    });

    test("halaman tak dikenal tetap 404, bukan 500", async () => {
        const res = await mintaHalaman("admin", "/halaman-yang-tidak-pernah-ada");
        expect(res.status).toBe(404);
    });

    test("tamu tanpa peran tak bisa menembus handler generik", async () => {
        const res = await mintaHalaman(null, "/config");
        expect(res.status).toBe(403);
    });
});

// Guard STRUKTURAL: memindai sumber, bukan daftar hafalan. Tujuannya menangkap rute BARU yang
// merender halaman admin tanpa checkRole — persis cara 30 halaman itu menumpuk tanpa disadari.
describe("guard struktural routes/pages.js", () => {
    // Dikecualikan dengan alasan yang eksplisit, bukan karena kebetulan lolos.
    const DIKECUALIKAN = {
        "/login": "halaman masuk, memang publik",
        "/": "sadar-peran di dalam handler: admin dirender, teknisi/agen dialihkan ke halamannya",
        "/keuangan-pribadi/login": "dompet pribadi punya gerbang sesinya sendiri (pfAuth)",
        "/keuangan-pribadi": "idem — resolveSession, bukan checkRole",
        "/keuangan-pribadi/:slug": "idem"
    };

    test("tak ada rute baru yang merender halaman sb-admin tanpa checkRole", () => {
        const re = /router\.get\(\s*(['"])([^'"]+)\1\s*(?:,\s*checkRole\(\[([^\]]*)\]\))?\s*,\s*(?:async\s*)?\(req,\s*res\)\s*=>\s*\{([\s\S]*?)\n\}\);/g;
        const telanjang = [];
        for (const m of SUMBER_PAGES.matchAll(re)) {
            const [, , jalur, guard, badan] = m;
            if (guard) continue;
            if (DIKECUALIKAN[jalur]) continue;
            if (!/res\.render\(\s*['"]sb-admin\//.test(badan)) continue;
            telanjang.push(jalur);
        }
        expect(telanjang).toEqual([]);
    });

    test("handler generik memasang penolak halaman bergerbang-sendiri SEBELUM checkRole", () => {
        expect(SUMBER_PAGES).toContain(
            "router.get('/:type([^.]+)', tolakHalamanBergerbangSendiri, checkRole(PERAN_ADMIN)"
        );
    });

    test("PERAN_ADMIN tidak diam-diam dilonggarkan ke teknisi/agen", () => {
        const m = SUMBER_PAGES.match(/const PERAN_ADMIN = \[([^\]]*)\]/);
        expect(m).not.toBeNull();
        const peran = m[1].replace(/['\s]/g, "").split(",").filter(Boolean);
        expect(peran.sort()).toEqual(["admin", "owner", "superadmin"]);
    });
});

// Halaman `saldo-management` bocor DAN API-nya terbuka — satu-satunya kategori "dua-duanya
// terbuka" yang menyentuh mutasi uang. Router saldo kini dijaga di tingkat router.
describe("guard API saldo", () => {
    const SUMBER_SALDO = fs.readFileSync(path.join(__dirname, "..", "saldo.js"), "utf8");

    test("routes/saldo.js memasang ensureAdmin untuk SELURUH router", () => {
        expect(SUMBER_SALDO).toContain("router.use(ensureAdmin)");
        expect(SUMBER_SALDO).toMatch(/require\(['"]\.\/api-route-helpers['"]\)/);
    });

    test("guard dipasang SEBELUM definisi endpoint pertama", () => {
        const posGuard = SUMBER_SALDO.indexOf("router.use(ensureAdmin)");
        const posRutePertama = SUMBER_SALDO.search(/router\.(get|post)\(/);
        expect(posGuard).toBeGreaterThan(-1);
        expect(posGuard).toBeLessThan(posRutePertama);
    });
});

// Jalur `.php` adalah pintu KEDUA ke halaman yang sama: `app.all(/.+\.php$/, requirePhpPageAuth,
// phpExpress.router)` di index.js, dan `phpExpress.router` merender `req.path.slice(1)` relatif ke
// `views/`. Tanpa penutup, `/sb-admin/config.php` melewati seluruh kebijakan peran di pages.js —
// handler generik di sana sengaja tak mencocokkan titik, jadi checkRole tak pernah tersentuh.
describe("jalur .php tak boleh jadi pintu kedua ke halaman panel", () => {
    const { requirePhpPageAuth } = require("../../lib/http-auth-bootstrap");

    function jalankan(reqTambahan, jalur) {
        return new Promise((resolve) => {
            const hasil = { status: 200, aksi: null, nilai: null };
            const res = {
                status(c) { hasil.status = c; return res; },
                render(v) { hasil.aksi = "render"; hasil.nilai = v; resolve(hasil); return res; },
                send(v) { hasil.aksi = "send"; hasil.nilai = v; resolve(hasil); return res; },
                json(v) { hasil.aksi = "json"; hasil.nilai = v; resolve(hasil); return res; },
                redirect(v) { hasil.aksi = "redirect"; hasil.nilai = v; resolve(hasil); return res; }
            };
            requirePhpPageAuth({ path: jalur, headers: {}, ...reqTambahan }, res, () => {
                hasil.aksi = "next";
                resolve(hasil);
            });
        });
    }

    const STAF = { user: { id: 1, role: "teknisi" } };
    const ADMIN = { user: { id: 2, role: "admin" } };

    test.each([
        "/sb-admin/config.php",
        "/sb-admin/accounts.php",
        "/sb-admin/saldo-management.php",
        "/sb-admin/keuangan-pribadi-catatan.php",
        "/views/sb-admin/config.php"
    ])("teknisi TIDAK bisa menembus lewat %s", async (jalur) => {
        const r = await jalankan(STAF, jalur);
        expect(r.status).toBe(404);
        expect(r.aksi).not.toBe("next");
    });

    test("admin pun tidak boleh lewat jalur .php — kebijakan perannya ada di pages.js", async () => {
        const r = await jalankan(ADMIN, "/sb-admin/config.php");
        expect(r.status).toBe(404);
        expect(r.aksi).not.toBe("next");
    });

    // KEBIJAKAN BARU: helper `.php` di views/ ROOT pun ditutup dari HTTP.
    //
    // Blok ini dulu berbunyi "dipanggil halaman teknisi lewat AJAX — jangan ikut mati", asumsi
    // yang juga tertulis di komentar sumbernya. Penelusuran seluruh pemanggil membantahnya:
    // NOL berkas .php di-fetch dari static/js. Semuanya dipanggil server-side (spawn PHP CLI /
    // exec / include __DIR__). Selama asumsi itu dipercaya, peran `agen` pun bisa membuka
    // /delete_pppoe_secret.php?username=<korban> dan /user-hotspot.php (dump seluruh
    // username+password voucher).
    test.each([
        "/mikrotik_helper.php",
        "/get_ppp_active.php",
        "/api-monitoring-live.php",
        "/delete_pppoe_secret.php",
        "/update_pppoe_profile.php",
        "/user-hotspot.php",
        "/mikrotik_route_switch.php"
    ])("helper %s ditutup dari HTTP bahkan untuk staf", async (jalur) => {
        const r = await jalankan(STAF, jalur);
        expect(r.status).toBe(404);
        expect(r.aksi).not.toBe("next");
    });

    test.each([
        ["peran agen", { user: { id: 8, role: "agen" } }],
        ["sesi PELANGGAN", { customer: { id: 9 } }],
        ["tanpa sesi apa pun", {}]
    ])("%s ditolak 404 di endpoint helper", async (_nama, req) => {
        const r = await jalankan(req, "/delete_pppoe_secret.php");
        expect(r.status).toBe(404);
        expect(r.aksi).not.toBe("next");
    });

    test("pemanggil internal tepercaya TETAP dilewatkan", async () => {
        const r = await jalankan({ internalService: true }, "/mikrotik_helper.php");
        expect(r.aksi).toBe("next");
    });
});

// Penjaga asumsi. Kebijakan "tak ada .php lewat HTTP" hanya sah selama tak ada kode sisi
// browser yang benar-benar mem-fetch berkas .php. Kalau suatu saat ada yang menambahkannya,
// tes ini merah SEBELUM fiturnya diam-diam mati di produksi.
describe("tak ada kode sisi browser yang mem-fetch .php", () => {
    const fs = require("fs");
    const path = require("path");

    test("static/js bersih dari fetch/ajax ke berkas .php", () => {
        const dir = path.join(__dirname, "..", "..", "static", "js");
        const berkas = [];
        (function pindai(d) {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) pindai(p);
                else if (e.name.endsWith(".js")) berkas.push(p);
            }
        })(dir);

        // Hanya literal BERBENTUK URL (diawali `/`). Rujukan seperti `views/sb-admin/x.php`
        // di Header Doc bukan pemanggilan, jadi tak dihitung.
        const pola = /['"`](\/[\w./-]*\.php)(?:[?#][^'"`\n]*)?['"`]/g;

        // Pengecualian terdokumentasi: endpoint ini TIDAK PERNAH ADA. Berkas nyatanya
        // `views/api-monitoring-wrapper.php` (di-include PHP, bukan disajikan), dan tak ada
        // satu pun rute Express `/api/monitoring-wrapper.php`. Jadi fetch-nya sudah mati
        // sejak dulu — bukan sesuatu yang dimatikan oleh penutupan jalur .php. Dicatat di
        // sini alih-alih disembunyikan, dan dihapus saat fungsi matinya dibersihkan.
        const DIKETAHUI_MATI = new Set(["/api/monitoring-wrapper.php"]);

        const pelanggar = [];
        for (const p of berkas) {
            const isi = fs.readFileSync(p, "utf8");
            for (const cocok of isi.matchAll(pola)) {
                if (!DIKETAHUI_MATI.has(cocok[1])) {
                    pelanggar.push(`${path.basename(p)}: ${cocok[1]}`);
                }
            }
        }

        expect(pelanggar).toEqual([]);
    });
});
