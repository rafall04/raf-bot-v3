# Header Doc
- Purpose: Peta sistem root untuk memahami tujuan proyek, stack, arsitektur global, flow inti, lokasi database, dan integrasi eksternal.
- Caller: Pengembang/agent sebelum tracing atau modifikasi lintas fitur.
- Deps: `index.js`, `lib/database.js`, `lib/env-config.js`, `message/raf.js`, `routes/api.js`, `routes/public.js`.
- MainFuncs: Menjelaskan entrypoint, jalur trigger->controller->service->repo->DB, dan boundary integrasi.
- SideEffects: Tidak ada; dokumentasi statis.

# SYSTEM MAP
## Tujuan Proyek
Aplikasi monolit Node.js untuk operasional ISP/RTRW-Net yang menggabungkan bot WhatsApp, portal web/admin, API internal, workflow tiket teknisi, billing/saldo, voucher, monitoring jaringan, dan provisioning pelanggan.

## Tech Stack
- Runtime: Node.js CommonJS.
- HTTP/Web: Express, body-parser, cookie-parser, helmet, express-rate-limit, express-session, multer.
- Bot: `@whiskeysockets/baileys`, `pino`, `qrcode`, `socket.io`.
- Data: SQLite3 + berkas JSON di folder `database/`.
- View/Legacy bridge: `php-express` + halaman/skrip PHP di `views/`.
- Integrasi: Axios HTTP client, SNMP (`net-snmp`), Mikrotik helpers, iPaymu, GenieACS, Telegram backup.

## Arsitektur Global
- Entry Runtime: `index.js` memuat composition root dan memakai wrapper `lib/app-runtime.js`, `lib/http-app.js`, `lib/routes-registry.js`, `lib/whatsapp-bootstrap.js`, dan `lib/whatsapp-gateway.js` untuk menahan coupling bootstrap serta kontrak runtime WA.
- Bot Layer: `message/raf.js` sebagai router/interceptor; logika domain dipindah ke `message/handlers/*.js`.
- Web/API Layer: `routes/*.js` sebagai controller HTTP tipis; beberapa file adalah factory sub-router (`api-*.js`) dan admin sekarang masuk lewat komposer `routes/admin-router.js` yang memasang registrar domain sebelum fallback ke `routes/admin.js`.
- Service/Business Layer: `lib/*.js` dan `lib/services/*` memuat aturan bisnis, adaptor integrasi, state machine tiket, auth, template, dan monitoring; `message/handlers/legacy-teknisi-state-handler.js` menjadi boundary transisi state legacy sebelum dispatcher intent (state WiFi legacy sudah pindah ke `message/handlers/states/*.js`), sementara `lib/whatsapp-gateway.js`, `lib/whatsapp.adapter.js`, `lib/whatsapp-delivery-service.js`, `lib/whatsapp-bootstrap.js`, dan `message/handlers/reply-runtime.js` kini menjadi boundary runtime/delivery WA untuk approval/admin/voucher/speed flow, helper cron, service notifikasi utama, route status/network, legacy step handler aktif, monitoring/runtime observability, serta reconnect lifecycle tunggal.
- Repository/Data Layer: `lib/database.js` sebagai compatibility facade di atas helper internal JSON/waypoint/network-assets, `lib/psb-database.js`, logger SQLite terpisah, file JSON `database/*.json`, serta `repositories/*.repository.js` yang mulai menjadi owner persistence per bounded context.
- Config Layer: `config/*.json`, `config.json`, `.env`, dan resolver `lib/env-config.js`.

## Core Logic Flow
### WhatsApp
1. Trigger: event pesan Baileys diterima di `index.js` lalu diteruskan ke `msgHandler = require("./message/raf")`.
2. Ctrl: `message/raf.js` membentuk konteks actor, cek keyword global/cancel, cek state aktif, lalu memutuskan intent DUA LAPIS: matcher ketat `lib/wifi_template_handler.js` (keyword awal kalimat, editable admin) → bila gagal, matcher longgar `lib/loose-intent-matcher.js` (khusus pengirim non-staf, gate `customerAssist.looseMatcher`, hanya intent aman CEK_KONEKSI/GANTI_SANDI_WIFI/HISTORY_WIFI). Pesan pelanggan yang tetap tanpa intent dievaluasi fallback anti-diam `message/handlers/customer-fallback-handler.js` (gate `customerAssist.fallback`, default OFF) sebelum dispatch.
3. Svc: `message/handlers/raf-intent-dispatch.js` kini menjadi composer map-based yang mendelegasikan ke `message/handlers/raf-intent-dispatch/*.js` per domain (`agent`, `reporting`, `ticket-customer`, `ticket-teknisi`, `wifi`, `saldo`, dst.) bersama handler domain existing (`smart-report`, `teknisi-workflow`, `wifi-management`, dst.).
4. Repo: handler memanggil `lib/*` atau `lib/services/*` untuk operasi saldo, tiket, voucher, auth, WiFi, logging, monitoring.
5. DB: akses data berakhir di SQLite (`database/users.sqlite`, DB domain lain) atau JSON `database/*.json` via `lib/database.js`/repo domain.

### HTTP/API
1. Trigger: request masuk ke Express di `index.js`.
2. Ctrl: route spesifik pada `routes/public.js`, `routes/admin-router.js`, `routes/api.js`, `routes/tickets.js`, dst.
3. Svc: route memanggil service/manager di `lib/*` dan `lib/services/*`.
4. Repo: service memakai wrapper database, helper JSON, atau adaptor integrasi.
5. DB: persist ke SQLite/JSON di folder `database/` atau DB log terpisah.
6. Listener publik (opsional): `index.js` juga dapat membuka listener HTTP KEDUA (`lib/public-site-app.js`, port `config.publicSite.port`, host `config.publicSite.host`) di proses yang sama untuk surface anonim (landing/registrasi/voucher) TANPA cron/WA/Socket.IO/auth-gate kedua. Untuk MULTI-BOT, PROSES KE-3 `portal.js` (`rafnet-portal`) mem-proxy ke listener publik bot (internal 127.0.0.1) dengan pemilih area — lihat "Site Publik Anonim" & "Portal Publik Terpadu" di Boundary Refactor Baru.

## DB Config / Locations
- Resolver path utama: `lib/env-config.js:getDatabasePath(dbName = "users.sqlite")`.
- Folder baku data: `database/` di root proyek.
- SQLite utama pelanggan: `database/users.sqlite`.
- SQLite test/dev terpisah: `database/users_test.sqlite` saat `NODE_ENV=test`.
- SQLite domain lain yang terindikasi di kode/komentar: `database/activity_logs.sqlite`, `database/psb_database.sqlite`.
- JSON yang dibootstrap `lib/database.js`: `packages.json`, `accounts.json`, `statik.json`, `voucher.json`, `user/atm.json`, `payment.json`, `payment-method.json`, `requests.json`, `package_change_requests.json`, `reports.json`, `speed_requests.json`, `network_assets.json`, `compensations.json`, `announcements.json`, `news.json`, `cron.json`.
- Whitelist bot Telegram teknisi: `database/telegram_teknisi.json` (array chat_id teknisi yang diizinkan; dikelola `repositories/telegram-teknisi.repository.js`, bukan di-bootstrap `lib/database.js`).
- Logger pesan masuk WA: `database/message_logs.sqlite` — dua tabel: (a) `inbound_messages` (korpus read-only bahasa pelanggan untuk evaluasi fitur AI; toggle `config.messageLogging.enabled`, default aktif), dan (b) `chat_activity` (jejak DURABEL kapan admin terakhir balas manual & kapan pelanggan mengeluh, per chat — tulang punggung gerbang intake bukti bayar, di-`hydrate` ke `lib/chat-activity-tracker` saat boot; SENGAJA tak ikut toggle `messageLogging` karena itu sinyal pengaman, bukan korpus). Owner `repositories/message-log.repository.js`, di-hook fire-and-forget dari `message/raf.js` + `index.js`. Bukan di-bootstrap `lib/database.js`.
- Kualitas jalur upstream: `database/upstream_quality.sqlite` (tabel `upstream_probes` loss/RTT/jitter per jalur×target + `upstream_route_state` snapshot route + `wan_link_samples` util/flap + `upstream_incidents` + `service_probes` reachability layanan×jalur). Owner `repositories/upstream-quality.repository.js`; ditulis `lib/upstream-quality-poller.js` (jalur) & `lib/service-reachability-prober.js` (layanan); gate `config.upstreamMonitor.enabled` / `config.serviceMonitor.enabled`. Bukan di-bootstrap `lib/database.js`.
- Survei kepuasan pelanggan (CSAT): `database/csat.sqlite` (tabel `csat_surveys` — 1 baris = 1 pelanggan × periode 'YYYY-MM' + skor 1-5/komentar/status daur hidup). Owner `repositories/csat.repository.js`; ditulis cron `lib/cron/jobs/rating-survey.js` (kirim + digest) & service `lib/csat/csat-survey-service.js` (tangkap balasan DURABEL — tahan restart, dibaca dari jalur inbound `message/raf.js`); gate `config.csatSurvey.enabled` (default OFF). Path via `getDatabasePath('csat.sqlite')` (→ `csat_test.sqlite` saat test). Bukan di-bootstrap `lib/database.js`.
- Ledger broadcast (anti-ban): `database/broadcast_ledger.sqlite` (tabel `broadcast_ledger` — kapan tiap nomor terakhir dikirimi broadcast + daftar BLOKIR/opt-out). Owner `lib/broadcast-ledger.js`; dibaca `lib/cron/wa-send-queue.js` saat `config.broadcastGuard.enabled` (skip nomor terblokir/min-gap, **FAIL-OPEN** — error tak menahan kirim). Path via `getDatabasePath`. Bukan di-bootstrap `lib/database.js`.
- Antrian bukti pembayaran: `database/payment_proofs.json` (metadata bukti transfer status pending/confirmed/rejected) + file bukti di `temp/payment_proofs/<id>.<jpg|pdf>`. Owner `repositories/payment-proof.repository.js` (berkunci `withLock`, baca-dari-disk tiap panggil); bukan di-bootstrap `lib/database.js`.
- Tindak lanjut reboot modem: `database/reboot-followups.json` (`reboot-followups_test.json` saat `NODE_ENV=test`) — antrian pekerjaan `{id,jid,deviceId,pppoeUsername,remoteAddr,dueAt,attempts,status}`. Owner `lib/reboot-followup-store.js`; dipindai tiap tick oleh `lib/reboot-followup-service.js` sehingga pekerjaan **selamat dari `pm2 restart`** (tak ada timer in-memory yang perlu dibangun ulang). Gate `config.rebootAssist.enabled`. Bukan di-bootstrap `lib/database.js`.
- Digest notifikasi anti-spam: `database/notification-digest.json` (`*_test.json` saat test) — bucket per (penerima, kind) `{recipient, kind, windowUntil, pending[]}`. Owner `lib/notification-digest.js`; dipindai tiap tick sehingga selamat dari `pm2 restart`. Gate `config.paymentRequestDigest.enabled`. Bukan di-bootstrap `lib/database.js`.
- Saldo pelanggan: `database/saldo.sqlite` — owner modul `lib/saldo/*` lewat koneksi singleton `lib/saldo/shared.js`; SEMUA mutasi wajib `withSaldoWriteLock` (anti double-spend).
- Riwayat broadcast: `database/broadcast.sqlite` — owner `repositories/broadcast.repository.js` (riwayat kirim + `sent_user_ids_json` daftar penerima).
- Penjualan/tracking voucher: `database/voucher.sqlite` — owner `repositories/voucher-tracking.repository.js`; rekonsiliasi `lib/cron/jobs/voucher-reconcile.js`.
- Log kejadian OLT durable: `database/olt_events.sqlite` — owner `lib/olt-event-logger.js` (dedup ber-STATE); dibaca halaman `/olt-log`, LOS broadcaster, dan gerbang mati-listrik CCTV.
- State modem OLT (Event→Insiden→Verdict): `database/olt_state.sqlite` — proyeksi `lib/olt-incident-projector.js`; read API `/api/olt/modem-state` + `/api/olt/diagnosis`; gate `config.oltModemState`.
- Papan PSB terjadwal: `database/psb_schedule.sqlite` — owner `lib/psb-schedule-service.js` (lifecycle menunggu→ditugaskan→terpasang→batal, ref `PSB-<n>`).
- Metrik monitoring: `database/monitoring_metrics.sqlite` — owner `lib/monitoring-service.js`.
- Audit isolir: `database/isolir_audit.sqlite` — owner `lib/services/isolir-audit-repository.js`.
- Keuangan PRIBADI owner: `database/personal_finance.sqlite` (tabel `pf_entries` — 1 baris = 1 catatan masuk/keluar + kategori + asal `wa`/`web`). Owner `repositories/personal-finance.repository.js`; ditulis perintah WA TANPA prefix `keluar`/`masuk`/`uang` (`message/handlers/personal-finance-wa.js`) & halaman `/keuangan-pribadi` (`routes/admin-personal-finance-routes.js`); gate `config.personalFinance.enabled` (default OFF) + `ownerJids` (WA, BUKAN `ownerNumber`/role). Halaman webnya punya OTENTIKASI SENDIRI: `database/personal_finance_auth.json` (owner `lib/personal-finance-auth.js`, bcrypt + rahasia sesi terpisah, cookie `pf_session`, disiapkan lewat `scripts/set-keuangan-pribadi-password.js`) — sesi admin TIDAK memberi akses, dan sebaliknya. Path via `getDatabasePath('personal_finance.sqlite')`. **Bukan** saldo pelanggan dan SENGAJA di luar backup Telegram grup. Bukan di-bootstrap `lib/database.js`.
- Watcher data aktif: minimal `announcements.json` dan `news.json` untuk reload runtime.
- Lokasi fallback legacy: `config.json` dipakai bila resolver env-aware gagal load config.

## Integrasi Eksternal
- WhatsApp Multi-Device via Baileys.
- Mikrotik / PPPoE / voucher / WiFi device adapters di `lib/mikrotik*`, `lib/wifi.js`, dan route API jaringan.
- iPaymu untuk pembayaran/topup/tagihan. Dua mode dipakai: QRIS-direct in-chat (voucher/topup) dan multi-channel via halaman portal sendiri `/bayar/:token` (tagihan bulanan: QRIS/VA/retail, channel dinamis dari `GET /payment-channels`). Semua callback masuk ke `POST /callback/payment` (verify server-to-server `checkTransaction` sebelum kredit). `lib/ipaymu.js` punya retry koneksi-fresh anti dual-WAN.
- **Multi-gateway bayar tagihan** (config `paymentGateway`: `ipaymu` default | `tripay` | `mayar`) via selector `lib/payment-gateways.js` (interface `chargeRedirect`/`verify`). Tripay (`lib/tripay.js`) & **Mayar (`lib/mayar.js`, base prod `api.mayar.id/hl/v1` · sandbox `api.mayar.club/hl/v1`)** = adapter redirect hosted auto-settle; callback masing-masing `POST /callback/tripay` & `POST /callback/mayar` (verify S2S sebelum kredit). Kredensial di halaman Setting. ⚠️ Mayar: field status-paid & korelasi webhook masih perlu diverifikasi via sandbox sebelum diaktifkan untuk pelanggan asli; voucher/topup masih iPaymu.
- SNMP/OLT monitoring untuk perangkat jaringan/ONT.
- Router gateway upstream (RouterOS API, kredensial `config.upstreamMonitor`): probe ping policy-routed per routing-table (WAJIB routing-table, BUKAN `interface=` — metode interface= terbukti memberi vonis loss palsu) via bridge `views/upstream_quality_probe.php` yang di-spawn `lib/upstream-quality-poller.js`.
- Router gateway — **jalur TULIS switch koneksi** (kredensial `config.wanSwitch` → fallback `config.upstreamMonitor`): enable/disable route default (0.0.0.0/0) untuk mengalihkan trafik antar-ISP instan, via bridge `views/mikrotik_route_switch.php` (mode `status`/`plan` read + `apply` write) yang di-spawn `lib/wan-switch-service.js`. Hanya switch TERDAFTAR di `config.wanSwitch.switches` (allowlist) yang boleh dijalankan; tiap apply plan-verify dulu (abort bila matcher tak menemukan route = anti topology-drift).
- GenieACS untuk provisioning/ACS pelanggan.
- Telegram backup untuk arsip database.
- Telegram bot teknisi (incoming long-poll `getUpdates`, single-consumer): teknisi cek redaman (modem GenieACS + OLT SNMP)/koneksi/modem/olt pelanggan. Token WAJIB beda dari Telegram backup (hindari konflik 409). Owner: `lib/telegram/*`, handler `message/telegram/*`, panel `/telegram-teknisi`.
- Socket.IO untuk status realtime portal.
- `php-express` untuk bridge halaman/endpoint PHP legacy.
- Cloudflare Tunnel disebut sebagai terminasi HTTPS reverse proxy; enforcement HTTPS lokal dimatikan. Express `trust proxy` disetel di `lib/http-app.js` (default `loopback`, override via `config.trustProxy`) agar `req.ip` & `express-rate-limit` membaca IP klien asli dari X-Forwarded-For — bukan alamat tunnel.

## Direktori Inti
- `message/`: router bot dan handler percakapan WhatsApp.
- `lib/`: engine bisnis, adaptor integrasi, workflow, helper, service.
- `routes/`: HTTP controller/API/admin/customer portal.
- `scripts/`: migrasi, backup, debug OLT, utilitas operasi.
- `config/`: command map, pesan, monitoring.
- `database/`: SQLite dan JSON operasional.

## Boundary Refactor Baru (indeks)

Log lengkapnya dipindah ke **[docs/boundary-log.md](docs/boundary-log.md)** — dulu ia menyumbang 93% isi file ini
dan dibaca ulang setiap sesi tanpa perlu. Buka HANYA entri yang relevan dengan yang sedang kamu sentuh.

**Aturan menambah entri** (detail di skill `system-map-sync`): badan entri (<8 baris) ditulis di `docs/boundary-log.md`
dengan anchor `<a id="bNNN"></a>` = nomor tertinggi saat ini + 1 — anchor WAJIB unik (pernah dobel dan indeks jadi
menyesatkan). Di file ini cukup SATU baris `- [judul heading entri](docs/boundary-log.md#bNNN)`, ditaruh di urutan
terakhir. Baris indeks BUKAN ringkasan fitur — kalau pembaca butuh konteks, ia membuka entrinya.

- [`routes/bill-payment.js` + `lib/bill-pay-token.js` + `lib/services/bill-payment-settlement.js`](docs/boundary-log.md#b01)
- [`lib/services/advance-payment-service.js`](docs/boundary-log.md#b02)
- [Beli Voucher Online (publik)](docs/boundary-log.md#b03)
- [Site Publik Anonim (listener HTTP kedua, 1 proses)](docs/boundary-log.md#b04)
- [Portal Publik Terpadu (multi-bot, proxy)](docs/boundary-log.md#b05)
- [Tandai Gratis (waiver)](docs/boundary-log.md#b06)
- [`repositories/message-log.repository.js`](docs/boundary-log.md#b07)
- [Log Gangguan OLT + LOS→grup](docs/boundary-log.md#b08)
- [Auto-tiket dari LOS](docs/boundary-log.md#b09)
- [Verifikasi LOS↔DG via scrape web OLT](docs/boundary-log.md#b10)
- [`lib/app-runtime.js`](docs/boundary-log.md#b11)
- [`lib/routes-registry.js`](docs/boundary-log.md#b12)
- [`lib/domain-events.js`](docs/boundary-log.md#b13)
- [`lib/whatsapp-gateway.js`](docs/boundary-log.md#b14)
- [`lib/whatsapp-bootstrap.js`](docs/boundary-log.md#b15)
- [`lib/whatsapp-inbound-adapter.js`](docs/boundary-log.md#b16)
- [`lib/process-lifecycle.js`](docs/boundary-log.md#b17)
- [`message/handlers/reply-runtime.js`](docs/boundary-log.md#b18)
- [`routes/admin-router.js`](docs/boundary-log.md#b19)
- [`services/payment-approval.service.js` + `routes/requests.js`](docs/boundary-log.md#b20)
- [`services/payment-flow.service.js` + `repositories/payment.repository.js` + `message/handlers/payment-processor-handler.js`](docs/boundary-log.md#b21)
- [`routes/api-users-routes.js` + `services/api-users.service.js` + `repositories/api-users.repository.js`](docs/boundary-log.md#b22)
- [`routes/api-voucher-routes.js` + `services/api-voucher.service.js` + `repositories/api-voucher.repository.js`](docs/boundary-log.md#b23)
- [Voucher: dashboard penjualan + notif terjual + badge Terlaris](docs/boundary-log.md#b24)
- [Cetak Voucher mandiri](docs/boundary-log.md#b25)
- [`routes/api-network-routes.js` + `services/api-network.service.js` + `repositories/api-network.repository.js`](docs/boundary-log.md#b26)
- [`routes/api-psb-routes.js` + `services/api-psb.service.js` + `repositories/api-psb.repository.js`](docs/boundary-log.md#b27)
- [`routes/admin.routes.js`](docs/boundary-log.md#b28)
- [`repositories/voucher.repository.js`](docs/boundary-log.md#b29)
- [`routes/admin-wifi-ops-routes.js` + `services/network-ops.service.js` + `repositories/wifi.repository.js`](docs/boundary-log.md#b30)
- [`routes/admin-config-routes.js` + `services/genieacs-parameter-config.service.js` + `services/mikrotik-device-config.service.js`](docs/boundary-log.md#b31)
- [`routes/admin-content-routes.js` + `services/wifi-template-config.service.js` + `services/admin-broadcast.service.js`](docs/boundary-log.md#b32)
- [`routes/admin-content-routes.js` + `views/sb-admin/templates.php`](docs/boundary-log.md#b33)
- [`database/response_templates.json`](docs/boundary-log.md#b34)
- [`repositories/auto-outage.repository.js` + `services/auto-outage-*.service.js` + `routes/admin-auto-outage-routes.js` + `views/sb-admin/auto-outage.php`](docs/boundary-log.md#b35)
- [`database/response_templates.json` + `message/handlers/raf-intent-dispatch.js` + `message/handlers/agent.js` + `message/handlers/monitoring-handler.js`](docs/boundary-log.md#b36)
- [`database/response_templates.json` + `message/handlers/agent.js`](docs/boundary-log.md#b37)
- [`database/response_templates.json` + `message/handlers/states/other-state-handler.js` + `message/handlers/states/report-state-handler.js`](docs/boundary-log.md#b38)
- [`database/response_templates.json` + `message/handlers/domains/reporting.domain.js` + `message/handlers/steps/general-steps.js`](docs/boundary-log.md#b39)
- [`database/response_templates.json` + `routes/public.js` + `routes/saldo.js` + `routes/tickets.js` + `services/admin.service.js` + `lib/report-notification-service.js`](docs/boundary-log.md#b40)
- [`database/response_templates.json` + `lib/topup-expiry.js` + `lib/psb-notification.js` + `lib/alert-system.js` + `routes/tickets.js`](docs/boundary-log.md#b41)
- [`database/response_templates.json` + `lib/services/profile-update-service.js` + `lib/services/customer-service.js` + `lib/services/speed-request-service.js` + `lib/services/report-service.js` + `routes/speed-requests.js` + `routes/requests.js`](docs/boundary-log.md#b42)
- [`database/response_templates.json` + `message/handlers/smart-report-text-menu.js` + `message/handlers/smart-report-handler.js` + `message/handlers/ticket-process-handler.js` + `message/handlers/teknisi-workflow-handler.js`](docs/boundary-log.md#b43)
- [`services/wifi-management.service.js` + `repositories/wifi.repository.js` + `message/handlers/wifi-management-handler.js`](docs/boundary-log.md#b44)
- [`routes/admin-ops-routes.js` + `services/admin-ops.service.js` + `repositories/admin-ops.repository.js`](docs/boundary-log.md#b45)
- [`routes/admin-database-routes.js` + `services/admin-database-ops.service.js`](docs/boundary-log.md#b46)
- [`routes/admin.js`](docs/boundary-log.md#b47)
- [`routes/payment-status.js` + `lib/payment-finance-service.js`](docs/boundary-log.md#b48)
- [`lib/paid-flag-reconcile.js`](docs/boundary-log.md#b49)
- [`routes/arrears.js` + `services/arrears.service.js` + `repositories/arrears.repository.js`](docs/boundary-log.md#b50)
- [`lib/runtime-state.js` + `lib/runtime-repositories.js`](docs/boundary-log.md#b51)
- [`repositories/runtime-cache.repository.js`](docs/boundary-log.md#b52)
- [`message/handlers/bot-context.js`](docs/boundary-log.md#b53)
- [`message/handlers/conversation-state-owner-map.js`](docs/boundary-log.md#b54)
- [`message/handlers/simple-location-handler.js`](docs/boundary-log.md#b55)
- [`message/handlers/teknisi-workflow-handler.js`](docs/boundary-log.md#b56)
- [`message/raf.js`](docs/boundary-log.md#b57)
- [`message/handlers/conversation-state-handler.js` + `message/handlers/states/*.js`](docs/boundary-log.md#b58)
- [`message/handlers/template-helpers.js` + `database/response_templates.json`](docs/boundary-log.md#b59)
- [`message/handlers/saldo-handler.js` + `message/handlers/wifi-history-handler.js` + `message/handlers/photo-upload-queue.js` + `message/handlers/photo-workflow-handler.js` + `message/handlers/states/wifi-name-state-handler.js`](docs/boundary-log.md#b60)
- [`lib/response-template-helper.js`](docs/boundary-log.md#b61)
- [`message/handlers/raf-intent-dispatch.js` + `message/handlers/raf-intent-dispatch/{index,conversation-intents,menu-intents,reporting-intents,ticket-customer-intents,ticket-teknisi-intents,status-mikrotik-intents,saldo-intents,agent-intents,wifi-intents,network-admin-intents,customer-service-intents,owner-admin-intents,verification-intents}.js`](docs/boundary-log.md#b62)
- [`lib/template-service.js` + `lib/template-manager.js` + `lib/message-template-helper.js`](docs/boundary-log.md#b63)
- [`services/admin-ops.service.js` + `routes/admin-ops-routes.js`](docs/boundary-log.md#b64)
- [`services/api-users.service.js` + `services/api-users/{default-deps,list-users-integrity,update-user-payment-status,delete-user-by-id,delete-all-users,create-user,create-user-validate,create-user-mikrotik-sync,create-user-persist,update-user-by-id}.js`](docs/boundary-log.md#b65)
- [`lib/saldo-manager.js` + `lib/saldo/{shared,saldo-repository,balance-operations,transfer-operations,transactions-store,topup-store}.js` + `message/handlers/balance-management-handler.js`](docs/boundary-log.md#b66)
- [`lib/cron.js` + `lib/cron/shared.js` + `lib/cron/jobs/{reminder,set-unpaid,isolir,isolir-notification,compensation-revert,speed-revert,redaman-check,telegram-backup}.js`](docs/boundary-log.md#b67)
- [`lib/security.js` + `lib/__tests__/security.test.js`](docs/boundary-log.md#b68)
- [`routes/tickets.js` + `routes/tickets-shared.js` + `routes/tickets-list-routes.js` + `routes/tickets-workflow-routes.js` + `routes/tickets-photo-routes.js` + `routes/tickets-admin-routes.js` + `routes/tickets-customer-routes.js`](docs/boundary-log.md#b69)
- [`lib/olt-ssh-client.js` + `lib/olt-zte-provision.js` + `lib/olt-provision-store.js` + `lib/olt-backup.js` + `lib/cron/jobs/olt-backup.js` + `routes/olt-provisioning.js` + `views/sb-admin/admin-olt-provision.php`](docs/boundary-log.md#b70)
- [Fitur 2026-06-16 (ACS/TR069 retrofit dari web admin)](docs/boundary-log.md#b71)
- [Fitur 2026-06-16 (profil tipe modem DIKALIBRASI ulang dari konfig NYATA VANS + auto-pilih anti-salah-klik)](docs/boundary-log.md#b72)
- [Revamp UX provisioning (2026-06-16, lanjutan)](docs/boundary-log.md#b73)
- [Fitur 2026-06-15 (CCTV discovery dari netwatch, READ-ONLY)](docs/boundary-log.md#b74)
- [Bugfix 2026-06-15 (konfirmasi voucher_sale)](docs/boundary-log.md#b75)
- [Bugfix 2026-06-14 (reboot + voucher urgent)](docs/boundary-log.md#b76)
- [Fitur 2026-06-20 (self-service "Cek Koneksi" pelanggan — Slice 1)](docs/boundary-log.md#b77)
- [Fitur 2026-06-20 (Dashboard Kesehatan OLT — web admin, read-only)](docs/boundary-log.md#b78)
- [Fitur 2026-06-20 (Health OLT via SNMP bebas-lockout + Konsol `show` read-only)](docs/boundary-log.md#b79)
- [Fitur 2026-06-22 (Manajemen VLAN OLT via web — config-write ter-guard)](docs/boundary-log.md#b80)
- [Fitur 2026-06-22 (Service-port per-ONU via web — config-write PER-PELANGGAN ter-guard)](docs/boundary-log.md#b81)
- [Fitur 2026-06-22 (Monitoring bandwidth per-PON & uplink — READ-ONLY + histori/grafik)](docs/boundary-log.md#b82)
- [Perf/Fix 2026-06-22 (health "stuck" + percepat fetch OLT)](docs/boundary-log.md#b83)
- [Verif "klop" monitor OLT + percepat fetch SNMP 2026-06-22](docs/boundary-log.md#b84)
- [Bedah ZTE C320 offline-cause + AKTIFKAN LOS broadcast 2026-06-22](docs/boundary-log.md#b85)
- [Jam OLT (NTP) + UI Penyebab/Online-Duration 2026-06-22](docs/boundary-log.md#b86)
- [Bot Telegram teknisi (Fase 1, READ-ONLY) 2026-06-22](docs/boundary-log.md#b87)
- [Fitur 2026-06-23 (Pemisahan akun infrastruktur dari data pelanggan)](docs/boundary-log.md#b88)
- [Fitur 2026-06-23 (Role "agen" — penagih pembayaran berbasis fee)](docs/boundary-log.md#b89)
- [Fitur 2026-06-29 (Lifecycle penagihan bertingkat — tahap "masa tenggang")](docs/boundary-log.md#b90)
- [Fitur 2026-06-29 (Bayar tagihan mode HOSTED iPaymu — opsi halaman gateway, bukan portal sendiri)](docs/boundary-log.md#b91)
- [Fitur 2026-06-30 (Multi-payment-gateway — Tripay sbg adapter ke-2, alur bayar tagihan)](docs/boundary-log.md#b92)
- [Fitur 2026-07-04 (Broadcast Tagihan — kirim pesan pembayaran ke pelanggan terpilih)](docs/boundary-log.md#b93)
- [Fitur 2026-07-04 (Intake PSB via Grup WhatsApp — Fase 1 dari rencana simplifikasi PSB)](docs/boundary-log.md#b94)
- [Fix 2026-07-04 (GenieACS waktu registrasi: baca `_registered` root, BUKAN `Events.Registered`)](docs/boundary-log.md#b95)
- [Semantik pesan selamat datang (JANGAN keliru): `${username}`/`${password}` = login PORTAL PELANGGAN, BUKAN PPPoE](docs/boundary-log.md#b96)
- [Fitur 2026-07-04 (PSB Fase 2 — wizard PSB via DM teknisi + auto-provision modem, gate konfirmasi)](docs/boundary-log.md#b97)
- [Fix 2026-07-09 (PSB risk hardening — welcome jujur + anti-orphan Fase 3)](docs/boundary-log.md#b98)
- [Fitur 2026-07-05 (Notif grup perbaikan + perintah `tutorial teknisi`)](docs/boundary-log.md#b99)
- [Fix 2026-07-06 (cek-wifi pelanggan gagal beruntun — refresh berat men-trip circuit breaker GLOBAL)](docs/boundary-log.md#b100)
- [Fix 2026-07-06 (root domain `/` auto-forward per peran — bukan 403 "khusus Administrator")](docs/boundary-log.md#b101)
- [Fitur 2026-07-07 (Asisten pelanggan Gelombang 1 — matcher longgar korpus + fallback anti-diam + jalur wizard sandi)](docs/boundary-log.md#b102)
- [Fitur 2026-07-07 (Monitor kualitas jalur upstream per-paket — collector Fase 1)](docs/boundary-log.md#b103)
- [Fitur 2026-07-07 (Switch koneksi WAN instan — dari deteksi ke kendali)](docs/boundary-log.md#b104)
- [Fitur 2026-07-07 (Monitoring reachability per-LAYANAN per-JALUR — TCP+TLS via source-IP steering)](docs/boundary-log.md#b105)
- [Fitur 2026-07-07 (Auto-pilot jaringan — failover WAN otomatis + agregasi komplain pelanggan)](docs/boundary-log.md#b106)
- [Fitur 2026-07-07 (Perintah WA `data <isp>` — rangkuman ISP on-demand utk owner/admin)](docs/boundary-log.md#b107)
- [Fitur 2026-07-08 (Panel web kustomisasi ARAH monitor — target/layanan/jalur/thresholds)](docs/boundary-log.md#b108)
- [Fitur 2026-07-08 (Steering Pelanggan per-ISP — visibilitas live + kendali web)](docs/boundary-log.md#b109)
- [Fitur 2026-07-08 (Diagnosa app-aware — "halo AI" buatan sendiri, jawaban spesifik per aplikasi)](docs/boundary-log.md#b110)
- [Fitur 2026-07-09 (Notif PULIH LOS — menutup alarm yang tergantung)](docs/boundary-log.md#b111)
- [Fitur 2026-07-09 (Konfirmasi Bukti Pembayaran — foto bukti transfer pelanggan → 1-klik lunas)](docs/boundary-log.md#b112)
- [Fitur 2026-07-10 (Konfirmasi Bukti Pembayaran DARI WHATSAPP — menutup jalur admin yang buntu)](docs/boundary-log.md#b113)
- [Fitur 2026-07-10 (Konfirmasi bukti bayar WA — mode "nol ketik kode")](docs/boundary-log.md#b114)
- [Fitur 2026-07-10 (Reboot berbantu + tindak lanjut yang MEMBUKTIKAN)](docs/boundary-log.md#b115)
- [Fitur 2026-07-10 (Tindak lanjut saat PELANGGAN restart modemnya sendiri)](docs/boundary-log.md#b116)
- [Fitur 2026-07-11 (Digest anti-spam notifikasi pengajuan pembayaran)](docs/boundary-log.md#b117)
- [Fitur 2026-07-11 (CCTV sadar-modem — tahan broadcast saat mati listrik area)](docs/boundary-log.md#b118)
- [Fitur 2026-07-12 (Broadcast Terarah — pilih template + pelanggan tertentu)](docs/boundary-log.md#b119)
- [Fitur 2026-07-13 (Resolver jalur baca PROFIL live freedns/lokaldns + monitor drift)](docs/boundary-log.md#b120)
- [Fitur 2026-07-13 (Oper koneksi per-SEGMEN — Track B Slice B1: read/dry-run)](docs/boundary-log.md#b121)
- [Fitur 2026-07-13 (Oper koneksi per-SEGMEN — Track B Slice B2: apply + verify + rollback)](docs/boundary-log.md#b122)
- [Fitur 2026-07-13 (Perintah WA `oper <segmen> ke <jalur>` — surface Track B)](docs/boundary-log.md#b123)
- [Fitur 2026-07-13 (Track B/B3 — `oper` diperluas ke per-PELANGGAN /32)](docs/boundary-log.md#b124)
- [Fitur 2026-07-13 (Web admin: kartu "Oper Segmen" — paritas dengan perintah WA)](docs/boundary-log.md#b125)
- [Fitur 2026-07-13 (Rapikan navbar: IA 5-seksi admin + CSS/JS sidebar ke statik bersama)](docs/boundary-log.md#b126)
- [Fitur 2026-07-13 (PSB terjadwal — Fase A/1: WA #jadwal → papan + notif grup)](docs/boundary-log.md#b127)
- [Fitur 2026-07-13 (P0 upstream: "Terdampak" alert + klaster komplain → data LIVE, buang peta statis)](docs/boundary-log.md#b128)
- [Fitur 2026-07-14 (PSB terjadwal — Fase B/1: assignment WEB, admin TUGASKAN / teknisi AMBIL)](docs/boundary-log.md#b129)
- [Fitur 2026-07-14 (PSB terjadwal — Fase B/2: perintah WA ambil / tugaskan / papan)](docs/boundary-log.md#b130)
- [Fitur 2026-07-14 (PSB terjadwal — Fase C/1: #PSB tutup jadwal → terpasang + rangkuman 1 sumber)](docs/boundary-log.md#b131)
- [Fitur 2026-07-14 (PSB terjadwal — Fase C/2: pre-fill #PSB PSB-<n> dari jadwal papan)](docs/boundary-log.md#b132)
- [Fitur 2026-07-14 (PSB terjadwal — S3: pensiun web PSB 3-fase legacy)](docs/boundary-log.md#b133)
- [Fitur 2026-07-14 (Kustomisasi TAMPILAN report "data <isp>" — daftar terdampak lengkap + on/off seksi)](docs/boundary-log.md#b134)
- [Fitur 2026-07-14 (Komisi marketing PSB — Fase 1: catat pemberi lead + nominal, deploy gelap)](docs/boundary-log.md#b135)
- [Fitur 2026-07-14 (Menu OWNER WA di-generate dari katalog — anti-basi + daftar ISP dinamis)](docs/boundary-log.md#b136)
- [Fitur 2026-07-14 (Komisi marketing PSB — Fase 2a: bayar pemberi lead LUAR via kas)](docs/boundary-log.md#b137)
- [Fitur 2026-07-14 (Owner Cockpit web — beranda ringkasan sekali-baca owner)](docs/boundary-log.md#b138)
- [Fitur 2026-07-14 (Komisi marketing PSB — Fase 2b: komisi TEKNISI masuk payroll)](docs/boundary-log.md#b139)
- [Fitur 2026-07-14 (Komisi marketing PSB — Fase 3: halaman Laporan Marketing PSB per pemberi lead)](docs/boundary-log.md#b140)
- [Fitur 2026-07-14 (Owner Cockpit — pengayaan: tunggakan/pelunasan/MRR + kartu Pelanggan & Perlu Tindakan)](docs/boundary-log.md#b141)
- [Fitur 2026-07-14 (Owner Cockpit — tren MoM + offline presisi + redesign elegan dark-aware)](docs/boundary-log.md#b142)
- [Fitur 2026-07-14 (Owner Cockpit fix — status tiket + route /admin/daftar-tiket 500 + timestamp)](docs/boundary-log.md#b143)
- [Fitur 2026-07-14 (Bukti bayar — aksi HAPUS untuk bukti PALSU, beda dari tolak)](docs/boundary-log.md#b144)
- [Fitur 2026-07-14 (Gratis bulan pemasangan — auto saat PSB + halaman /gratis-bulan-ini)](docs/boundary-log.md#b145)
- [Bugfix 2026-07-14 (KRITIS: INSERT pelanggan membuang kolom senyap — created_at/lokasi/kredensial hilang)](docs/boundary-log.md#b146)
- [Bugfix 2026-07-14 (Share lokasi PSB tak tersimpan — ctx.lokasi tak pernah dikirim ke create API)](docs/boundary-log.md#b147)
- [Bugfix 2026-07-14 (Owner Cockpit: kartu isolir SELALU 0 — dihitung dari users.status yang tak pernah ditulis)](docs/boundary-log.md#b148)
- [Fitur 2026-07-14 (Aset jaringan: teknisi memetakan ODC/ODP dari WhatsApp + fondasi port/kapasitas/validasi dibereskan)](docs/boundary-log.md#b149)
- [Fitur 2026-07-14 (Menata ODP dari lapangan: sambungkan pelanggan lewat WA — nomor ATAU nama, tanpa butuh GPS)](docs/boundary-log.md#b150)
- [Bugfix 2026-07-15 (Intake bukti bayar: foto keluhan/koordinasi salah-tangkap jadi "bukti pembayaran" — gerbang uang + jejak admin durabel)](docs/boundary-log.md#b151)
- [Bugfix 2026-07-15 (Gerbang bukti bayar #b151: pengecualian ISOLIR belum berlaku di cabang caption → foto "internet mati" dari pelanggan terisolir tertelan jadi keluhan)](docs/boundary-log.md#b152)
- [Fitur 2026-07-18 (Survei kepuasan pelanggan bulanan / CSAT — kirim rating 1-5, tangkap balasan DURABEL, rekap owner; deploy GELAP)](docs/boundary-log.md#b153)
- [Fitur 2026-07-18 (CSAT #b153 GO-LIVE 2 bot: alert detractor real-time + nomor HP di rekap + mode uji testPhone)](docs/boundary-log.md#b154)
- [Fitur 2026-07-18 (Halaman web admin Survei Kepuasan `/survei` — rangkuman CSAT on-demand)](docs/boundary-log.md#b155)
- [Fitur 2026-07-18 (Anti-ban broadcast: jitter + batch + cap + circuit-breaker + ledger di `sendQueueWithRetry`)](docs/boundary-log.md#b156)
- [Fitur 2026-07-18 (Spintax: variasi isi pesan `{a|b|c}` anti-ban di render template)](docs/boundary-log.md#b157)
- [Fitur 2026-07-18 (Opt-out survei balas-STOP survey-scoped + validasi onWhatsApp anti-ban)](docs/boundary-log.md#b158)
- [Fitur 2026-07-19 (CSAT web-managed: jadwal survei di halaman Cron + tombol "Kirim Survei Sekarang")](docs/boundary-log.md#b159)
- [Fix 2026-07-19 (CSAT: tutup celah balasan survei bocor → rating hilang + reboot salah picu; + pemulihan)](docs/boundary-log.md#b160)
- [Fix 2026-07-19 (CS: tutup miss deteksi cek-koneksi + keamanan reboot — data-driven korpus prod)](docs/boundary-log.md#b161)
- [Fix 2026-07-19 (UI: token semantik sadar-mode + guard — akar "halaman baru selalu gelap-di-gelap")](docs/boundary-log.md#b162)
- [Feat 2026-07-20 (Request ganti paket: keputusan admin langsung dari WhatsApp — ok / tolak / batalkan)](docs/boundary-log.md#b163)
- [Feat 2026-07-20 (LOS: gerbang MATI-LISTRIK-AREA anti salah-vonis "fiber putus" + notif pelanggan ramah + notif pulih pelanggan)](docs/boundary-log.md#b164)
- [Feat 2026-07-21 (PSB: alamat & dusun jadi field sendiri + gerbang modem copotan)](docs/boundary-log.md#b165)
- [Feat 2026-07-21 (Peta berhenti berbohong: JALUR kabel yang mengikuti jalan — endpoint waypoint yang hilang + rekam jalur dari WhatsApp)](docs/boundary-log.md#b166)
- [Feat 2026-07-21 (Kartu bantuan aset + gagal-senyap gerbang staf ditutup)](docs/boundary-log.md#b167)
- [Fix+Feat 2026-07-21 (Peta jaringan: tiga penyaring yang saling menimpa disatukan + ODP melapor sendiri)](docs/boundary-log.md#b168)
- [Fix+Feat 2026-07-21 (Template pesan: guard integritas key + Speed on Demand pindah ke state domain)](docs/boundary-log.md#b169)
- [Fitur 2026-07-13 (PSB terjadwal — Fase A/2: form + papan WEB, paritas WA #jadwal)](docs/boundary-log.md#b170)
- [Feat 2026-07-21 (Titik lokasi pelanggan: satu gerbang untuk WA teknisi, web admin, dan pin pelanggan)](docs/boundary-log.md#b171)
- [Fix 2026-07-21 (Panel pelanggan: gagal-GPS tak lagi menstempel koordinat default)](docs/boundary-log.md#b172)
- [Fix 2026-07-22 (Penataan rules: indeks boundary diregenerasi + guard integritas + sapu rule-sprawl)](docs/boundary-log.md#b173)
- [Feat 2026-07-22 (Otomasi anti-basi dokumen: guard docs↔kode + pre-push gate + hook diperluas + guard tema masuk npm test)](docs/boundary-log.md#b174)
- [Feat 2026-07-23 (Keuangan pribadi owner menumpang nomor bot — domain terisolasi penuh)](docs/boundary-log.md#b175)
- [Feat 2026-07-23 (Keuangan pribadi: perintah tanpa prefix + login halaman TERPISAH dari akun admin)](docs/boundary-log.md#b176)
- [Feat 2026-07-23 (Kas usaha via WhatsApp — menumpang expense-manager, BUKAN pembukuan kedua)](docs/boundary-log.md#b177)
- [Fix 2026-07-23 (Backup lokal dompet pribadi — menutup risiko kehilangan permanen)](docs/boundary-log.md#b178)
- [Feat 2026-07-23 (Biaya rutin usaha: bot mengingatkan, manusia mengonfirmasi + halaman /kas-usaha)](docs/boundary-log.md#b179)
- [Fix 2026-07-26 (Ganti sandi/nama WiFi: payload kosong dilaporkan "Berhasil" — penjaga bukti-mendarat)](docs/boundary-log.md#b180)
- [Beli Voucher dari Panel Pelanggan (terautentikasi, tag `buynowpanel`)](docs/boundary-log.md#b181)
- [Fix 2026-07-26 (`/app/voucher` anonim membocorkan hargaReseller & margin)](docs/boundary-log.md#b182)
- [Redesign admin+teknisi Tahap 4 (`.card` disatukan, palet SB-Admin pensiun, guard mode gelap diperluas)](docs/boundary-log.md#b183)
- [Fix 2026-07-29 (Setelan tampilan invoice tak pernah diterapkan + reset senyap jatuh tempo)](docs/boundary-log.md#b184)
- [Fix 2026-07-29 (`/voucher-sales` 404 di kedua bot — gerbang default-aktif memakai cek truthy)](docs/boundary-log.md#b185)
- [Fix 2026-07-29 (Grafik trafik tak pernah dapat data: endpoint 11 dtk vs abort 8 dtk → endpoint ringan sendiri + skala kerapatan ponsel)](docs/boundary-log.md#b186)
- [Fix 2026-07-31 (Satu pemilik verdict gangguan area + gerbang gangguan-massal auto outage)](docs/boundary-log.md#b187)
- [Fix 2026-07-31 (Pesan gangguan area bocorkan jumlah pelanggan terdampak)](docs/boundary-log.md#b188)
- [Fix 2026-07-31 (Monitor OLT menyajikan data basi/setengah jadi sebagai fakta)](docs/boundary-log.md#b189)
- [Feat 2026-07-31 (Laporan verifikasi pasca-perbaikan ke grup — angka nyata per pelanggan terdampak)](docs/boundary-log.md#b190)
- [Fix 2026-07-31 (Broadcast GAMAS: penjaga data internal sebelum teks keluar ke pelanggan)](docs/boundary-log.md#b191)
- [Fix 2026-07-31 (Pembacaan OLT sebagian disulap jadi vonis "semua pelanggan mati")](docs/boundary-log.md#b192)
- [Fix 2026-07-31 (Walk SNMP yang GAGAL tak lagi tertukar dengan walk yang memang kosong)](docs/boundary-log.md#b193)
- [Fix 2026-08-01 (Pembacaan OLT jujur sampai ke layar: pembatas waktu ikut config, OLT bisu tak lagi jadi vonis "Offline")](docs/boundary-log.md#b194)
- [Fix 2026-08-02 (PSB buntu: modem polos divonis "TERPAKAI pelanggan lain", dan SN di layar beda tulisan dengan stiker)](docs/boundary-log.md#b195)

## Catatan cakupan
- Subfolder `lib/services`, `lib/middleware`, `public`, `views`, `tools`, dan `static` belum dipetakan rinci di peta ini.
- Lokasi final secret `.env`/token tidak ditrace dari isi file.
