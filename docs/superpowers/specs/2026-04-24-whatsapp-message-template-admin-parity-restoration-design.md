# Header Doc
- Purpose: Tech spec untuk memulihkan parity admin web template pesan WhatsApp dengan runtime bot setelah refactor boundary.
- Caller: Pengembang/agent sebelum membuat implementation plan `whatsapp-message-template-admin-parity-restoration`.
- Deps: `routes/admin-content-routes.js`, `routes/message-templates.js`, `views/sb-admin/templates.php`, `lib/template-service.js`, `lib/templating.js`, `lib/message-manager.js`, `database/*_templates.json`.
- MainFuncs: Mendefinisikan scope audit, target arsitektur template owner, data flow load/save admin, runtime rendering, guardrail, dan testing.
- SideEffects: Tidak ada; dokumentasi desain statis.

# WHATSAPP MESSAGE TEMPLATE ADMIN PARITY RESTORATION DESIGN

## 1. Goal
Memastikan halaman admin web `/templates` kembali menjadi pusat kustomisasi pesan WhatsApp yang jelas dan dapat dipercaya.

Target fase ini:
- semua kategori template penting bisa dilihat dan disimpan dari admin web;
- save dari admin tidak menghapus metadata template;
- runtime bot membaca sumber template yang sama dengan admin editor;
- endpoint template tidak membingungkan antara compat route dan full editor route;
- ada audit coverage antara pesan runtime dan template admin.

## 2. Current Findings
Yang masih berfungsi:
- `/templates` masih dirender oleh generic page handler di `routes/pages.js`;
- navbar masih punya menu `Template Pesan`;
- `views/sb-admin/templates.php` load/save ke `/api/templates`;
- `/api/templates` masih aktif di `routes/admin-content-routes.js`;
- `lib/template-service.js` memusatkan kategori:
  - `notificationTemplates`
  - `wifiMenuTemplates`
  - `responseTemplates`
  - `commandTemplates`
  - `errorTemplates`
  - `successTemplates`
  - `systemTemplates`
  - `menuTemplates`
  - `reportTemplates`

Masalah:
- `/api/templates` dan `/api/message-templates` sama-sama ada, tapi cakupannya berbeda.
- `/api/message-templates` adalah compat route yang fokus ke `notificationTemplates`.
- UI `/templates` belum mengedit `menuTemplates` dan `reportTemplates`; keduanya hanya dipreserve saat save.
- Save UI membangun ulang entry beberapa kategori menjadi `{ name, template }`, sehingga metadata seperti `description`, `enabled`, `placeholders`, dan `updated_at` berisiko hilang.
- Banyak pesan WhatsApp masih hardcoded atau fallback-backed, jadi tidak semuanya bisa diubah dari admin web.

## 3. Target Architecture

### Admin full editor
- `routes/admin-content-routes.js`
  - tetap menjadi owner route `/api/templates`;
  - load/save semua kategori template dari `lib/template-service.js`;
  - tidak kehilangan metadata saat save.

### Compat API
- `routes/message-templates.js`
  - tetap compat surface untuk `/api/message-templates`;
  - harus eksplisit bahwa ini compat notification-template API;
  - diagnostics harus menunjukkan source owner `template-service`.

### Runtime renderer
- `lib/template-service.js`
  - tetap source of truth kategori dan persistence JSON.
- `lib/templating.js`
  - tetap owner render notification/system/menu/report.
- `lib/message-manager.js`
  - tetap owner response/command/system style lookup.

### Admin UI
- `views/sb-admin/templates.php`
  - harus bisa menampilkan dan menyimpan kategori penting:
    - notification
    - response
    - command
    - error
    - success
    - system
    - menu
    - report
    - wifi
  - harus preserve metadata existing.

## 4. Scope
Fase ini fokus pada parity admin editor dan runtime template source.

In scope:
- audit kategori template dan usage runtime;
- perbaikan save payload admin agar metadata tidak hilang;
- expose/edit `menuTemplates` dan `reportTemplates` di UI;
- boundary tests untuk `/api/templates`;
- compat clarity tests untuk `/api/message-templates`;
- docs/map sync.

Out of scope:
- migrasi semua hardcoded reply sekaligus;
- redesign visual penuh halaman template;
- menghapus `/api/message-templates`;
- migrasi storage JSON ke SQLite.

## 5. Data Flow
Load:
1. Admin membuka `/templates`.
2. UI fetch `GET /api/templates`.
3. `routes/admin-content-routes.js` memanggil `templateService.loadAllCategories()`.
4. Response membawa semua kategori yang bisa diedit.
5. UI merender kategori ke tab/editor.

Save:
1. UI mengumpulkan semua textarea dan metadata existing.
2. UI POST ke `/api/templates`.
3. Route memanggil `templateService.saveCategory(...)` per kategori.
4. `templateService.loadAllCategories()` dan `templateManager.reloadTemplates()` dipanggil.
5. Runtime renderer memakai cache yang sama.

Runtime:
1. Flow bot memanggil `renderTemplate`, `renderMenu`, `renderReport`, `messageManager.getMessage`, atau compatibility helper.
2. Semua lookup berakhir ke `templateService.renderCategoryTemplate(...)`.
3. Template yang diedit admin muncul di runtime setelah save/reload.

## 6. Hard Rules
- Jangan ubah contract public `/api/templates` tanpa compatibility handling.
- Jangan hilangkan metadata template saat save.
- Jangan membuat endpoint template baru kalau `/api/templates` masih cukup.
- Jangan menghapus `/api/message-templates` pada fase ini.
- Jangan migrasi semua hardcoded reply dalam satu batch.

## 7. Implementation Slices

### Slice A: Template admin parity inventory
- Buat test/inventory untuk kategori yang dikirim `/api/templates`.
- Tandai kategori editable vs preserved-only.
- Catat runtime paths yang memakai template vs hardcoded/fallback.

### Slice B: Preserve metadata on save
- Perbaiki `views/sb-admin/templates.php` agar payload mempertahankan metadata existing.
- Tambah route/service test untuk memastikan metadata tidak hilang.

### Slice C: Expose menu/report categories in admin UI
- Tambah tab/render kategori `menuTemplates` dan `reportTemplates`.
- Pastikan save masuk ke category owner yang benar.

### Slice D: Compat route clarity
- Perketat test `routes/__tests__/message-templates.compat.test.js`.
- Pastikan diagnostics menyatakan source file dan legacy adapter usage.

### Slice E: Docs and verification
- Sync `SYSTEM_MAP.md`, `routes/.module_map.md`, dan dokumen testing bila perlu.
- Jalankan focused tests + smoke-core subset template.

## 8. Testing Strategy
- `routes/__tests__/admin-content-routes.test.js`
  - `GET /api/templates` harus mengembalikan semua kategori penting.
  - `POST /api/templates` harus preserve metadata.
- `routes/__tests__/message-templates.compat.test.js`
  - compat route tetap mapped ke `message_templates.json`.
- `lib/__tests__/template-service.test.js`
  - save/load category tetap normalisasi placeholder tanpa merusak metadata.
- Optional source guardrail:
  - UI `/templates` harus fetch `/api/templates`.
  - UI harus membawa `menuTemplates` dan `reportTemplates` sebagai editable categories.

## 9. Risks
- Beberapa pesan WhatsApp tetap hardcoded setelah fase ini.
- UI lama berbasis PHP/jQuery bisa menyimpan format berbeda antara string dan object template.
- Runtime fallback hardcoded masih dapat membuat admin merasa “template tidak bekerja” untuk flow tertentu.

Mitigasi:
- Pisahkan parity editor dari migrasi hardcoded reply.
- Tambahkan coverage report/inventory.
- Prioritaskan runtime template keys yang sudah ada sebelum migrasi pesan baru.

## 10. Success Criteria
- `/templates` load/save semua kategori penting.
- `menuTemplates` dan `reportTemplates` tidak lagi hanya preserved-only.
- Metadata existing tidak hilang saat save.
- Compat `/api/message-templates` tetap bekerja dan terdokumentasi sebagai compat route.
- Ada audit jelas pesan WhatsApp yang sudah template-backed vs belum.

## 11. Follow-Up After This Phase
- Migrasi hardcoded reply prioritas ke template keys.
- Stabilkan `speed-payment-handler` agar bisa masuk smoke-core.
- Tambahkan preview/test render lintas kategori langsung di admin UI bila dibutuhkan.
