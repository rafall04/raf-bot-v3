# Conversation State Consolidation Design

> Status: Approved
> Date: 2026-04-22

## Goal

Menata ulang layer state/conversation bot agar owner state per domain jelas, transisi state tidak tercecer di `message/raf.js`, dan flow baru bisa ditambahkan tanpa menambah branching acak yang sulit dirawat.

Target praktis:
- owner state per bounded context tegas,
- router bot hanya mengarahkan state aktif ke owner yang tepat,
- legacy state shell tetap ada hanya sebagai compatibility boundary,
- penambahan fitur percakapan menjadi lebih presisi dan murah dirawat.

## Approach

Pendekatan yang dipilih: `State consolidation by bounded context`.

Alasan:
- paling sesuai untuk target struktur yang ketat,
- menurunkan risiko tabrakan state antar domain,
- memungkinkan guardrail test yang benar-benar bisa menolak kebocoran ownership.

## Definition of Done

Fase ini dianggap berhasil jika:
- `message/raf.js` tidak lagi memegang percabangan state domain besar,
- setiap state utama punya owner handler/domain tunggal,
- legacy state transition hanya tersisa sebagai compatibility shell yang jelas,
- tidak ada domain berbeda yang menangani step state yang sama,
- tersedia guardrail test untuk ownership state dan forbidden cross-domain state logic.

## Problem Statement

Kondisi saat ini masih menunjukkan:
- `message/raf.js` memegang banyak conditional state branch lintas domain,
- state reporting, teknisi, WiFi, dan payment masih overlap,
- sebagian step flow tersebar di file legacy dan step handler lama,
- ownership state belum selalu bisa ditrace dari nama step ke owner domain.

Akibatnya:
- fitur baru rawan menabrak state existing,
- debugging flow percakapan mahal,
- review perubahan sulit karena transisi state tidak terkunci.

## Target Architecture

Struktur target:

- `message/handlers/conversation-handler.js`
  - owner state store generik saja.
  - tidak memegang business rule domain.

- `message/handlers/conversation-state-router.js`
  - owner routing `state.step -> domain state owner`.

- `message/handlers/state-domains/*`
  - owner transisi state per bounded context, misalnya:
    - `reporting.state.js`
    - `wifi.state.js`
    - `teknisi.state.js`
    - `payment.state.js`
    - `agent-voucher.state.js`

- `message/raf.js`
  - hanya cek ada state aktif,
  - lempar ke `conversation-state-router`,
  - jika tidak handled baru lanjut ke intent dispatcher.

## Ownership Rules

Aturan target:

- state `REPORT_*`, `GANGGUAN_*`, `MATI_*`, `LEMOT_*` hanya boleh ditangani owner reporting.
- state `TEKNISI_*`, completion, resolution note, dan photo completion hanya owner teknisi.
- state `ASK_NEW_*`, `CONFIRM_GANTI_*`, `SELECT_SSID_*`, `SELECT_CHANGE_*` hanya owner WiFi.
- state topup/payment proof/status hanya owner payment.
- state agent voucher purchase/sale hanya owner agent-voucher.

Tidak boleh ada:
- satu step ditangani di dua file berbeda,
- router utama ikut memegang branching domain step besar,
- handler domain lain menangani state yang bukan miliknya.

## Forbidden Paths

Setelah fase ini:
- `message/raf.js` dilarang memiliki daftar panjang `if (stateStep === ...)` lintas domain.
- `conversation-handler.js` dilarang memuat branching business domain.
- file legacy tidak boleh menjadi owner utama baru.
- domain state tidak boleh menulis state domain lain secara ad hoc tanpa router/contract yang jelas.

## Implementation Slices

### Slice A: State Ownership Map
- Inventaris semua `state.step` aktif.
- Tetapkan owner tunggal untuk setiap step.
- Buat source of truth ownership map yang bisa diuji.

### Slice B: Conversation State Router
- Tambah `message/handlers/conversation-state-router.js`.
- Router ini menjadi owner dispatch dari `state.step` ke owner domain.

### Slice C: Reporting and WiFi Extraction
- Pindahkan branching state reporting dan WiFi keluar dari `message/raf.js`.
- Owner domain mengambil alih follow-up step dan compatibility logic terkait.

### Slice D: Teknisi and Payment Extraction
- Pindahkan flow photo completion, resolution, OTP/completion follow-up, dan payment proof ke owner state domain masing-masing.

### Slice E: Guardrails
- Tambah static/source tests:
  - `message/raf.js` tidak lagi memegang branching state domain besar,
  - owner map konsisten,
  - forbidden cross-domain handling tidak bocor.

### Slice F: Docs Sync
- Sinkronkan:
  - `SYSTEM_MAP.md`
  - `message/.module_map.md`
  - `message/handlers/.module_map.md`

## Testing Strategy

Wajib ada:
- owner map contract test,
- router dispatch test untuk memastikan step jatuh ke owner yang benar,
- static guardrail test bahwa `message/raf.js` tidak memegang branching state domain besar,
- regression tests untuk flow prioritas:
  - reporting
  - WiFi
  - teknisi photo/completion
  - payment proof

## Risks

Risiko utama:
- migration setengah jalan membuat step tidak tertangani,
- satu state hidup di legacy branch dan router baru sekaligus,
- naming step lama tidak konsisten sehingga ownership map membingungkan.

Mitigasi:
- mulai dari owner map eksplisit,
- migrasi per bounded context,
- tambahkan fallback logging untuk unowned step selama transisi.

## Success Criteria

Fase ini dianggap selesai jika:
- state flow punya owner tunggal per domain,
- `message/raf.js` turun menjadi orchestrator tipis,
- transisi state bisa ditrace dari step name ke owner file,
- regression tests state prioritas tersedia,
- fitur baru bisa masuk lewat owner domain tanpa menambah branch acak di router.
