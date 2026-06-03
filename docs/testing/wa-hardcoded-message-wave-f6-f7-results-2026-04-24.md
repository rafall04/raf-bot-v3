# Header Doc
- Purpose: Dokumentasi hasil Wave F6+F7 migrasi sisa hardcoded WA messages + refactor literal raf-intent-dispatch.js.
- Caller: Pengembang/operator untuk review hasil wave + recovery insight.
- Deps: `docs/testing/wa-hardcoded-message-final-wave-results-2026-04-24.md` (Wave F1-F5 results).
- MainFuncs: Ringkasan wave, kerusakan saat multi_edit, recovery manual, hasil test, exit status.
- SideEffects: Tidak ada; dokumentasi statis.

# WA HARDCODED MESSAGE WAVE F6+F7 RESULTS 2026-04-24

## Summary

Wave F6+F7 + refactor literal `raf-intent-dispatch.js` selesai dengan 55/55 wave tests pass dan smoke-core zero regression.

| Wave | Scope | Files migrated | Keys | Tests |
|---|---|---|---|---|
| **F6** | Saldo + WiFi History + Photo Queue/Workflow + WiFi Name State | 5 | 22 | 5 pass |
| **F7** | Lib outbound notification (approval, device-status) | 2 + 1 new helper | 3 | 4 pass |
| **Refactor dispatch** | raf-intent-dispatch.js literal-only migration | 1 | 12 | 4 pass |
| **TOTAL** | **8 files + 1 new helper** | **37 keys** | **13 pass** |

## Wave Execution Detail

### Wave F6 — Sisa handler customer-facing

| File | Migrations | Notable |
|------|------------|---------|
| `message/handlers/saldo-handler.js` | 15 | `saldo_*` verifikasi/error/transfer/voucher |
| `message/handlers/wifi-history-handler.js` | 4 + encoding fix | Perbaikan UTF-8 mojibake di file existing (emoji dobel-encode) |
| `message/handlers/photo-upload-queue.js` | 1 | `photo_queue_process_error` |
| `message/handlers/photo-workflow-handler.js` | 1 | `photo_idle_reminder` |
| `message/handlers/states/wifi-name-state-handler.js` | 1 | `wifi_name_bulk_target_missing` |

**UTF-8 fix side-benefit**: file `wifi-history-handler.js` tadinya punya mojibake (emoji UTF-8 dobel-encode sebagai Latin-1). Di-rewrite dengan UTF-8 benar dan clean header doc.

### Wave F7 — Lib outbound notification

| File | Migrations | Detail |
|------|------------|--------|
| `lib/response-template-helper.js` (new) | 0 | Helper terpusat pakai `renderCategoryTemplate` dari `template-service` untuk dipakai layer `lib/` (sibling helper untuk mirror `message/handlers/template-helpers.js`) |
| `lib/approval-logic.js` | 2 | `approval_teknisi_status_notification` + `approval_teknisi_payment_confirmation` dengan placeholder `${user_name}`, `${status_text}`, `${partial_section}`, `${metode_pembayaran}`, dll |
| `lib/device-status.js` | 1 | `getDeviceOfflineMessage()` refactor ke `renderResponseTemplate` dengan placeholder `${user_name}` + `${last_online_section}` |

### Refactor literal `raf-intent-dispatch.js`

Strategi: **migrasi literal-only**, tidak pecah file. Setiap edit pakai `edit` tool (bukan `multi_edit`) + `node --check` verify per edit.

12 dispatch_* keys:
1. `dispatch_tiketdone_missing_id`
2. `dispatch_tiketdone_not_found`
3. `dispatch_tiketdone_already_done`
4. `dispatch_tiketdone_upload_prompt`
5. `dispatch_button_menu`
6. `dispatch_agent_detail_missing_id`
7. `dispatch_cari_pelanggan_format`
8. `dispatch_list_tiket_empty`
9. `dispatch_done_upload_categories_missing`
10. `dispatch_done_upload_not_enough`
11. `dispatch_done_upload_complete`
12. `dispatch_lid_only_command`

## Kerusakan Saat Multi-Edit (LESSON LEARNED)

Percobaan pertama untuk refactor struktural lewat `multi_edit` pada file 1411 baris merusak file parah (792 lines, syntax broken, case handler hilang ~50%). Backup Windsurf History ikut over-written.

**Recovery**: User melakukan restore manual dari backup lokal mereka (52149 bytes, 1411 lines, syntax valid). Setelah restore, saya lanjut dengan **pendekatan SAFE**:
- Gunakan `edit` tool (bukan `multi_edit`) untuk setiap literal
- Jalankan `node --check` setelah setiap edit untuk deteksi dini
- Tidak pecah file struktural — fokus migrasi literal saja

**Root cause `multi_edit` corruption**: beberapa `old_string` overlap dengan pattern lain, membuat edit apply ke tempat salah dan menghapus blok besar.

**Recommendation**: Untuk file >1000 lines, **SELALU pakai `edit` 1-per-1** dengan verify per step. Jangan pernah pakai `multi_edit` untuk banyak perubahan di file besar.

## Final Test Results

### Wave tests

```powershell
npx jest message/__tests__/wa-hardcoded-message-migration-wave-f1.test.js message/__tests__/wa-hardcoded-message-migration-wave-f2.test.js message/__tests__/wa-hardcoded-message-migration-wave-f3.test.js message/__tests__/wa-hardcoded-message-migration-wave-f4.test.js message/__tests__/wa-hardcoded-message-migration-wave-f5.test.js message/__tests__/wa-hardcoded-message-migration-wave-f6-f7.test.js message/__tests__/template-helpers.test.js
```

Result:
- Test Suites: `7 passed, 7 total`
- Tests: `55 passed, 55 total`
- Time: `~3s`

### Smoke-core regression (no regression)

```powershell
npx jest lib/__tests__/whatsapp-gateway.test.js lib/__tests__/whatsapp-bootstrap.test.js lib/__tests__/whatsapp-inbound-adapter.contract.test.js message/__tests__/bot-hardening.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/raf-router-boundary.test.js lib/__tests__/runtime-contract.test.js routes/__tests__/runtime-wiring.test.js services/__tests__/admin-ops.service.runtime-boundary.test.js services/__tests__/network-ops.service.runtime-boundary.test.js services/__tests__/wifi-management.service.test.js services/__tests__/payment-flow.service.test.js
```

Result:
- Test Suites: `12 passed, 12 total`
- Tests: `26 passed, 26 total`
- Time: `~5s`

## Files Modified (Complete Wave F6+F7)

### New files
1. `lib/response-template-helper.js` — helper lib layer
2. `message/__tests__/wa-hardcoded-message-migration-wave-f6-f7.test.js` — guardrail tests

### Modified files
1. `message/handlers/saldo-handler.js`
2. `message/handlers/wifi-history-handler.js` (UTF-8 rewrite)
3. `message/handlers/photo-upload-queue.js`
4. `message/handlers/photo-workflow-handler.js`
5. `message/handlers/states/wifi-name-state-handler.js`
6. `message/handlers/raf-intent-dispatch.js` (literal-only migration)
7. `lib/approval-logic.js`
8. `lib/device-status.js`
9. `database/response_templates.json` (37 keys added)
10. `SYSTEM_MAP.md`

## Cumulative Coverage (Wave F1-F7)

- **Total handler files migrated**: 25 (17 dari F1-F5 + 8 dari F6+F7)
- **Total keys in responseTemplates**: ~145 baru (110 dari F1-F5 + 37 dari F6+F7)
- **Total wave tests**: 55 (42 F1-F5 + 13 F6-F7)
- **Smoke-core regression**: 12 suites, 26 tests, zero regression

## Exit Status

- Wave F6 execution: `COMPLETE`
- Wave F7 execution: `COMPLETE`
- Refactor dispatch literal: `COMPLETE`
- All guardrail tests: `PASS`
- Smoke-core regression: `PASS`
- File corruption (multi_edit incident): `RECOVERED` via user manual restore
- Admin UI editability: `VERIFIED` untuk 37 key baru (total ~145 key)
- Backward compatibility: `PRESERVED` (fallback pattern di setiap call-site)

## Struktur WhatsApp Logic Setelah Refactor

Arsitektur boundary WA tetap 3 layer jelas:

```
lib/ (infra)
  ├── whatsapp-gateway.js         # singleton socket Baileys
  ├── whatsapp-delivery-service.js # sendMessage dengan retry
  ├── whatsapp.adapter.js          # legacy adapter
  ├── whatsapp-inbound-adapter.js  # normalisasi inbound
  ├── response-template-helper.js  # NEW: render responseTemplates (lib-side)
  └── template-service.js          # render core (baca JSON)

message/ (routing)
  ├── raf.js                       # composition router
  └── handlers/
      ├── template-helpers.js      # render responseTemplates (handler-side)
      ├── raf-context.js           # inbound context
      ├── raf-intent-dispatch.js   # intent dispatcher (sudah literal-clean)
      ├── raf-state-routing.js     # managed state router
      ├── raf-interceptors.js      # keyword intercept
      └── reply-runtime.js         # outbound reply boundary

message/handlers/*.js (domain handlers)
  # 25 handler bot, semua pakai renderResponseTemplate(key, fallback, data)
  # Admin dapat customize lewat /api/templates tab Response
```

Tidak ada duplikasi logic WA. Setiap domain punya owner tunggal + helper sentralisasi untuk render template.
