# Header Doc
- Purpose: Catatan hasil verifikasi Wave 4 migrasi pesan WhatsApp hardcoded agent self-service.
- Caller: Pengembang/agent saat audit progres normalisasi WhatsApp.
- Deps: `message/handlers/agent.js`, `database/response_templates.json`, `message/__tests__/wa-hardcoded-message-migration-wave4-agent.test.js`.
- MainFuncs: Mendokumentasikan command verifikasi dan hasilnya.
- SideEffects: Tidak ada; dokumentasi statis.

# WA Hardcoded Message Migration Wave 4 Agent Self-Service Results

## Scope
- Migrasi pesan statis prioritas di `message/handlers/agent.js` untuk konfirmasi transaksi, status transaksi hari ini, status topup, ganti PIN, update profil, toggle outlet, dan error profil agent.
- Menambahkan key `agent_transaction_*`, `agent_topup_*`, `agent_pin_*`, `agent_profile_*`, `agent_status_*`, dan `agent_self_*` ke `database/response_templates.json`.
- Menambahkan guardrail `message/__tests__/wa-hardcoded-message-migration-wave4-agent.test.js`.

## Verification
- `node --check message/handlers/agent.js`: PASS.
- `node --check message/__tests__/wa-hardcoded-message-migration-wave4-agent.test.js`: PASS.
- `node -e "JSON.parse(require('fs').readFileSync('database/response_templates.json','utf8')); console.log('response_templates.json OK')"`: PASS.
- `npm test -- message/__tests__/wa-hardcoded-message-migration-wave4-agent.test.js`: PASS.
- `npm test -- message/__tests__/wa-hardcoded-message-migration-wave4-agent.test.js message/__tests__/wa-hardcoded-message-migration-wave3.test.js lib/__tests__/template-service.test.js`: PASS, 3 suites, 10 tests.
