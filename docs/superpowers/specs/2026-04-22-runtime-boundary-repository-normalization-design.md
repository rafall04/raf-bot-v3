/**
 * Header Doc
 * Purpose: Tech Spec fondasi runtime boundary dan repository normalization agar dependency ownership proyek eksplisit, akses data konsisten, dan penambahan fitur lebih presisi.
 * Caller: Pengembang/agent sebelum memecah implementasi dengan skill `writing-plans`.
 * Deps: `SYSTEM_MAP.md`, `routes/.module_map.md`, `message/.module_map.md`, `message/handlers/.module_map.md`, `index.js`, `lib/app-runtime.js`, `lib/routes-registry.js`, `message/raf.js`, `routes/*`, `services/*`, dan `repositories/*`.
 * MainFuncs: Mendefinisikan konteks, tujuan, arsitektur target, scope P0/P1, strategi migrasi, guardrail, risiko terkendali, dan verifikasi fondasi runtime serta repository.
 * SideEffects: Tidak ada; dokumen desain statis.
 */

# Tech Spec: Runtime Boundary and Repository Normalization

## 1. Context

Proyek ini sudah bergerak ke arah arsitektur yang lebih sehat:

- route admin aktif sudah punya jalur `router -> controller -> service -> repository`,
- boundary WhatsApp runtime mulai dipusatkan,
- `message/raf.js` sudah mulai dipisah ke pipeline dan facade domain,
- composition root mulai lebih jelas melalui `index.js`, `lib/app-runtime.js`, dan `lib/routes-registry.js`.

Namun dua sumber technical debt terbesar masih tersisa:

- **hidden dependency runtime**, terutama pembacaan `global.*` di jalur bisnis aktif,
- **akses persistence yang belum seragam**, karena domain masih campur memakai helper `lib/*`, `lib/database.js`, SQLite, dan file JSON langsung.

Selama dua area ini belum dibenahi, fitur baru akan tetap mahal karena:

- dependency graph sulit ditrace,
- test butuh setup global besar,
- service boundary mudah bocor,
- review perubahan lintas domain sulit presisi,
- regression risk tinggi saat menyentuh cache, state, atau persistence.

Fase ini ditujukan sebagai fondasi sebelum refactor domain besar berikutnya.

## 2. Goal

Fase ini bertujuan untuk:

- menjadikan runtime container/dependency wiring sebagai source of truth yang eksplisit,
- mengurangi pembacaan `global.*` dari handler/service/domain aktif,
- menormalkan akses data melalui repository owner per bounded context,
- memastikan service berbicara ke repository, bukan ke file/DB/helper persistence secara acak,
- membuat fitur baru dan maintenance ke depan lebih deterministic, terukur, dan mudah diuji.

## 3. Non-Goals

Fase ini tidak mencakup:

- migrasi total seluruh storage legacy ke database baru,
- redesign UX/command bot atau route publik,
- rewrite penuh semua helper `lib/*` dalam satu batch,
- penghapusan semua compatibility layer sekaligus,
- perubahan semantics fitur hanya demi “kerapihan”.

## 4. Recommended Approach

Pendekatan yang dipilih adalah **runtime-first foundation**.

Urutannya:

1. tegaskan runtime boundary dan dependency ownership,
2. setelah dependency source jelas, normalkan repository per domain.

Alasan:

- repository yang sehat butuh runtime/dependency source yang sudah tegas,
- kalau repository dibangun dulu sementara `global.*` masih liar, source of truth tetap kabur,
- pendekatan ini memberi fondasi paling kuat untuk refactor domain selanjutnya.

Pendekatan yang tidak dipilih:

- **repository-first**: hasilnya cepat terlihat di data layer, tetapi tetap bocor bila dependency source belum jelas,
- **per-domain mixed migration**: berisiko melahirkan beberapa pola arsitektur sekaligus dan memperpanjang masa transisi.

## 5. Target Architecture

Arsitektur target:

`index.js`
-> `lib/app-runtime.js` / runtime bootstrap
-> dependency registry/container
-> router / handler / controller
-> service
-> repository
-> persistence adapter

Aturan target:

- `global.*` bukan source of truth untuk domain logic aktif,
- dependency aktif masuk lewat runtime/container/factory,
- controller/router/handler tetap tipis,
- service memegang business rule,
- repository menjadi owner akses persistence domain,
- adapter persistence mengenkapsulasi SQLite/JSON/cache/external persistence detail.

## 6. Scope P0: Runtime Boundary

### 6.1 Target Files and Areas

Prioritas area:

- `index.js`
- `lib/app-runtime.js`
- `lib/routes-registry.js`
- composition root `routes/*`
- entrypoint bot `message/raf.js`
- runtime WA / delivery / bootstrap helpers
- service/handler yang masih membaca `global.*` langsung

### 6.2 Runtime Contract

`appRuntime` atau registry sejenis harus menjadi kontrak eksplisit untuk:

- config yang sah dipakai domain,
- repository owner,
- service registry,
- gateway/adapters,
- cache/state access yang diizinkan,
- logger/observability hooks,
- feature-level compatibility adapters bila masih dibutuhkan.

### 6.3 Runtime Rules

Aturan yang dituju:

- modul bisnis aktif tidak membaca `global.config`, `global.users`, `global.accounts`, `global.voucher`, `global.statik`, atau runtime WA global secara langsung,
- runtime dibaca dari dependency injection atau context yang berasal dari composition root,
- `global.*` boleh tetap hidup sementara hanya sebagai compatibility shell,
- compatibility shell harus diisi dari runtime tunggal, bukan menjadi lokasi mutasi bebas.

### 6.4 Expected Outcome

Sesudah P0:

- dependency graph lebih mudah ditrace,
- test dapat menyuplai dependency secara lokal tanpa bootstrap global besar,
- domain baru punya jalur wiring yang konsisten,
- runtime leakage berkurang nyata dari layer router/handler/service.

## 7. Scope P1: Repository Normalization

### 7.1 Domain Priority

Domain prioritas:

- billing
- voucher
- saldo/payment
- wifi/customer operations
- ticket/reporting
- agent

### 7.2 Repository Rules

Aturan yang dituju:

- setiap domain prioritas punya repository owner,
- repository mengenkapsulasi SQLite query, JSON read/write, cache hydration, dan fallback compatibility,
- service tidak membaca file/SQLite/helper persistence langsung,
- handler/controller tidak melakukan persistence access,
- repository menjadi tempat tunggal untuk optimasi read/write dan penanganan source legacy.

### 7.3 Repository Shape

Contoh owner target:

- `repositories/billing.repository.js`
- `repositories/voucher.repository.js`
- `repositories/saldo.repository.js`
- `repositories/ticket.repository.js`
- `repositories/wifi.repository.js`
- `repositories/agent.repository.js`

Jika storage masih legacy:

- bungkus dulu lewat repository adapter,
- jangan migrasi fisik storage sekaligus kecuali benar-benar dibutuhkan.

### 7.4 Expected Outcome

Sesudah P1:

- service domain lebih bersih,
- akses data lebih terpusat,
- perubahan persistence tidak perlu memodifikasi banyak handler/service,
- query/file access lebih mudah diaudit dan diuji.

## 8. Migration Strategy

Strategi migrasi yang direkomendasikan:

1. tetapkan kontrak runtime container yang sah,
2. audit pembaca `global.*` aktif di jalur bisnis utama,
3. gantikan pembacaan langsung dengan dependency injection bertahap,
4. bungkus persistence legacy per bounded context ke repository owner,
5. pindahkan service agar hanya bicara ke repository,
6. tambahkan guardrail test untuk boundary runtime dan repository,
7. sisakan compatibility shell untuk modul legacy yang belum disentuh.

Prinsip penting:

- migrasi dilakukan per bounded context,
- jangan buka terlalu banyak domain sekaligus,
- satu domain tidak boleh punya dua source of truth permanen.

## 9. Guardrails

Guardrail fase ini:

- jangan ubah route/path/command publik tanpa kebutuhan bisnis,
- jangan campur refactor fondasi dengan redesign fitur,
- setiap file yang disentuh wajib punya Header Doc,
- map docs harus sinkron jika ownership flow berubah,
- controller/route tetap mengikuti global error handling yang sudah dibakukan,
- perubahan persistence harus meminimalkan I/O dan tidak menambah pola akses acak baru.

## 10. Controlled Risks

Risiko di sini adalah area yang paling mudah salah bila migrasi fondasi dilakukan tanpa guardrail.

### 10.1 Hidden Dependency Survives

Contoh:

- domain tampak menerima runtime, tetapi diam-diam masih membaca `global.*`.

Mitigasi:

- audit pembaca `global.*`,
- static guardrail test,
- review dependency constructor/factory.

### 10.2 Repository Wrapper Without Real Ownership

Contoh:

- repository hanya menjadi pass-through tipis sementara service masih mengakses helper persistence lain.

Mitigasi:

- tetapkan owner tunggal per domain,
- pindahkan akses persistence ke repository sepenuhnya sebelum menyatakan domain selesai.

### 10.3 Dual Source of Truth

Contoh:

- sebagian flow membaca runtime/container,
- sebagian lain tetap memakai `global.*` atau file helper lama untuk data yang sama.

Mitigasi:

- compatibility shell tunggal,
- migration per bounded context,
- contract tests untuk source ownership.

### 10.4 Cache and Runtime Drift

Contoh:

- cache, state, atau runtime snapshot tidak sinkron setelah dependency source diganti.

Mitigasi:

- repository/cache ownership eksplisit,
- trace read/write path,
- regression test domain yang menyentuh cache/state.

Karena proyek belum live, risiko ini dinilai terkendali selama migrasi dilakukan bertahap dan diverifikasi per slice.

## 11. Verification Strategy

Verifikasi minimum:

- runtime contract tests:
  memastikan handler/service menerima dependency dari runtime, bukan `global.*`
- repository contract tests:
  memastikan service domain mengakses data lewat repository owner
- static guardrail tests:
  mendeteksi direct access/import yang dilarang
- regression tests domain prioritas:
  billing, voucher, saldo, ticket, wifi, agent
- trace manual composition root:
  memastikan `index.js` -> runtime -> router/handler/service -> repository dapat diikuti dengan jelas

## 12. Deliverables

Deliverable implementasi fase ini nanti:

- runtime/dependency contract yang lebih tegas,
- pengurangan direct `global.*` access pada jalur bisnis aktif,
- repository owner untuk domain prioritas,
- service boundary yang berbicara ke repository,
- guardrail tests untuk runtime dan repository leakage,
- sinkronisasi `SYSTEM_MAP.md` dan module maps terkait ownership baru.

## 13. Success Criteria

Fase ini dianggap berhasil bila:

- dependency domain utama tidak lagi membaca `global.*` langsung,
- runtime container menjadi titik wiring tunggal yang bisa ditrace,
- domain prioritas memakai repository owner yang konsisten,
- service tidak lagi mengakses persistence secara langsung,
- setup test domain tidak memerlukan mock global besar,
- penambahan fitur baru dapat mengikuti pola runtime -> service -> repository dengan deviasi minimal.
