# Header Doc
- Purpose: Design spec untuk wave finalisasi migrasi hardcoded WhatsApp messages di handler bot agar semua pesan user-facing editable lewat admin web (`/api/templates` → tab Response).
- Caller: Pengembang/agent yang akan mengeksekusi migration per-wave.
- Deps: `database/response_templates.json`, `lib/template-service.js`, `lib/templating.js`, `routes/admin-content-routes.js`, `views/sb-admin/templates.php`, handler bot di `message/handlers/*`.
- MainFuncs: Menetapkan scope, pattern helper, naming convention, fallback strategy, dan wave breakdown untuk migrasi ~75 hardcoded message baru.
- SideEffects: Tidak ada; dokumentasi statis. Eksekusi dilakukan pada implementation plan terpisah.

# WA HARDCODED MESSAGE — ADMIN CUSTOMIZABLE FINAL WAVE DESIGN

## Problem Statement

Audit komprehensif menemukan **~75 hardcoded WhatsApp reply strings** di 15 file handler yang belum ter-migrasi ke `response_templates.json`, padahal wave 1-4 + finalization sebelumnya sudah memigrasi dispatcher global, agent voucher, monitoring, states legacy, steps WiFi, dan outbound WA routes/services.

Konsekuensi: Admin tidak bisa edit teks balasan bot lewat halaman `/api/templates` untuk operasi berikut:
- Voucher/statik profile CRUD (`addprofvoucher`, `addprofstatik`, delete variants)
- Network setup (`addbinding`, `addqueue`, `addppp`)
- WiFi power adjust, reboot modem, cek WiFi fallback/error
- Billing/package change customer-facing messages
- Balance transfer/del saldo
- WiFi state confirmation (`CONFIRM_GANTI_NAMA`, `CONFIRM_GANTI_SANDI`)
- Access management (list/add/delete/help)
- Utility (bantuan fallback, cek tiket)
- Monitoring statistics header & all-user/all-saldo/list-profil
- WiFi password/name state error messages
- Steps progress (power set, bulk rename/repassword)

## Scope

### In-scope (migrate ke `responseTemplates`)

| # | File | Hardcoded count | Message keys baru |
|---|---|---|---|
| 1 | `message/handlers/voucher-management-handler.js` | 8 | `voucher_profile_exists`, `voucher_profile_create_success`, `voucher_profile_not_found`, `voucher_profile_delete_success`, `voucher_profile_generic_error`, `statik_profile_exists`, `statik_profile_create_success`, `statik_profile_not_found`, `statik_profile_delete_success`, `statik_profile_generic_error` |
| 2 | `message/handlers/network-management-handler.js` | 12 | `network_binding_profile_not_found`, `network_binding_mac_exists`, `network_binding_invalid_mac`, `network_binding_range_ip`, `network_binding_technical_error`, `network_binding_success`, `network_queue_parent_not_found`, `network_queue_already_exists`, `network_queue_limitat_exceed_download`, `network_queue_limitat_exceed_upload`, `network_queue_technical_error`, `network_queue_success`, `network_ppp_profile_error`, `network_ppp_already_exists`, `network_ppp_technical_error`, `network_ppp_success`, `network_generic_error` |
| 3 | `message/handlers/wifi-power-handler.js` | 7 | `wifi_power_admin_id_not_found`, `wifi_power_admin_prompt_id`, `wifi_power_voucher_only_monthly`, `wifi_power_device_missing`, `wifi_power_format_prompt`, `wifi_power_format_error`, `wifi_power_success`, `wifi_power_technical_error`, `wifi_power_generic_error` |
| 4 | `message/handlers/reboot-modem-handler.js` | 5 | `reboot_admin_id_not_found`, `reboot_admin_prompt_id`, `reboot_voucher_only_monthly`, `reboot_device_missing`, `reboot_confirm_prompt` |
| 5 | `message/handlers/wifi-check-handler.js` | 3 | `wifi_check_lid_not_registered`, `wifi_check_device_missing`, `wifi_check_loading` |
| 6 | `message/handlers/legacy-wifi-state-handler.js` | 6 | `wifi_confirm_name_success`, `wifi_confirm_name_failed`, `wifi_confirm_name_cancelled`, `wifi_confirm_password_success`, `wifi_confirm_password_failed`, `wifi_confirm_password_cancelled` |
| 7 | `message/handlers/billing-management-handler.js` | 4 | `billing_lid_not_registered`, `billing_check_generic_error`, `billing_change_package_pending`, `billing_no_other_packages`, `billing_change_package_list_header`, `billing_change_package_generic_error` |
| 8 | `message/handlers/package-management-handler.js` | 8 | `package_lid_not_registered`, `package_request_pending`, `package_list_header`, `package_no_options`, `package_list_error`, `sod_active_exists`, `sod_pending_exists`, `sod_no_options`, `sod_list_header`, `sod_generic_error` |
| 9 | `message/handlers/balance-management-handler.js` | 3 | `balance_transfer_wrong_format`, `balance_transfer_insufficient`, `balance_del_saldo_not_found`, `balance_generic_error` |
| 10 | `message/handlers/access-management-handler.js` | 8 | `access_not_registered_lid`, `access_not_registered`, `access_list_single`, `access_list_many`, `access_add_format`, `access_add_invalid_prefix`, `access_add_invalid_format`, `access_add_limit_reached`, `access_add_duplicate`, `access_add_db_error`, `access_add_success`, `access_delete_format`, `access_delete_not_found`, `access_delete_primary_blocked`, `access_delete_success`, `access_help` |
| 11 | `message/handlers/utility-handler.js` | 2 | `utility_admin_contact_missing`, `utility_bantuan_fallback`, `utility_cek_tiket_not_owned` |
| 12 | `message/handlers/monitoring-handler.js` | 5 | `monitoring_ppp_stats_header`, `monitoring_ppp_inactive_list_header`, `monitoring_ppp_inactive_none`, `monitoring_hotspot_stats_header`, `monitoring_allsaldo_header`, `monitoring_alluser_entry`, `monitoring_list_profstatik_header`, `monitoring_list_profvoucher_header` |
| 13 | `message/handlers/states/wifi-password-state-handler.js` | 4 | `wifi_password_change_error`, `wifi_password_bulk_change_error`, `wifi_password_applying_single`, `wifi_password_applying_bulk` |
| 14 | `message/handlers/states/wifi-name-state-handler.js` | 1 | `wifi_name_change_error` |
| 15 | `message/handlers/steps/wifi-steps.js` | 2 | `wifi_step_applying_name_bulk`, `wifi_step_applying_password_bulk` |
| 16 | `message/handlers/steps/general-steps.js` | 1 | `general_step_applying_power` |
| 17 | `message/handlers/conversation-state-handler.js` | 2 | `conversation_universal_cancel`, `conversation_unknown_step_error` |

**Total estimasi ~90 key baru** (setelah breakdown lebih granular).

### Out-of-scope

- `raf-intent-dispatch.js` sudah punya pola `renderResponseTemplate` dengan fallback inline; sisa hardcoded di sini (9 match pattern `reply(`` tapi mayoritas sudah pakai `renderResponseTemplate` dengan fallback). Akan di-cleanup di wave terpisah kalau masih ada sisa setelah Wave F1-F5.
- Error fallback yang bersifat log/debug ("Terjadi kesalahan saat ... Silakan coba lagi") — akan jadi 1 key generic `generic_technical_error` untuk semua handler.
- File PHP admin views — sudah bisa handle `responseTemplates` tab (verified di `views/sb-admin/templates.php` line 343-344 + `routes/admin-content-routes.js` line 43-73).

## Design

### 1. Centralized Helper Pattern

Tambah helper bersama di `message/handlers/utils.js` (atau file baru `message/handlers/template-helpers.js`) agar pattern konsisten:

```javascript
const { renderCategoryTemplate } = require('../../lib/template-service');

function renderResponseTemplate(key, fallback, data = {}) {
    const result = renderCategoryTemplate('responseTemplates', key, data);
    return result.found && result.text ? result.text : fallback;
}

module.exports = { renderResponseTemplate };
```

Pattern ini sudah dipakai di `monitoring-handler.js:9-12` dan `raf-intent-dispatch.js` (lokal per-file). Wave ini **memusatkan helper** agar tidak duplikasi.

### 2. Naming Convention

Format: `{domain}_{action}_{status}` atau `{domain}_{action}`

Domain prefixes:
- `network_*` — network setup (binding, queue, ppp)
- `voucher_*` / `statik_*` — voucher/statik profile CRUD
- `wifi_power_*`, `wifi_check_*`, `wifi_confirm_*`, `wifi_password_*`, `wifi_name_*` — WiFi domain
- `reboot_*` — reboot modem
- `billing_*` — cek tagihan
- `package_*`, `sod_*` — paket & speed on demand
- `balance_*` — topup/transfer/delsaldo
- `access_*` — akses nomor tambahan
- `utility_*` — bantuan, cek tiket
- `monitoring_*` — statistik PPP/Hotspot/AP/all-saldo
- `conversation_*` — universal conversation (cancel, unknown step)
- `general_step_*`, `wifi_step_*` — steps intermediate

### 3. Placeholder Convention

Mengikuti standar existing (`${nama_pelanggan}`, `${nama_wifi}`, `${nama_bot}`, `${pushname}`). Tambah placeholder spesifik per key dengan dokumentasi di field `name` template.

### 4. Fallback Strategy (Backward Compatibility)

**Setiap migration HARUS:**
1. Simpan pesan hardcoded original sebagai fallback parameter kedua ke `renderResponseTemplate`
2. Tambah entry di `response_templates.json` dengan template **identik** dengan fallback (supaya behavior tidak berubah saat admin belum customize)
3. Placeholder dinamis dibungkus `${...}` — kalau admin hapus placeholder, renderString biarkan as-is

Contoh migration untuk `voucher-management-handler.js`:

```javascript
// BEFORE
await reply(`Mohon Maaf Profil Yang Akan Ditambahkan Sudah Ada Di Dalam Database. Silahkan Cek Kembali Pada Penulisan Profil Voucher Anda.\n\nTerima Kasih`);

// AFTER
const { renderResponseTemplate } = require('./template-helpers');
await reply(renderResponseTemplate(
    'voucher_profile_exists',
    `Mohon Maaf Profil Yang Akan Ditambahkan Sudah Ada Di Dalam Database. Silahkan Cek Kembali Pada Penulisan Profil Voucher Anda.\n\nTerima Kasih`
));
```

Di `database/response_templates.json` tambah:
```json
"voucher_profile_exists": {
    "name": "Voucher: Profil Sudah Ada",
    "template": "Mohon Maaf Profil Yang Akan Ditambahkan Sudah Ada Di Dalam Database. Silahkan Cek Kembali Pada Penulisan Profil Voucher Anda.\n\nTerima Kasih"
}
```

### 5. Admin UI (No Changes Needed)

Verified:
- `routes/admin-content-routes.js:37-79` — GET `/api/templates` sudah return `responseTemplates`
- `routes/admin-content-routes.js:81-118` — POST `/api/templates` sudah save `responseTemplates`
- `views/sb-admin/templates.php:343-344` — sudah ada tab Response
- `views/sb-admin/templates.php:716-948` — sudah ada kategorisasi + save logic untuk responseTemplates

Key baru otomatis muncul di admin UI setelah server restart (karena `loadAllCategories()` dipanggil saat startup di `template-service.js:240`).

### 6. Wave Breakdown

**Wave F1 — Admin-only Network/Voucher (LOW risk)**
- `voucher-management-handler.js` (10 keys)
- `network-management-handler.js` (17 keys)
- Impact: admin/owner commands only. Tidak kena customer flow.

**Wave F2 — WiFi/Reboot Management (MEDIUM risk)**
- `wifi-power-handler.js` (9 keys)
- `reboot-modem-handler.js` (5 keys)
- `wifi-check-handler.js` (3 keys)
- `legacy-wifi-state-handler.js` (6 keys)
- Impact: customer-facing, tapi flow self-contained.

**Wave F3 — Billing/Package/Balance (MEDIUM-HIGH risk)**
- `billing-management-handler.js` (6 keys)
- `package-management-handler.js` (10 keys)
- `balance-management-handler.js` (4 keys)
- Impact: customer billing flow. Perlu test regresi billing.

**Wave F4 — Access/States/Steps**
- `access-management-handler.js` (16 keys)
- `states/wifi-password-state-handler.js` (4 keys)
- `states/wifi-name-state-handler.js` (1 key)
- `steps/wifi-steps.js` (2 keys)
- `steps/general-steps.js` (1 key)
- `conversation-state-handler.js` (2 keys)
- Impact: state machine flows.

**Wave F5 — Utility/Monitoring cleanup**
- `utility-handler.js` (3 keys)
- `monitoring-handler.js` (8 keys — statistik headers)
- Impact: admin/owner stats.

### 7. Testing Strategy

Ikuti pola existing di `message/__tests__/wa-hardcoded-message-migration-*.test.js`:

Per wave, tambah 1 test file `wa-hardcoded-message-migration-wave-f{N}.test.js` yang verifikasi:
- File handler tidak lagi mengandung string hardcoded utama
- Handler panggil `renderResponseTemplate` atau `renderCategoryTemplate('responseTemplates', ...)`
- Key baru ada di `response_templates.json`

Plus jalankan smoke-core penuh per `pre-deploy-verification-checklist.md` setelah setiap wave.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Placeholder admin mengedit jadi tidak valid | `renderString` di `template-service.js:133-144` biarkan placeholder unresolved as-is, tidak throw error |
| Admin menghapus template key | Fallback parameter kedua di `renderResponseTemplate` tetap return string hardcoded original |
| Regression test existing hardcoded string di `__tests__` | Grep semua test file sebelum eksekusi, update expected values kalau ada assertion terhadap string hardcoded |
| File size `response_templates.json` membengkak | Saat ini 113KB. +90 key ~ +15KB. Masih acceptable |
| Breaking change untuk test guardrail | Tambah per-wave test guardrail, jangan langsung satu mega test |

## Acceptance Criteria

Per wave:
- [ ] Semua file dalam wave tidak lagi mengandung hardcoded string target
- [ ] `response_templates.json` berisi semua key baru untuk wave tersebut
- [ ] Test `wa-hardcoded-message-migration-wave-f{N}.test.js` pass
- [ ] Smoke-core pack pass (22 suite, 59 test, 0 fail)
- [ ] Admin panel `/templates` menampilkan key baru di tab Response
- [ ] Manual smoke: edit 1 template di admin → restart bot → verifikasi perubahan berlaku

Final:
- [ ] Semua Wave F1-F5 selesai
- [ ] Grep pattern `reply\(\`[^$][A-Z]` di `message/handlers/*` menghasilkan 0 match (kecuali yang intentional)
- [ ] Update `SYSTEM_MAP.md` Wave summary
- [ ] Update `docs/testing/deploy-readiness-final-*.md` dengan status baru
