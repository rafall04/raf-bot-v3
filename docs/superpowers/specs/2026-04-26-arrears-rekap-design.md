# Header Doc
- Purpose: Menjadi spesifikasi desain halaman dan read model rekap tunggakan pelanggan berbasis periode untuk kebutuhan operasional penagihan dan pelaporan manajerial.
- Caller: Pengembang/agent sebelum membuat route, service, repository, dan UI `Rekap Tunggakan`.
- Deps: `routes/payment-status.js`, `lib/payment-finance-service.js`, runtime repository `users`, serta boundary UI/admin existing.
- MainFuncs: Mendefinisikan tujuan, source of truth, API, struktur UI, aturan hitung tunggakan, dan batas implementasi fase awal.
- SideEffects: Tidak ada; dokumen desain statis.

# Rekap Tunggakan Pelanggan

> Status: APPROVED

## Goal
Membuat halaman baru `Rekap Tunggakan` yang menjadi source visual tunggal untuk:
- operasional penagihan harian,
- ringkasan tunggakan untuk owner/manajemen,
- detail statement tunggakan pelanggan berbasis periode.

## Problem
- Sistem pembayaran sudah bergerak ke ledger periodik, tetapi belum ada read model khusus tunggakan pelanggan.
- `users.paid` hanya cocok sebagai snapshot periode berjalan, bukan histori lintas bulan.
- Admin butuh daftar pelanggan menunggak yang bisa langsung ditindak.
- Owner butuh rekap nominal, bucket tunggakan, dan ringkasan collection rate per periode.

## Source Of Truth
- Rekap tunggakan wajib dihitung dari domain periodik:
  - `payment_history`
  - `payment_reversals`
  - harga efektif pelanggan untuk periode yang dihitung
- `users.paid` tidak boleh dipakai sebagai histori tunggakan.
- `users.paid` hanya boleh diperlakukan sebagai snapshot periode berjalan untuk concern lain yang masih legacy.

## Product Shape
Satu halaman baru `Rekap Tunggakan` dengan dua tab:
- `Operasional`
- `Manajerial`

Halaman tunggal dipilih agar:
- user tidak perlu pindah halaman untuk context yang sama,
- filter periode/area bisa dipakai ulang di dua mode,
- query dan state UI tidak terduplikasi.

## Period Model
- User memilih `period_month` dan `period_year` sebagai periode acuan.
- Rekap menghitung seluruh periode `<= periode acuan`.
- Periode setelah periode acuan tidak ikut dihitung.

Contoh:
- jika periode acuan `April 2026`, maka seluruh posisi tunggakan dihitung sampai `April 2026`.

## Arrears Calculation Rules
Untuk setiap pelanggan dan setiap periode yang diperiksa:
- `amount_due`
- `gross_paid`
- `total_reversal`
- `net_paid = gross_paid - total_reversal`
- `outstanding = max(amount_due - net_paid, 0)`

Rule hasil:
- `outstanding > 0` => periode menunggak
- `outstanding = 0` => periode lunas

## Period Amount Rule
Fase awal:
- `amount_due` diambil dari harga efektif pelanggan saat query (`getEffectivePrice(user)` atau padanan service owner).

Catatan:
- ini cukup untuk fase awal operasional,
- tetapi untuk histori yang benar-benar tahan perubahan paket, fase lanjutan idealnya punya snapshot amount per periode/invoice.

## Customer-Level Aggregation
Dari seluruh periode yang masih outstanding, service membentuk field:
- `unpaid_period_count`
- `oldest_unpaid_period`
- `latest_unpaid_period`
- `total_outstanding`
- `current_period_outstanding`
- `aging_bucket`

## Aging Bucket Rule
Karena tunggakan disepakati berbasis periode, bucket dihitung dari jumlah periode tertunggak:
- `1_PERIODE`
- `2_PERIODE`
- `3_PLUS_PERIODE`

Rule:
- `1_PERIODE` jika `unpaid_period_count = 1`
- `2_PERIODE` jika `unpaid_period_count = 2`
- `3_PLUS_PERIODE` jika `unpaid_period_count >= 3`

## Inclusion Rule
Fase awal:
- masukkan pelanggan status `aktif`
- masukkan pelanggan status `isolir`
- exclude `nonaktif` / `terminated`

Catatan:
- pelanggan tidak boleh dianggap menunggak untuk periode sebelum dia aktif,
- batas aktif historis idealnya nanti memakai `activation/start service date`.

## Collection Rate Rule
Untuk periode acuan, tampilkan dua metrik:
- `collection_rate_by_customer`
- `collection_rate_by_amount`

Definisi:
- `collection_rate_by_customer = fully_paid_customers / billable_customers`
- `collection_rate_by_amount = collected_amount / total_billed_amount`

## Target Architecture
- `routes/arrears.js`
  - owner HTTP untuk domain rekap tunggakan
  - endpoint read-only untuk summary, read model, dan statement pelanggan

- `services/arrears.service.js`
  - owner orkestrasi read model tunggakan
  - membentuk row operasional, summary manajerial, bucket, dan statement detail

- `repositories/arrears.repository.js`
  - owner query batch SQLite/read path untuk users, payment history, reversal, dan metadata filter

- UI page `Rekap Tunggakan`
  - memakai endpoint read model baru
  - tidak menulis status keuangan langsung

## Backend API
- `GET /api/arrears/read-model`
  - query:
    - `period_month`
    - `period_year`
    - `area`
    - `status`
    - `bucket`
    - `search`
    - `min_outstanding`
  - response:
    - `rows[]`
    - `summary`
    - `filters`
    - `generated_at`

- `GET /api/arrears/summary`
  - response summary manajerial terfokus

- `GET /api/arrears/customer/:id`
  - response detail statement tunggakan pelanggan

## Operational Read Model
Setiap row operasional minimal berisi:
- `user_id`
- `name`
- `phone_number`
- `subscription`
- `area`
- `status`
- `unpaid_period_count`
- `oldest_unpaid_period`
- `latest_unpaid_period`
- `current_period_outstanding`
- `total_outstanding`
- `aging_bucket`

## Managerial Summary Model
Summary manajerial minimal berisi:
- `total_customers_in_arrears`
- `total_outstanding`
- `current_period_outstanding`
- `bucket_1_period`
- `bucket_2_period`
- `bucket_3_plus_period`
- `collection_rate_by_customer`
- `collection_rate_by_amount`
- `by_area[]`
- `by_package[]`
- `top_outstanding[]`

## UI Layout
### Header
- picker `Bulan`
- picker `Tahun`
- tombol `Terapkan`
- tombol `Export`
- indikator `Generated at`
- total pelanggan terhitung

### Tab Operasional
Urutan blok:
1. filter bar
2. kartu ringkas kecil
3. tabel utama

Filter:
- search `nama / ID / nomor`
- `area`
- `status pelanggan`
- `bucket tunggakan`
- `min total tunggakan`
- toggle `hanya periode berjalan punya tunggakan`

Kartu ringkas:
- `Pelanggan Menunggak`
- `Total Tunggakan`
- `1 Periode`
- `2 Periode`
- `3+ Periode`

Kolom tabel:
- `ID`
- `Nama`
- `No. WA`
- `Paket`
- `Area`
- `Status`
- `Jml Periode`
- `Periode Tertua`
- `Tunggakan Periode Acuan`
- `Total Tunggakan`
- `Bucket`
- `Aksi`

Aksi baris fase awal:
- `Detail`
- `Kirim Reminder`
- `Input Pembayaran`

### Tab Manajerial
Urutan blok:
1. kartu KPI besar
2. rekap per area dan per paket
3. top outstanding customer
4. distribusi bucket tunggakan
5. tanpa trend pada fase 1

KPI utama:
- `Total Pelanggan Menunggak`
- `Total Outstanding`
- `Outstanding Periode Acuan`
- `Collection Rate by Customer`
- `Collection Rate by Amount`

### Drawer Detail Pelanggan
Header drawer:
- nama
- ID pelanggan
- nomor WA
- paket
- area
- status
- total outstanding

Isi drawer:
- tabel statement per periode
  - `Periode`
  - `Tagihan`
  - `Dibayar`
  - `Reversal`
  - `Net`
  - `Outstanding`
  - `Status`

Aksi drawer:
- `Kirim Reminder`
- `Input Pembayaran`

## Query Strategy
- Hindari N+1 query per user-per-periode.
- Repository harus ambil payment/reversal batch untuk rentang periode yang relevan, lalu service mengagregasi di memory.
- Ini penting karena halaman ini akan dipakai rutin dan beban query bisa cepat naik.

## Hard Rules
- Rekap tunggakan tidak boleh memakai `users.paid` sebagai histori.
- Page ini read-model first; tidak menulis langsung source keuangan.
- Periode adalah basis tunggal untuk definisi tunggakan fase awal.
- Operasional harus tabel-first.
- Manajerial harus summary-first.
- Detail pelanggan dibuka dalam drawer/modal, bukan pindah halaman.

## Phase 1 Scope
- halaman baru `Rekap Tunggakan`
- 2 tab `Operasional` dan `Manajerial`
- backend read model tunggakan
- tabel operasional
- drawer detail pelanggan
- summary manajerial dasar
- export dasar bila effort memungkinkan

## Deferred Scope
- chart/trend kompleks
- invoice lifecycle penuh
- due-date based aging
- historical invoice amount snapshot per periode
- approval workflow tambahan

## Verification
- repository test untuk batch read payment/reversal per periode
- service test untuk:
  - outstanding calculation
  - bucket calculation
  - exclusion/inclusion pelanggan
  - collection rate calculation
- route test untuk payload `read-model`, `summary`, dan `customer/:id`
- UI regression untuk:
  - filter periode
  - tab switching
  - drawer statement

## Success Criteria
- Admin bisa melihat siapa saja yang menunggak sampai periode tertentu.
- Owner bisa melihat nominal tunggakan dan distribusinya tanpa query manual.
- Detail pelanggan bisa menunjukkan periode mana saja yang belum lunas.
- Read model tidak bergantung pada `users.paid` untuk histori.
- Query tetap efisien dan tidak jatuh ke pola N+1.
