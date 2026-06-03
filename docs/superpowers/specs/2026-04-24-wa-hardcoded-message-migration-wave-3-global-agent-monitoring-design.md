# Header Doc
- Purpose: Tech spec Wave 3 migrasi pesan WhatsApp hardcoded untuk dispatcher global, agent non-voucher, dan monitoring.
- Caller: Agent/pengembang sebelum implementation plan Wave 3.
- Deps: `message/handlers/raf-intent-dispatch.js`, `message/handlers/agent.js`, `message/handlers/monitoring-handler.js`, `database/response_templates.json`.
- MainFuncs: Menentukan scope pesan prioritas, template key, fallback rule, guardrail, dan verifikasi.
- SideEffects: Tidak ada; dokumentasi desain statis.

# WA HARDCODED MESSAGE MIGRATION WAVE 3 DESIGN

## Goal
Memperluas migrasi pesan WhatsApp hardcoded ke tiga domain prioritas tanpa mengubah logic bisnis: dispatcher global, command agent umum, dan monitoring.

## Scope
In scope:
- `raf-intent-dispatch.js`: pesan tanya jawab unavailable, status checking, cancel ticket restriction/no-active/not-found/not-owned/already-cancelled/done/in-progress/confirm/unsupported status, dan format konfirmasi.
- `agent.js`: customer-facing list/search/detail/services errors dan prompts awal.
- `monitoring-handler.js`: progress status PPP/Hotspot, gagal ambil stats, status AP error/wrapper, dan monitor WiFi placeholder.
- Template key baru di `responseTemplates`.
- Source guardrail test.

Out of scope:
- Dynamic detail list/table penuh.
- Logic permission, query, transaction, monitoring integration.
- Migrasi semua remaining handler.

## Architecture
- Semua target memakai helper `renderResponseTemplate(key, fallback, data)`.
- `raf-intent-dispatch.js` memakai `format` dari context.
- `agent.js` dan `monitoring-handler.js` memakai `format` dari `conversation-handler`.
- Fallback string tetap ada sebagai safety net.

## Success Criteria
- Template key Wave 3 tersedia di `database/response_templates.json`.
- Tiga handler target memakai key Wave 3.
- Syntax, JSON parse, guardrail, dan template-service tests lulus.
