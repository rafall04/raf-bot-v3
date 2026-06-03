/**
 * Header Doc
 * Purpose: Tech Spec aktivasi repository owner untuk domain saldo, ticket, dan voucher agar repository compatibility menjadi owner aktif pada jalur bisnis nyata.
 * Caller: Pengembang/agent sebelum memecah implementasi dengan skill `writing-plans`.
 * Deps: `SYSTEM_MAP.md`, `message/handlers/domain-services.js`, `repositories/saldo.repository.js`, `repositories/ticket.repository.js`, `repositories/voucher.repository.js`, `message/handlers/*`, dan service/domain consumer terkait.
 * MainFuncs: Mendefinisikan konteks, tujuan, pendekatan, scope domain, arsitektur target, guardrail, risiko terkendali, dan verifikasi untuk aktivasi repository owner.
 * SideEffects: Tidak ada; dokumen desain statis.
 */

# Tech Spec: Repository Owner Activation for Saldo, Ticket, and Voucher

## 1. Context

Fondasi runtime boundary dan purge `global.*` pada service aktif sudah berjalan:

- runtime contract kini lebih eksplisit,
- service legacy aktif sudah mulai memakai runtime/repository injection,
- `message/handlers/domain-services.js` sudah memiliki bridge ke repository compatibility,
- repository `voucher`, `saldo`, dan `ticket` sudah tersedia sebagai compatibility owner awal.

Namun repository tersebut belum sepenuhnya menjadi owner aktif pada jalur bisnis utama.

Kondisi saat ini:

- `saldo.repository.js` masih tipis di atas `lib/saldo-manager`,
- `ticket.repository.js` masih bergantung pada compatibility handler `ticket-creation-handler`,
- `voucher.repository.js` baru read-only shell untuk katalog/profil,
- beberapa consumer masih memakai helper persistence langsung atau helper `lib/*` yang lama.

Artinya, boundary repository sudah ada secara bentuk, tetapi ownership nyata di jalur aktif masih belum penuh.

## 2. Goal

Fase ini bertujuan untuk:

- mengubah `saldo.repository.js`, `ticket.repository.js`, dan `voucher.repository.js` menjadi owner aktif yang benar-benar dipakai,
- memindahkan consumer prioritas agar membaca persistence melalui repository tersebut,
- mengurangi direct helper persistence access dari service/handler,
- menyiapkan phase service decomposition berikutnya dengan owner data yang lebih tegas.

## 3. Non-Goals

Fase ini tidak mencakup:

- migrasi storage fisik besar-besaran,
- rewrite total seluruh helper `lib/*`,
- redesign flow bisnis saldo/ticket/voucher,
- refactor domain bot/admin lain di luar jalur konsumen prioritas,
- penghapusan semua compatibility shell sekaligus.

## 4. Recommended Approach

Pendekatan yang dipilih adalah **repository-owner activation bertahap per domain**.

Alasan:

- repository sudah ada, jadi langkah berikutnya adalah mengaktifkan ownership nyata,
- risiko paling kecil dicapai dengan mengubah satu jalur aktif per domain,
- pendekatan ini menjaga compatibility sambil menurunkan dependency pada helper legacy.

## 5. Scope Priority

### 5.1 Saldo

Target minimum:

- lookup saldo user,
- create saldo user,
- jalur consumer prioritas yang sekarang memakai helper saldo langsung.

### 5.2 Ticket

Target minimum:

- draft/report persistence,
- ticket id boundary,
- consumer reporting/ticket yang sekarang masih langsung ke compatibility handler.

### 5.3 Voucher

Target minimum:

- catalog/profile read,
- inventory/profile lookup untuk flow prioritas,
- consumer voucher yang sekarang masih memakai helper direct read.

## 6. Target Architecture

Setelah fase ini:

- repository `saldo`, `ticket`, dan `voucher` menjadi owner aktif jalur data domain masing-masing,
- service/facade domain membaca repository tersebut, bukan helper persistence langsung,
- helper `lib/*` yang masih dibutuhkan berada di bawah repository, bukan di atasnya,
- `message/handlers/domain-services.js` bergerak dari bridge helper legacy menjadi bridge repository owner.

## 7. Migration Strategy

Urutan aman:

1. pasang contract tests yang lebih tegas untuk repository owner,
2. pilih satu consumer aktif per domain,
3. pindahkan consumer itu ke repository owner,
4. jalankan regression tests domain terkait,
5. baru lanjut ke consumer berikutnya dalam domain yang sama.

Prinsip:

- satu domain, satu jalur aktif per batch,
- jangan biarkan satu concern membaca sebagian dari helper lama dan sebagian dari repo baru,
- compatibility shell boleh tetap ada sementara, tetapi owner read/write harus jelas.

## 8. Guardrails

Guardrail fase ini:

- jangan ubah command/route publik,
- jangan redesign business logic,
- setiap repository target wajib punya contract test,
- consumer yang dipindah wajib punya boundary/regression test,
- Header Doc dan map docs harus sinkron jika ownership berubah.

## 9. Controlled Risks

### 9.1 Dual Ownership

Contoh:

- repo baru ada, tetapi jalur lain masih membaca helper lama untuk concern yang sama.

Mitigasi:

- aktivasi dilakukan per consumer prioritas,
- static guardrail untuk direct helper access jika perlu.

### 9.2 Repository Too Thin

Contoh:

- repository hanya menjadi pass-through tanpa benar-benar menjadi source boundary.

Mitigasi:

- contract tests harus menegaskan entrypoint owner yang dipakai consumer aktif,
- consumer dipindah nyata, bukan hanya menambah file repo.

### 9.3 Legacy Helper Coupling Survives

Contoh:

- `message/handlers/domain-services.js` tetap melayani helper persistence langsung walau repo sudah aktif.

Mitigasi:

- consumer prioritas dipindah ke repository bridge,
- helper direct lama hanya dipertahankan untuk concern yang belum disentuh.

## 10. Verification Strategy

Verifikasi minimum:

- contract tests repository `saldo`, `ticket`, `voucher`,
- boundary/regression tests consumer aktif yang dipindah,
- static guardrail jika consumer lama masih rawan direct helper access,
- trace manual bahwa runtime/domain bridge menunjuk ke owner repo, bukan helper persistence lama.

## 11. Deliverables

Deliverable implementasi fase ini nanti:

- repository owner `saldo`, `ticket`, `voucher` yang aktif dipakai,
- consumer prioritas yang sudah repo-first,
- pengurangan helper persistence direct access pada jalur domain aktif,
- guardrail tests baru untuk ownership data domain,
- sinkronisasi dokumentasi ownership repository.

## 12. Success Criteria

Fase ini dianggap berhasil bila:

- `saldo.repository.js`, `ticket.repository.js`, dan `voucher.repository.js` dipakai langsung oleh consumer prioritas,
- helper persistence direct tidak lagi menjadi jalur utama untuk concern yang dipindah,
- regression tests domain prioritas tetap lolos,
- runtime/domain bridge menunjuk ke repository owner nyata,
- phase service decomposition berikutnya menjadi lebih mudah dan lebih presisi.
