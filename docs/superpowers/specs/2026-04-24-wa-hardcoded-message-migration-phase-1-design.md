# Header Doc
- Purpose: Tech spec migrasi pesan WhatsApp hardcoded fase 1 untuk WiFi state dan agent voucher.
- Caller: Agent/pengembang sebelum membuat implementation plan `wa-hardcoded-message-migration-phase-1`.
- Deps: `message/handlers/states/wifi-password-state-handler.js`, `message/handlers/states/wifi-name-state-handler.js`, `message/handlers/agent-voucher-handler.js`, `database/response_templates.json`, `lib/templating.js`.
- MainFuncs: Mendefinisikan scope template key, pola fallback aman, target file, testing, dan batasan migrasi.
- SideEffects: Tidak ada; dokumentasi desain statis.

# WA HARDCODED MESSAGE MIGRATION PHASE 1 DESIGN

## Goal
Mengurangi pesan WhatsApp user-facing hardcoded pada domain prioritas WiFi state dan agent voucher agar bisa dikustomisasi dari halaman admin `/templates`.

## Current State
- Admin `/templates` sudah bisa edit `responseTemplates`.
- `wifi-name-state-handler.js` dan `wifi-password-state-handler.js` sudah punya helper lokal `renderResponseTemplate`, tetapi masih banyak reply langsung dengan string hardcoded.
- `agent-voucher-handler.js` mayoritas masih memakai string literal langsung untuk error, empty-state, dan prompt percakapan.
- Fallback hardcoded tetap diperlukan agar runtime aman jika template key belum ada.

## Scope
In scope:
- Migrasi pesan WiFi state yang paling sering muncul ke `responseTemplates`.
- Migrasi pesan agent voucher error/prompt/empty-state prioritas ke `responseTemplates`.
- Tambah helper/template access pattern yang konsisten di target file.
- Tambah source guardrail test agar key template dan helper dipakai.
- Sync map/docs.

Out of scope:
- Migrasi semua pesan WhatsApp di semua handler.
- Menghapus semua fallback hardcoded.
- Redesign UI admin templates.
- Migrasi storage template ke SQLite.

## Architecture
- `database/response_templates.json` menjadi source editable dari admin untuk template fase 1.
- Handler target memanggil `renderResponseTemplate(key, fallback, data)` atau helper setara.
- Fallback string tetap berada di code sebagai safety net, tetapi pesan normal mengikuti template.
- Template key memakai prefix domain:
  - `wifi_name_*`
  - `wifi_password_*`
  - `agent_voucher_*`

## Target Template Keys

WiFi password:
- `wifi_password_select_ssid_prompt`
- `wifi_password_confirm_all_ssid`
- `wifi_password_confirm_single_ssid`
- `wifi_password_enter_new_password`
- `wifi_password_change_success`

WiFi name:
- `wifi_name_confirm_change`
- `wifi_name_change_success`

Agent voucher:
- `agent_voucher_agent_not_found`
- `agent_voucher_empty_stock`
- `agent_voucher_generic_error`
- `agent_voucher_purchase_prompt`
- `agent_voucher_sale_prompt`
- `agent_voucher_invalid_choice`

## Data Flow
1. Admin mengedit key di `/templates` tab Bot Responses.
2. UI menyimpan ke `/api/templates`.
3. `routes/admin-content-routes.js` menyimpan `responseTemplates`.
4. Runtime handler memanggil `renderResponseTemplate`.
5. Jika key tidak tersedia, fallback hardcoded dipakai.

## Testing
- Source guardrail memastikan handler target menggunakan key template fase 1.
- Source guardrail memastikan tidak ada regress langsung untuk pesan yang sudah dipindah.
- `lib/__tests__/template-service.test.js` tetap memastikan render/save template aman.
- Focused test command:
  - `npm test -- message/__tests__/wa-hardcoded-message-migration-phase1.test.js lib/__tests__/template-service.test.js`

## Success Criteria
- Pesan prioritas WiFi state dan agent voucher memakai `responseTemplates`.
- Template key baru tersedia di `database/response_templates.json`.
- Guardrail test lulus.
- Map/docs menjelaskan fase migrasi ini.
