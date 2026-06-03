# Final Reporting State Authority Purge Design

> Status: Approved
> Date: 2026-04-22

## Goal

Menutup fase stabilisasi state sampai benar-benar clear dengan memindahkan authority reporting sepenuhnya ke `reporting.state.js` dan `conversation-state-router.js`, lalu menghapus fallback reporting aktif dari `message/raf.js`.

## Approach

Pendekatan yang dipilih: `Final reporting authority purge`.

Alasan:
- ini adalah sisa dual-path state terbesar,
- membersihkan reporting akan menutup fase stabilisasi state secara nyata,
- setelah ini `conversation-state-router` bisa dianggap otoritas state utama.

## Current State

Yang sudah clear:
- `agent-voucher` fallback aktif tidak lagi jadi jalur utama,
- `payment` ringan tidak lagi bergantung pada jalur aktif lama,
- `wifi` dan `teknisi` fallback aktif sudah didorong keluar dari jalur utama,
- `conversation-state-router` sudah menjadi entry authority untuk state domain.

Yang belum clear:
- `message/raf.js` masih memegang branch reporting besar seperti:
  - `REPORT_MENU`
  - `REPORT_LEMOT_ANALYSIS`
  - `CONFIRM_MATI_REPORT`
  - `REPORT_MATI_TROUBLESHOOT`
  - `REPORT_MATI_PHOTO`
  - `LEMOT_AWAITING_PHOTO`
  - `CONFIRM_DIRECT_MATI`
  - `DIRECT_LEMOT_TROUBLESHOOT`
  - `GANGGUAN_MATI_AWAITING_PHOTO`
  - `GANGGUAN_MATI_DEVICE_OFFLINE`
  - `GANGGUAN_MATI_DEVICE_ONLINE`
  - `GANGGUAN_LEMOT_*`
  - `TICKET_RESOLVE_*`

## Definition of Done

Fase ini dianggap berhasil jika:
- `message/raf.js` tidak lagi mengeksekusi branch reporting state,
- semua state reporting aktif dieksekusi lewat `routeConversationState(...)`,
- `reporting.state.js` menjadi owner tunggal untuk reporting state,
- `conversation-state-boundary.test.js` melarang representative reporting branch kembali ke router utama.

## Hard Rules

Setelah fase ini:
- `message/raf.js` dilarang mengandung eksekusi langsung untuk representative reporting state.
- `reporting.state.js` wajib menanggung full authority step reporting yang masih aktif.
- step reporting baru harus masuk owner map, bukan fallback ke router.
- dual-path reporting tidak boleh tersisa.

## Implementation Slices

### Slice A: Guardrail Before Removal
- Tambah assertion yang menandai reporting fallback lama di `message/raf.js`.

### Slice B: Harden `reporting.state.js`
- Pastikan owner reporting sudah cukup menangani representative step aktif.

### Slice C: Remove Reporting Fallback from Router
- Hapus branch reporting aktif dari `message/raf.js`.

### Slice D: Tighten Boundary Tests
- Perketat `conversation-state-boundary.test.js` agar reporting fallback tidak bisa kembali.

### Slice E: Final Verification and Docs
- Jalankan regression suite reporting + bot hardening.
- Sinkronkan docs authority final.

## Testing Strategy

Wajib ada:
- `conversation-state-boundary.test.js`
- `conversation-state-router.test.js`
- `reporting-state-owner.test.js`
- `bot-hardening.test.js`
- `raf-router-boundary.test.js`

Tambahkan regression khusus reporting bila perlu untuk memastikan authority tidak bocor.

## Risks

Risiko utama:
- ada step reporting yang hanya hidup di fallback lama,
- `reporting.state.js` belum setara untuk beberapa jalur foto/troubleshoot,
- removal besar di `message/raf.js` bisa meninggalkan gap jika dilakukan tanpa guardrail.

Mitigasi:
- representative guardrails sebelum purge,
- hapus hanya branch yang sudah tercakup owner,
- rerun regression penuh setelah penghapusan.

## Success Criteria

Fase ini selesai jika:
- reporting fallback aktif hilang dari `message/raf.js`,
- `conversation-state-router` menjadi authority state nyata,
- tidak ada lagi dual-path state handling domain prioritas,
- struktur state bot bisa dianggap clear untuk fase stabilisasi ini.
