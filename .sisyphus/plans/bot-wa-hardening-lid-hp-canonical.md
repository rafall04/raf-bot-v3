# Plan: Hardening Bot WA — LID-to-HP Canonical Identity & State Machine

**Status:** Ready for execution — Validated by Metis + Momus  
**Eksekutor:** Atlas / Sisyphus  
**Bahasa implementasi:** JavaScript CommonJS  
**Tanggal dibuat:** 2026-02-28  
**Revisi:** 2026-02-28 (post Metis + Momus + self-review)

---

## Latar Belakang & Tujuan

Bot WhatsApp menggunakan Baileys yang kini beroperasi di dunia LID-first. Sender dari WhatsApp bisa berformat `@lid` (bukan nomor HP langsung). Masalah yang terjadi:

1. **Database harus tetap canonical nomor HP** — LID hanya input transient yang dikonversi.
2. **Konversi LID belum seragam** — banyak handler masih pakai `sender.split('@')[0]` manual atau `global.users.find` duplikasi yang tidak LID-aware.
3. **State machine tidak aman** — key state (`temp[sender]`, conversation state) kadang masih pakai LID mentah, berisiko mismatch lifecycle topup/voucher.
4. **Command global tidak deterministik** — `batal/otw/selesai` belum punya precedence policy yang tegas.

---

## Kebijakan Arsitektur (Immutable Rules)

> **Eksekutor wajib mengikuti ini sebagai kontrak, tidak boleh ada deviasi.**

1. **Canonical identity = nomor HP** dalam format `628xxx@s.whatsapp.net`
2. **LID (`@lid`) hanya diproses di layer awal** (`message/raf.js` dan `lib/jid-utils.js`), TIDAK boleh lolos ke handler bisnis
3. **Satu resolver, satu source of truth** — semua lookup customer wajib pakai `resolveCustomerBySender` dari `lib/jid-utils.js`
4. **Satu state key policy** — semua state (`conversation`, lock, teknisi) memakai `canonicalId`, bukan raw `sender`
5. **Fallback aman wajib ada** — jika `getPNForLID` gagal/null, hentikan flow bisnis dengan pesan error yang jelas, jangan lanjut
6. **`normalizeJid` TIDAK boleh di-rename** — sudah dipakai di banyak tempat; `toCanonicalJid` adalah wrapper baru di atasnya
7. **`sender` asli TIDAK boleh dihapus** — tetap dipakai untuk `reply()`/`sendMessage()` ke user karena WA delivery butuh original JID

---

## Scope: IN dan OUT

### IN (Yang Dikerjakan)
- Tambah helper `toCanonicalJid` dan `buildCanonicalContext` sebagai wrapper baru di `lib/jid-utils.js` (bukan rename)
- Extract helper `getStoredMappingByLid` dari dalam `normalizeJid` menjadi fungsi standalone
- Canonicalization middleware di `message/raf.js` REUSE `normalizedSenderForSaldo` (yang sudah ada di baris ~227) sebagai `canonicalId`, BUKAN buat chain resolusi kedua
- Refactor semua handler ekonomi yang masih pakai raw sender lookup
- Unifikasi `global.users.find` manual ke `resolveCustomerBySender`
- Fix state key di conversation/topup flow agar pakai canonical ID
- Perbaikan command gate (`batal`, `otw`, `selesai`) agar precedence jelas
- Hapus fungsi `extractPhoneFromLid` lokal di `agent-voucher-handler.js` (duplikasi)
- Update `message/handlers/utils.js` agar LID-aware
- Tambah 4 file yang terlewat dari audit pertama: `reboot-modem-handler.js`, `wifi-power-handler.js`, `wifi-management-handler.js`, `ticket-creation-handler.js`
- Hapus @lid check parsial di `package-management-handler.js` baris 25 (bukan di-patch, tapi dihapus total)

### OUT (Tidak Dikerjakan dalam Plan Ini)
- Tidak mengubah skema database (tabel tetap sama)
- Tidak mengubah format respons WA ke user
- Tidak menambah fitur baru
- Tidak menyentuh file di `routes/` atau `scripts/`

---

## ⚠️ Dependency Ordering Kritis

> **Ini adalah aturan urutan yang TIDAK boleh dilanggar:**

```
Phase 0 → Phase 1 (wajib selesai dulu, terutama TODO-1.5) → Phase 2 → Phase 3/4/5 → Phase 6 → Phase 7
```

- Phase 3, 4, 5 **TIDAK bisa dimulai** sebelum TODO-1.5 selesai karena handler butuh `canonicalId` di params
- `handleTransferSaldo` (TODO-3.1) dan `handleCancelTopup` (TODO-5.4) butuh signature update yang bergantung TODO-1.5
- Phase 6 bisa paralel dengan Phase 4 dan 5, tapi tetap setelah Phase 1

---

## Phase 0 — Persiapan & Fondasi

### TODO-0.1: Extract `getStoredMappingByLid` sebagai fungsi standalone
- **File:** `lib/jid-utils.js`
- **Aksi:** Logic pencarian stored mapping yang saat ini tertanam di dalam `normalizeJid` harus di-extract menjadi fungsi standalone yang bisa dipanggil langsung
- **Signature:** `function getStoredMappingByLid(lidJid): { phoneNumber, pnJid } | null`
- **PENTING:** Tidak mengubah behavior `normalizeJid` — hanya extract ke fungsi terpisah agar bisa dipanggil dari `toCanonicalJid`
- **QA:** Unit test: given LID yang ada di `database/lid-mappings.json`, harus return object mapping yang benar

### TODO-0.2: Tambah helper `toCanonicalJid(jid, msg, raf)` di `lib/jid-utils.js`
- **Tujuan:** Satu fungsi wrapper entry point untuk konversi LID -> canonical HP JID
- **Signature:** `async function toCanonicalJid(jid, msg = null, raf = null): Promise<string|null>`
- **Logic** (urut, tidak boleh diubah):
  ```js
  async function toCanonicalJid(jid, msg = null, raf = null) {
    // Non-LID: langsung normalize
    if (!isLidJid(jid)) return normalizePhoneToJid(extractPhoneFromJid(jid))

    // Step 1: cek stored mapping
    const stored = getStoredMappingByLid(jid)
    if (stored) return normalizePhoneToJid(stored.phoneNumber)

    // Step 2: cek metadata pesan
    const fromMeta = getPreferredPlainSenderNumber(msg, jid)
    if (fromMeta && !fromMeta.includes('@lid')) return normalizePhoneToJid(fromMeta)

    // Step 3: query Baileys signalRepository
    if (raf?.signalRepository?.lidMapping) {
      const pnJid = await raf.signalRepository.lidMapping.getPNForLID(jid)
      if (pnJid) {
        saveMappings({ lid: jid, pnJid })
        return pnJid
      }
    }

    // Step 4: fallback — tidak bisa dikonversi
    return null
  }
  ```
- **PENTING:** Return `null` harus di-handle oleh caller dengan early return + pesan error ke user
- **QA:** Unit test 5 skenario:
  - (a) non-LID JID → pass-through ke `@s.whatsapp.net`
  - (b) LID ada di stored mapping → return canonical HP
  - (c) LID ada di message metadata → return canonical HP
  - (d) LID ditemukan via `getPNForLID` → return canonical HP + persist ke JSON
  - (e) LID gagal semua langkah → return `null`
- **Mock yang wajib:** `raf.signalRepository.lidMapping.getPNForLID` sebagai async jest mock; `fs` mock untuk `loadMappings/saveMappings`

### TODO-0.3: Tambah helper `buildCanonicalContext(rawSender, msg, raf)` di `lib/jid-utils.js`
- **Tujuan:** Menghasilkan context object siap pakai untuk `raf.js`
- **Signature:** `async function buildCanonicalContext(rawSender, msg, raf): Promise<{canonicalId, phoneNumber, isResolved, isLid, rawSender}>`
- **Output shape:**
  ```js
  {
    canonicalId: "628xxx@s.whatsapp.net",  // null jika gagal resolve
    phoneNumber: "628xxx",                  // canonical bare phone number
    isResolved: true,                       // false jika LID tidak terkonversi
    isLid: true,                            // apakah sender asal adalah @lid
    rawSender: "xxx@lid"                    // original untuk logging & WA delivery
  }
  ```
- **PENTING:** Fungsi ini memanggil `toCanonicalJid` secara internal; tidak duplikasi logic
- **QA:** Test bahwa `context.canonicalId` selalu `@s.whatsapp.net` atau `null` (tidak pernah `@lid`)

### TODO-0.4: Tambah `ensureMappingsFile()` — pastikan file JSON ada saat init
- **File:** `lib/jid-utils.js`
- **Dipanggil dari:** Awal `loadMappings()` atau saat file `lib/jid-utils.js` di-require
- **Aksi:** Cek apakah `database/lid-mappings.json` ada; jika tidak, buat dengan isi `{ "mappings": [] }`
- **QA:** Cek file terbentuk saat `node index.js` start, verifikasi format JSON valid

---

## Phase 1 — Canonicalization Middleware di `message/raf.js`

> **⚠️ PERHATIAN KRITIS:** `message/raf.js` sudah memiliki `normalizedSenderForSaldo` di baris ~227 yang merupakan hasil resolusi LID. Jangan buat chain resolusi kedua — REUSE ini sebagai `canonicalId`.

### TODO-1.1: REUSE `normalizedSenderForSaldo` sebagai `canonicalId`
- **File:** `message/raf.js`
- **Lokasi:** Sekitar baris ~228 (setelah `normalizedSenderForSaldo` dihitung)
- **Aksi:** Tambah alias `const canonicalId = normalizedSenderForSaldo || sender`
- **Guard:** Tambah early return jika sender adalah LID tapi canonical tidak bisa dihitung:
  ```js
  const canonicalId = normalizedSenderForSaldo
  if (sender.endsWith('@lid') && !canonicalId) {
    await reply(mess.lidNotResolved || 'Maaf, identitas nomor Anda belum dapat dikenali. Silakan coba beberapa saat lagi.')
    clearProcessing(sender)
    return
  }
  ```
- **PENTING:** JANGAN panggil `buildCanonicalContext` atau `toCanonicalJid` lagi di sini — `normalizedSenderForSaldo` sudah merupakan hasil resolusi yang sama
- **QA:** Log `canonicalId` di dev mode; verifikasi selalu format `@s.whatsapp.net` atau proses berhenti

### TODO-1.2: Ganti semua `isProcessing/setProcessing/clearProcessing(sender)` → `canonicalId`
- **File:** `message/raf.js`
- **Baris target:** ~352, ~357, ~2420 (dan semua `clearProcessing` di `finally`)
- **Pattern lama:** `isProcessing(sender)` / `setProcessing(sender)` / `clearProcessing(sender)`
- **Pattern baru:** `isProcessing(canonicalId)` / `setProcessing(canonicalId)` / `clearProcessing(canonicalId)`
- **Pengecualian:** `clearProcessing` di dalam early return sebelum canonical diketahui tetap pakai `sender`
- **QA:** Test dua pesan cepat dari `@lid` user; pastikan tidak ada double-processing

### TODO-1.3: Ganti semua state key dari `sender` ke `canonicalId`
- **File:** `message/raf.js`
- **Target:** Semua `getUserState(sender)`, `setUserState(sender, ...)`, `deleteUserState(sender)`, `temp[sender]`
- **Pattern baru:** Ganti semua dengan `canonicalId`
- **Perhatian:** `reply()` dan `sendMessage()` TETAP pakai `sender` (rawSender) untuk WA delivery
- **QA:** Test multi-step conversation (topup flow lengkap) dari akun `@lid` — state harus konsisten step 1 sampai confirm

### TODO-1.4: Global command gate — verifikasi `teknisiWorkflowCommands` sudah benar
- **File:** `message/raf.js`
- **Cek apakah pola ini sudah ada (dari patch sebelumnya):**
  ```js
  const globalCommands = ['menu','bantuan','help','lapor','ceksaldo','saldo']
  const teknisiWorkflowCommands = ['otw','sampai','selesai','proses','verifikasi','done']
  const isTeknisiWorkflowCommand = teknisiWorkflowCommands.includes(commandCheck)
  isGlobalCommand = !isTeknisiWorkflowCommand && globalCommands.includes(commandCheck)
  ```
- **Jika sudah ada:** Tambahkan comment dokumentasi di atasnya saja (satu baris)
- **Jika belum ada:** Implementasikan pola di atas
- **QA:**
  - Test kirim `selesai` saat dalam state topup → state topup TIDAK boleh terhapus
  - Test kirim `batal` saat dalam state topup → state topup wajib dihapus, reply konfirmasi batal

### TODO-1.5: Teruskan `canonicalId` dan `raf` ke SEMUA handler call
- **File:** `message/raf.js`
- **Aksi:** Semua pemanggilan handler di dalam switch intent harus menyertakan `canonicalId` dan `raf`
- **Pattern:**
  ```js
  // Lama
  handleSomeFeature({ sender, msg, reply, mess, global })

  // Baru
  handleSomeFeature({ sender, canonicalId, msg, raf, reply, mess, global })
  ```
- **Prioritas update signature handler:** Mulai dari handler yang dipanggil Phase 3/4/5
- **QA:** Grep semua handler call di `raf.js`, pastikan tidak ada yang tidak meneruskan `canonicalId` dan `raf`

---

## Phase 2 — Refactor `message/handlers/utils.js`

### TODO-2.1: Update `getUserByJid` agar LID-aware
- **File:** `message/handlers/utils.js`
- **Fungsi:** `getUserByJid(jid, users)` — saat ini pakai `global.users.find(u => u.whatsapp_jid === jid)` manual
- **Pola baru:**
  ```js
  // Ubah signature menjadi async
  async function getUserByJid(jid, users, msg = null, raf = null) {
    const { user } = await resolveCustomerBySender({
      users,
      sender: jid,
      msg,
      raf
    })
    return user
  }
  ```
- **Import tambahan:** `const { resolveCustomerBySender } = require('../../lib/jid-utils')`
- **Update exports** di `module.exports`
- **QA:** Test dengan JID `@lid` dan JID `@s.whatsapp.net` biasa

### TODO-2.2: Update `getUserByPhone` — normalisasi konsisten
- **File:** `message/handlers/utils.js`
- **Aksi:** Pastikan menggunakan `normalizePhoneNumber` dari `lib/jid-utils` bukan regex manual
- **QA:** Test dengan berbagai format (`08xxx`, `628xxx`, `+628xxx`)

---

## Phase 3 — Refactor Handler Ekonomi (Prioritas Tinggi)

> **Prerequisit:** TODO-1.5 wajib selesai dulu. Semua handler di phase ini butuh `canonicalId` dan `raf` di params.

### TODO-3.1: `message/handlers/saldo-handler.js` — `handleTransferSaldo`
- **Prerequisit:** TODO-1.5 selesai
- **Lokasi:** Baris ~277 (manual `global.users.find` untuk `senderUser`)
- **Aksi:**
  1. Tambah `canonicalId` dan `raf` ke signature fungsi
  2. Update call site di `raf.js` untuk meneruskan `canonicalId` dan `raf`
  3. Ganti manual find:
     ```js
     const { user: senderUser } = await resolveCustomerBySender({
       users: global.users,
       sender: canonicalId,
       msg,
       raf
     })
     ```
- **Import tambahan:** `const { resolveCustomerBySender } = require('../../lib/jid-utils')`
- **QA:** Test transfer saldo dari akun `@lid` ke akun lain

### TODO-3.2: `message/handlers/payment-processor-handler.js`
- **Prerequisit:** TODO-1.5 selesai
- **Lokasi baris ~39:** `sender.split('@')[0]` → `canonicalId ? canonicalId.split('@')[0] : sender.split('@')[0]`
- **Lokasi baris ~139:** `temp[sender]` yang ada di sini → `temp[canonicalId]`
- **Pastikan:** `canonicalId` diteruskan dari `raf.js` ke fungsi ini
- **QA:** Test purchase voucher dari `@lid`; verifikasi payment record menggunakan nomor HP

### TODO-3.3: `message/handlers/agent-voucher-handler.js` — Hapus `extractPhoneFromLid` lokal
- **Lokasi:** Baris ~19-45 (fungsi lokal redundan)
- **Aksi:**
  1. Hapus seluruh fungsi `extractPhoneFromLid` lokal
  2. Import `extractSenderInfo` dan `toCanonicalJid` dari `lib/jid-utils`
  3. Ganti semua pemanggilan `extractPhoneFromLid(msg, sender, raf)` dengan `toCanonicalJid(sender, msg, raf)`
  4. Pada baris ~424 dan ~538: `customerId` harus merupakan canonical JID, bukan LID
- **QA:** Test purchase agent voucher dari `@lid`; verifikasi `customerId` yang tersimpan adalah nomor HP

### TODO-3.4: `message/handlers/balance-management-handler.js`
- **Prerequisit:** TODO-1.5 selesai
- **Lokasi:** Baris ~165 (cari fungsi yang mengandung `global.users.find` — BUKAN `handleBalanceInfo`, baca file segar untuk nama fungsi yang benar)
- **Aksi:** Ganti manual find dengan `resolveCustomerBySender`
- **⚠️ CATATAN METIS:** Eksekutor wajib baca file terlebih dahulu untuk konfirmasi nama fungsi yang sebenarnya di baris ~165 sebelum edit
- **QA:** Test cek saldo dari `@lid` sender

---

## Phase 4 — Refactor Handler Pelanggan

> Semua handler berikut: ganti `global.users.find` manual dengan `resolveCustomerBySender`. Prerequisit: TODO-1.5 selesai.

### TODO-4.1: `message/handlers/package-management-handler.js`
- **Target fungsi:** `handlePackageList` (baris ~17) dan `handlePackageChange` (baris ~119)
- **Aksi tambahan:** Hapus total @lid check parsial di baris ~25 (JANGAN di-patch, hapus saja karena akan diganti oleh `resolveCustomerBySender` yang sudah LID-aware)
- **Pattern baru:** `const { user } = await resolveCustomerBySender({ users: global.users, sender: canonicalId, msg, raf })`
- **Import:** Tambah `resolveCustomerBySender` dari `lib/jid-utils`
- **QA:** Test cek paket dari `@lid`; test ubah paket dari `@lid`

### TODO-4.2: `message/handlers/access-management-handler.js`
- **Target:** `handleAccessManagement` (baris ~12, 24)
- **Pola lama:** `sender.split('@')[0]` + `global.users.find`
- **Pattern baru:** `resolveCustomerBySender`
- **QA:** Test akses manajemen dari `@lid`

### TODO-4.3: `message/handlers/wifi-check-handler.js`
- **Target:** `handleWifiCheck` (baris ~16, 65)
- **Pattern baru:** `resolveCustomerBySender`
- **QA:** Test cek status WiFi dari `@lid`

### TODO-4.4: `message/handlers/wifi-history-handler.js`
- **Target:** `handleWifiHistory` (baris ~8, 20)
- **Pattern baru:** `resolveCustomerBySender`
- **QA:** Test riwayat WiFi dari `@lid`

### TODO-4.5: `message/handlers/smart-report-handler.js`
- **Target:** Semua fungsi yang memanggil `global.users.find` manual (baris ~17, ~48)
- **Pattern baru:** `resolveCustomerBySender`
- **QA:** Test submit laporan dari `@lid`; verifikasi tiket terbuat dan terkait ke user yang benar

### TODO-4.6: `message/handlers/smart-report-hybrid.js`
- **Target:** Semua fungsi user lookup (baris ~12, ~40)
- **Pattern baru:** `resolveCustomerBySender`
- **QA:** Test semua entry point report dari `@lid`

### TODO-4.7: `message/handlers/reboot-modem-handler.js` (BARU — terlewat di audit pertama)
- **Target:** Baris ~20, ~23 (raw split `@s.whatsapp.net`/metadata)
- **Pattern baru:** `resolveCustomerBySender`
- **QA:** Test reboot modem dari `@lid`

### TODO-4.8: `message/handlers/wifi-power-handler.js` (BARU — terlewat di audit pertama)
- **Target:** Baris ~35, ~39, ~42 (raw split)
- **Pattern baru:** `resolveCustomerBySender`
- **QA:** Test WiFi power command dari `@lid`

### TODO-4.9: `message/handlers/wifi-management-handler.js` (BARU — terlewat di audit pertama)
- **Target:** Baris ~32, ~37, ~40, ~171, ~175, ~178 (raw split, banyak titik)
- **Pattern baru:** `resolveCustomerBySender`
- **QA:** Test manajemen WiFi dari `@lid`

### TODO-4.10: `message/handlers/ticket-creation-handler.js` (BARU — terlewat di audit pertama)
- **Target:** Baris ~52 — `pelangganPlainNumber = pelangganId.split('@')[0]`
- **Aksi:** Ganti dengan `pelangganPlainNumber = extractPhoneFromJid(pelangganId)` dari `lib/jid-utils`
- **Import:** Tambah `extractPhoneFromJid` dari `lib/jid-utils`
- **QA:** Test buat tiket untuk pelanggan `@lid`

---

## Phase 5 — Hardening Topup/Saldo Lifecycle

### TODO-5.1: `lib/saldo-manager.js` — Tambah `normalizeUserId` sebagai warning-only shim
- **Aksi:** Tambah fungsi internal di atas `createTopupRequest`, `getUserTopupRequests`, dan `verifyTopupRequest`:
  ```js
  function normalizeUserId(userId) {
    if (!userId) return userId
    if (userId.endsWith('@lid')) {
      logger.warn('[SALDO-MANAGER] Received @lid userId — caller belum normalize', { userId })
      return userId  // tetap lolos tapi log warning, tidak crash
    }
    return userId.replace(/:\d+@/, '@')  // strip device suffix saja
  }
  ```
- **Panggil di awal ketiga fungsi tersebut:** `userId = normalizeUserId(userId)`
- **PENTING:** Ini adalah SHIM warning-only, bukan hard block. Tidak refactor normalisasi existing yang sudah ada di dalam saldo-manager
- **Tujuan:** Alarm dini jika LID lolos ke manager — jika Phase 1-4 benar, warning ini tidak akan pernah muncul
- **QA:** Verifikasi tidak ada warning di log saat topup flow normal dari `@lid` (artinya upstream sudah benar)

### TODO-5.2: `message/handlers/steps/saldo-steps.js` — Pastikan `paymentSender` canonical
- **Lokasi:** State init topup (TOPUP_SELECT_METHOD) dan TOPUP_CONFIRM
- **Aksi:** `paymentSender` yang di-store di state dan dipakai di `createTopupRequest` harus `canonicalId`:
  ```js
  setUserState(canonicalId, {
    step: 'TOPUP_SELECT_METHOD',
    type: 'topup',
    pushname,
    paymentSender: canonicalId  // canonical bukan raw sender
  })
  ```
- **Pada TOPUP_CONFIRM:**
  ```js
  const paymentSender = userState.paymentSender || canonicalId
  saldoManager.createTopupRequest(paymentSender, ...)
  ```
- **QA:** Full flow test topup dari `@lid`: init → pilih metode → input jumlah → confirm → verifikasi `createTopupRequest` dipanggil dengan `628xxx@s.whatsapp.net` bukan `@lid`

### TODO-5.3: `message/handlers/topup-handler.js` — Verifikasi `requestLookupId` sudah canonical
- **Lokasi:** Fungsi `handleTopupPaymentProof`
- **Cek:** Apakah `requestLookupId = senderInfo.normalizedSender || sender` sudah menghasilkan `@s.whatsapp.net`?
- **Jika BELUM canonical:** Ganti dengan `toCanonicalJid(msg.key.remoteJid, msg, raf)` — pastikan `raf` diteruskan ke fungsi ini dari `raf.js`
- **Jika SUDAH canonical:** Cukup tambah assertion log saja (verifikasi format)
- **QA:** Test upload bukti topup dari akun `@lid`; pending request harus ketemu dan diproses dengan benar

### TODO-5.4: `message/handlers/saldo-handler.js` — `handleCancelTopup` pakai canonical
- **Prerequisit:** TODO-1.5 selesai
- **Fungsi:** `handleCancelTopup(msg, sender, reply)` — update signature menjadi `handleCancelTopup(msg, sender, canonicalId, reply)`
- **Update call site di raf.js** untuk meneruskan `canonicalId`
- **Pola lama:** `r.userId === sender` (exact match pakai raw sender)
- **Pola baru:** `r.userId === canonicalId`
- **QA:** Test batal topup dari `@lid`; pending request harus dihapus dengan benar

---

## Phase 6 — State Machine & Teknisi Flow

### TODO-6.1: `message/handlers/conversation-handler.js` — Defensive canonical check
- **Aksi:** Tambah guard warning jika `userId` yang masuk masih `@lid`:
  ```js
  function setUserState(userId, state) {
    if (userId && userId.endsWith('@lid')) {
      logger.warn('[STATE] setUserState dipanggil dengan @lid key — periksa caller', { userId })
    }
    // ... existing logic tidak diubah
  }
  ```
- **Tujuan:** Deteksi dini jika ada caller yang belum canonical setelah Phase 1-5
- **QA:** Verifikasi tidak ada warning di log saat alur normal setelah Phase 1-5 selesai

### TODO-6.2: `message/handlers/teknisi-workflow-handler.js` — Verifikasi state key
- **Aksi:** Pastikan semua `global.teknisiStates[sender]` diganti ke `global.teknisiStates[canonicalId]`
- **⚠️ PENTING:** `sender` untuk kirim WA (`sendMessage`, `reply`) tetap pakai sender asli (rawSender), hanya state key yang pakai canonical
- **QA:** Full lifecycle teknisi dari OTW sampai selesai dari akun `@lid`; state tidak boleh hilang di tengah jalan

### TODO-6.3: `message/handlers/teknisi-photo-handler-v3.js` — Verifikasi state key
- **Aksi:** Pastikan semua `global.teknisiStates[sender]` pakai `canonicalId`
- **QA:** Test upload foto dari akun teknisi yang menggunakan `@lid`

---

## Phase 7 — Testing & Verification

> **Commit kecil wajib dilakukan setelah setiap Phase selesai** sebelum lanjut ke Phase berikutnya.

### TODO-7.1: Unit test `lib/jid-utils.js`
- **File baru:** `lib/__tests__/jid-utils.test.js`
- **Test case wajib:**
  - `toCanonicalJid` non-LID JID → pass-through ke `@s.whatsapp.net`
  - `toCanonicalJid` LID ada di stored mapping → return canonical HP
  - `toCanonicalJid` LID ada di message metadata → return canonical HP
  - `toCanonicalJid` LID ditemukan via `getPNForLID` mock → return canonical HP + panggil `saveMappings`
  - `toCanonicalJid` LID gagal semua → return `null`
  - `buildCanonicalContext` → `isResolved: false` dan `canonicalId: null` untuk LID yang tidak bisa dikonversi
  - `resolveCustomerBySender` → menemukan user dengan phone canonical
- **Mock wajib:** `raf.signalRepository.lidMapping.getPNForLID` sebagai async jest mock; `fs` mock untuk JSON file

### TODO-7.2: Integration test topup flow untuk `@lid` sender
- **File baru:** `lib/__tests__/topup-lid-flow.test.js`
- **Test case wajib:**
  - Topup init dari `@lid` → state key canonical → `createTopupRequest` dipanggil dengan `628xxx@s.whatsapp.net`
  - Upload bukti dari `@lid` → request ditemukan dengan canonical lookup
  - Admin verify → saldo masuk ke user yang benar
  - Batal topup dari `@lid` → request dihapus dengan benar

### TODO-7.3: Integration test state machine command precedence
- **File baru:** `lib/__tests__/state-gate.test.js`
- **Test case wajib:**
  - Kirim `batal` saat dalam topup flow → state dihapus, request dibatalkan
  - Kirim `selesai` saat dalam topup flow → TIDAK clear state topup
  - Kirim `selesai` dari akun teknisi saat tidak ada state → normal routing ke intent switch
  - Kirim `otw` dari akun teknisi → tidak breakout dari state lain, diproses sebagai intent teknisi

### TODO-7.4: Jalankan `npm test` dan verifikasi semua pass
- **Perintah:** `npm test`
- **Syarat lolos:** 0 failures; semua test suite pass termasuk test baru; tidak ada warning kritis di output
- **Gate:** Jika ada failure, fix dulu sebelum dianggap done

---

## Acceptance Criteria (Definition of Done)

Eksekutor hanya boleh menyatakan selesai jika SEMUA kondisi berikut terpenuhi:

- [ ] Tidak ada `@lid` yang lolos ke `lib/saldo-manager.js` (verifikasi via warning log clean)
- [ ] Semua 13 handler yang teridentifikasi pakai raw sender / manual find sudah diganti ke `resolveCustomerBySender`
- [ ] `toCanonicalJid` gagal → bot reply error aman, tidak crash, tidak proses bisnis lanjut
- [ ] Full topup lifecycle dari `@lid` sender lulus test (init → confirm → upload bukti → verified)
- [ ] `batal` dari user `@lid` dalam topup flow membatalkan request dengan benar
- [ ] Teknisi workflow (`otw/sampai/selesai`) tidak tertrigger sebagai global command breakout
- [ ] `npm test` pass 100% termasuk 3 test file baru
- [ ] LSP diagnostics bersih untuk semua file yang dimodifikasi
- [ ] Tidak ada double-resolution chain di `raf.js` (`normalizedSenderForSaldo` dipakai ulang sebagai `canonicalId`, bukan dua kali resolve)

---

## Guardrail untuk AI Eksekutor

1. **Jangan ubah skema database** — hanya ubah logic resolusi identity
2. **Jangan hapus `sender` asli** — tetap dipakai untuk `reply()`/`sendMessage()` ke user
3. **Jangan rename `normalizeJid`** — buat wrapper baru `toCanonicalJid` saja
4. **Jangan buat double resolution** — REUSE `normalizedSenderForSaldo` di `raf.js` sebagai `canonicalId`
5. **Baca file dulu sebelum edit** — terutama `balance-management-handler.js` baris ~165 untuk konfirmasi nama fungsi
6. **Jangan merge dua phase sekaligus** — kerjakan satu TODO per satu, verifikasi lulus sebelum lanjut
7. **Commit kecil per phase** — memudahkan rollback jika ada regresi
8. **Jika ada file yang tidak ada di plan** — jangan disentuh, laporkan ke user

---

## Referensi File Kunci

| File | Role | Priority |
|------|------|----------|
| `lib/jid-utils.js` | Foundation — semua resolver LID/JID | Phase 0 |
| `message/raf.js` | Orchestrator — canonicalization middleware | Phase 1 |
| `message/handlers/utils.js` | Shared utility — LID-aware update | Phase 2 |
| `lib/saldo-manager.js` | DB saldo/topup — identity-sensitive | Phase 5 |
| `message/handlers/saldo-handler.js` | Ekonomi — transfer + cancel topup | Phase 3+5 |
| `message/handlers/topup-handler.js` | Ekonomi — proof upload | Phase 5 |
| `message/handlers/payment-processor-handler.js` | Ekonomi — payment | Phase 3 |
| `message/handlers/steps/saldo-steps.js` | Ekonomi — topup multi-step | Phase 5 |
| `message/handlers/agent-voucher-handler.js` | Ekonomi — voucher agent | Phase 3 |
| `message/handlers/balance-management-handler.js` | Ekonomi — balance info | Phase 3 |
| `message/handlers/package-management-handler.js` | Pelanggan — paket | Phase 4 |
| `message/handlers/access-management-handler.js` | Pelanggan — akses | Phase 4 |
| `message/handlers/wifi-check-handler.js` | Pelanggan — cek WiFi | Phase 4 |
| `message/handlers/wifi-history-handler.js` | Pelanggan — riwayat WiFi | Phase 4 |
| `message/handlers/smart-report-handler.js` | Pelanggan — laporan | Phase 4 |
| `message/handlers/smart-report-hybrid.js` | Pelanggan — laporan hybrid | Phase 4 |
| `message/handlers/reboot-modem-handler.js` | Pelanggan — reboot | Phase 4 |
| `message/handlers/wifi-power-handler.js` | Pelanggan — WiFi power | Phase 4 |
| `message/handlers/wifi-management-handler.js` | Pelanggan — manajemen WiFi | Phase 4 |
| `message/handlers/ticket-creation-handler.js` | Tiket — buat tiket | Phase 4 |
| `message/handlers/teknisi-workflow-handler.js` | State teknisi | Phase 6 |
| `message/handlers/teknisi-photo-handler-v3.js` | State teknisi — foto | Phase 6 |
| `message/handlers/conversation-handler.js` | State store — key policy guard | Phase 6 |
