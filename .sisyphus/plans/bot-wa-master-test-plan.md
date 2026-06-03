# Master Test Plan: RAF BOT V2 (End-to-End & Role-Based)

## 1. Objective
Memastikan seluruh fitur bot WhatsApp (umum, pelanggan, teknisi, admin, agent) berjalan sesuai spesifikasi bisnis, aman dari leakage otorisasi, tangguh terhadap skenario koneksi/idempotensi, dan konsisten menggunakan `canonicalId` (HP-only policy) meskipun input berasal dari `@lid`.

## 2. Scope & Boundaries
**IN SCOPE:**
- Unit tests untuk utilities (`jid-utils`, `state-manager`, intent parser).
- Integration tests untuk router utama (`message/raf.js`) -> handlers.
- Scenario tests lintas role (Umum, Pelanggan, Teknisi, Admin, Agent).
- Regression tests untuk Edge Cases (LID fallback, cancel routing, idempotency).

**OUT OF SCOPE:**
- Pengujian UI Web Portal (hanya menguji bot WhatsApp).
- Pengujian MikroTik langsung di jaringan production (wajib di-mock).

## 3. Test Fixture & Mock Strategy
- **Event Mocking**: Semua payload `messages.upsert` dan `connection.update` Baileys harus disimulasikan via `jest` mocks.
- **Identity Mocking**: 
  - Skenario PN: JID `6281234567890@s.whatsapp.net`
  - Skenario LID Sukses: JID `12345@lid` -> return `6281234567890@s.whatsapp.net` via `raf.signalRepository.lidMapping.getPNForLID`.
  - Skenario LID Gagal: `getPNForLID` return `null`.
- **Database/State**: Reset mock `global.users`, `global.teknisiStates`, dan SQLite per test-case.

---

## 4. Execution Phases

### Phase 1: Test Harness & Foundation
- [x] Buat file utilitas testing di `lib/__tests__/helpers/test-harness.js`.
- [x] Implementasi fungsi builder mock payload `messages.upsert`.
- [x] Implementasi mock socket Baileys `raf` (termasuk `sendMessage`, `signalRepository`, dll).
- [x] Implementasi mock database/state initialization resetter.

### Phase 2: Unit Testing (Critical Helpers)
- [x] **File**: `lib/__tests__/jid-utils.test.js`
  - [x] Test `toCanonicalJid` berhasil resolve PN.
  - [x] Test `toCanonicalJid` fallback null jika resolver gagal.
  - [x] Test `buildCanonicalContext` mapping state.
- [x] **File**: `lib/__tests__/state-manager.test.js`
  - [x] Test lock per-sender (`isProcessing`, `setProcessing`, `clearProcessing`).

### Phase 3: Integration Testing (Router & Gates)
- [ ] **File**: `message/__tests__/raf-router.test.js`
  - [ ] Test intent dispatching dasar (menu -> `menu-handler.js`).
  - [ ] Test Role Guard (Cegah user biasa akses intent teknisi/owner).
  - [ ] Test State Guard (Perintah umum dialihkan ke state aktif).
  - [ ] Test Global Cancel (`batal`) menghapus `temp`, state, dan `global.teknisiStates` sepenuhnya.

### Phase 4: Scenario Testing — Teknisi Workflow
- [ ] **File**: `message/handlers/__tests__/teknisi-workflow.test.js`
  - [ ] Test ambil tiket (`proses ID`).
  - [ ] Test perjalanan (`otw ID`).
  - [ ] Test OTP flow (input salah vs benar).
  - [ ] Test photo upload guard (harus sesuai urutan step kategori foto).
  - [ ] Test finish (`selesai ID`) update status final.

### Phase 5: Scenario Testing — Pelanggan & Laporan
- [ ] **File**: `message/handlers/__tests__/customer-report.test.js`
  - [ ] Test masuk menu lapor.
  - [ ] Test percabangan "Mati" vs "Lemot".
  - [ ] Test pembuatan tiket keluhan (simpan ke DB).
- [ ] **File**: `message/handlers/__tests__/wifi-management.test.js`
  - [ ] Test ganti password WiFi (harus berhasil jika modem online).

### Phase 6: Scenario Testing — Ekonomi (Topup, Saldo, Voucher)
- [ ] **File**: `message/handlers/__tests__/economic-flow.test.js`
  - [ ] Test Topup Lifecycle (Init -> Konfirmasi -> Create Request -> Upload Bukti -> Verifikasi Admin).
  - [ ] Test transaksi Voucher via saldo (`checkATMuser` dan `deductSaldo`).
  - [ ] Test validasi penolakan transaksi jika identity (`@lid`) tidak ter-resolve.

### Phase 7: Regression & Edge Cases
- [ ] **File**: `lib/__tests__/regression.test.js`
  - [ ] Test Idempotency: Kirim 2 payload `messages.upsert` dengan ID sama berturut-turut, pastikan eksekusi hanya 1 kali.
  - [ ] Test Failure isolation: Error di satu handler tidak me-restart/crash socket utama.
  - [ ] Test Unresolved LID Fallback: Memastikan fallback aman muncul dan state tidak corrupt.

---

## 5. Acceptance Criteria (Quality Gates)
- [ ] **Pass Rate**: 100% dari semua Test Matrix di atas lulus tanpa *skipped* / *failing* tests.
- [ ] **No Syntax Errors**: `npm run lint` atau `node -c` lolos di seluruh file baru.
- [ ] **Isolation Guarantee**: Setiap *test case* bisa dijalankan independen (`jest -t "nama_test"`) tanpa bergantung pada state test lain.
- [ ] **Mock Verification**: Semua test yang berinteraksi dengan API eksternal/MikroTik 100% menggunakan mock.

## 6. Execution Instructions for AI Implementer
- Dilarang membuat fitur baru, fokus HANYA pada *test coverage*.
- Eksekusi bertahap per Phase dan laporkan hasil via `npm test` sebelum beranjak ke Phase berikutnya.
- Apabila ditemukan bug pada *production code* selama pembuatan test, catat di Notepad `issues.md`, namun **fokus utama adalah menulis assertion sesuai ekspektasi plan**.
