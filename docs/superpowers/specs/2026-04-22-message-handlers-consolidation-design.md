/**
 * Header Doc
 * Purpose: Tech Spec roadmap konsolidasi layer `message/handlers` agar router bot WhatsApp menjadi tipis, ownership intent jelas, dan orchestration domain berpindah ke boundary yang dapat diuji.
 * Caller: Pengembang/agent sebelum memecah implementasi dengan skill `writing-plans`.
 * Deps: `SYSTEM_MAP.md`, `message/.module_map.md`, `message/handlers/.module_map.md`, `message/raf.js`, `message/handlers/raf-*.js`, dan handler domain prioritas.
 * MainFuncs: Mendefinisikan konteks, tujuan, pendekatan, target architecture, sequencing, risiko terkendali, dan verifikasi roadmap konsolidasi handler bot.
 * SideEffects: Tidak ada; dokumen desain statis.
 */

# Tech Spec: Message Handlers Consolidation Roadmap

## 1. Context

Blast radius terbesar pada proyek ini saat ini berada di layer bot WhatsApp, khususnya `message/raf.js` dan `message/handlers/*`.

Refactor awal sudah berjalan:

- `message/raf.js` tidak lagi sepenuhnya memegang semua state logic karena sebagian pipeline telah dipindah ke `raf-context`, `raf-interceptors`, `raf-state-routing`, `bot-context`, `bot-pipeline`, dan dispatcher intent.
- Legacy state teknisi dan WiFi sudah mulai dipisah ke `legacy-teknisi-state-handler.js` dan `legacy-wifi-state-handler.js`.
- Runtime delivery WhatsApp sudah mulai dipusatkan lewat `lib/whatsapp-gateway.js`, `lib/whatsapp-delivery-service.js`, dan `message/handlers/reply-runtime.js`.

Namun layer bot masih menjadi lokasi coupling terbesar:

- `message/raf.js` masih mengimpor sangat banyak helper, handler, dan utility lintas domain.
- Ownership intent/domain belum sepenuhnya eksplisit dan belum semua flow punya owner tunggal yang mudah diuji.
- Banyak handler masih menjadi tempat campuran antara logic channel WA, orchestration domain, state flow, validasi, dan side effect.

Karena bot adalah pintu masuk utama banyak proses operasional, konsolidasi layer ini akan memberi dampak terbesar terhadap maintainability dan regression control proyek.

## 2. Goal

Roadmap ini bertujuan untuk:

- Menjadikan `message/raf.js` sebagai composition router bot yang tipis.
- Menegaskan owner intent/domain pada `message/handlers/*`.
- Menormalkan kontrak context bot agar sender/state/actor/reply runtime konsisten.
- Memindahkan orchestration domain yang berat keluar dari handler bot ke service boundary yang bisa diuji.
- Menambah guardrail test agar refactor bisa dilakukan bertahap tanpa membuka regresi flow percakapan.

## 3. Non-Goals

Roadmap ini tidak mencakup:

- Menulis ulang seluruh bot menjadi framework baru.
- Menghapus semua helper legacy `lib/*` dalam satu fase.
- Mengubah command publik atau UX percakapan tanpa kebutuhan stabilisasi yang jelas.
- Memigrasikan seluruh domain HTTP/API dalam fase yang sama.
- Men-deprecate semua flow legacy sekaligus tanpa shell compatibility.

## 4. Recommended Approach

Pendekatan yang dipilih adalah **incremental handler-first consolidation**.

Alasan:

- Cocok untuk blast radius tinggi seperti layer bot.
- Bisa dilakukan per bounded context tanpa memutus semua flow sekaligus.
- Memungkinkan test-first migration pada domain yang paling berisiko.
- Selaras dengan kondisi proyek yang belum live, sehingga perubahan bisa diverifikasi sampai benar-benar stabil sebelum deploy.

Pendekatan yang tidak dipilih:

- **Service-first rewrite penuh** terlalu berat di awal dan memperbesar waktu tanpa feedback cepat.
- **Big dispatcher rewrite** terlalu berisiko karena satu kesalahan bisa memutus banyak alur percakapan sekaligus.

## 5. Target Architecture

### 5.1 Bot Composition Router

`message/raf.js` menjadi composition router tipis.

Tanggung jawab:

- build message context,
- panggil global interceptors,
- routing managed state,
- dispatch intent ke owner domain.

`message/raf.js` tidak lagi menjadi bucket import besar untuk detail domain bisnis.

### 5.2 Pipeline Boundaries

Boundary pipeline umum tetap berada di:

- `message/handlers/raf-context.js`
- `message/handlers/raf-interceptors.js`
- `message/handlers/raf-state-routing.js`
- `message/handlers/raf-intent-dispatch.js`
- `message/handlers/bot-context.js`
- `message/handlers/bot-pipeline.js`

Tanggung jawabnya hanya:

- membentuk context standar,
- menentukan keyword/state precedence,
- memetakan intent ke owner domain,
- menghindari domain logic spesifik.

### 5.3 Domain Handler Ownership

Setiap kelompok intent harus punya owner domain yang eksplisit.

Prioritas domain awal:

- **reporting/ticket**
  owner: `smart-report-*`, `ticket-*`, `teknisi-*`, `customer-photo-*`

- **wifi customer ops**
  owner: `wifi-management-*`, `wifi-check-*`, `wifi-history-*`, `wifi-power-*`

- **agent voucher**
  owner: `agent-voucher-handler.js`, sebagian `payment-processor-handler.js`

- **saldo/payment**
  owner: `saldo-handler.js`, `payment-handler.js`, `payment-processor-handler.js`, `topup-handler.js`

Masing-masing domain harus punya boundary facade yang jelas, sehingga dispatcher tidak perlu mengenal detail implementasi flow internal.

### 5.4 Bot Context Contract

Semua handler domain harus menerima context bot yang seragam, minimal berisi:

- actor context,
- canonical sender id,
- state key,
- capability flags,
- reply/send abstraction,
- message metadata,
- dependency access yang memang dibutuhkan.

Handler tidak boleh lagi membangun ulang context sender/state/capability dengan cara berbeda-beda.

### 5.5 Service Extraction Boundary

Logic berikut harus dipindah keluar dari handler seiring roadmap berjalan:

- validasi domain reusable,
- lookup customer/agent yang lintas flow,
- perubahan state bisnis yang tidak spesifik ke WA,
- side effect ke payment/voucher/ticket/wifi domain,
- notification orchestration lintas channel.

Handler bot tetap menjadi adaptor channel WhatsApp, bukan owner bisnis penuh.

### 5.6 Compatibility Shell

Karena proyek masih memiliki helper legacy di `lib/*`, refactor akan memakai compatibility shell tipis.

Artinya:

- flow lama tetap bisa berjalan selama migrasi berlangsung,
- helper lama tidak dihapus sekaligus,
- ownership baru dibangun di atas adapter/facade yang menahan direct legacy leakage ke router utama.

## 6. Sequencing

Urutan roadmap yang direkomendasikan:

1. **Slim `message/raf.js`**
   Keluarkan wiring/import yang tidak perlu berada di entrypoint bot.

2. **Freeze ownership intent**
   Petakan intent aktif dan pastikan satu intent hanya punya satu owner domain aktif.

3. **Normalize bot context**
   Satukan actor, sender canonicalization, state key, dan reply runtime contract.

4. **Consolidate highest-impact domains**
   Mulai dari:
   - reporting/ticket,
   - wifi management,
   - agent voucher,
   - saldo/payment.

5. **Extract orchestration-heavy logic**
   Pindahkan logic reusable keluar dari handler ke service boundary.

6. **Add regression guardrails**
   Tambah test untuk state routing, intent ownership, dan flow domain prioritas.

7. **Reduce legacy leakage**
   Setelah owner flow stabil, kurangi direct helper import dari `message/raf.js` dan handler domain.

## 7. Controlled Risks

Roadmap ini tidak diasumsikan akan menimbulkan bug jika dijalankan disiplin. Risiko di sini berarti area yang paling mudah salah bila refactor dilakukan tanpa guardrail.

### 7.1 Conversation Flow Regression

Contoh:

- state upload foto melompat ke intent lain,
- konfirmasi tiket tidak kembali ke step yang benar,
- flow voucher/saldo terpotong karena state key berubah.

Mitigasi:

- test regression per flow prioritas,
- migrasi per bounded context,
- jangan pindahkan dua domain besar sekaligus dalam satu batch.

### 7.2 Duplicate Intent Ownership

Contoh:

- satu keyword masih ditangani dua jalur berbeda,
- dispatcher baru aktif tetapi fallback lama belum dimatikan.

Mitigasi:

- ownership map intent,
- guardrail test bahwa satu intent hanya punya satu owner aktif.

### 7.3 Sender/State Context Fragmentation

Contoh:

- `@lid`, canonical sender, dan state sender tidak sinkron,
- user yang sama terlihat sebagai entitas berbeda antar flow.

Mitigasi:

- normalisasi context dijadikan fase awal,
- handler domain tidak boleh merakit identity context sendiri.

### 7.4 Partial Service Extraction

Contoh:

- sebagian logic pindah ke service, tetapi logging/notifikasi/side effect masih tercecer di handler lama.

Mitigasi:

- extraction dilakukan per flow lengkap,
- jangan memindahkan separuh orchestration dari satu flow.

Karena proyek belum live, risiko ini dinilai terkendali dan justru paling aman ditangani sekarang dengan pendekatan test-first.

## 8. Verification Strategy

Verifikasi minimum untuk roadmap ini:

- guardrail test untuk ownership intent,
- guardrail test untuk state routing precedence,
- regression test untuk flow prioritas:
  - report/ticket,
  - wifi,
  - agent voucher,
  - saldo/payment,
- static guardrail untuk mencegah `message/raf.js` kembali menjadi import bucket lintas domain,
- trace manual bahwa reply/delivery path tetap memakai runtime boundary yang benar.

## 9. Deliverables

Deliverable implementasi fase ini nanti:

- normalisasi ownership intent bot,
- penyusutan responsibility `message/raf.js`,
- konsolidasi context contract bot,
- ekstraksi orchestration domain prioritas ke service boundary,
- test guardrail baru untuk flow bot berisiko tinggi,
- sinkronisasi dokumentasi map bot jika ownership flow berubah.

## 10. Success Criteria

Roadmap ini dianggap berhasil bila:

- `message/raf.js` menjadi composition router yang jauh lebih tipis,
- intent bot memiliki owner domain yang tunggal dan mudah ditrace,
- handler domain memakai context standar,
- orchestration berat berkurang di layer handler,
- flow prioritas memiliki regression guardrail,
- refactor dapat dilanjutkan ke fase helper legacy dengan risiko yang lebih rendah.
