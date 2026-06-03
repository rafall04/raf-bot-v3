# Header Doc
- Purpose: Catatan hasil migrasi pesan WhatsApp hardcoded fase 1 ke template admin.
- Caller: Pengembang/agent saat melanjutkan migrasi hardcoded WA fase berikutnya.
- Deps: `message/handlers/states/wifi-password-state-handler.js`, `message/handlers/states/wifi-name-state-handler.js`, `message/handlers/agent-voucher-handler.js`, `database/response_templates.json`.
- MainFuncs: Merangkum scope yang selesai, verifikasi, dan residual hardcoded yang masih sengaja ditunda.
- SideEffects: Tidak ada; dokumentasi statis.

# WA Hardcoded Message Migration Phase 1 Results - 2026-04-24

## Scope Selesai

- WiFi password state: prompt pilih SSID, konfirmasi single/all SSID, input password baru, dan success utama memakai `responseTemplates`.
- WiFi name state: konfirmasi perubahan nama dan success utama memakai `responseTemplates`.
- Agent voucher: pesan prioritas flow beli/jual utama memakai `responseTemplates`, termasuk agent belum terdaftar, data agent tidak ditemukan, stok kosong, generic error, prompt pilih nomor, dan pilihan nomor tidak valid.
- Template key baru ditambahkan ke `database/response_templates.json` agar bisa diedit dari admin `/templates`.

## Verifikasi

- `node --check message/handlers/states/wifi-password-state-handler.js`
- `node --check message/handlers/states/wifi-name-state-handler.js`
- `node --check message/handlers/agent-voucher-handler.js`
- `node --check message/__tests__/wa-hardcoded-message-migration-phase1.test.js`
- `node -e "JSON.parse(require('fs').readFileSync('database/response_templates.json','utf8'))"`
- `npm test -- message/__tests__/wa-hardcoded-message-migration-phase1.test.js lib/__tests__/template-service.test.js`

Hasil focused suite: 2 test suites PASS, 8 tests PASS.

## Residual

- Agent voucher masih memiliki pesan hardcoded di flow quantity, payment, customer number, confirmation, inventory, dan history.
- WiFi state masih memiliki sebagian pesan proses/error teknis yang memakai key legacy atau fallback langsung.
- Fase berikutnya sebaiknya lanjut domain `agent-voucher` sampai tuntas atau pindah ke `raf-intent-dispatch` untuk blast radius pesan umum.
