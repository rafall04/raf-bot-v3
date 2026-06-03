- Berhasil mengekstrak `getStoredMappingByLid` dari `normalizeJid` untuk unifikasi lookup LID.
- Implementasi `toCanonicalJid` mengikuti urutan resolusi: stored mapping -> message metadata -> signalRepository -> fallback null.
- Penambahan `ensureMappingsFile` menjamin file `database/lid-mappings.json` selalu ada.
## bot-wa-hardening-lid-hp-canonical - utils.js Phase 2
- Updated `findUserByPhone` (renamed from `getUserByPhone` logic) to use `normalizePhoneNumber` from `lib/jid-utils`.
- Implemented `getUserByJid` as an async function that is LID-aware using `resolveCustomerBySender`.
- Added necessary imports and fixed syntax errors after rewrite.
- Verified with `node -c` and `lsp_diagnostics`.

### Phase 3: Handler Hardening
- Updated `message/handlers/saldo-handler.js`:
  - `handleTransferSaldo` now accepts `canonicalId` and `raf`.
  - Uses `canonicalId` for sender identity (resolved in router).
  - Uses `resolveCustomerBySender` for sender name resolution instead of manual array search.
  - Ensures `rafToUse` (from args or global) is used for notifications.
- Updated `message/handlers/agent-voucher-handler.js`:
  - Removed `extractPhoneFromLid` as it's redundant with `jid-utils`.
  - All agent-related commands (`purchase`, `sell`, `inventory`, `history`) now use `extractSenderInfo(msg).jid` to get the canonical identity.
  - This prevents LID spoofing and ensures consistent agent lookup regardless of LID/PN message source.

# Learnings - bot-wa-hardening-lid-hp-canonical

- `resolveCustomerBySender` simplifies JID normalization and user lookup by centralizing the logic for @lid and @s.whatsapp.net formats.
- Always verify syntax with `node -c` after complex edits to catch missing braces or other syntax errors.

# Learnings - bot-wa-hardening-lid-hp-canonical

- `lib/saldo-manager.js` uses a mix of SQLite (for balances) and JSON (for transactions and topup requests).
- Adding warning-only shims is an effective way to track if architectural constraints (like canonical IDs) are being respected without breaking functionality immediately.### Topup Lifecycle Canonicalization
- Updated `handleCancelTopup` in `message/handlers/saldo-handler.js` to accept `canonicalId` and `raf`, and use `canonicalId` for request lookups.
- Verified `TOPUP_CONFIRM` in `message/handlers/steps/saldo-steps.js` uses `userState.paymentSender || sender`.
- Verified `handleTopupPaymentProof` in `message/handlers/topup-handler.js` uses `requestLookupId` from `extractSenderInfo`.
- Fixed syntax errors in `message/handlers/steps/saldo-steps.js` related to `try-catch` blocks.
### Phase 6: Canonical Identity for Teknisi Workflow
- Updated function signatures in `message/handlers/teknisi-workflow-handler.js` to include `canonicalId`.
- Changed `global.teknisiStates` access to use `canonicalId || sender` to ensure consistent identity for technicians, especially those using @lid JIDs.
- Functions updated: `handleProsesTicket`, `handleOTW`, `handleSampaiLokasi`, `handleVerifikasiOTP`, `handleSelesaiTicket`, `handleTeknisiPhotoUpload`, and `handleCompleteTicket`.
- State lookup and cleanup now use the canonical identity.
## Testing Patterns
- Created integration test for multi-step topup flow ().
- Verified that  stored in state as  is correctly passed to .
- Used Jest mocks for  and  to simulate LID resolution environment.
- Mocked  to prevent errors in  lookup during testing.

## Testing Patterns
- Created integration test for multi-step topup flow (`lib/__tests__/topup-lid-flow.test.js`).
- Verified that `paymentSender` stored in state as `canonicalId` is correctly passed to `saldoManager.createTopupRequest`.
- Used Jest mocks for `saldoManager` and `jidUtils` to simulate LID resolution environment.
- Mocked `global.config` to prevent errors in `getAdminRecipients` lookup during testing.
