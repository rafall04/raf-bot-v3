# Header Doc
- Purpose: Implementation plan bertahap untuk migrasi ~90 hardcoded WhatsApp messages ke `response_templates.json` agar editable via admin web.
- Caller: Pengembang/agent yang mengeksekusi Wave F1-F5 secara berurutan.
- Deps: `2026-04-24-wa-hardcoded-message-admin-customizable-final-wave-design.md`, `lib/template-service.js`, `database/response_templates.json`, handler bot.
- MainFuncs: Checklist task terurut per wave dengan exit criteria eksplisit.
- SideEffects: Tidak ada; dokumentasi statis. Eksekusi dilakukan step-by-step.

# IMPLEMENTATION PLAN — WA Hardcoded Message Admin Customizable Final Wave

## Prasyarat (Lakukan Sekali Sebelum Wave F1)

### P.1 Centralized Template Helper

File baru: `message/handlers/template-helpers.js`

```javascript
/**
 * Header Doc
 * Purpose: Helper sentralisasi untuk render responseTemplates dengan fallback aman.
 * Caller: Seluruh handler di message/handlers/*.
 * Deps: lib/template-service.
 * MainFuncs: renderResponseTemplate.
 * SideEffects: Tidak ada; pure function render template dengan fallback.
 */
"use strict";

const { renderCategoryTemplate } = require('../../lib/template-service');

function renderResponseTemplate(key, fallback, data = {}) {
    const result = renderCategoryTemplate('responseTemplates', key, data);
    return result.found && result.text ? result.text : fallback;
}

module.exports = { renderResponseTemplate };
```

### P.2 Test Skeleton

File baru: `message/__tests__/wa-hardcoded-message-migration-wave-f-helpers.test.js`

Verifikasi:
- `renderResponseTemplate(missingKey, 'fallback')` return `'fallback'`
- `renderResponseTemplate(existingKey, 'fallback', data)` return rendered template
- `renderResponseTemplate(existingKey, 'fallback')` dengan empty template di JSON return `'fallback'`

### Exit Criteria Prasyarat
- [ ] File `template-helpers.js` dibuat
- [ ] Test helper pass
- [ ] Smoke-core pack pass (22 suite, 59 test, 0 fail)

---

## Wave F1 — Admin-only Network/Voucher (LOW risk)

### Task F1.1 — voucher-management-handler.js

File: `message/handlers/voucher-management-handler.js`

Migrasi keys:
- `voucher_profile_exists` (line 19)
- `voucher_profile_create_success` (line 22)
- `voucher_profile_not_found` (line 45)
- `voucher_profile_delete_success` (line 49)
- `statik_profile_exists` (line 72)
- `statik_profile_create_success` (line 75)
- `statik_profile_not_found` (line 98)
- `statik_profile_delete_success` (line 102)

Plus generic error (shared): `voucher_generic_error`, `statik_generic_error`

### Task F1.2 — network-management-handler.js

File: `message/handlers/network-management-handler.js`

Migrasi keys (semua 22 hardcoded):
- Binding: `network_binding_profile_not_found`, `network_binding_mac_exists`, `network_binding_invalid_mac`, `network_binding_range_ip`, `network_binding_technical_error`, `network_binding_success`
- Queue: `network_queue_parent_not_found`, `network_queue_already_exists`, `network_queue_limitat_exceed_download`, `network_queue_limitat_exceed_upload`, `network_queue_technical_error`, `network_queue_success`
- PPP: `network_ppp_profile_error`, `network_ppp_already_exists`, `network_ppp_technical_error`, `network_ppp_success`

### Task F1.3 — Append keys ke response_templates.json

Tambah 16 entry baru dengan format:
```json
"network_binding_success": {
    "name": "Network: IP Binding Berhasil",
    "template": "Pembuatan Ip Binding Telah Selesai. Dengan Data Berikut :\n\nKomen : ${komen}\nIP : ${ip}\nMAC ADDRESS : ${mac}\n\nTerima Kasih"
}
```

### Task F1.4 — Test guardrail

File baru: `message/__tests__/wa-hardcoded-message-migration-wave-f1.test.js`

Verifikasi:
- Handler files tidak mengandung hardcoded string utama
- Handler import `renderResponseTemplate` dari `template-helpers`
- Semua key F1 exist di `response_templates.json`

### Exit Criteria F1
- [ ] Semua hardcoded di 2 file F1 migrated
- [ ] 16+ keys ditambah ke response_templates.json
- [ ] Test F1 pass
- [ ] Smoke-core pack pass
- [ ] Manual: edit 1 key lewat admin → verifikasi persisted

---

## Wave F2 — WiFi/Reboot Management (MEDIUM risk)

### Task F2.1 — wifi-power-handler.js

File: `message/handlers/wifi-power-handler.js` (9 hardcoded)

Keys:
- `wifi_power_admin_id_not_found` (line 46)
- `wifi_power_admin_prompt_id` (line 46)
- `wifi_power_voucher_only_monthly` (line 51)
- `wifi_power_device_missing` (line 55)
- `wifi_power_format_prompt` (line 59 — throw string)
- `wifi_power_format_error` (line 63 — throw string)
- `wifi_power_success` (line 77)
- `wifi_power_technical_error` (line 81)
- `wifi_power_generic_error` (line 89)

### Task F2.2 — reboot-modem-handler.js

File: `message/handlers/reboot-modem-handler.js` (5 hardcoded)

Keys:
- `reboot_admin_id_not_found` (line 32)
- `reboot_admin_prompt_id` (line 32)
- `reboot_voucher_only_monthly` (line 38)
- `reboot_device_missing` (line 42)
- `reboot_confirm_prompt` (line 50)

### Task F2.3 — wifi-check-handler.js

File: `message/handlers/wifi-check-handler.js` (3 hardcoded)

Keys:
- `wifi_check_lid_not_registered` (line 62)
- `wifi_check_admin_help` (line 84-87)
- `wifi_check_device_missing` (line 98)
- `wifi_check_loading` (line 101)

### Task F2.4 — legacy-wifi-state-handler.js

File: `message/handlers/legacy-wifi-state-handler.js` (6 hardcoded)

Keys:
- `wifi_confirm_name_success` (line 68)
- `wifi_confirm_name_failed` (line 71)
- `wifi_confirm_name_cancelled` (line 74)
- `wifi_confirm_password_success` (line 91)
- `wifi_confirm_password_failed` (line 94)
- `wifi_confirm_password_cancelled` (line 97)

### Task F2.5 — Keys + tests

Tambah ~23 keys ke `response_templates.json`, buat test `wa-hardcoded-message-migration-wave-f2.test.js`.

### Exit Criteria F2
- [ ] 4 file migrated
- [ ] 23+ keys ditambah
- [ ] Test F2 pass
- [ ] Smoke-core pack pass
- [ ] Manual regression: customer "ganti power wifi 80", "reboot modem", "cek wifi", dan confirm WiFi name/password flow

---

## Wave F3 — Billing/Package/Balance (MEDIUM-HIGH risk)

### Task F3.1 — billing-management-handler.js

File: `message/handlers/billing-management-handler.js` (6 hardcoded)

Keys:
- `billing_lid_not_registered` (line 42)
- `billing_check_generic_error` (line 77)
- `billing_change_package_pending` (line 129)
- `billing_no_other_packages` (line 138)
- `billing_change_package_list_header` (line 153 template literal)
- `billing_change_package_generic_error` (line 158)

### Task F3.2 — package-management-handler.js

File: `message/handlers/package-management-handler.js` (10 hardcoded)

Keys:
- `package_lid_not_registered` (line 42)
- `package_request_pending` (line 58)
- `package_list_intro` (line 73)
- `package_upgrade_header`, `package_downgrade_header` (line 77, 85)
- `package_no_options` (line 93)
- `package_list_footer` (line 96)
- `package_generic_error` (line 108)
- `sod_lid_not_registered` (line 144)
- `sod_active_exists` (line 160)
- `sod_pending_exists` (line 168)
- `sod_no_options` (line 179)
- `sod_list_intro` (line 182)
- `sod_list_footer` (line 203)
- `sod_generic_error` (line 215)

### Task F3.3 — balance-management-handler.js

File: `message/handlers/balance-management-handler.js` (3 hardcoded + generic)

Keys:
- `balance_del_saldo_not_found` (line 103)
- `balance_topup_generic_error` (line 85)
- `balance_del_saldo_generic_error` (line 121)
- `balance_transfer_insufficient` (line 141 — throw string)
- `balance_transfer_generic_error` (line 238)

### Task F3.4 — Keys + tests

Tambah ~25 keys ke `response_templates.json`, buat test `wa-hardcoded-message-migration-wave-f3.test.js`.

### Exit Criteria F3
- [ ] 3 file migrated
- [ ] 25+ keys ditambah
- [ ] Test F3 pass
- [ ] Smoke-core pack pass
- [ ] Manual regression: customer "cek tagihan", "ubah paket", "speed on demand", admin topup/delsaldo/transfer

---

## Wave F4 — Access/States/Steps

### Task F4.1 — access-management-handler.js

File: `message/handlers/access-management-handler.js` (16 hardcoded)

Keys: `access_*` (16 keys sesuai design spec)

### Task F4.2 — states/ folder

Files:
- `states/wifi-password-state-handler.js` (4 hardcoded)
- `states/wifi-name-state-handler.js` (1 hardcoded)

Keys: `wifi_password_change_error`, `wifi_password_bulk_change_error`, `wifi_password_applying_single`, `wifi_password_applying_bulk`, `wifi_name_change_error`

### Task F4.3 — steps/ folder

Files:
- `steps/wifi-steps.js` (2 hardcoded)
- `steps/general-steps.js` (1 hardcoded)

Keys: `wifi_step_applying_name_bulk`, `wifi_step_applying_password_bulk`, `general_step_applying_power`

### Task F4.4 — conversation-state-handler.js

File: `message/handlers/conversation-state-handler.js` (2 hardcoded)

Keys: `conversation_universal_cancel`, `conversation_unknown_step_error`

### Task F4.5 — Keys + tests

Tambah ~24 keys ke `response_templates.json`, buat test `wa-hardcoded-message-migration-wave-f4.test.js`.

### Exit Criteria F4
- [ ] 5 file migrated
- [ ] 24+ keys ditambah
- [ ] Test F4 pass
- [ ] Smoke-core pack pass
- [ ] Manual regression: access add/delete/list, WiFi state confirm flows

---

## Wave F5 — Utility/Monitoring cleanup

### Task F5.1 — utility-handler.js

File: `message/handlers/utility-handler.js` (3 hardcoded)

Keys:
- `utility_admin_contact_missing`
- `utility_bantuan_fallback` (hardcoded fallback text)
- `utility_cek_tiket_not_owned`

### Task F5.2 — monitoring-handler.js

File: `message/handlers/monitoring-handler.js` (5+ hardcoded di statistics headers)

Keys:
- `monitoring_ppp_stats_header`
- `monitoring_ppp_inactive_list_header`
- `monitoring_ppp_all_active`
- `monitoring_ppp_no_detail`
- `monitoring_hotspot_stats_header`
- `monitoring_allsaldo_header`
- `monitoring_alluser_entry_format`
- `monitoring_list_profstatik_header`
- `monitoring_list_profstatik_entry`
- `monitoring_list_profvoucher_header`
- `monitoring_list_profvoucher_entry`

### Task F5.3 — Keys + tests

Tambah ~14 keys ke `response_templates.json`, buat test `wa-hardcoded-message-migration-wave-f5.test.js`.

### Exit Criteria F5
- [ ] 2 file migrated
- [ ] 14+ keys ditambah
- [ ] Test F5 pass
- [ ] Smoke-core pack pass
- [ ] Manual: admin "statusppp", "statushotspot", "allsaldo", "bantuan", "cektiket"

---

## Final Exit Criteria (Post Wave F5)

- [ ] Grep audit: `reply\(\`[^$][A-Z]` di `message/handlers/*` returns 0 hardcoded matches
- [ ] Grep audit: `reply\("[A-Z]` returns 0 hardcoded matches (kecuali intentional short text)
- [ ] All wave tests pass
- [ ] Smoke-core pack pass end-to-end
- [ ] Update `SYSTEM_MAP.md` Wave summary dengan entry baru
- [ ] Update `docs/testing/deploy-readiness-final-*.md`
- [ ] Changelog commit-by-commit jelas

---

## Execution Notes

1. **Setiap wave = 1 commit** (atau max 2-3 kalau besar)
2. **Pattern konsisten**: import `renderResponseTemplate` dari `template-helpers`, pakai sebagai `reply(renderResponseTemplate('key', fallback, data))`
3. **Jangan ubah logika bisnis** — hanya migrasi string
4. **Review placeholder naming** agar consistent dengan existing (`${nama_pelanggan}`, bukan `${customerName}`)
5. **Test regresi per wave**: jalankan `npm test` untuk file test terkait handler yang di-migrasi

## Rollback Strategy

Setiap wave adalah commit atomik. Kalau regression:
1. `git revert <commit>` membatalkan migration wave
2. Fallback pattern menjamin behavior tidak berubah meski `response_templates.json` corrupt
3. Admin UI edit hanya efek runtime; restart bot untuk reload cache
