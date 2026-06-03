# WiFi Repository/Service Normalization Implementation Plan

> Based on spec: `docs/superpowers/specs/2026-04-22-wifi-repository-service-normalization-design.md`

## Execution Rules
- Kerjakan per slice kecil dengan verifikasi di akhir tiap slice.
- Jangan ubah behavior user-facing bot.
- Jangan redesign seluruh domain WiFi.
- Setiap file yang disentuh wajib sinkron dengan Header Doc dan map docs.

## Implementation Slices

### Task 1 - Concern Inventory
Goal: pisahkan concern aktif handler WiFi menjadi orchestration, adapter device, dan logging/history.

Steps:
1. Audit `message/handlers/wifi-management-handler.js`.
2. Tandai exact concern:
   - validasi/reply shaping
   - resolve customer
   - device operation
   - logging/history write
3. Tambahkan baseline guardrail bila perlu.

Verify:
- ownership concern WiFi jelas sebelum refactor

### Task 2 - WiFi Service Owner
Goal: bentuk service owner untuk orchestration perubahan nama/sandi WiFi.

Steps:
1. Buat `services/wifi-management.service.js` atau equivalent.
2. Pindahkan orchestration aktif ganti nama/sandi WiFi ke service.
3. Pertahankan handler hanya sebagai adapter bot.

Verify:
- service boundary tests lulus
- regression handler WiFi tidak berubah perilaku

### Task 3 - WiFi Repository/Log Owner
Goal: buat owner tunggal untuk logging/history concern WiFi.

Steps:
1. Buat/perkuat `repositories/wifi.repository.js` atau equivalent.
2. Bungkus write log/history WiFi di repository owner.
3. Jika `lib/wifi-logger.js` masih dipakai, posisikan sebagai adapter implementasi.

Verify:
- repository contract tests lulus
- handler/service tidak lagi menulis log langsung

### Task 4 - Handler Refactor
Goal: jadikan `wifi-management-handler.js` tipis dan repo/service-first.

Steps:
1. Ubah handler agar memanggil service owner.
2. Hapus concern logging/persistence yang tidak lagi perlu di handler.
3. Pertahankan reply dan validation ringan di layer handler.

Verify:
- regression test WiFi handler lulus
- source guardrail boundary lulus

### Task 5 - Guardrails + Docs Sync
Goal: kunci boundary WiFi baru.

Steps:
1. Tambah guardrail source/boundary test bila perlu.
2. Sync `SYSTEM_MAP.md`, `message/handlers/.module_map.md`, dan map domain terkait.

Verify:
- guardrail tests lulus
- docs sinkron dengan owner final

### Task 6 - Final Regression
Goal: pastikan normalisasi WiFi tidak memecah flow aktif.

Verify:
- WiFi handler regression tests
- service boundary tests
- repository contract tests
- tests ops/admin terkait bila terpengaruh

## Exit Criteria
- Handler WiFi jadi lebih tipis.
- Orchestration WiFi pindah ke service owner.
- Logging/history WiFi punya owner repository/service jelas.
- `lib/wifi.js` tinggal adapter perangkat, bukan owner business logging.
