/**
 * Header Doc
 * Purpose: Tech Spec stabilisasi pasca-refactor area admin agar ownership route, boundary layer, error handling, dan dokumentasi kembali konsisten.
 * Caller: Pengembang/agent sebelum memecah implementasi dengan skill `writing-plans`.
 * Deps: `SYSTEM_MAP.md`, `routes/.module_map.md`, `routes/admin-router.js`, `routes/admin.js`, `routes/admin.routes.js`, `controllers/admin.controller.js`, `services/admin.service.js`, `services/billing.service.js`.
 * MainFuncs: Mendefinisikan scope, pendekatan, target architecture, audit scope, deliverables, risiko, dan verifikasi.
 * SideEffects: Tidak ada; dokumen desain statis.
 */

# Tech Spec: Admin Stabilization Post-Refactor

## 1. Context

Refactor pemisahan router dan service untuk area admin sudah dimulai. `routes/admin.js` tidak lagi menjadi owner logic aktif dan sekarang berfungsi sebagai legacy fallback `410`, sementara sebagian endpoint aktif sudah dipindahkan ke jalur:

`routes/admin.routes.js` -> `controllers/admin.controller.js` -> `services/admin.service.js` / `services/billing.service.js` -> `repositories/*`

Di saat yang sama, `routes/admin-router.js` sudah berkembang menjadi composition root admin yang memasang registrar bounded context lain seperti content, config, wifi ops, database, voucher, logs, dan ops.

Masalah yang tersisa bukan lagi "memindahkan business logic dari `routes/admin.js`", melainkan menstabilkan hasil refactor agar ownership route, layer boundary, global error handling, dan dokumentasi seluruh area admin benar-benar konsisten.

## 2. Goal

Menstabilkan area admin pasca-refactor dengan target berikut:

- Semua endpoint admin aktif memiliki owner yang jelas dan tidak bertabrakan dengan legacy route.
- Router admin aktif tetap tipis dan hanya menangani wiring HTTP.
- Business logic domain admin tetap berada di service.
- Akses persistence dan cache tetap berada di repository atau adapter dependency yang dipanggil service.
- `routes/admin.js` dibatasi ketat sebagai legacy fallback `410`.
- Global error handling admin mengikuti pola `asyncHandler` dan tidak mengulang `try...catch` di controller.
- Header Doc/JSDoc dan map dokumentasi admin sinkron dengan flow yang benar.

## 3. Non-Goals

Pekerjaan ini tidak mencakup:

- Mengubah path publik endpoint admin yang sudah dipakai UI.
- Menulis ulang registrar admin menjadi arsitektur baru penuh bila tidak dibutuhkan untuk stabilisasi.
- Memindahkan semua registrar admin ke pola controller-service-repository baru dalam satu langkah besar.
- Mengubah semantics response bisnis tanpa alasan kompatibilitas yang jelas.
- Refactor domain non-admin yang tidak mempengaruhi ownership route admin.

## 4. Recommended Approach

Pendekatan yang dipilih adalah **bounded-context normalization**.

Alasan:

- Scope tetap fokus pada stabilisasi, bukan refactor ulang besar-besaran.
- Bisa menutup ownership drift di seluruh `routes/admin-router.js`, bukan hanya pada `routes/admin.routes.js`.
- Selaras dengan target user untuk mengaudit dan menormalkan semua admin registrar agar tidak ada route legacy atau stub yang misleading.

Alternatif yang ditolak:

- **Minimal stabilization**: terlalu sempit karena hanya merapikan area billing/package-change dan berisiko meninggalkan drift pada registrar admin lain.
- **Hard modularization**: terlalu luas untuk tahap stabilisasi dan berpotensi berubah menjadi proyek refactor multi-fase.

## 5. Target Architecture

### 5.1 Composition Root

`routes/admin-router.js` tetap menjadi composition root tunggal untuk area admin.

Tanggung jawab:

- Membuat router admin utama.
- Memasang registrar bounded context dalam urutan yang jelas.
- Memasang `routes/admin.routes.js` sebagai owner endpoint aktif untuk domain admin yang sudah dimigrasikan.
- Memasang `routes/admin.js` terakhir sebagai legacy fallback.

Konsekuensi:

- Mount order harus diperlakukan sebagai bagian dari kontrak stabilisasi.
- Jika sebuah endpoint sudah punya owner aktif di registrar baru, `routes/admin.js` hanya boleh menyimpan stub `410` untuk endpoint yang sama.

### 5.2 Active Router Layer

File aktif seperti `routes/admin.routes.js` dan registrar admin lain hanya boleh berisi:

- definisi route,
- middleware auth/rate limit,
- validasi kontrak HTTP yang ringan,
- pembungkusan handler dengan `asyncHandler`,
- delegasi ke controller atau service boundary yang sudah ditetapkan.

Router tidak boleh menjadi owner:

- branching domain kompleks,
- akses database langsung,
- mutasi cache global,
- integrasi WA/MikroTik/GenieACS secara langsung,
- audit logging yang merupakan bagian aturan bisnis.

### 5.3 Controller Layer

`controllers/admin.controller.js` menjadi penerjemah HTTP tipis.

Tanggung jawab:

- Membentuk actor context dari `req.user` dan metadata request.
- Meneruskan payload HTTP ke service yang tepat.
- Menentukan `res.status(...).json(...)` berdasarkan hasil service.

Controller tidak boleh memegang:

- query database,
- business validation,
- side effect domain,
- fallback logic lintas dependency.

### 5.4 Service Layer

`services/admin.service.js` dan `services/billing.service.js` menjadi acuan untuk boundary logic admin.

Tanggung jawab service:

- Validasi domain.
- Orkestrasi dependency.
- Audit logging.
- Notifikasi dan side effect domain.
- Penegakan aturan role/authorization level domain.
- Menyusun hasil terstruktur yang dikonsumsi controller.

Service menjadi owner utama untuk:

- package change flow,
- billing approval / bulk payment flow,
- sinkronisasi dengan adapter seperti MikroTik atau delivery WhatsApp,
- cache reload atau workflow admin yang menghasilkan perubahan state.

### 5.5 Repository Layer

`repositories/admin.repository.js` dan `repositories/billing.repository.js` tetap menjadi boundary persistence.

Tanggung jawab:

- Membaca/menulis SQLite.
- Membaca/menulis JSON persistence yang relevan.
- Sinkronisasi cache `global.*`.
- Menyediakan lookup dan operasi data yang reusable untuk service.

Repository tidak boleh memuat:

- business rule approval,
- formatting response HTTP,
- keputusan orchestration side effect.

### 5.6 Legacy Fallback Layer

`routes/admin.js` dipertahankan sebagai fallback legacy.

Aturan ketat:

- hanya route stub `410`,
- tidak ada helper bisnis baru,
- tidak ada akses dependency domain aktif,
- setiap pesan `410` harus menunjuk owner endpoint baru yang akurat,
- file ini harus dimount terakhir agar tidak shadow active owner.

## 6. Stabilization Rules

Aturan implementasi stabilisasi:

1. Semua endpoint admin aktif harus memakai `ensureAuthenticatedStaff` atau middleware auth admin yang relevan.
2. Semua handler async admin aktif harus dibungkus `asyncHandler`.
3. Controller admin tidak boleh berisi `try...catch` repetitif; error mengalir ke global error middleware.
4. Validasi request yang murni kontrak HTTP boleh tetap di router/controller bila sangat ringan.
5. Validasi domain dan aturan bisnis harus berada di service.
6. Router/controller tidak boleh mengimpor primitive WhatsApp langsung.
7. Router/controller tidak boleh menjadi tempat akses DB langsung.
8. Response shape service-controller harus konsisten dan mudah ditrace.
9. Pesan stub `410` di `routes/admin.js` harus sinkron dengan owner aktual pada komposer admin.
10. Setiap file yang diedit wajib mempertahankan Header Doc/JSDoc yang akurat.

## 7. Audit Scope

Stabilisasi ini akan mengaudit empat kelas masalah.

### 7.1 Ownership Drift

Gejala:

- Endpoint aktif masih terdefinisi lebih dari satu kali.
- Stub `410` menunjuk owner yang salah.
- Mount order menyebabkan owner aktif tertutup route lain.

### 7.2 Boundary Drift

Gejala:

- Registrar atau router masih memegang business logic yang seharusnya ada di service.
- Controller mengandung orchestration domain.
- Service masih bocor ke concern HTTP.

### 7.3 Error-Handling Drift

Gejala:

- Handler async belum memakai `asyncHandler`.
- Ada pola `try...catch` manual yang hanya meneruskan error.
- Perilaku error antar endpoint admin tidak seragam.

### 7.4 Documentation Drift

Gejala:

- Header Doc tidak cocok dengan owner logic nyata.
- `routes/.module_map.md` tidak cocok dengan flow aktual.
- `SYSTEM_MAP.md` masih menyebut ownership lama bila flow berubah di tahap stabilisasi.

## 8. Deliverables

Deliverable tahap implementasi nanti:

- Audit ownership semua endpoint admin yang dipasang oleh `routes/admin-router.js`.
- Normalisasi owner route aktif vs stub fallback `410`.
- Rapikan layer `routes/admin.routes.js`, `controllers/admin.controller.js`, `services/admin.service.js`, `services/billing.service.js` bila masih ada drift.
- Audit registrar admin lain untuk memastikan router tidak menampung business logic besar secara diam-diam.
- Sinkronkan `routes/admin.js` agar semua stub `410` akurat dan non-misleading.
- Sinkronkan `routes/.module_map.md`.
- Sinkronkan `SYSTEM_MAP.md` hanya bila hasil stabilisasi mengubah narasi flow ownership root.

## 9. Risks

Risiko utama:

- Shadow route karena urutan mount tidak tepat.
- Refactor boundary yang terlalu agresif sehingga scope stabilisasi melebar.
- Memindahkan validasi yang seharusnya tetap dekat dengan kontrak HTTP.
- Perubahan pesan atau status response yang merusak kompatibilitas UI admin lama.

Mitigasi:

- Jangan ubah path endpoint publik.
- Fokus pada owner normalization dan boundary cleanup.
- Pisahkan validasi HTTP ringan vs validasi domain secara eksplisit.
- Verifikasi mount order dan daftar route owner sebelum menyentuh logic.

## 10. Verification Strategy

Verifikasi minimum untuk menyatakan stabil:

- Trace setiap endpoint admin aktif dari `routes/admin-router.js` ke owner akhirnya.
- Pastikan endpoint yang sudah punya owner aktif tidak lagi memiliki implementasi aktif di `routes/admin.js`.
- Pastikan handler admin aktif memakai auth middleware dan `asyncHandler`.
- Pastikan controller tidak menyimpan business logic atau akses persistence.
- Pastikan service menjadi owner side effect domain admin.
- Pastikan Header Doc dan map dokumentasi sesuai dengan ownership yang baru.

## 11. Implementation Slices Preview

Tahap `writing-plans` nanti akan memecah pekerjaan ke slice kecil 2-5 menit, kemungkinan diurutkan seperti ini:

1. Audit mount order dan daftar endpoint owner di `routes/admin-router.js`.
2. Audit `routes/admin.js` untuk stub `410` yang salah owner atau redundant.
3. Audit `routes/admin.routes.js` untuk boundary/router rules dan `asyncHandler`.
4. Audit `controllers/admin.controller.js` untuk drift concern non-HTTP.
5. Audit `services/admin.service.js` dan `services/billing.service.js` untuk logic yang masih tercecer atau kontrak hasil yang belum seragam.
6. Audit registrar admin lain yang aktif untuk menemukan business logic yang masih berada di layer router.
7. Sinkronkan `routes/.module_map.md` dan root map bila diperlukan.

## 12. Success Criteria

Pekerjaan stabilisasi dianggap selesai bila:

- Area admin memiliki ownership route yang tunggal dan jelas.
- `routes/admin.js` hanya berfungsi sebagai fallback legacy.
- Layer router/controller/service/repository admin konsisten dengan jalur target.
- Error handling admin aktif mengikuti global pattern.
- Dokumentasi flow admin sinkron dengan implementasi aktual.
