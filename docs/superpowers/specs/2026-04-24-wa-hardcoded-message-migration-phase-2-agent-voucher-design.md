# Header Doc
- Purpose: Tech spec migrasi pesan WhatsApp hardcoded fase 2 khusus domain agent voucher.
- Caller: Agent/pengembang sebelum implementation plan `wa-hardcoded-message-migration-phase-2-agent-voucher`.
- Deps: `message/handlers/agent-voucher-handler.js`, `database/response_templates.json`, `message/__tests__/wa-hardcoded-message-migration-phase1.test.js`.
- MainFuncs: Mendefinisikan scope lanjutan template agent voucher quantity/payment/customer/confirmation/success/history.
- SideEffects: Tidak ada; dokumentasi desain statis.

# WA HARDCODED MESSAGE MIGRATION PHASE 2 AGENT VOUCHER DESIGN

## Goal
Melanjutkan migrasi hardcoded WhatsApp di `agent-voucher-handler.js` setelah fase 1 agar flow agent voucher utama semakin dapat dikustomisasi dari admin `/templates`.

## Scope
In scope:
- Quantity validation dan prompt pembelian/penjualan.
- Payment method prompt dan invalid choice.
- Cancel conversation.
- Failure/success purchase dan sale.
- Customer phone prompt/invalid phone.
- Sale confirmation prompt.
- Empty inventory/history messages.
- Guardrail test key phase 2.

Out of scope:
- Mengubah struktur data transaksi voucher.
- Memindahkan detail list voucher/history ke renderer baru.
- Menghapus fallback hardcoded.

## Architecture
- Tetap memakai helper lokal `renderResponseTemplate(key, fallback, data)`.
- `responseTemplates` menjadi source admin-editable.
- Dynamic detail tetap dibangun di handler dan dimasukkan sebagai placeholder bila perlu.
- Fallback dipertahankan untuk reliability runtime.

## Success Criteria
- Key `agent_voucher_*` fase 2 tersedia di `database/response_templates.json`.
- Handler memakai key fase 2 untuk pesan user-facing prioritas.
- Guardrail dan template-service tests lulus.
