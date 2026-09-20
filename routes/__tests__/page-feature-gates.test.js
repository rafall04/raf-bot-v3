/**
 * Header Doc
 * Purpose: Menahan regresi "gerbang default-aktif yang justru mati saat kuncinya
 *          tidak ada". config.json produksi bersifat MERGE-KEY (CLAUDE.md) — kunci
 *          fitur baru yang ditambahkan ke config.example.json TIDAK otomatis ada di
 *          sana. Gerbang yang memakai cek TRUTHY (`cfg && cfg.enabled`) karena itu
 *          diam-diam mematikan halamannya di setiap instalasi lama. Persis itu yang
 *          terjadi pada /voucher-sales: komentar kode dan config.example.json
 *          sama-sama bilang "default true", tapi halamannya 404 di KEDUA bot produksi
 *          karena `voucherSalesDashboard` memang tak pernah ada di config mereka.
 *          Gerbang yang DIMAKSUD default-aktif kini WAJIB lewat registry
 *          `lib/feature-flags.js` (`isFeatureEnabled` + `defaultEnabled:true`) —
 *          penerus pola `=== false` yang diadministrasi di /feature-flags.
 * Caller: Jest (`npm test`).
 * Deps: routes/pages.js & lib/feature-flags.js (dibaca sebagai teks — guard statis).
 * MainFuncs: -
 * SideEffects: Hanya membaca berkas.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pages.js'), 'utf8');
const FLAGS = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'feature-flags.js'), 'utf8');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.example.json'), 'utf8'));

describe('gerbang fitur halaman', () => {
    test('/voucher-sales default AKTIF — tak lagi mati hanya karena kuncinya absen', () => {
        // Pola LAMA yang menyebabkan 404 senyap di produksi.
        expect(SRC).not.toContain('global.config.voucherSalesDashboard && global.config.voucherSalesDashboard.enabled');
        // Pola BARU: gerbang lewat registry feature-flags, BUKAN idiom truthy/`!==false`
        // tersebar — registry memuat `defaultEnabled:true` jadi kunci yang absen tetap AKTIF.
        expect(SRC).toContain("isFeatureEnabled('voucherSalesDashboard')");
        expect(FLAGS).toMatch(/key:\s*"voucherSalesDashboard"[\s\S]*?defaultEnabled:\s*true/);
    });

    test('config.example.json tetap mendokumentasikan voucherSalesDashboard sebagai aktif', () => {
        // Kalau contoh dan kode berbeda pendapat, salah satunya berbohong — dan yang
        // dibaca manusia saat menyiapkan instalasi baru adalah contoh ini.
        expect(EXAMPLE.voucherSalesDashboard).toBeDefined();
        expect(EXAMPLE.voucherSalesDashboard.enabled).toBe(true);
    });

    test('halaman keuangan pribadi tetap default MATI (fitur sensitif, bukan default-aktif)', () => {
        // Kontras yang disengaja: dompet pribadi memang harus opt-in eksplisit.
        expect(SRC).toContain("if (cfg.enabled !== true) return res.status(404).render('sb-admin/404.php');");
        expect(EXAMPLE.personalFinance.enabled).toBe(false);
    });
});
