# Final Reporting State Authority Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghapus fallback reporting aktif dari `message/raf.js` sehingga `reporting.state.js` dan `conversation-state-router.js` menjadi authority final untuk state reporting.

**Architecture:** Fase ini menyelesaikan sisa dual-path terbesar. Pekerjaan dimulai dengan guardrail eksplisit untuk representative reporting branch, lalu mengeraskan owner `reporting.state.js`, menghapus branch reporting dari router utama, dan menutup dengan regression suite state/bot. Reporting dikerjakan sendiri karena blast radius paling besar.

**Tech Stack:** Node.js CommonJS, Jest, `message/raf.js`, `message/handlers/state-domains/reporting.state.js`, `message/handlers/conversation-state-router.js`, static/source guardrails, `.module_map.md`, `SYSTEM_MAP.md`.

---

### Task 1: Guardrail the Remaining Reporting Fallback

**Files:**
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Add explicit reporting fallback markers**

Tambahkan assertion representative untuk branch reporting yang masih aktif di router:
- `REPORT_MENU`
- `REPORT_LEMOT_ANALYSIS`
- `GANGGUAN_MATI_DEVICE_OFFLINE`
- `GANGGUAN_LEMOT_CONFIRM_TICKET`
- `TICKET_RESOLVE_UPLOAD_PHOTOS`

- [ ] **Step 2: Run boundary baseline**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js`
Expected: PASS dan menangkap baseline reporting fallback yang tersisa.

### Task 2: Harden Reporting State Owner

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\state-domains\reporting.state.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\reporting-state-owner.test.js`
- Verify: `C:\project\raf-bot-v2\message\handlers\conversation-state-owner-map.js`

- [ ] **Step 1: Tighten reporting owner assertions**

Pastikan owner reporting memuat representative step aktif dan bukan sekadar shell.

- [ ] **Step 2: Patch `reporting.state.js` if any missing representative branch remains**

- [ ] **Step 3: Re-run reporting owner tests**

Run: `npm test -- message/__tests__/reporting-state-owner.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 3: Remove Reporting Fallback from `message/raf.js`

**Files:**
- Modify: `C:\project\raf-bot-v2\message\raf.js`
- Modify: `C:\project\raf-bot-v2\message\__tests__\conversation-state-boundary.test.js`

- [ ] **Step 1: Remove representative reporting branch execution from router**

Target removal:
- `REPORT_MENU`
- `REPORT_LEMOT_ANALYSIS`
- `CONFIRM_MATI_REPORT`
- `REPORT_MATI_TROUBLESHOOT`
- `REPORT_MATI_PHOTO`
- `LEMOT_AWAITING_PHOTO`
- `CONFIRM_DIRECT_MATI`
- `DIRECT_LEMOT_TROUBLESHOOT`
- `GANGGUAN_MATI_*`
- `GANGGUAN_LEMOT_*`
- `TICKET_RESOLVE_*`

- [ ] **Step 2: Invert boundary test from baseline to prohibition**

Setelah purge, `conversation-state-boundary.test.js` harus melarang representative reporting branch kembali ke router utama.

- [ ] **Step 3: Re-run focused reporting verification**

Run: `npm test -- message/__tests__/conversation-state-boundary.test.js message/__tests__/reporting-state-owner.test.js message/__tests__/conversation-state-router.test.js`
Expected: PASS.

### Task 4: Final Verification and Docs Sync

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`

- [ ] **Step 1: Sync authority wording**

Tambahkan catatan bahwa:
- reporting state authority sudah final di `reporting.state.js`,
- `message/raf.js` tidak lagi mengeksekusi reporting fallback aktif.

- [ ] **Step 2: Run final verification suite**

Run: `npm test -- message/__tests__/conversation-state-owner-map.test.js message/__tests__/conversation-state-router.test.js message/__tests__/reporting-state-owner.test.js message/__tests__/conversation-state-boundary.test.js message/__tests__/bot-hardening.test.js message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the final authority batch**

```bash
git add message SYSTEM_MAP.md
git commit -m "refactor: finalize reporting state authority"
```
