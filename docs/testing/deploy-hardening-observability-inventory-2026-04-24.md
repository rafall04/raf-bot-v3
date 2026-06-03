# Header Doc
- Purpose: Mengunci inventaris warning/log residual pasca smoke-core penuh agar fase deploy-hardening punya baseline observability yang eksplisit.
- Caller: Pengembang/agent pada fase `deploy-hardening-observability-cleanup-final` sebelum mengubah policy logging atau startup diagnostics.
- Deps: `docs/testing/local-full-system-smoke-results-2026-04-24.md`, `lib/env-config.js`, `message/handlers/conversation-handler.js`, `services/network-ops.service.js`.
- MainFuncs: Mengklasifikasikan warning residual menjadi dependency-level, test/dev-only, compatibility-only, dan runtime-significant.
- SideEffects: Tidak ada; dokumentasi statis.

# DEPLOY HARDENING OBSERVABILITY INVENTORY 2026-04-24

## Baseline Source Inventory

| Signal | Source | Scope | Classification | Notes |
| --- | --- | --- | --- | --- |
| `baseline-browser-mapping` | dependency/tooling warning saat Jest run | test/tooling | `dependency-level non-blocking` | Bukan berasal dari app runtime; muncul karena paket `baseline-browser-mapping` sudah tua di dependency tree. |
| `[ENV] test mode - using test database` | [C:\project\raf-bot-v2\lib\env-config.js](/C:/project/raf-bot-v2/lib/env-config.js) | test/dev bootstrap | `test-dev informational` | Setelah Task 2, hanya tampil untuk `development` atau override `ENV_CONFIG_VERBOSE_BOOT=1`. |
| `[legacyStateProxyRead]` | [C:\project\raf-bot-v2\message\handlers\conversation-handler.js](/C:/project/raf-bot-v2/message/handlers/conversation-handler.js) line 121 | compatibility state surface | `compatibility-only warning` | Muncul saat test/consumer masih membaca state berscope legacy non-`managed`. |
| `[legacyStateProxyWrite]` | [C:\project\raf-bot-v2\message\handlers\conversation-handler.js](/C:/project/raf-bot-v2/message/handlers/conversation-handler.js) line 209 | compatibility state surface | `compatibility-only warning` | Muncul saat proxy transisional masih dipakai untuk write path. |
| `[WIFI_LOGGING] Could not get current WiFi info for logging` | [C:\project\raf-bot-v2\services\network-ops.service.js](/C:/project/raf-bot-v2/services/network-ops.service.js) line 344 | runtime WiFi mutation | `runtime-significant warning` | Relevan bila gagal mengambil current WiFi info sebelum write mutation log. |
| `[WIFI_LOGGING] { logged: false, skipReason: 'test' }` | [C:\project\raf-bot-v2\services\network-ops.service.js](/C:/project/raf-bot-v2/services/network-ops.service.js) line 379 | test/logging skip path | `test-only informational` | Saat `wifiRepository.saveWebWifiChangeByDevice()` memutuskan `shouldLog=false` untuk mode test. |
| `[WIFI_LOGGING] Failed to write WiFi change log` | [C:\project\raf-bot-v2\services\network-ops.service.js](/C:/project/raf-bot-v2/services/network-ops.service.js) line 386 | runtime WiFi mutation | `runtime-significant error` | Tetap perlu dipertahankan sebagai signal gagal write log perubahan WiFi. |

## Startup / Env Boundaries Still Noisy

### 1. Environment bootstrap
- Boundary:
  - [C:\project\raf-bot-v2\lib\env-config.js](/C:/project/raf-bot-v2/lib/env-config.js)
- Current behavior:
  - setelah Task 2, `console.warn(...)` hanya aktif untuk `development` atau override manual `ENV_CONFIG_VERBOSE_BOOT=1`
- Risk:
  - bila override manual dipakai saat smoke, output test bisa kembali bercampur dengan diagnostic bootstrap
- Candidate action:
  - pertahankan gate eksplisit; jangan aktifkan override pada smoke-core normal

### 2. Compatibility proxy diagnostics
- Boundary:
  - [C:\project\raf-bot-v2\message\handlers\conversation-handler.js](/C:/project/raf-bot-v2/message/handlers/conversation-handler.js)
- Current behavior:
  - `getUserState()` dan `createScopedStateProxy().set()` selalu `console.warn(...)` saat scope legacy disentuh
- Risk:
  - signal compatibility yang expected masih terlihat seperti warning aktif saat smoke/test
- Candidate action:
  - pindahkan ke channel diagnostic compatibility-only, atau gate berdasarkan mode/test flag agar tetap terlihat saat dibutuhkan tapi tidak mengotori smoke-core

### 3. WiFi logging observability
- Boundary:
  - [C:\project\raf-bot-v2\services\network-ops.service.js](/C:/project/raf-bot-v2/services/network-ops.service.js)
- Current behavior:
  - skip-path `test` silent setelah Task 2
  - pre-log lookup failure memakai `console.warn`
  - write failure memakai `console.error`
- Risk:
  - failure-path test masih memunculkan warning/error karena memang menguji degradasi logging
- Candidate action:
  - pertahankan `warn/error` untuk kegagalan runtime nyata

## Task 1 Exit
- Residual warning/log sudah dipetakan ke source file dan kategori.
- Dua signal layak dibersihkan lebih dulu pada Task 2:
  - `[ENV] test mode - using test database`
  - `[WIFI_LOGGING] { logged: false, skipReason: 'test' }`
- Dua signal compatibility/runtime yang harus diperlakukan hati-hati:
  - `legacyStateProxyRead/Write`
  - `[WIFI_LOGGING]` failure-path warnings/errors

## Task 2 Outcome
- `[ENV] test mode - using test database`
  - tidak lagi muncul default pada `NODE_ENV=test`; sekarang hanya aktif untuk `development` atau override manual `ENV_CONFIG_VERBOSE_BOOT=1`
- `[WIFI_LOGGING] { logged: false, skipReason: 'test' }`
  - tidak lagi muncul pada smoke/test path; skip-path test sekarang silent
- Residual aktif setelah rerun smoke-core:
  - `baseline-browser-mapping`
  - `legacyStateProxyRead/Write`
  - `[WIFI_LOGGING]` failure-path warning/error saat skenario runtime/logging benar-benar gagal

## Task 3-4 Outcome
- Pre-deploy checklist dibuat:
  - [C:\project\raf-bot-v2\docs\testing\pre-deploy-verification-checklist.md](/C:/project/raf-bot-v2/docs/testing/pre-deploy-verification-checklist.md)
- Focused observability tests:
  - `3` suite pass
  - `8` test pass
- Single-pass smoke-core rerun:
  - `22` suite pass
  - `59` test pass
  - `0` fail
- Unexpected warning:
  - `NONE`
