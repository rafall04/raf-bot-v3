/**
 * Header Doc
 * Purpose: HTTP controller monitoring OLT (multi-merk) — snapshot ONU, pencocokan ONU↔pelanggan,
 *          refresh per-ONU, health, dan data untuk halaman `/admin-olt` & `/teknisi-olt`.
 *          KEJUJURAN DATA bagian dari kontraknya: snapshot OLT di-cache (stale-while-revalidate)
 *          agar walk SNMP yang lama tak memblok halaman, jadi tiap respons WAJIB membawa umur data
 *          sebenarnya (`freshness`), penanda walk tak lengkap (`incompleteWalks`), dan kesahihan
 *          tiap angka redaman (`rx_power_valid`). Cache punya BATAS UMUR KERAS — lewat itu
 *          pemanggil menunggu data segar, karena foto lama berlabel "baru saja" lebih berbahaya
 *          daripada halaman yang jujur gagal.
 * Caller: `lib/routes-registry.js` (mount `/api/olt`), halaman admin/teknisi OLT.
 * Deps: `routes/olt/shared.js` (state & helper bersama — cache, config, matching helpers),
 *       `routes/olt/{snapshot,matching,health}.js` (sub-router per sub-domain; split #b395).
 * !! IDENTITAS BARIS PUNYA DUA SUMBER (#b284): pelanggan bot, ATAU sesi PPPoE MikroTik untuk
 * yang belum didaftarkan admin. ONU EPON tak membawa description/serial, jadi tanpa sumber
 * kedua barisnya tampil TANPA NAMA dan teknisi tak bisa mengerjakannya.
 *
 * MainFuncs: composer — mount health, matching, snapshot dalam urutan route asli; helper
 *            `getCachedOltDataByKey`/`buildOltFreshness` hidup di `./shared` (singleton).
 * SideEffects: Membaca OLT lewat WEB (scraping) + API MikroTik; menulis
 *       `database/last-caller-id-cache.json` (lewat `./shared`).
 *
 * !! TIDAK ada SNMP HIOSO di sini lagi (#b283) — SNMP membuat OLT HIOSO hang. Seluruh
 * pembacaan lewat `lib/olt-optical-resolver.ambilDataOlt` (satu pintu) atau dispatch
 * per-merek `lib/olt-drivers`. ZTE tetap boleh SNMP lewat drivernya sendiri.
 */
const express = require('express');
const router = express.Router();
const { nextOltDeviceId } = require('./olt/shared');

router.use(require('./olt/health'));
router.use(require('./olt/matching'));
router.use(require('./olt/snapshot'));

router.nextOltDeviceId = nextOltDeviceId; // diekspos untuk uji

module.exports = router;
