# WA Single-Entry Facade Finalization Design

> Status: Approved
> Date: 2026-04-22

## Goal

Membuat integrasi WhatsApp benar-benar mendekati satu pintu, sehingga perubahan Baileys mayoritas terlokalisasi pada sedikit file owner yang jelas.

Target praktis:
- perubahan socket lifecycle cukup di boundary runtime WA,
- perubahan send/reply/media cukup di adapter dan delivery facade,
- perubahan shape event/message masuk cukup di inbound adapter,
- router dan handler bisnis tidak lagi tahu detail Baileys mentah.

## Approach

Pendekatan yang dipilih: `Inbound+Outbound finalization per boundary`.

Alasan:
- paling akurat untuk target satu pintu,
- menjaga migrasi bertahap tanpa rewrite besar,
- membuat definition of done bisa diuji lewat guardrail tests.

## Definition of Done

Fase ini dianggap berhasil jika:
- `message/raf.js` tidak lagi memanggil helper Baileys langsung,
- `message/handlers/*` tidak lagi import primitive Baileys atau socket raw,
- inbound message normalization punya owner tunggal,
- outbound text/media/contact punya owner tunggal,
- bootstrap/reconnect/status punya owner tunggal,
- tersedia guardrail test untuk forbidden imports dan owner usage.

## Owner Files

Owner akhir yang ditetapkan:

- `lib/whatsapp-bootstrap.js`
  - owner lifecycle start, reconnect, teardown, auth/session boot.

- `lib/whatsapp-gateway.js`
  - owner socket runtime, status, readiness, dan diagnostics.

- `lib/whatsapp-inbound-adapter.js`
  - owner normalisasi event masuk dari Baileys ke kontrak internal bot.

- `lib/whatsapp.adapter.js`
  - owner primitive outbound tingkat rendah:
    - send text
    - send media
    - send contact
    - presence/reaction bila dipakai

- `lib/whatsapp-delivery-service.js`
  - owner delivery orchestration:
    - retries
    - recipient readiness
    - delivery logging
    - safety checks

- `message/handlers/reply-runtime.js`
  - owner facade reply layer bot/router agar handler tidak tahu detail adapter.

## Target Flow

Arsitektur target:

`index.js`
-> `lib/whatsapp-bootstrap.js`
-> `lib/whatsapp-gateway.js`
-> `lib/whatsapp-inbound-adapter.js`
-> `message/raf.js`
-> `message/handlers/*`
-> `message/handlers/reply-runtime.js`
-> `lib/whatsapp.adapter.js` / `lib/whatsapp-delivery-service.js`

Konsekuensinya:
- `message/raf.js` menerima context pesan yang sudah dinormalisasi,
- handler domain hanya menerima bot context internal,
- semua outbound keluar lewat facade tunggal.

## Forbidden Paths

Setelah fase ini:

- `message/raf.js` dilarang:
  - import Baileys helper langsung,
  - memanggil socket raw,
  - membentuk payload WA mentah.

- `message/handlers/*` dilarang:
  - import `@whiskeysockets/baileys`,
  - akses `raf.sendMessage(...)` langsung,
  - akses `global.raf` atau socket runtime mentah.

- controller/service non-WA dilarang:
  - kirim WA langsung tanpa adapter atau delivery service.

## Implementation Slices

### Slice A: Inbound Adapter
- Tambah `lib/whatsapp-inbound-adapter.js`.
- Pindahkan normalisasi event/message dari `message/raf.js` atau helper terkait ke owner baru.
- Tetapkan kontrak normalized message:
  - sender canonical id
  - remote jid
  - message text
  - media metadata
  - quoted info
  - message type
  - pushname/context

### Slice B: Router Slimming
- Ubah `message/raf.js` agar hanya mengonsumsi normalized message context.
- Hapus pengetahuan langsung terhadap helper Baileys dari router utama.

### Slice C: Outbound Contract Tightening
- Audit `message/handlers/*` dan helper aktif.
- Pastikan semua kirim text/media/contact lewat `reply-runtime` atau delivery service.

### Slice D: Forbidden Import Guardrails
- Tambah static tests untuk melarang direct Baileys/socket usage di router/handlers.
- Tambah contract tests untuk owner inbound dan outbound.

### Slice E: Docs and Ownership Sync
- Sinkronkan:
  - `SYSTEM_MAP.md`
  - `message/.module_map.md`
  - `message/handlers/.module_map.md`

## Testing Strategy

Wajib ada:
- source/static test:
  - `message/raf.js` tidak import Baileys helper langsung,
  - `message/handlers/*` tidak import socket raw.
- inbound adapter contract test:
  - event Baileys dinormalisasi ke shape internal yang stabil.
- reply/delivery contract test:
  - text/media/contact lewat owner facade.
- regression test:
  - flow bot prioritas tetap jalan setelah router tidak tahu Baileys langsung.

## Risks

Risiko utama:
- beberapa flow media lama masih mengandalkan shape message Baileys spesifik,
- ada helper legacy yang masih memegang `raf` atau socket raw diam-diam,
- normalisasi inbound terlalu tipis sehingga detail Baileys tetap bocor.

Mitigasi:
- static guardrail tests,
- migrasi per slice kecil,
- kontrak inbound eksplisit dan stabil.

## Success Criteria

Fase ini dianggap selesai jika:
- perubahan lifecycle/status socket terlokalisasi di bootstrap/gateway,
- perubahan payload reply/media/contact terlokalisasi di adapter/delivery,
- perubahan shape event masuk terlokalisasi di inbound adapter,
- router dan handler domain tidak lagi menyentuh detail Baileys mentah,
- guardrail tests menjaga boundary tetap rapat.
