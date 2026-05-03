/**
 * Header Doc
 * Purpose: Tech Spec fitur auto outage broadcast berbasis PPPoE MikroTik dengan deteksi presisi database-first dan triage WhatsApp interaktif.
 * Caller: Pengembang/agent sebelum memecah implementasi dengan skill `writing-plans`.
 * Deps: `SYSTEM_MAP.md`, `lib/.module_map.md`, `routes/.module_map.md`, `services/admin-broadcast.service.js`, `routes/admin-content-routes.js`, `lib/mikrotik.js`, `lib/whatsapp-delivery-service.js`, `lib/report-orchestration-service.js`.
 * MainFuncs: Mendefinisikan scope, phased delivery, arsitektur, data model, flow deteksi, flow percakapan, admin UI, ticket handoff, risiko, dan verifikasi.
 * SideEffects: Tidak ada; dokumen desain statis.
 */

# Tech Spec: Auto Outage Broadcast PPPoE MikroTik

## 1. Context

Project ini sudah memiliki boundary penting untuk broadcast admin, delivery WhatsApp, template pesan, tiket gangguan, dan API/admin route. Kebutuhan baru adalah membuat sistem otomatis yang mendeteksi pelanggan yang alatnya mati melebihi beberapa jam, lalu menghubungi pelanggan lewat WhatsApp untuk konfirmasi kondisi sebenarnya.

Sumber deteksi utama harus MikroTik PPPoE, bukan GenieACS, karena tidak semua pelanggan memakai GenieACS. Namun daftar pelanggan yang boleh diproses harus tetap berasal dari database project agar PPPoE di MikroTik yang tidak terdaftar di aplikasi tidak ikut dibroadcast.

## 2. Goal

Membangun fondasi fitur auto outage broadcast yang tepat, presisi, dan bisa dikustomisasi admin.

Target fase awal:

- Mendeteksi pelanggan database yang PPPoE-nya tidak aktif di MikroTik.
- Menggunakan `pppoe_username` sebagai kunci match utama.
- Mengambil `/ppp active` secara batch per router untuk efisiensi.
- Mengecek `last-logged-out` hanya untuk kandidat offline.
- Menyimpan state deteksi agar offline duration stabil dan auditable.
- Menampilkan dashboard admin sederhana untuk validasi presisi.
- Mengirim broadcast interaktif setelah rule memenuhi threshold admin.
- Menerima jawaban angka, teks, deskripsi bebas, foto, atau video.
- Membuat tiket hanya setelah pelanggan mengonfirmasi pengajuan tiket.

## 3. Non-Goals

Fase pertama tidak mencakup:

- Workflow builder penuh drag-and-drop.
- Broadcast recovery otomatis ketika pelanggan online kembali.
- Deteksi berbasis GenieACS sebagai sumber utama.
- Broadcast ke PPPoE yang tidak ada di database project.
- Auto-create ticket tanpa konfirmasi final pelanggan.
- Refactor besar seluruh monitoring atau tiket di luar kebutuhan fitur ini.

## 4. Recommended Approach

Pendekatan yang dipilih adalah **Rule Builder sederhana dengan detection foundation database-first**.

Alasan:

- Lebih aman daripada langsung membuat workflow builder penuh.
- Admin tetap bisa mengatur hal penting seperti threshold jam offline, interval scan, cooldown, target area/ODP/router/profile/custom filter, template pesan, opsi jawaban, permintaan bukti, dan konfirmasi tiket.
- Struktur data tetap bisa dikembangkan menjadi workflow builder penuh di fase berikutnya.
- Fase 1A bisa berjalan dry-run/manual trigger dulu agar presisi deteksi divalidasi sebelum broadcast otomatis aktif.

Alternatif yang ditolak:

- **Workflow Builder penuh**: terlalu besar untuk fase awal dan meningkatkan risiko salah broadcast.
- **Template global minimal**: terlalu kaku dan tidak sesuai kebutuhan admin yang ingin custom penuh.
- **GenieACS-first**: tidak cocok karena cakupan pelanggan tidak lengkap.

## 5. Phased Delivery

### 5.1 Fase 1A: Presisi Deteksi

Fokus fase ini adalah membuktikan data deteksi benar sebelum broadcast otomatis dinyalakan.

Deliverable:

- Service deteksi PPPoE offline.
- Persistence outage state.
- Endpoint admin read-only untuk melihat hasil scan.
- Manual scan endpoint untuk admin.
- Dry-run report: matched, online, offline candidate, skipped, unmatched.
- Tidak ada auto-broadcast default.

Acceptance criteria:

- Sistem hanya memproses pelanggan yang ada di database project.
- PPPoE aktif di MikroTik yang tidak match database diabaikan.
- Pelanggan tanpa `pppoe_username` di-skip dengan alasan jelas.
- `/ppp active` dipanggil sekali per router per scan interval.
- Detail PPP secret atau `last-logged-out` hanya dicek untuk kandidat offline.

### 5.2 Fase 1B: Broadcast Interaktif

Fokus fase ini adalah komunikasi WhatsApp yang informatif dan tetap terstruktur.

Deliverable:

- Rule builder sederhana di admin.
- Template dan pilihan jawaban customizable.
- Conversation state untuk jawaban pelanggan.
- Triage mapping dari angka, teks pendek, dan free-text.
- Dukungan foto/video sebagai bukti.
- Konfirmasi final sebelum tiket dibuat.
- Dashboard hasil triage.

Acceptance criteria:

- Broadcast hanya dikirim jika rule aktif dan threshold offline terpenuhi.
- Jawaban `aman` menutup incident pelanggan tanpa tiket.
- Jawaban `ada kendala` memulai triage lanjutan.
- Tiket hanya dibuat setelah pelanggan menjawab konfirmasi pengajuan tiket.
- Cooldown mencegah broadcast berulang ke pelanggan yang sama.

## 6. Target Architecture

### 6.1 New Bounded Context

Domain baru: `auto-outage-broadcast`.

Komponen utama:

- `services/auto-outage-detection.service.js`: orchestrator scan dan evaluasi status online/offline.
- `repositories/auto-outage.repository.js`: persistence state, scan audit, rule config, dan conversation state.
- `services/auto-outage-rule.service.js`: evaluasi rule admin dan eligibility broadcast.
- `services/auto-outage-conversation.service.js`: normalisasi jawaban pelanggan, triage, bukti media, dan konfirmasi tiket.
- `routes/admin-auto-outage-routes.js`: endpoint admin untuk scan, dashboard, rule config, dan manual broadcast.
- `message/handlers/state-domains/auto-outage-state-handler.js`: handler inbound WhatsApp untuk conversation state auto outage.
- `lib/cron/jobs/auto-outage-check.js`: optional scheduler setelah Fase 1A tervalidasi.

### 6.2 Integration Boundaries

- MikroTik access tetap lewat `lib/mikrotik.js` atau adapter kecil di bawah service, bukan langsung di route.
- WhatsApp outbound tetap lewat `lib/whatsapp-delivery-service.js` atau service broadcast yang sudah ada.
- Ticket handoff memakai service tiket/orchestration existing, bukan membuat format tiket sendiri di conversation handler.
- Admin route harus memakai `asyncHandler` dan tetap tipis.
- Tidak ada direct import Baileys di service, route, atau conversation handler.

## 7. Detection Flow

Flow deteksi per router:

1. Load pelanggan database dari runtime users repository.
2. Filter pelanggan yang punya `pppoe_username` valid.
3. Ambil `/ppp active print detail` sekali untuk router target.
4. Buat `Set(activeUsername)` dari hasil PPP active.
5. Untuk setiap pelanggan database:
   - Jika username ada di active set: status `online`, reset pending offline, simpan `recovered_at` jika sebelumnya offline.
   - Jika username tidak ada: tandai kandidat offline.
6. Untuk kandidat offline yang belum punya `offline_since` valid, ambil PPP secret detail untuk membaca `last-logged-out`.
7. Jika `last-logged-out` valid, pakai sebagai `offline_since`.
8. Jika `last-logged-out` kosong/tidak valid, pakai waktu deteksi pertama internal.
9. Evaluasi durasi offline terhadap rule threshold.
10. Simpan scan audit untuk dashboard.

Prinsip efisiensi:

- Satu query active list per router per interval.
- Query detail PPP secret hanya untuk kandidat offline.
- Kandidat yang sudah pending conversation tidak dicek detail berulang sebelum cooldown atau refresh window.
- State offline disimpan agar restart service tidak mengulang broadcast tanpa konteks.

## 8. Data Model

Persistence bisa memakai SQLite untuk audit dan state karena data bersifat queryable dan perlu difilter admin. JSON boleh dipakai hanya untuk config awal jika konsisten dengan pola project, tetapi SQLite lebih disarankan untuk state operasional.

### 8.1 `auto_outage_rules`

Field inti:

- `id`
- `name`
- `enabled`
- `router_id`
- `target_scope`: `all`, `area`, `odp`, `profile`, `custom`
- `target_filter_json`
- `offline_threshold_minutes`
- `scan_interval_minutes`
- `broadcast_cooldown_minutes`
- `max_broadcast_per_incident`
- `template_initial`
- `template_followup`
- `template_ticket_confirmation`
- `options_json`
- `require_media_for_categories_json`
- `auto_ticket_enabled`
- `created_at`
- `updated_at`

### 8.2 `auto_outage_states`

Field inti:

- `id`
- `user_id`
- `pppoe_username`
- `router_id`
- `status`: `online`, `offline`, `eligible`, `pending_confirmation`, `triage`, `ticket_confirm_pending`, `ticket_created`, `safe`, `no_response`, `recovered`
- `offline_since`
- `last_logged_out`
- `last_checked_at`
- `recovered_at`
- `broadcast_count`
- `last_broadcast_at`
- `conversation_id`
- `last_detection_reason`
- `skip_reason`
- `created_at`
- `updated_at`

### 8.3 `auto_outage_conversations`

Field inti:

- `id`
- `state_id`
- `user_id`
- `pppoe_username`
- `status`: `waiting_initial`, `waiting_detail`, `waiting_media`, `waiting_ticket_confirm`, `closed`
- `initial_answer_raw`
- `triage_category`: `aman`, `alat_mati`, `los_kabel`, `no_internet`, `lambat`, `lainnya`, `unknown`
- `description`
- `media_json`
- `ticket_requested`
- `ticket_id`
- `closed_reason`
- `created_at`
- `updated_at`

### 8.4 `auto_outage_scan_logs`

Field inti:

- `id`
- `rule_id`
- `router_id`
- `started_at`
- `finished_at`
- `total_db_users`
- `total_with_pppoe`
- `total_active_ppp`
- `total_online`
- `total_offline_candidates`
- `total_eligible`
- `total_skipped`
- `error_message`
- `summary_json`

## 9. Conversation Design

Default flow harus bisa dikustomisasi admin, tetapi fallback awal disediakan.

Initial message:

```text
Halo Kak ${nama}, sistem kami mendeteksi koneksi WiFi/PPPoE atas nama ${nama} tidak aktif sejak ${offline_duration}.
Apakah ada kendala pada WiFi-nya?
Balas: AMAN jika modem sengaja dimatikan, atau ADA KENDALA jika ada gangguan.
```

Jika `aman`:

- Simpan status `safe`.
- Tutup conversation.
- Tidak buat tiket.

Jika `ada kendala`:

```text
Baik Kak, boleh jelaskan kendalanya?
Contoh: alat mati total, lampu LOS merah/kabel bermasalah, WiFi nyala tapi tidak bisa internet, lambat/putus-putus, atau keluhan lain.
Boleh balas dengan angka, teks, atau langsung kirim foto/video modem.
```

Mapping internal:

- `aman`, `1`, `tidak ada kendala`, `sengaja dimatikan` -> `aman`
- `alat mati`, `modem mati`, `power mati`, `tidak nyala` -> `alat_mati`
- `los`, `lampu merah`, `kabel`, `putus`, `fiber` -> `los_kabel`
- `tidak internet`, `no internet`, `wifi nyala`, `tidak bisa browsing` -> `no_internet`
- `lambat`, `lemot`, `putus-putus`, `sering dc` -> `lambat`
- jawaban lain -> `lainnya`

Final confirmation:

```text
Terima kasih Kak. Apakah keluhan ini ingin diajukan sebagai tiket gangguan sekarang?
Balas YA untuk ajukan tiket, atau TIDAK jika belum perlu.
```

Jika `YA`:

- Buat tiket memakai ticket service existing.
- Lampirkan kategori, deskripsi, offline_since, last_logged_out, router, dan media.
- Update conversation `ticket_created`.

Jika `TIDAK`:

- Tutup conversation dengan `closed_reason = customer_declined_ticket`.

## 10. Admin UI

Fase 1A admin UI:

- Halaman daftar hasil deteksi.
- Filter status: online, offline, eligible, pending, recovered, skipped.
- Kolom: pelanggan, PPPoE username, router, area/ODP jika tersedia, status, offline sejak, last logged out, terakhir cek, alasan skip/detection.
- Tombol manual scan.
- Tombol dry-run eligible broadcast.

Fase 1B admin UI:

- Rule config sederhana.
- Toggle enable/disable rule.
- Input threshold offline dalam menit/jam.
- Input scan interval.
- Input cooldown broadcast.
- Target filter: all, area, ODP, profile, router, custom.
- Editor template initial, follow-up, dan konfirmasi tiket.
- Editor pilihan jawaban dan keyword mapping sederhana.
- Toggle minta foto/video untuk kategori tertentu.
- Dashboard triage conversation.
- Action manual close, resend, create ticket, atau mark safe.

## 11. Error Handling and Safety

- Jika WhatsApp belum authenticated, scan tetap boleh berjalan, tetapi broadcast ditahan.
- Jika MikroTik unreachable, simpan scan log error dan jangan ubah status pelanggan menjadi offline massal dari scan gagal.
- Jika `/ppp active` gagal, scan router tersebut dianggap failed, bukan semua pelanggan offline.
- Jika PPP secret detail gagal untuk kandidat offline, pakai internal detection time dan simpan warning.
- Jika pelanggan online kembali, pending conversation ditutup dengan `online_again` kecuali tiket sudah dibuat.
- Broadcast recovery otomatis tidak aktif pada fase pertama.
- Cooldown wajib untuk mencegah spam.
- Semua outbound WhatsApp harus lewat delivery service.
- Semua route admin write harus memakai auth staff/admin sesuai pola existing.

## 12. DB and Performance Notes

- Query database pelanggan harus batch dari runtime users repository, bukan per username.
- Active PPP MikroTik harus diambil sekali per router per scan.
- Detail PPP secret hanya untuk kandidat offline.
- State table perlu index minimal:
  - `pppoe_username`
  - `user_id`
  - `router_id`
  - `status`
  - `offline_since`
  - `last_broadcast_at`
- Conversation table perlu index:
  - `user_id`
  - `state_id`
  - `status`
- Scan log table perlu index:
  - `router_id`
  - `started_at`
- Tidak boleh melakukan N+1 ke MikroTik untuk semua pelanggan.
- DB-heavy change wajib memakai upsert/batch update agar lock contention rendah.

## 13. Testing Strategy

Unit tests:

- Match database users dengan active PPP set.
- Skip pelanggan tanpa `pppoe_username`.
- Ignore PPP active yang tidak ada di database.
- Offline duration dari `last-logged-out` valid.
- Offline duration fallback dari first internal detection.
- Rule eligibility threshold dan cooldown.
- Triage mapping angka, keyword, dan free-text.
- Ticket confirmation hanya membuat tiket saat jawaban final `YA`.

Integration tests:

- Admin manual scan endpoint.
- Admin rule config endpoint.
- Broadcast dry-run endpoint.
- Conversation handler menerima reply customer dan mengubah state.
- WA delivery dependency mocked, tidak import Baileys langsung.

Regression guardrails:

- Route admin tetap memakai `asyncHandler`.
- Tidak ada direct WhatsApp socket import di route/service baru.
- Tidak ada direct MikroTik call dari route.
- Tidak ada auto ticket tanpa customer confirmation.

## 14. Open Implementation Decisions

Keputusan yang sudah dikunci:

- Kunci match utama adalah `pppoe_username`.
- Sumber daftar pelanggan adalah database project.
- Sumber status utama adalah MikroTik `/ppp active`.
- `last-logged-out` adalah fallback/metadata untuk kandidat offline.
- Fase pertama tidak mengirim broadcast recovery otomatis.
- Ticket dibuat hanya setelah konfirmasi pelanggan.

Keputusan teknis saat planning:

- Apakah state memakai SQLite baru atau SQLite existing domain users dengan table baru.
- Adapter MikroTik mana yang paling stabil untuk membaca PPP secret detail di project saat ini.
- Route admin akan dipasang di registrar baru atau digabung dulu ke `routes/admin-content-routes.js`. Rekomendasi: registrar baru agar SRP terjaga.

## 15. Verification Before Implementation

Sebelum logic broadcast otomatis aktif:

- Jalankan scan dry-run pada data nyata.
- Bandingkan hasil offline dengan dashboard MikroTik manual.
- Verifikasi sample pelanggan online, offline, dan tidak terdaftar.
- Pastikan skipped/unmatched jelas di dashboard.
- Aktifkan auto-broadcast hanya setelah admin menyetujui presisi scan.

## 16. Spec Self-Review

- Empty-marker scan: tidak ada penanda pekerjaan kosong yang belum diputuskan untuk fase desain; keputusan yang belum final dipindah ke bagian planning teknis.
- Consistency check: seluruh flow memakai database-first, MikroTik active batch, fallback last-logged-out, dan WA delivery boundary existing.
- Scope check: spec dipisah menjadi Fase 1A dan 1B agar tidak berubah menjadi workflow builder penuh.
- Ambiguity check: auto ticket dan recovery broadcast dibuat eksplisit; ticket wajib konfirmasi pelanggan, recovery broadcast ditunda.
