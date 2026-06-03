/**
 * Header Doc
 * Purpose: Sub-router placeholder untuk endpoint tiket gangguan yang diinisiasi langsung oleh customer (self-service). Sengaja dipisah agar penerapan auth middleware customer-only (mis. token customer, captcha rate-limit ketat) tidak tercampur dengan staff/admin endpoint.
 * Caller: `routes/tickets.js` (composer via `router.use`).
 * Deps: `./tickets-shared` untuk express factory.
 * MainFuncs: (kosong) — diisi saat ada use case customer-self-create / customer-self-track / customer-self-cancel via portal publik.
 * SideEffects: Tidak ada saat ini.
 *
 * BOUNDARY NOTE:
 *   Saat ini SEMUA endpoint tiket di `routes/tickets.js` membutuhkan auth staff (`ensureAuthenticatedStaff` atau `ensureAdmin`).
 *   Customer self-report saat ini ditangani via WhatsApp bot (`message/handlers/...`) dan portal pelanggan (`routes/public.js`).
 *   File ini menyediakan slot router siap-pakai bila kelak ada endpoint tiket khusus customer yang perlu mount di prefix `/api`.
 */
"use strict";

const { express } = require('./tickets-shared');

const router = express.Router();

// (placeholder) — Tidak ada endpoint customer aktif untuk router tiket saat ini.
// Saat menambah endpoint baru:
//   1. Pastikan auth middleware customer-only digunakan (jangan re-use staff middleware).
//   2. Tambahkan rate-limit ketat (mis. 3 req/menit per IP) untuk anti-abuse.
//   3. Validasi input ketat (sanitize `laporanText`, batasi panjang, blacklist kata kunci, dsb.).
//   4. Update Header Doc `MainFuncs` dengan daftar endpoint baru.

module.exports = router;
