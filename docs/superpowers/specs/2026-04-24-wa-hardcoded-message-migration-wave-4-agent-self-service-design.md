# Header Doc
- Purpose: Spesifikasi Wave 4 migrasi pesan WhatsApp hardcoded agent self-service ke responseTemplates.
- Caller: Agent pengembang saat melanjutkan normalisasi pesan WhatsApp.
- Deps: `message/handlers/agent.js`, `database/response_templates.json`, `message/__tests__/wa-hardcoded-message-migration-wave4-agent.test.js`.
- MainFuncs: Menetapkan scope, pendekatan, dan validasi Wave 4.
- SideEffects: Tidak ada; dokumentasi statis.

# WA Hardcoded Message Migration Wave 4 Agent Self-Service Design

## Goal
Mengurangi hardcoded pesan WhatsApp tersisa di `message/handlers/agent.js` untuk flow transaksi agent, status topup, PIN, profile update, status outlet, dan error profil agent.

## Scope
- Migrasi reply statis prioritas ke `responseTemplates` dengan helper `renderResponseTemplate()`.
- Menambahkan key template kategori `agent_transaction`, `agent_topup`, `agent_pin`, `agent_profile`, `agent_status`, dan `agent_self`.
- Menjaga logic bisnis transaksi, saldo, credential, dan delivery WA tetap tidak berubah.
- Menambahkan guardrail test source + JSON agar key template baru tidak hilang.

## Non-Goals
- Tidak mengubah format list transaksi dinamis yang berisi data runtime.
- Tidak mengubah mekanisme saldo, manager agent, atau transport WhatsApp.
- Tidak memindahkan file besar `agent.js` ke modul baru dalam wave ini.

## Testing
- `node --check` untuk handler dan test baru.
- JSON parse untuk `database/response_templates.json`.
- Jest focused untuk Wave 4, Wave 3, dan template service.
