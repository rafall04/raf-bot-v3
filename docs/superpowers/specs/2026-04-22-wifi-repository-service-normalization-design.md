# WiFi Repository/Service Normalization

> Status: APPROVED

## Goal
Menormalkan domain WiFi agar perubahan nama/sandi WiFi tidak lagi terlalu bertumpu pada helper campuran `lib/wifi`, dan concern persistence/logging punya owner yang jelas.

## Problem
- `message/handlers/wifi-management-handler.js` masih langsung memakai `getSSIDInfo`, `setSSIDName`, `setPassword`, `updateWifiSettings`.
- Logging/history WiFi masih tersebar antara handler bot, helper logger, dan service admin/network.
- Boundary antara integrasi device operation, persistence/logging, dan business orchestration belum konsisten.

## Target Architecture
- `message/handlers/wifi-management-handler.js`
  - channel adapter bot saja
  - validasi input ringan + reply shaping

- `services/wifi-management.service.js`
  - owner orchestration perubahan nama/sandi WiFi
  - resolve target customer
  - pilih action single/bulk
  - panggil repository/logging owner
  - panggil adapter device operation

- `repositories/wifi.repository.js`
  - owner persistence/log concern domain WiFi
  - history/log write
  - read concern yang diperlukan untuk customer/device mapping bila domain-specific

- `lib/wifi.js`
  - adapter perangkat murni:
    - `getSSIDInfo`
    - `setSSIDName`
    - `setPassword`
    - `updateWifiSettings`

- `lib/wifi-logger.js`
  - tetap boleh dipakai sementara sebagai adapter log implementation, tapi dipanggil dari repository/service owner.

## Scope
Fokus hanya pada concern aktif:
- ganti nama WiFi
- ganti sandi WiFi
- log/history perubahan WiFi yang terkait flow itu

## Hard Rules
- Jangan ubah behavior user-facing bot.
- Jangan ubah adapter device operation di `lib/wifi.js` lebih dari yang perlu.
- Jangan pindahkan semua domain WiFi sekaligus.
- Logging/history harus punya owner tunggal setelah slice ini.

## Implementation Slices
1. Audit exact concern di handler: business orchestration vs adapter device vs logging/history.
2. Bentuk service WiFi sebagai owner orchestration.
3. Bentuk/perkuat repository owner untuk log/history WiFi.
4. Refactor handler agar memanggil service owner.
5. Tambah guardrail test dan sinkronkan docs.

## Verification
- service boundary test untuk flow ganti nama/sandi
- repository contract test untuk log/history WiFi
- regression test pada handler WiFi yang disentuh
- source guardrail bila perlu untuk melarang direct logging/persistence dari handler

## Success Criteria
- handler WiFi jadi lebih tipis
- orchestration WiFi pindah ke service owner
- logging/history WiFi punya owner repository/service yang jelas
- `lib/wifi.js` turun menjadi adapter perangkat, bukan bucket business logic
