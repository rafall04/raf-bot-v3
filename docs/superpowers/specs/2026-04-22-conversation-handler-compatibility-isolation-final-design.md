# Conversation-Handler Compatibility Isolation Final

> Status: APPROVED

## Goal
Menutup sisa technical debt state layer dengan membuat `conversation-handler` hanya punya satu jalur aktif yang jelas:
- API state eksplisit untuk flow aktif,
- proxy compatibility terisolasi untuk boundary transisional/test,
- tidak ada consumer produksi yang lagi bergantung pada `createScopedStateProxy(...)`.

## Problem
- `message/handlers/conversation-handler.js` masih mengekspor `createScopedStateProxy(...)`.
- Compatibility tests masih memicu `legacyStateProxyRead/Write`.
- Ada risiko consumer minor/legacy masih memakai proxy karena surface itu masih publik.
- Signal compatibility dan jalur aktif masih berdekatan sehingga batas arsitektur belum final.

## Target Architecture
- `message/handlers/conversation-handler.js`
  - owner utama:
    - `getUserState`
    - `setUserState`
    - `updateUserState`
    - `deleteUserState`
    - `getScopedState`
    - `setScopedState`
    - `deleteScopedState`
  - `createScopedStateProxy(...)` tetap ada sementara, tapi dibatasi sebagai compatibility adapter.

- Consumer aktif bot/domain
  - wajib memakai API eksplisit di atas.
  - tidak boleh membuat atau menyebarkan proxy baru.

- Test compatibility
  - dipisah jelas dari regression active-flow.

## Hard Rules
- Jangan ubah behavior user-facing flow.
- Jangan hapus `createScopedStateProxy(...)` total bila masih dipakai boundary legacy/test.
- Jangan biarkan file aktif baru memakai proxy sebagai source of truth.
- Setiap perubahan ownership consumer wajib diikuti guardrail test dan doc sync.

## Implementation Slices
1. Audit semua pemanggil `createScopedStateProxy(...)`.
2. Klasifikasikan caller menjadi active production, legacy compatibility, atau test-only.
3. Migrasikan active consumer terakhir ke API state eksplisit.
4. Tambah guardrail yang melarang penggunaan proxy di jalur aktif prioritas.
5. Perjelas dokumentasi bahwa proxy tinggal compatibility-only surface.

## Verification
- `message/__tests__/conversation-handler-state-store.test.js`
- `message/__tests__/bot-hardening.test.js`
- `message/__tests__/conversation-state-boundary.test.js`
- `message/__tests__/raf-router-boundary.test.js`
- guardrail source test baru untuk caller `createScopedStateProxy(...)`

## Success Criteria
- Active path state bot tidak lagi bergantung pada proxy compatibility.
- `createScopedStateProxy(...)` tinggal adapter transisional yang jelas.
- Warning `legacyStateProxy*` tidak lagi muncul dari jalur aktif.
- State layer makin deterministic dan siap untuk fitur baru tanpa hidden dependency proxy.
