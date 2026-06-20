---
name: raf-invariants
description: Pre-flight checklist invariant RAF Bot V2 sebelum mengubah kode berisiko. WAJIB pakai skill ini SEBELUM menulis atau mengedit kode yang menyentuh saldo/koin pelanggan, pembayaran/topup, pengiriman pesan WhatsApp, JID/@lid, response template, atau conversation state. Picu skill ini bahkan saat permintaan terdengar sepele ("ubah handler X", "tambah notifikasi ke pelanggan", "fix saldo", "kirim pesan", "proses topup", "handle @lid", "tambah step percakapan") karena jalur-jalur ini punya guard non-obvious yang kalau terlewat menyebabkan double-spend saldo, duplikasi/notifikasi tak terkirim, atau korupsi data @lid. Bukan untuk perubahan murni UI/CSS/dokumentasi.
---

# RAF Bot V2 — Invariant Pre-Flight

Tujuan skill ini: sebelum mengubah jalur berisiko, **kunci dulu invariant yang relevan** supaya perubahan tetap aman. Ini app monolit single-instance yang pegang uang pelanggan (saldo) dan satu koneksi WhatsApp live — kesalahan kecil di sini = double-spend, pesan dobel, atau data @lid teracuni. Sumber kebenaran lengkap tetap `CLAUDE.md` + `SYSTEM_MAP.md`; skill ini ringkasan actionable + lokasi helper.

## Cara pakai

1. Cocokkan area yang kamu sentuh dengan tabel di bawah.
2. Untuk tiap area yang kena, baca bagiannya dan ikuti pola helper yang sudah ada — **jangan bikin pola tandingan.**
3. Sebelum selesai: lint + test + sync dokumentasi (bagian terakhir).

| Kalau kamu menyentuh…                     | Baca bagian                                       |
| ----------------------------------------- | ------------------------------------------------- |
| saldo, koin, topup, transfer, pembayaran  | [Saldo & Pembayaran](#saldo--pembayaran)          |
| nomor WA, JID, `@lid`, identitas pengirim | [JID / @lid](#jid--lid)                           |
| kirim pesan/balasan/notifikasi ke user    | [Kirim WhatsApp](#kirim-whatsapp)                 |
| teks apa pun yang dibaca pelanggan        | [Template Pesan](#template-pesan)                 |
| alur tanya-jawab bertahap di bot          | [Conversation State](#conversation-state)         |
| proses pesan masuk per pengirim           | [Concurrency](#concurrency)                       |
| cron, koneksi WA, `global.*`, PM2         | [Single Instance](#single-instance--global-state) |
| baca/tulis DB, path file data             | [DB Paths](#db-paths)                             |

---

## Saldo & Pembayaran

**Kenapa kritis:** ini uang pelanggan. Race condition = double-spend; init yang salah = saldo hantu.

- **Semua mutasi saldo lewat modul `lib/saldo`** (sering di-`require` sebagai `saldoManager`). Fungsi publik `addSaldo` / `deductSaldo` / `transferSaldo` sudah men-serialize lewat `withSaldoWriteLock(fn)` (`lib/saldo/shared.js:208`) di atas satu koneksi SQLite singleton. **Kalau kamu menambah jalur mutasi saldo baru, bungkus juga dengan `withSaldoWriteLock`** — jangan menulis saldo di luar lock. Lihat [[saldo-write-serialization]].
- **Jangan pernah `addSaldo()` / `addKoinUser()` dengan amount `0` / `undefined` / negatif.** Validasi `amount > 0` dulu. Untuk sekadar memastikan record ada, pakai `saldoManager.createUserSaldo(userId)` (idempotent, read-only init) — **bukan** `addKoinUser(userId, 0)`.
- **Normalisasi JID dulu** sebelum operasi saldo (lihat bagian JID). `addKoinUser` bersifat _fail-closed_: kalau JID tak bisa di-resolve, ia mengembalikan `false` dan tidak menambah saldo — periksa nilai baliknya, jangan diabaikan.
- **Sumber kebenaran status bayar** = ledger periodik di `routes/payment-status.js` + `lib/payment-finance-service.js`. Flag `users.paid` di dashboard hanya cache turunan — jangan menulisnya sebagai sumber final dari route lain. Lihat [[payment-paid-two-sources]].

## JID / @lid

**Kenapa kritis:** angka di `<id>@lid` **bukan** nomor telepon. Memperlakukannya sebagai nomor menghasilkan `62<lid>` palsu dan meracuni `database/lid-mappings.json`.

- **Normalisasi ke JID kanonik sebelum dipakai sebagai key DB / target kirim / lookup saldo.** Helper di `lib/jid-utils.js`:
    - `normalizeJidForSaldo(jid, options)` — untuk jalur saldo (async).
    - `normalizeJidForMessage(jid, options)` — untuk jalur kirim pesan (async).
    - `toCanonicalJid(jid, msg, raf)` / `resolveCustomerBySender({...})` — resolver umum.
    - `isLidJid(jid)` untuk deteksi.
- **Jangan pernah** memakai `@lid` sebagai key saldo/DB atau sebagai target `sendMessage`. Kalau tidak bisa dinormalisasi, **gagal dengan jelas** (log + stop), jangan diam-diam pakai `@lid`.
- **Jangan tampilkan `@lid` ke user.** Urutan nama tampilan: `pushname` > nama DB > nomor telepon.
- State percakapan juga di-key dengan sender kanonik, bukan `@lid` — lihat [Conversation State](#conversation-state) dan [[conversation-state-canonical-key]].

## Kirim WhatsApp

**Kenapa kritis:** satu socket live. Shape socket Baileys diisolasi di balik gateway/adapter; bocor ke handler bikin perubahan Baileys meledak di mana-mana. Notifikasi yang melempar exception bisa menjatuhkan flow.

- **Di `message/raf.js` dan handler aktif `message/handlers/*`: DILARANG** `require('@whiskeysockets/baileys')`, menyentuh `global.raf`, atau memanggil `.sendMessage(` mentah. Ini ditegakkan test statis `message/__tests__/wa-forbidden-imports.test.js` — pelanggaran = test merah. Balas lewat helper yang sudah disuntikkan ke handler (`reply()` / `message/handlers/reply-runtime.js`).
- **Butuh Baileys langsung?** Hanya boleh di `index.js`, `lib/whatsapp.adapter.js`, dan lewat `lib/baileys-import.js` (`module.exports = async () => import('@whiskeysockets/baileys')`). Layer lain pakai `lib/whatsapp-gateway.js` / `lib/whatsapp.adapter.js` / `lib/whatsapp-delivery-service.js`.
- **Cek kesiapan koneksi pakai abstraksi**, bukan global mentah: `isReady()` atau `getConnectionState() === "open"` dari `lib/whatsapp-gateway.js` (lihat contoh di `message/handlers/reply-runtime.js`, `message/handlers/steps/*.js`). Pola semantiknya = `koneksi open && socket ada && sendMessage ada`.
- **Notifikasi tidak boleh melempar.** Bungkus try-catch, log, lalu lanjut — jangan biarkan gagal-kirim menjatuhkan operasi pemanggil.
- **Dedup:** notifikasi mempertahankan cek duplikat (`lib/whatsapp-notification-wrapper.js`). Untuk balasan command langsung, lewati dengan opsi `{ skipDuplicateCheck: true }`.
- **Target kirim wajib JID kanonik** (lihat bagian JID), tidak pernah `@lid`.

## Template Pesan

**Kenapa kritis:** semua teks yang dibaca pelanggan harus bisa diedit admin di `/api/templates`. Hardcode = tak bisa diubah operator + lolos audit.

- **Semua teks user-facing dirender dari template**, tidak pernah string literal. Helper:
    - `renderResponseTemplate(key, fallback, data)` — `lib/response-template-helper.js:23` (juga `message/handlers/template-helpers`).
    - `renderTemplate(templateName, data)` — `lib/templating.js:109`.
- Template tinggal di `database/*_templates.json` (utamanya `response_templates.json`).
- **Pesan baru = key template baru.** Sediakan `fallback` runtime yang aman, tapi tetap render lewat key — jangan kirim object diagnostik, kirim `.text`-nya.

## Conversation State

**Kenapa kritis:** state nyangkut atau salah-key bikin bot "tuli" untuk user tertentu (akar bug @lid + reboot).

- Pakai `conversation-handler` (`message/handlers/conversation-handler.js`): `getUserState(userId)` (`:134`), `setUserState(userId, state, options)` (`:156`), `deleteUserState(userId)` (`:186`). **Jangan** baca/tulis `temp[sender]` mentah.
- **Key dengan sender kanonik (`stateSender`), bukan `@lid`** — lihat [[conversation-state-canonical-key]].
- State butuh field `step`, auto-expire ~15 menit, dan harus menghormati kata batal universal (`batal`/`cancel`/`ga jadi`). Sebagian step "protected" dari intersepsi command global — cek konvensi sebelum menambah step.

## Concurrency

- Bungkus pemrosesan pesan per sender dengan `isProcessing` / `setProcessing` / `clearProcessing` (`lib/state-manager.js`). `setProcessing` mengembalikan `false` kalau sender sudah terkunci.
- **Selalu `clearProcessing` di blok `finally`** supaya lock tidak bocor (auto-expire 10 dtk hanya jaring pengaman, bukan andalan).

## Single Instance & Global State

- App **wajib single-instance.** Satu koneksi WA, state `global.*` in-memory, cron terjadwal. Instance kedua = cron dobel, socket WA bentrok, data korup.
- **Jangan** menambah koneksi WA kedua, menjalankan cron paralel, atau mengubah PM2 ke mode `cluster` (tetap `fork` / `instances: 1`).

## DB Paths

- Resolve path lewat `getDatabasePath(name)` (`lib/env-config.js`); di `NODE_ENV=test` otomatis jadi `*_test.sqlite` supaya test tak menyentuh data prod.
- Pisahkan domain ke file SQLite berbeda — jangan gabung.
- **Jangan baca `process.env.*` langsung** di kode app; lewat `global.config` / helper env-config (`loadConfig()`).

---

## Sebelum dianggap selesai

1. **Header Doc** di tiap file yang kamu edit tetap akurat (`Purpose`, `Caller`, `Deps`, `MainFuncs`, `SideEffects`).
2. **Lint + test** jalur yang tersentuh: `npm run lint`, lalu `npx jest <file/area>` (test serial — jangan paralelkan).
3. **Sinkronkan `SYSTEM_MAP.md`** kalau kamu mengubah flow lintas fitur/layer — gunakan skill `system-map-sync`.
