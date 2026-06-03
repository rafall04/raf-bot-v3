# Conversation State Stabilization Phase 2 Design

> Status: Approved
> Date: 2026-04-22

## Goal

Menstabilkan hasil konsolidasi state agar `conversation-state-router` benar-benar menjadi jalur otoritatif, sementara fallback branch lama di `message/raf.js` dipurge bertahap per domain.

Target praktis:
- `message/raf.js` makin tipis dan deterministic,
- tidak ada dual-path state handling untuk domain prioritas,
- state domain owner benar-benar menjadi jalur eksekusi aktif.

## Approach

Pendekatan yang dipilih: `Router authority hardening`.

Alasan:
- paling aman untuk melanjutkan batch konsolidasi sebelumnya,
- meminimalkan risiko regresi,
- memungkinkan purge fallback dilakukan bertahap dengan guardrail yang ketat.

## Problem Statement

Batch sebelumnya sudah menambah:
- owner map state,
- `conversation-state-router`,
- bounded state owner files.

Namun `message/raf.js` masih menyimpan fallback branch lama sebagai compatibility shell. Ini berarti ownership sudah ada, tetapi belum final dan masih ada potensi dual-path.

## Definition of Done

Fase ini dianggap berhasil jika:
- `conversation-state-router` menjadi jalur utama execution untuk state domain prioritas,
- fallback branch lama di `message/raf.js` berkurang nyata atau hilang untuk domain yang sudah stabil,
- guardrail test menolak kembalinya branch state domain ke router utama,
- `message/raf.js` lebih tipis dan owner state lebih deterministic.

## Target Scope

Urutan stabilisasi:
1. `agent-voucher` prefix state
2. `payment` ringan (`ASK_VOUCHER_CHOICE`, `AWAITING_QUESTION`)
3. `wifi` managed + legacy wifi state
4. `teknisi` completion/photo branch
5. `reporting` branch besar

Alasan:
- domain kecil dibersihkan dulu untuk mengurangi dual-path dengan risiko rendah,
- reporting paling besar dan paling sensitif sehingga dibersihkan terakhir.

## Forbidden Paths

Setelah fase ini:
- `message/raf.js` dilarang menangani langsung:
  - `AGENT_VOUCHER_*`
  - `ASK_VOUCHER_CHOICE`
  - `AWAITING_QUESTION`
  - managed WiFi step
  - teknisi photo/completion step
  - reporting step yang sudah punya owner domain

State baru wajib masuk melalui:
- `conversation-state-owner-map.js`
- `conversation-state-router.js`
- satu file owner domain yang jelas

## Implementation Slices

### Slice A: Guardrail Before Purge
- Tambah source/static tests yang mendeteksi fallback branch lama per domain.

### Slice B: Purge `agent-voucher` + `payment`
- Hapus fallback branch kecil yang sudah aman.

### Slice C: Purge `wifi`
- Pastikan managed + legacy WiFi state hanya dieksekusi via owner domain.

### Slice D: Purge `teknisi`
- Pindahkan authority final untuk photo/completion state.

### Slice E: Purge `reporting`
- Reporting dibersihkan terakhir setelah domain owner cukup stabil.

### Slice F: Docs + Guardrails Hardening
- Perketat `conversation-state-boundary.test.js`.
- Sinkronkan map docs.

## Testing Strategy

Wajib ada:
- source/static tests:
  - branch fallback lama sudah hilang dari `message/raf.js`
- router authority tests:
  - state representative selalu handled lewat `conversation-state-router`
- regression tests:
  - `bot-hardening`
  - reporting state
  - wifi state
  - teknisi state
  - payment/voucher state

## Risks

Risiko utama:
- branch fallback dihapus sebelum owner domain cukup setara,
- ada step yang belum masuk owner map,
- reporting punya flow tersembunyi yang masih bergantung pada fallback lama.

Mitigasi:
- purge per domain kecil dulu,
- test sebelum dan sesudah purge,
- reporting dikerjakan paling akhir.

## Success Criteria

Fase ini dianggap selesai jika:
- `conversation-state-router` menjadi otoritas nyata,
- `message/raf.js` turun lagi secara signifikan,
- tidak ada dual-path state handling untuk domain prioritas,
- guardrail tests menjaga router utama tetap tipis.
