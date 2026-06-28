# Spec — Bayar Tagihan Bulanan via Halaman Portal + iPaymu (Fase 1)

Status: DRAFT untuk review (28 Jun 2026). Belum diimplementasikan.
Owner alur: payment (pascabayar/bulanan). Terkait: [[payment-paid-two-sources]], customer-journey URGENT#1.

## 1. Tujuan & ruang lingkup Fase 1

Pelanggan **pascabayar/bulanan** bisa membayar tagihan **periode berjalan** sendiri, **tanpa mengetik perintah**, lewat **link bayar proaktif** yang membuka **halaman bayar milik portal** (pilih QRIS / VA / e-wallet / retail). Setelah lunas terverifikasi: **otomatis tandai lunas + reaktivasi (un-isolir)** + struk WhatsApp.

**Masuk Fase 1:** periode berjalan saja; link proaktif dari cron + dari `cektagihan`; halaman bayar di portal; callback `tagihan` + auto-reaktivasi; struk.
**DITUNDA (Fase 2/3):** bayar dari saldo, tunggakan multi-bulan, auto-debit/deposit, cicilan/partial.

## 2. Prinsip desain (tidak boleh dilanggar)

1. **Reuse pipeline iPaymu** — tambah tag `tagihan`, JANGAN bikin gateway/callback kedua. Pakai `lib/ipaymu.js` + `POST /callback/payment` (routes/public.js) yang sudah ada verify S2S + lock + idempotency + fail-closed.
2. **Ledger = sumber kebenaran bayar** — tandai lunas via `applyPaymentStatusChange()` (payment-finance-service), bukan flip `user.paid` langsung. Hindari dua-sumber-kebenaran ([[payment-paid-two-sources]]).
3. **Fail-closed (tiru pola `topup`)** — urutan callback: verify iPaymu → catat lunas (ledger) → reaktivasi. Reaktivasi gagal → lunas TETAP, alert admin + retry. Catat-lunas gagal → HTTP 500 (iPaymu retry), jangan reaktivasi.
4. **Semua teks via template** (`renderResponseTemplate`/`renderTemplate`). Normalisasi `@lid` sebelum dipakai. Single-instance cron (jangan duplikasi).

## 3. Alur end-to-end

```
[cron reminder/isolir]  ─push─▶  WA: tagihan + link bayar (token)         ← tanpa ketik
        atau pelanggan ketik *cektagihan*/*bayar* ─────────────────────┘
                                   │ tap link
                                   ▼
GET /bayar/:token (portal)  → verifikasi token → tampil tagihan + tombol metode
                                   │ pilih metode (QRIS/VA/ewallet/retail)
                                   ▼
POST /api/bayar/:token/charge {channel}
    → ipaymu.pay/payDirect(channel)  (tag 'tagihan', amount = harga paket periode ini)
    → createPaymentRequest(reff, trxId, sender, 'tagihan', amount, method, ket, {userId, periode})
    → balikkan QR / instruksi VA / nomor retail untuk dirender di halaman
                                   │ pelanggan bayar
                                   ▼
iPaymu ─notify─▶ POST /callback/payment  (reference_id, status_code, trx_id)
    → cari global.payment by reffId (tag 'tagihan')
    → verifyIpaymuTransaction(trxId)  → paid? referenceId & amount cocok?
    → applyPaymentStatusChange({ user, paid:true, periodMonth, periodYear, amountPaid, paymentMethod:'QRIS/VA/...', createdBy:'ipaymu.tagihan' })
    → JIKA user terisolir: IsolirService.executeProfileAction(user, { targetProfile: getProfileBySubscription(subscription), disconnect:true, caller:'callback.tagihan.reaktivasi' })
    → kirim struk WA (template) ; tandai payment record done
```

## 4. Komponen & file yang disentuh

### 4.1 `lib/ipaymu.js` (extend) — TERVERIFIKASI live di akun prod 28-06
- `getPaymentChannels()` → `GET /payment-channels` (signed, GET). Kembalikan grup→channel yang `FeatureStatus==='active' && HealthStatus==='online'`. Halaman bayar render DINAMIS dari sini (jangan hardcode channel).
- `payDirect({ ...props, paymentMethod, paymentChannel })` — generalisasi `pay()`. `pay()` tetap default `qris`/`mpm` (backward-compat voucher/topup).
- **Channel aktif akun ini (28-06):**
  - `qris` → `mpm` (QRIS Dynamic NOBU), fee 0.7%.
  - `va` → permata, mandiri, bni, bca, bag, danamon, bmi(Muamalat), bsi, bri, cimb, btn — flat 3.5–4.5rb.
  - `cstore` → indomaret, alfamart — flat 4rb (+ StoreFee ~2.5rb).
  - ⚠️ **Tidak ada e-wallet aktif** (OVO/DANA/ShopeePay) di akun ini — jangan tampilkan kalau katalog tak mengembalikannya.
- **Bentuk response `/payment/direct` (Data) — terverifikasi:** semua channel balas envelope sama: `{ TransactionId, ReferenceId, SubTotal, Fee, Total, Expired, FeeDirection }` plus:
  - QRIS: `QrString`.
  - VA: `Via:"VA"`, `Channel:"BCA"`, `PaymentNo` = **nomor VA**, `PaymentName`.
  - cstore: `Via:"Convenience Store"`, `Channel:"ALFAMART"`, `PaymentNo` = **kode bayar**, `StoreFee`, `Note` (instruksi siap-tampil).
- `payDirect` kembalikan ternormalisasi: `{ id:TransactionId, reffId, paymentMethod, paymentChannel, via, channelLabel, qrString?, paymentNo?, paymentName?, note?, subTotal, fee, total, expired }`.
- ⚠️ **ENETUNREACH/timeout intermiten** saat probe = akar dual-WAN (IH non-whitelist) — retry di `ipaymuRequest` sudah menanganinya; `getPaymentChannels`/`payDirect` lewat `ipaymuRequest` (dapat retry gratis).
- (Opsi) `payRedirect()` `POST /payment` (hosted page) — **DITUNDA**; halaman portal sendiri lebih baik.

### 4.2 Halaman bayar (portal) — route publik baru
- `routes/public.js` (atau `routes/payment-page.js` baru, di-mount di routes-registry):
  - `GET /bayar/:token` → render halaman (verifikasi token; tampil nama, paket, nominal, daftar tombol metode). Halaman = view PHP/HTML statis + JS kecil.
  - `POST /api/bayar/:token/charge` → body `{ channel }`; panggil `payDirect`, `createPaymentRequest` (tag `tagihan`), balikkan data render (QR string / VA / kode retail) sebagai JSON.
  - `GET /api/bayar/:token/status` → polling status (pakai `checkStatusPayment(reffId)`), untuk halaman auto-update "Lunas".
- **Tanpa login** — otorisasi via token bertanda-tangan (lihat §5). Hanya untuk pelanggan pascabayar (tolak voucher/whitelist/infrastruktur).

### 4.3 Token link bayar — modul baru `lib/bill-pay-token.js`
- `createBillPayToken(user, { periodMonth, periodYear })` → `base64url(payload).hmacSHA256(secret)`.
  - payload: `{ uid, period:'YYYY-MM', exp }` (exp mis. +7 hari / sampai jatuh tempo+grace).
  - secret: dari `global.config` (key baru `bill_pay_token_secret`, auto-generate saat pertama).
- `verifyBillPayToken(token)` → `{ ok, user, periodMonth, periodYear }` (cek HMAC + exp + user masih ada + masih unpaid).
- Tidak menyimpan token (stateless) — tahan restart, tak perlu DB.

### 4.4 Callback `tagihan` — `routes/public.js` `POST /callback/payment`
- Tambah cabang `else if (pay.tag == 'tagihan')` setelah blok `topup` (public.js ~baris 825). Pola fail-closed sama topup:
  1. `applyPaymentStatusChange({ user, paid:true, periodMonth: pay.periodMonth, periodYear: pay.periodYear, amountPaid: pay.amount, paymentMethod: pay.method, createdBy:'ipaymu.tagihan', notes:'Bayar tagihan via QRIS/VA' })`.
     - Idempoten built-in: kalau `already_fully_paid` → anggap sukses (jangan reaktivasi ganda).
  2. Reaktivasi (best-effort, jangan gagalkan lunas): jika profil PPPoE pelanggan == `config.isolir_profile`, `IsolirService.executeProfileAction(user, { targetProfile: getProfileBySubscription(user.subscription), disconnect:true, caller:'callback.tagihan' })`. Gagal → log + `recordReactivationRetry` (lihat §9) + alert admin, TAPI tetap balas sukses (lunas sudah tercatat).
  3. Struk WA via template (lihat §6).
- `pay` record butuh field tambahan: `userId`, `periodMonth`, `periodYear` → lewat `createPaymentRequest(..., opts)` (signature sudah punya `opts`).

### 4.5 Titik proaktif (nol-ketik)
- `lib/cron/jobs/reminder.js` & `lib/cron/jobs/isolir-notification.js`: pada pesan reminder/isolir untuk user unpaid, sisipkan link `${site}/bayar/${createBillPayToken(user,...)}` + tombol CTA teks. (Pakai template; lihat §6.)
- `message/handlers/customer-handler.js` `handleCheckBill` (baris 51-58): ganti teks hardcoded "Transfer Bank / hubungi admin" → template + link bayar (kalau unpaid & bukan whitelist/voucher). Konversi handleCheckBill ke template (`renderResponseTemplate`).
- Keyword baru `bayar`/`bayartagihan` → intent → tampilkan tagihan + link (reuse handleCheckBill yang sudah membawa link).

### 4.6 `applyPaymentStatusChange` — sudah ada (payment-finance-service:778)
Param relevan: `{ user, paid, periodMonth, periodYear, amountPaid, amountDue, paymentMethod, notes, createdBy }`. Idempoten (`already_fully_paid` → `no_change`). periodMonth/Year = bulan/tahun berjalan (Asia/Jakarta).

## 5. Skema token (keamanan link tanpa login)
- `token = base64url(JSON.stringify({uid, period, exp})) + '.' + base64url(HMAC_SHA256(payloadB64, secret))`.
- Verifikasi: recompute HMAC (timing-safe compare), cek `exp > now`, cek user ada & `!paid` untuk period itu.
- Anti-enumerasi: token tak bisa ditebak (HMAC). Tak ada data sensitif di URL selain uid (acak/opaque kalau perlu). Rate-limit `GET /bayar/:token`.

## 6. Template baru (database/response_templates.json)
- `tagihan_info_unpaid` — info tagihan + ajakan bayar + `${link_bayar}` (ganti teks hardcoded handleCheckBill).
- `tagihan_info_paid` / `tagihan_info_whitelist` — versi lunas/gratis.
- `tagihan_reminder_with_link` — dipakai cron reminder (sisip `${link_bayar}`).
- `tagihan_struk_lunas` — struk sukses: paket, nominal, metode, periode, status "Lunas + layanan aktif kembali".
- `tagihan_reaktivasi_gagal_admin` — alert ke admin bila reaktivasi MikroTik gagal.

## 7. Money-safety & invarian (raf-invariants)
- Callback: JANGAN percaya body — `verifyIpaymuTransaction(trxId)` wajib; cek `referenceId` & `amount` cocok (sudah ada di pola callback).
- Lock per `reference_id` (sudah ada) — cegah callback konkuren double-reaktivasi.
- `amountPaid > 0` (applyPaymentStatusChange validasi). Idempoten `already_fully_paid`.
- Normalisasi `@lid` → JID kanonik untuk `sendMessage` struk & lookup user.
- Skip whitelist (`packages[].whitelist`) & infrastruktur (`isInfrastructure(user)`) — tak ditagih.

## 8. Edge cases
- Sudah lunas saat buka link → halaman tampil "Tagihan sudah lunas", tak buat charge.
- User keburu dibayar admin manual (mark paid) sebelum callback → `already_fully_paid` → reaktivasi tetap jalan bila masih terisolir (cek profil), tak double-credit.
- QR/VA kedaluwarsa → halaman bisa "buat ulang" (charge baru, reffId baru).
- User tanpa `pppoe_username`/`device_id` → tetap tandai lunas, skip reaktivasi (log).
- Pelanggan voucher/prepaid buka link → tolak (bukan pascabayar).

## 9. Keputusan terbuka / risiko (perlu diputuskan saat koding)
1. **Persistensi `global.payment`** — record in-memory; bila bot restart sebelum callback `tagihan` datang (QRIS/VA bisa dibayar jam kemudian), record hilang → callback gagal nemu. **Rekomendasi:** persist record `tagihan` (dan idealnya semua) ke SQLite/JSON + reload saat start. Ini juga menutup lubang yang sama di voucher/topup. (Lihat catatan maturity iPaymu.)
2. **Retry reaktivasi** — bila MikroTik down saat callback. Rekomendasi: tabel/JSON `reactivation_queue` + cron retry, atau reuse mekanisme isolir. Minimal v1: alert admin + tombol manual.
3. **Bentuk response iPaymu per channel non-QRIS** — verifikasi ke docs/akun sebelum render VA/retail.
4. **Halaman portal**: render via php-express (konsisten portal) atau HTML statis + JS? Rekomendasi HTML+JS kecil (tak butuh PHP, lebih ringan, token di query).

## 10. Rencana test
- `lib/__tests__/ipaymu.test.js` — payDirect channel non-QRIS (mock).
- `lib/__tests__/bill-pay-token.test.js` — sign/verify, exp, tamper, user-not-found.
- `routes/__tests__/payment-callback-tagihan.test.js` — cabang tagihan: verified→applyPaymentStatusChange dipanggil; reaktivasi dipanggil hanya saat terisolir; reaktivasi gagal → lunas tetap (tidak 500); idempoten already_paid.
- `message/__tests__/check-bill.test.js` — handleCheckBill: unpaid→link, paid→tanpa link, whitelist→gratis.
- Lint + `npm test` area tersentuh.

## 11. Urutan implementasi (commit kecil)
1. `lib/bill-pay-token.js` + test.
2. `lib/ipaymu.js` `payDirect(channel)` + test.
3. Halaman `/bayar/:token` + `/api/bayar/:token/charge|status` (QRIS dulu) + token guard.
4. Callback cabang `tagihan` + auto-reaktivasi + struk + test.
5. handleCheckBill → template + link; keyword `bayar`.
6. Sisip link di cron reminder/isolir-notification.
7. (Opsi) persist `global.payment` tag tagihan.
8. Channel non-QRIS (VA/ewallet/retail) setelah QRIS terbukti.
