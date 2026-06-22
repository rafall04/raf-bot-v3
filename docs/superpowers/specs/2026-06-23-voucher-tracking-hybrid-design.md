# Header Doc
- Purpose: Tech Spec sistem pelacakan (tracking) & laporan voucher hotspot di RAF Bot V2 dengan arsitektur **Hybrid** — MikroTik/Mikhmon tetap pemilik *expiry*, bot menjadi pemilik *tracking & laporan* berbasis DB. Menggantikan ketergantungan pada penumpukan `/system/script` Mikhmon.
- Caller: Developer/agent yang mengimplementasikan fase `voucher-tracking-hybrid`.
- Deps: `services/api-voucher.service.js`, `repositories/api-voucher.repository.js`, `routes/api-voucher-routes.js`, `lib/mikrotik.js`, `views/*hotspot*.php`, `lib/cron.js` + `lib/cron/jobs/*`, `lib/database.js` (`withSqliteDatabase`), `lib/agent-voucher-manager.js`, arsip `tmp/mikhmon_log_archive.txt`.
- MainFuncs: Menetapkan keputusan arsitektur, data model, alur rekonsiliasi, slices implementasi, guardrail, risiko, dan success criteria.
- SideEffects: Tidak ada; dokumen statis. (SYSTEM_MAP.md di-update saat implementasi, bukan di spec.)

# Voucher Tracking Hybrid (VANS)

## Tujuan
Menjadikan **bot sebagai sumber kebenaran pelacakan & laporan voucher** (siapa beli, kapan aktif, masa berlaku, pendapatan, reseller/margin) — dengan data ter-index di DB, bukan menumpuk `/system/script` di router. **Expiry tetap di router** (mekanisme Mikhmon: `on-login` per-profil + scheduler per-profil) karena otonom & tahan-banting.

## Konteks & Problem Saat Ini
- Voucher hotspot dibuat bot via `views/adduserhotspot.php` → hanya `/ip/hotspot/user/add` (name/password/server/comment/profile). **Bot tidak mencatat apa pun** dan tidak punya laporan voucher yang queryable.
- Expiry dikerjakan **Mikhmon di MikroTik 172.17.11.1**: tiap profil jualan punya `on-login` (encode validity+harga: `Paket-2Jam`=2h, `Paket-8Jam`=8h, `Paket-1Hari`=1d, `4H`=4h, `bulanan-55rb`=30d) yang menulis kedaluwarsa ke *comment* saat **login pertama**; scheduler per-profil (tiap ~2–3 menit, on-event INLINE) menghapus user lewat-tempo.
- Mikhmon mencatat **setiap login sebagai 1 `/system/script`** bernama `tgl-|-jam-|-user-|-harga-|-IP-|-MAC-|-validity-|-profil-|-komen`. Per 2026-06-23 menumpuk **40.089** entri (config router ~7,8 MB) → dibersihkan (arsip: `tmp/mikhmon_log_archive.txt`, backup router `pre-script-cleanup-20260623.backup`). **Akan kambuh** karena `on-login` terus menulis log. Lihat memory `vans-voucher-expiry`.

## Keputusan Arsitektur (dan alasannya)
1. **Hybrid, bukan full-replace.** Expiry tetap milik router/Mikhmon. Alasan: (a) otonom — tetap jalan saat bot mati/restart/WA logout; (b) "validity dari login pertama" hanya router yang tahu momennya presisi; (c) terbukti setahun. Memindah expiry ke cron bot menukar keandalan dengan ketergantungan uptime bot (risiko bocor pendapatan).
2. **Log-script Mikhmon = event-stream aktivasi.** Daripada membiarkannya menumpuk atau sekadar menghapus, **bot meng-ingest** tiap entri (login time, harga, IP, MAC, validity, profil, kode reseller) lalu **menghapusnya dari router**. Parser yang sama dipakai untuk seed historis dari arsip 40k. Konsekuensi: **JANGAN slim/hapus `on-login`** (itu sumber event kita) dan **JANGAN sentuh scheduler/profile** (itu expiry).
3. **Status voucher diturunkan dari observasi router, bukan dihitung ulang bot.** Hadir+aktif = online; punya aktivasi tapi masih ada = aktif; hilang dari router (dihapus scheduler Mikhmon) = `expired/consumed`. Bot tidak pernah menghapus *user* hotspot.
4. **Owner tunggal.** Persistensi voucher (katalog + history + tracking) tetap di domain voucher yang sudah ada (`repositories/api-voucher.repository.js` diperluas untuk memiliki `voucher.sqlite`). Tidak membuat owner paralel.

## Target Architecture
```
Generate (bot/reseller)                Router (Mikhmon — TIDAK diubah)
  api-voucher.service.generateAndSend ──► adduserhotspot.php (/ip/hotspot/user/add)
        │ catat record (authoritative sale)        │ on-login (login pertama) → tulis expiry ke comment + buat log-script
        ▼                                           │ scheduler per-profil → hapus user expired
  voucher.sqlite (BOT = source of truth)            ▼
        ▲                                   /system/script (event aktivasi)
        │  ingest + update status                    │
  cron: voucher-reconcile  ◄───── baca log-script + /ip/hotspot/active ──── prune log-script
        │
        ▼
  routes/api-voucher-routes (GET /voucher/report, /voucher/list) ──► views/sb-admin/voucher-report.php
```

## Data Model — `database/voucher.sqlite` (baru, owned by voucher repository)
Pakai `withSqliteDatabase` + helper promisified `run/get/all` (pola `lib/services/isolir-audit-repository.js`). Path via `getDatabasePath('voucher.sqlite')` (test → `voucher_test.sqlite`).

**`voucher_batches`** — event generate (lot penjualan)
| kolom | tipe | catatan |
|---|---|---|
| id | INTEGER PK | |
| source | TEXT | `bot` \| `reseller` \| `mikhmon_external` |
| profile | TEXT | profil hotspot MikroTik |
| qty | INTEGER | |
| unit_price | INTEGER | harga retail saat generate |
| created_by | TEXT | username admin / id reseller |
| transaction_context | TEXT | `direct_customer_sale` \| `delivery_resend` \| `agent_purchase` |
| created_at | TEXT (ISO) | |

**`vouchers`** — satu baris per kode
| kolom | tipe | catatan |
|---|---|---|
| id | INTEGER PK | |
| username | TEXT | kode voucher (hotspot user name) |
| password | TEXT NULL | hanya bila bot yang generate |
| profile | TEXT | |
| price | INTEGER NULL | retail |
| reseller_price | INTEGER NULL | |
| margin | INTEGER NULL | |
| validity | TEXT NULL | `2h`/`8h`/`1d`/`30d` (dari profil/log) |
| status | TEXT | `unused` \| `active` \| `expired` \| `unknown` |
| source | TEXT | `bot` \| `reseller` \| `mikhmon_external` |
| batch_id | INTEGER NULL | FK voucher_batches |
| sold_to_phone | TEXT NULL | |
| sold_by | TEXT NULL | |
| created_at | TEXT NULL | waktu generate (bila diketahui) |
| first_login_at | TEXT NULL | dari aktivasi |
| expires_at | TEXT NULL | first_login_at + validity |
| last_mac | TEXT NULL | |
| last_ip | TEXT NULL | |
| removed_seen_at | TEXT NULL | saat reconcile mendeteksi user hilang (≈ consumed) |
| updated_at | TEXT | |

**`voucher_activations`** — event log aktivasi (append-only; sumber: log-script Mikhmon + arsip)
| kolom | tipe | catatan |
|---|---|---|
| id | INTEGER PK | |
| username | TEXT | |
| profile | TEXT | |
| price | INTEGER NULL | |
| validity | TEXT NULL | |
| login_at | TEXT (ISO) | dari `tgl + jam` log |
| mac | TEXT NULL | |
| ip | TEXT NULL | |
| voucher_comment | TEXT NULL | kode reseller/komen (mis. `vc-263-04.01.25-KAYINN010425`) |
| raw | TEXT | nama script asli (audit) |
| ingested_at | TEXT | |

Index: `vouchers(username)`, `vouchers(status)`, `vouchers(created_at)`, `vouchers(profile)`, `voucher_activations(login_at)`, `voucher_activations(username)`, UNIQUE `voucher_activations(username, login_at)` (idempotent re-ingest).

## Format & Parser Log Mikhmon
Nama script: `mmm/dd/yyyy-|-HH:MM:SS-|-<username>-|-<harga>-|-<ip>-|-<mac>-|-<validity>-|-<profil>-|-<komen>`.
Contoh: `apr/03/2025-|-01:28:42-|-JDGH4988-|-2500-|-10.10.2.112-|-CA:BF:E9:94:6E:1D-|-1d-|-Paket-1Hari-|-vc-263-04.01.25-KAYINN010425`.
Parser: split `-|-` → 9 field; parse tanggal `mmm/dd/yyyy` + jam → ISO `Asia/Jakarta`. **Slice 1 wajib** sampling user hotspot live untuk konfirmasi format *comment* pasca-login (untuk pemetaan `expires_at`), karena format nama-script (event) ≠ format comment-user (state). Bila comment tak ter-parse, `expires_at` = `login_at + validity`.

## Komponen Baru / Diperluas
1. **Repository (perluas `api-voucher.repository.js`):** init `voucher.sqlite` + CRUD `voucher_batches`/`vouchers`/`voucher_activations`, upsert idempotent, query agregat laporan. (Owner voucher tetap satu.)
2. **Generation capture (perluas `api-voucher.service.generateAndSendVouchers` + jalur agen di `lib/agent-voucher-manager.js`):** setelah `adduserhotspot` sukses, tulis `vouchers` (+ `voucher_batches`) — record penjualan otoritatif (username/password/profile/price/margin/source/sold_by/sold_to). Tidak mengubah kontrak respons publik.
3. **Adapter MikroTik baru (`lib/mikrotik.js` + `views/`):**
   - `getHotspotLogScripts()` → `views/get_hotspot_log_scripts.php`: `/system/script/print` `.proplist=.id,name` filter `name~"-\\|-"` (ringan).
   - `removeScriptsByIds(ids)` → `views/remove_scripts.php`: batch `=.id=` (pola yang sudah terbukti saat cleanup 40k).
   - `getHotspotUsersLite()` → `views/get_hotspot_users.php`: `.proplist=name,profile,comment,uptime,disabled` (snapshot presence/expiry-comment).
   - Reuse `getActiveHotspotUsers` (sudah ada) untuk online snapshot.
4. **Cron `lib/cron/jobs/voucher-reconcile.js`** (daftarkan di `lib/cron.js`; pola `set-unpaid`): overlap-guard + sequential + SQLITE_BUSY-aware. Per tick:
   a. `getHotspotLogScripts()` → parse → upsert `voucher_activations` + update/insert `vouchers` (first_login_at, mac, ip, status=active, expires_at, source bila baru=`mikhmon_external`/`reseller`).
   b. `removeScriptsByIds()` untuk entri yang sukses ter-ingest (prune).
   c. `getHotspotUsersLite()` → tandai `vouchers` yang sebelumnya `active` tapi kini hilang → `status=expired`, `removed_seen_at=now`. Yang ada tapi belum pernah login → `unused`.
   Config: `cron.json` → `voucher_reconcile_schedule` (default `*/5 * * * *`) + `status_voucher_reconcile` (bool). Schedule editable via UI cron existing.
5. **Laporan (routes + UI):**
   - `GET /voucher/report` (requireStaff): agregat revenue per periode/profil/source/reseller, hitung unused/active/expired. Filter `from`/`to`/`profile`/`source`.
   - `GET /voucher/list` (requireStaff): cari per kode/komen/MAC + paginasi.
   - `views/sb-admin/voucher-report.php` (atau perluas `voucher.php`): tabel + ringkasan + filter. Ikuti tema/_head/_asset existing.
6. **Seed historis (one-off, `scripts/seed-voucher-activations.js`):** parse `tmp/mikhmon_log_archive.txt` (40.089) → `voucher_activations` (+ derive `vouchers` `mikhmon_external` untuk yang tak match penjualan bot). Idempotent (UNIQUE username+login_at).

## Scope
**Masuk:** DB voucher.sqlite + repository; capture saat generate; cron reconcile (ingest+prune+status); endpoint + halaman laporan; adapter MikroTik read/prune; seed historis.
**Tidak masuk:** mengubah `on-login`/scheduler/profile (expiry); migrasi ke User Manager; redesign katalog/reseller existing; perubahan kontrak publik voucher generate/send.

## Hard Rules / Invariants
- **JANGAN** ubah `on-login`, scheduler, atau profil hotspot. Expiry = milik router.
- Reconcile **READ + prune log-script** saja di router; **DILARANG menghapus `/ip/hotspot/user`** (bisa memutus pelanggan bayar).
- Ingest **sebelum** prune (jangan hapus log yang belum tercatat). Prune hanya id yang sukses ter-ingest.
- Idempotent (UNIQUE username+login_at), overlap-guard, sequential + jeda kecil, sadar SQLITE_BUSY (pola cron existing).
- Owner persistensi voucher tunggal (perluas repo voucher, bukan owner baru).
- Reuse boundary WA delivery & reseller/saldo existing; jangan bikin jalur kirim baru.
- Voucher.sqlite domain terpisah (jangan campur ke users/saldo).

## Implementation Slices
1. **Discovery & parser:** sampling user hotspot live (format comment), unit-test parser nama-script + tanggal `Asia/Jakarta`.
2. **DB + repository:** voucher.sqlite + skema + CRUD/agregat + contract test.
3. **Seed historis** dari arsip 40k (validasi jumlah & contoh).
4. **Adapter MikroTik** read log + remove batch + users-lite (+ test bridge).
5. **Cron reconcile** (ingest→prune→status) di belakang flag `status_voucher_reconcile=false` dulu; uji manual.
6. **Capture saat generate** (service + agen).
7. **Endpoint + halaman laporan.**
8. **Aktifkan cron** + sync `SYSTEM_MAP.md` + `.module_map.md`.

## Testing Strategy
- Unit: parser log (varian format, MAC kosong, komen mengandung `-`), derivasi `expires_at`.
- Repository contract: upsert idempotent, agregat revenue, transisi status.
- Cron: simulasi ingest→prune (mock adapter), overlap-guard, "user hilang → expired", "ingest gagal → tak prune".
- Route/UI: baseline report/list + filter.
- Regresi: generate/send voucher existing tetap hijau; `jest --runInBand` (heap flag, lihat memory `jest-fullsuite-heap`).

## Risiko & Mitigasi
- **Format comment pasca-login bervariasi** → status/expiry meleset. Mitigasi: status inti dari presence/hilang; comment best-effort; discovery di Slice 1.
- **Username 6-char bisa terpakai ulang** setelah voucher lama dihapus → tabrakan match. Mitigasi: cocokkan ke voucher "open" terbaru per username; yang sudah `removed_seen_at` dianggap closed; activations tetap unik per (username, login_at).
- **Prune menghapus log sebelum ingest** (bug) → kehilangan data. Mitigasi: hanya prune id yang dikonfirmasi ter-upsert; transaksional per-batch.
- **Beban router** poll tiap 5 menit. Mitigasi: proplist ringan, 1 panggilan print, batch prune, jeda; reuse breaker MikroTik existing.
- **Bot down lama** → log menumpuk sementara. Mitigasi: reconcile catch-up (ingest semua yang ada saat hidup lagi); aman karena Mikhmon expiry tetap jalan.

## Rollback
Fitur aditif: matikan `status_voucher_reconcile` di `cron.json`; (opsional) hapus `voucher.sqlite`. Tidak ada perubahan router permanen selain prune log (aman, dan log = data yang sudah dipindah ke DB). Backup router `pre-script-cleanup-20260623.backup` tersedia.

## Success Criteria
- `/system/script` di router tetap ~0 secara berkelanjutan (tidak menumpuk lagi).
- Setiap voucher (bot + reseller + eksternal) tercatat di `voucher.sqlite` dengan status & revenue yang benar.
- Halaman Laporan Voucher menampilkan revenue/aktif/expired per periode/profil/reseller, bisa cari per kode.
- Expiry tetap berfungsi (scheduler/on-login Mikhmon utuh; tidak ada user hotspot terhapus oleh bot).
- `npm run lint` + suite hijau; `SYSTEM_MAP.md` & `.module_map.md` sinkron.

## Open Questions (untuk kamu putuskan saat review)
1. Jadwal reconcile: `*/5 * * * *` cukup, atau mau lebih cepat (mis. `*/2`)?
2. Halaman laporan: file baru `voucher-report.php` atau perluas `voucher.php` yang ada?
3. Voucher non-bot (Mikhmon manual/reseller lama): tetap dicatat sebagai `mikhmon_external` di laporan, atau cukup voucher yang dijual lewat bot saja?
4. Seed historis: ingest seluruh 40k arsip, atau mulai bersih dari sekarang saja?
