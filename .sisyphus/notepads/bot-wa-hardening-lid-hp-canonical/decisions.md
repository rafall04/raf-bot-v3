- Keputusan: Menggunakan format PN JID (`628xxx@s.whatsapp.net`) sebagai nilai yang disimpan di `lid-mappings.json` saat berhasil resolve via `getPNForLID`, agar konsisten dengan lookup `getStoredMappingByLid`.
- Keputusan: Mempertahankan kompatibilitas dengan `findUserWithLidSupport` yang menyimpan `userId` di file mapping yang sama.

# Decisions - bot-wa-hardening-lid-hp-canonical

- Added `normalizeUserId` shim to `lib/saldo-manager.js` to warn if `@lid` identifiers reach the manager layer. This is a non-blocking warning to detect missing canonicalization in upstream handlers.
- Integrated `normalizeUserId` in `createTopupRequest`, `getUserTopupRequests`, and `verifyTopupRequest` (applied to `adminId` as per plan's requirement for the three functions).### Canonical ID in Topup Operations
- Decided to pass `canonicalId` to `handleCancelTopup` to ensure consistency with other hardened handlers.
- Used `requestLookupId` derived from `extractSenderInfo` in `handleTopupPaymentProof` to correctly handle @lid users when they upload payment proofs.
