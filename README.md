# RAF Bot V2

Aplikasi **monolitik Node.js untuk operasional ISP / RTRW-Net**. Satu basis kode menggabungkan bot WhatsApp (Baileys), panel web admin/teknisi (PHP via `php-express`), portal pelanggan, API JSON internal, dan Socket.IO realtime — untuk manajemen pelanggan, billing, tiket teknisi, voucher, saldo, monitoring jaringan, dan provisioning.

> **Instance tunggal wajib.** Hanya ada satu koneksi WhatsApp, state global di memori, dan cron terjadwal. Menjalankan lebih dari satu instance (cluster) menyebabkan cron dobel, koneksi WA bentrok, dan data tidak konsisten.

## ✨ Fitur Utama

**Bot WhatsApp**
- *Pelanggan:* cek & bayar tagihan, ganti nama/password WiFi, reboot modem, cek status perangkat, lapor gangguan (mati/lemot), Speed on Demand.
- *Teknisi:* workflow tiket gangguan & PSB (pasang baru) — alur OTW → tiba → OTP → foto → selesai dengan kode penyelesaian.
- *Agen/Reseller:* jual-beli voucher, topup saldo, kelola outlet & profil.
- Semua pesan bot berbasis **template yang dapat diedit dari panel admin** (`/api/templates`).

**Panel Web Admin & Teknisi** (SB Admin, PHP, role-aware)
- Manajemen pelanggan, paket, dan akun.
- Billing: invoice PDF, status pembayaran berbasis ledger, pembayaran parsial, diskon, tunggakan (arrears), kompensasi.
- Saldo & voucher, manajemen agen.
- Isolir otomatis terjadwal + manual, dan buka isolir.
- Keuangan: pengeluaran, gaji teknisi, kasbon, settlement teknisi, rekap keuangan.
- Konten: pengumuman, berita, editor template pesan; map viewer ODP/ODC.

**Portal Pelanggan** — login via OTP WhatsApp untuk self-service.

**Jaringan & Monitoring**
- MikroTik (PPPoE/Hotspot) + import pelanggan dari MikroTik.
- GenieACS — provisioning ONT, reboot, manajemen WiFi.
- OLT multi-merk (ZTE C320, HIOSO) — monitoring redaman/RxPower, deteksi LOS, syslog receiver, broadcast WA saat LOS.
- CCTV monitor — broadcast WA ke pelanggan saat CCTV publik mati.
- Auto-outage broadcast berbasis PPPoE MikroTik.
- Metrik monitoring, alert system, dan error recovery.

**Otomatisasi (cron):** pengingat tagihan, set unpaid, isolir, revert kompensasi/speed, cek redaman, backup Telegram.

**Pembayaran:** integrasi iPaymu.

## 🧱 Arsitektur Singkat

`index.js` adalah *composition root* tipis yang memuat config, membangun runtime bersama, memasang middleware + route, menjalankan Socket.IO, dan memegang lifecycle koneksi Baileys. Alur:

- **Bot** — `message/raf.js` (router/interceptor) → `message/handlers/*` (logika domain), dispatch intent map-based.
- **Web/API** — `routes/*.js` (controller tipis); admin dirakit `routes/admin-router.js`.
- **Service** — `services/*.service.js`, `lib/*.js`, `lib/services/*` (aturan bisnis & adaptor integrasi).
- **Repository** — `repositories/*.repository.js` (owner persistence per domain); `lib/database.js` facade kompatibilitas.

Peta arsitektur lengkap ada di **[SYSTEM_MAP.md](SYSTEM_MAP.md)**, dan panduan kerja untuk AI/kontributor di **[CLAUDE.md](CLAUDE.md)**.

## 🛠️ Teknologi

- **Runtime:** Node.js (CommonJS), timezone dipaksa `Asia/Jakarta`.
- **Web/API:** Express, Helmet, express-rate-limit, express-session, Multer, Socket.IO.
- **Bot:** `@whiskeysockets/baileys`, `pino`, `qrcode`.
- **Data:** SQLite (`sqlite3`) terpisah per domain + berkas JSON di `database/`.
- **View legacy:** `php-express` untuk halaman `.php` (panel admin/teknisi).
- **Integrasi:** Axios, SNMP (`net-snmp`), MikroTik (RouterOS API), iPaymu, GenieACS, Telegram (backup), Puppeteer (PDF).

## 📋 Prasyarat

- **Node.js ≥ 18** (disarankan 20 LTS) — tidak dikunci `engines`, tapi Baileys 7.x butuh Node modern.
- **PHP CLI** di `PATH` — wajib untuk merender halaman admin/teknisi (`.php`). Tanpa PHP, halaman tersebut error 500 (API JSON tetap jalan). `index.js` memberi peringatan jika `php` tidak ditemukan.
- *(Opsional, sesuai fitur yang dipakai)* MikroTik, GenieACS, OLT/SNMP, iPaymu, bot Telegram.

## 🚀 Instalasi & Setup Pertama

```bash
# 1. Install dependencies
npm install

# 2. Konfigurasi (lihat bagian Konfigurasi)
#    config.json otomatis dibuat dari config.example.json saat pertama start,
#    lalu isi kredensial asli. Bisa juga disalin manual:
cp config.example.json config.json
cp .env.example .env   # opsional: secret & knob runtime

# 3. Buat akun admin pertama
#    (accounts.json di-gitignore, dan route pembuatan akun butuh login admin)
node scripts/create-admin.js <username> <password> [nama] [role]
#    role: admin (default) | teknisi

# 4. Jalankan
npm start

# 5. Scan QR WhatsApp yang tampil di terminal (juga dikirim ke dashboard via Socket.IO).
#    Sesi tersimpan di sessions/<sessionName>/.
```

Server default berjalan di **http://localhost:3100**. Database SQLite/JSON dibuat & di-migrate otomatis saat startup (backup tersimpan di `backups/`).

## ⚙️ Konfigurasi

Ada dua sumber konfigurasi:

1. **`config.json` — sumber konfigurasi utama (bisnis).** Auto-bootstrap dari `config.example.json`. Memuat `ownerNumber`, `botName`, jadwal tagihan/isolir, GenieACS, iPaymu, invoice/perusahaan, OLT, monitoring, CCTV, dll. Diakses lewat helper `lib/env-config.js`, **bukan** `process.env` langsung.
2. **`.env` — secret & knob runtime.** Variabel utama:

   | Variabel | Keterangan |
   |---|---|
   | `NODE_ENV` | `production` / `test` (test memakai DB `*_test.sqlite`) |
   | `PORT` | Port HTTP (default `3100`) |
   | `JWT_SECRET`, `SESSION_SECRET` | Secret autentikasi (wajib diganti) |
   | `SESSION_NAME` | Nama sesi WhatsApp (folder `sessions/`) |
   | `IP_MC`/`NAME_MC`/`PASSWORD_MC`/`PORT_MC`/`SSL_MC` | Kredensial MikroTik (alias modern: `MIKROTIK_HOST` dst.) |
   | `PORTAL_ALLOWED_ORIGINS` | Whitelist origin portal pelanggan (CORS) |
   | `PSB_DEBUG`/`TICKET_DEBUG`/`NOTIF_DEBUG`/`STATS_DEBUG` | Logging verbose per domain |

   `.env.example` memuat daftar lengkap; sebagian entri (Redis, Sentry, SMTP, webhook) bersifat opsional/eksperimental dan belum tentu aktif.

`config.json`, `.env`, `database/*`, dan `sessions/` **di-gitignore** — jadi clone baru selalu mulai bersih.

## 🏃 Menjalankan

```bash
npm start          # nodemon index.js (auto-reload; nodemon men-set NODE_ENV=production)
npm run dev        # alias npm start
npm run start:prod # node index.js (tanpa nodemon)
```

**Produksi (PM2)** — wajib mode `fork`, satu instance:

```bash
pm2 start ecosystem.config.js   # nama proses: raf-dander-v3
pm2 logs raf-dander-v3          # lihat QR WhatsApp untuk scan
pm2 save                        # simpan daftar proses
```

HTTPS diterminasi di depan oleh **Cloudflare Tunnel** (enforcement HTTPS lokal dimatikan).

## 🗄️ Database

- **SQLite terpisah per domain** di `database/` — mis. `users.sqlite`, `saldo.sqlite`, `activity_logs.sqlite`, `psb_database.sqlite`, `monitoring_metrics.sqlite`, `isolir_audit.sqlite`.
- **Berkas JSON** untuk katalog/state ringan (paket, voucher, payment, template, dll.).
- Path di-resolve via `lib/env-config.js` `getDatabasePath(name)`; saat `NODE_ENV=test` otomatis memakai berkas `*_test.sqlite`.
- **Auto-migration** berjalan saat startup; migrasi manual: `node scripts/auto-migrate-on-startup.js`. Backup otomatis dibuat sebelum migrasi.

## 🧪 Pengujian

```bash
npm test                       # jest --runInBand (serial; state global membuat paralel tidak aman)
npx jest path/to/file.test.js  # satu berkas
npx jest -t "nama test"        # berdasarkan nama
npm run lint                   # eslint .
npm run format                 # prettier --write .
```

Test berdampingan di folder `__tests__/` per layer (`lib`, `message`, `routes`, `services`, `repositories`, `controllers`, `views`, `static/js`).

## 📁 Struktur Proyek

```
index.js            # Composition root (bootstrap HTTP + WhatsApp + Socket.IO)
lib/                # Engine bisnis, adaptor integrasi, helper, service
  ├─ services/      # Service domain
  ├─ olt-drivers/   # Driver OLT multi-merk (ZTE, HIOSO)
  └─ cron/, saldo/  # Modul terpecah per domain
message/            # Bot WhatsApp
  ├─ raf.js         # Router/interceptor pesan
  └─ handlers/      # Handler domain + dispatch intent
routes/             # Express controller / API / admin / portal
controllers/        # Controller terpisah (mis. admin)
services/           # Service layer (*.service.js)
repositories/       # Owner persistence per domain (*.repository.js)
database/           # SQLite + JSON (gitignored)
views/              # Halaman PHP SB Admin (admin/teknisi) + helper RouterOS
static/             # Aset front-end (CSS/JS/vendor)
scripts/            # Migrasi, backup, debug OLT, utilitas operasi
config/             # Command map, pesan, konfigurasi monitoring
```

## 🔧 Skrip Utilitas

| Perintah | Fungsi |
|---|---|
| `node scripts/create-admin.js <user> <pass> [nama] [role]` | Buat akun admin/teknisi pertama |
| `node scripts/auto-migrate-on-startup.js` | Migrasi database manual |
| `node scripts/backup-database.js` | Backup database |
| `node scripts/cleanup-old-backups.js` | Bersihkan backup lama |
| `scripts/olt-zte-*.js`, `scripts/debug-*.js` | Diagnostik & discovery OLT/ONT |

## 📚 Dokumentasi Lanjutan

- **[CLAUDE.md](CLAUDE.md)** — panduan kerja, perintah, dan invariant untuk kontributor/AI.
- **[SYSTEM_MAP.md](SYSTEM_MAP.md)** — peta arsitektur & boundary refactor.
- `docs/` — referensi OLT (`olt-syslog-receiver.md`, `olt-zte-c320-snmp-map.md`) serta checklist/hasil testing.

## ⚠️ Catatan Penting

- Jangan jalankan lebih dari satu instance (lihat catatan di atas).
- Komentar, dokumentasi, dan pesan log/error memakai **Bahasa Indonesia**; nama variabel/fungsi tetap Inggris.
- Berkas data (`database/*`, `sessions/`, `config.json`, `.env`) **tidak** di-commit.

## 📄 Lisensi

MIT
