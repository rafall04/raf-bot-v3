# Header Doc
- Purpose: Catatan hasil Wave 3 migrasi pesan WhatsApp hardcoded ke responseTemplates.
- Caller: Pengembang/agent saat melanjutkan migrasi hardcoded WA fase berikutnya.
- Deps: `message/handlers/raf-intent-dispatch.js`, `message/handlers/agent.js`, `message/handlers/monitoring-handler.js`, `database/response_templates.json`.
- MainFuncs: Merangkum scope selesai, verifikasi, dan residual wave berikutnya.
- SideEffects: Tidak ada; dokumentasi statis.

# WA Hardcoded Message Migration Wave 3 Results - 2026-04-24

## Scope Selesai

- `raf-intent-dispatch.js`: pesan tanya jawab unavailable, checking device, cancel ticket customer-only/no-active/not-found/not-owned/already-cancelled/already-done/in-progress/confirm/status-unsupported, dan format konfirmasi memakai `responseTemplates`.
- `agent.js`: pesan customer-facing awal untuk empty agent, fetch error, area prompt, area not found, services error, search empty/not found/error, detail not found/error memakai `responseTemplates`.
- `monitoring-handler.js`: progress PPP/Hotspot, error PPP/Hotspot, wrapper/error status AP, dan monitor WiFi placeholder memakai `responseTemplates`.
- Guardrail Wave 3 ditambahkan di `message/__tests__/wa-hardcoded-message-migration-wave3.test.js`.

## Verifikasi

- `node --check message/handlers/raf-intent-dispatch.js`
- `node --check message/handlers/agent.js`
- `node --check message/handlers/monitoring-handler.js`
- `node --check message/__tests__/wa-hardcoded-message-migration-wave3.test.js`
- `node -e "JSON.parse(require('fs').readFileSync('database/response_templates.json','utf8'))"`
- `npm test -- message/__tests__/wa-hardcoded-message-migration-wave3.test.js message/__tests__/wa-hardcoded-message-migration-phase1.test.js lib/__tests__/template-service.test.js`

Hasil focused suite: 3 test suites PASS, 12 tests PASS.

## Residual

- Dynamic list/detail di dispatcher, agent, dan monitoring masih dibangun di handler.
- `agent.js` masih punya pesan self-service/transaction lanjutan yang belum dimigrasi.
- `monitoring-handler.js` masih punya output rekap besar seperti all users/saldo/list profile yang sengaja tidak disentuh pada Wave 3.
