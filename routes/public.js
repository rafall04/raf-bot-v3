/**
 * Header Doc
 * Purpose: Composer router publik/customer portal — murni merangkai sub-router per konteks
 *          (`routes/public/`): auth (login/OTP), customer self-service, callback pembayaran,
 *          laporan, permintaan speed, dan konten. Semua path API TIDAK berubah.
 * Caller: `lib/routes-registry.js` → Express app.
 * Deps: express + sub-router `routes/public/{auth,customer,payment-callback,reports,requests,content}`.
 * MainFuncs: mount sub-router (urutan sama dengan registrasi lama: auth → customer →
 *            payment-callback → reports → requests → content).
 * SideEffects: Tidak ada langsung — seluruh side effect hidup di sub-router.
 *
 * Catatan split (#b392): `routes/public.js` lama (1779 baris) dipecah murni-pindah tanpa mengubah
 * logika. Helper bersama tinggal di `routes/public/shared.js`. Guard test yang memindai sumber
 * kini diarahkan ke file pemilik (payment-callback/auth/reports/requests).
 */
const express = require('express');

const router = express.Router();

router.use(require('./public/auth'));
router.use(require('./public/customer'));
router.use(require('./public/payment-callback'));
router.use(require('./public/reports'));
router.use(require('./public/requests'));
// KONTEN publik (wifi-name/pengumuman/berita) — sub-router pertama hasil split (b386).
router.use(require('./public/content'));

module.exports = router;
