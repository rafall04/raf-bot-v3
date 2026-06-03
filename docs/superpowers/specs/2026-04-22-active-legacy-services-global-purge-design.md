/**
 * Header Doc
 * Purpose: Tech Spec fase purge `global.*` pada service legacy aktif agar dependency ownership service menjadi eksplisit dan konsisten dengan runtime boundary baru.
 * Caller: Pengembang/agent sebelum memecah implementasi dengan skill `writing-plans`.
 * Deps: `SYSTEM_MAP.md`, `routes/.module_map.md`, `services/*.js`, `repositories/*.js`, `lib/app-runtime.js`, `lib/runtime-repositories.js`, dan test suites service aktif.
 * MainFuncs: Mendefinisikan konteks, tujuan, pendekatan, scope prioritas, pola replacement dependency, guardrail, risiko terkendali, dan verifikasi untuk purge `global.*`.
 * SideEffects: Tidak ada; dokumen desain statis.
 */

# Tech Spec: Active Legacy Services Global Purge

## 1. Context

Fondasi runtime boundary dan repository normalization awal sudah mulai terbentuk:

- `lib/app-runtime.js` kini mengekspose registry runtime yang lebih eksplisit,
- route admin aktif sudah service/repository-first,
- `message/raf.js` mulai membaca katalog runtime lewat repository-backed path,
- repository compatibility owner untuk voucher, saldo, dan ticket sudah tersedia,
- guardrail tests sudah mulai menjaga runtime contract dan repository bridge.

Namun beberapa service legacy yang masih aktif di jalur bisnis utama tetap membaca atau memutasi `global.*` secara langsung.

Contoh pola yang masih ada:

- membaca `global.users`, `global.accounts`, `global.voucher`, `global.statik`, `global.paymentMethod`,
- memutasi array global secara langsung,
- mengandalkan `global.db` sebagai dependency implicit,
- mencampur cache mutation, persistence, dan business rule dalam satu blok service.

Area ini sekarang menjadi hambatan terbesar untuk meningkatkan presisi maintenance dan penambahan fitur.

## 2. Goal

Fase ini bertujuan untuk:

- menghapus pembacaan dan mutasi `global.*` dari service legacy aktif,
- mengganti hidden dependency dengan dependency injection berbasis runtime/repository,
- menegaskan owner cache/data access di service operasional yang masih transisional,
- membuat service aktif lebih mudah diuji dan dipecah pada fase berikutnya.

## 3. Non-Goals

Fase ini tidak mencakup:

- redesign behavior bisnis dari service target,
- migrasi storage fisik besar-besaran,
- rewrite total seluruh service legacy dalam satu batch,
- pembersihan seluruh helper `lib/*` sekaligus,
- perubahan route publik atau command publik.

## 4. Recommended Approach

Pendekatan yang dipilih adalah **service-first global purge**.

Alasan:

- hidden dependency saat ini paling nyata berada di level service aktif,
- runtime/repository foundation yang baru dibuat bisa langsung dimanfaatkan,
- purge per service lebih terukur dan lebih kecil risikonya dibanding mixed refactor lintas domain sekaligus.

Pendekatan yang tidak dipilih:

- **repository-first purge** terlalu besar untuk service yang masih campur cache mutation + orchestration,
- **route/domain-first purge** cenderung meninggalkan hidden dependency di service aktif.

## 5. Scope Priority

### 5.1 Wave 1

Service prioritas tertinggi:

- `services/admin-ops.service.js`
- `services/admin-database-ops.service.js`
- `services/network-ops.service.js`
- `services/payment-approval.service.js`

### 5.2 Wave 2

Service lain yang masih:

- membaca `global.*` langsung,
- memutasi cache global,
- mengandalkan `global.db` tanpa boundary runtime/repository.

## 6. Target Architecture

Setelah fase ini:

- service tidak membaca `global.*` langsung,
- service menerima dependency melalui `defaultDeps()` atau factory override,
- cache/data access dilakukan lewat runtime repository atau repository owner,
- `global.*` hanya tinggal compatibility shell di composition root/runtime bootstrap,
- service lebih fokus pada business rule daripada source lookup.

## 7. Dependency Replacement Pattern

Contoh pola target:

Dari:

```js
const user = (global.users || []).find((item) => String(item.id) === String(id));
```

Menjadi:

```js
const user = deps.userRepository.getById(id);
```

Dari:

```js
global.users.splice(index, 1);
```

Menjadi:

```js
deps.userRepository.removeById(id);
```

Dari:

```js
if (!global.db) throw new Error("Database not initialized");
```

Menjadi:

```js
const db = deps.runtime.getDb();
```

atau dipindahkan sepenuhnya ke repository owner.

## 8. Migration Strategy

Urutan aman:

1. audit exact `global.*` usage per service target,
2. tambah guardrail tests untuk forbidden global access,
3. tambahkan dependency defaults berbasis runtime/repository,
4. ganti direct read/mutation dengan repository/runtime helper,
5. jalankan regression tests service target,
6. sinkronkan module map/system map bila ownership dependency berubah.

Prinsip penting:

- satu service dibersihkan penuh per batch,
- jangan campur purge dependency dengan redesign business flow,
- jangan biarkan satu concern membaca sebagian dari repo dan sebagian dari `global.*`.

## 9. Guardrails

Guardrail fase ini:

- jangan ubah contract publik route/bot,
- behavior bisnis existing harus tetap,
- setiap service target wajib punya boundary test baru,
- `global.*` tidak boleh sekadar “disamarkan”; read/write owner baru harus jelas,
- Header Doc wajib sinkron di semua file yang disentuh.

## 10. Controlled Risks

### 10.1 Hidden Dependency Disguised

Contoh:

- `global.*` tidak lagi dibaca langsung, tetapi wrapper baru tetap hanya menjadi alias tanpa ownership nyata.

Mitigasi:

- gunakan repository/runtime owner yang konkret,
- static guardrail test untuk service target.

### 10.2 Undocumented Global Side Effect

Contoh:

- service ternyata bergantung pada mutasi global yang tidak terlihat dari kontrak function.

Mitigasi:

- purge per service penuh,
- regression test behavior sebelum dan sesudah.

### 10.3 Dual Cache Path

Contoh:

- service menulis ke repo baru tetapi flow lain masih membaca cache lama untuk concern yang sama.

Mitigasi:

- tetapkan satu owner read/write per concern,
- jika perlu pakai compatibility sync yang eksplisit dan sementara.

Karena proyek belum live, risiko ini tetap dinilai terkendali bila dijalankan bertahap dan disiplin.

## 11. Verification Strategy

Verifikasi minimum:

- static guardrail tests untuk forbidden `global.*` access pada service target,
- behavioral regression tests existing service target,
- contract tests untuk repository/runtime helper yang menggantikan access lama,
- trace manual jalur dependency service agar bisa diikuti tanpa `global.*`.

## 12. Deliverables

Deliverable implementasi fase ini nanti:

- service target yang sudah dependency-injected,
- pengurangan direct `global.*` access pada service legacy aktif,
- repository/runtime helper untuk concern cache/data yang dipindahkan,
- guardrail tests baru untuk service boundary,
- sinkronisasi dokumentasi ownership dependency.

## 13. Success Criteria

Fase ini dianggap berhasil bila:

- service target tidak lagi membaca/memutasi `global.*` langsung,
- dependency service dapat diinject dan ditrace,
- regression tests existing tetap lolos,
- hidden dependency pada area admin/network/payment turun nyata,
- fase decomposition service/repository berikutnya menjadi jauh lebih mudah dan presisi.
