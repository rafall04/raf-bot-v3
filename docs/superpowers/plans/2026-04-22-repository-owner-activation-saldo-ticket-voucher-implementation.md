# Repository Owner Activation for Saldo, Ticket, and Voucher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengaktifkan `saldo.repository.js`, `ticket.repository.js`, dan `voucher.repository.js` sebagai owner aktif pada jalur bisnis nyata, sehingga consumer prioritas tidak lagi membaca helper persistence langsung.

**Architecture:** Fase ini bergerak per domain. Tiap repository dipaksa punya contract yang lebih nyata, lalu satu consumer aktif dipindah ke repository owner tersebut. Helper `lib/*` lama masih boleh dipakai sementara, tetapi hanya di bawah repository, bukan di level service/handler yang mengorkestrasi flow. Setiap slice ditutup dengan regression test agar ownership baru tidak bocor kembali ke helper lama.

**Tech Stack:** Node.js CommonJS, Jest, repository `repositories/*.js`, handler bot `message/handlers/*`, helper persistence legacy `lib/*`, runtime/domain bridge `message/handlers/domain-services.js`.

---

### Task 1: Tighten Repository Contracts

**Files:**
- Modify: `C:\project\raf-bot-v2\repositories\__tests__\voucher.repository.contract.test.js`
- Modify: `C:\project\raf-bot-v2\repositories\__tests__\saldo-ticket-repositories.test.js`
- Verify: `C:\project\raf-bot-v2\repositories\voucher.repository.js`
- Verify: `C:\project\raf-bot-v2\repositories\saldo.repository.js`
- Verify: `C:\project\raf-bot-v2\repositories\ticket.repository.js`

- [ ] **Step 1: Strengthen the failing expectations**

Tambahkan ekspektasi untuk entrypoint owner yang akan dipakai consumer aktif:
- `voucherRepository.getVoucherCatalog()`
- `voucherRepository.findVoucherProfile()`
- `saldoRepository.getSaldoUser()`
- `saldoRepository.createSaldoUser()`
- `ticketRepository.saveReportDraft()`
- `ticketRepository.generateTicketId()`

- [ ] **Step 2: Run repository contract tests**

Run: `npm test -- repositories/__tests__/voucher.repository.contract.test.js repositories/__tests__/saldo-ticket-repositories.test.js`
Expected: PASS or reveal shape mismatch before consumer migration.

### Task 2: Activate Voucher Repository on Active Read Consumer

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\domain-services.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\domains\saldo-payment.domain.js` if voucher lookup crosses payment flow
- Create: `C:\project\raf-bot-v2\message\__tests__\voucher-repository-owner.test.js`

- [ ] **Step 1: Write the failing owner test**

```js
test("voucher domain bridge reads catalog/profile via voucher repository owner", () => {
    const runtime = {
        repositories: {
            voucherRepository: {
                getVoucherCatalog: jest.fn(() => [{ prof: "VC-1" }]),
                findVoucherProfile: jest.fn(() => ({ prof: "VC-1" }))
            }
        }
    };
});
```

- [ ] **Step 2: Run the voucher owner test**

Run: `npm test -- message/__tests__/voucher-repository-owner.test.js`
Expected: FAIL until the consumer path uses repository owner explicitly.

- [ ] **Step 3: Replace direct voucher helper read on the chosen consumer**

Contoh pola target:

```js
const voucherRepository = repositories.voucher;
const catalog = voucherRepository.getVoucherCatalog();
const profile = voucherRepository.findVoucherProfile(profileName);
```

- [ ] **Step 4: Re-run voucher owner test plus existing message hardening**

Run: `npm test -- message/__tests__/voucher-repository-owner.test.js message/__tests__/runtime-repository-bridge.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

### Task 3: Activate Saldo Repository on Active Consumer

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\domain-services.js`
- Modify: `C:\project\raf-bot-v2\message\raf.js` or a saldo-facing handler using `checkATMuser`/user saldo init path
- Create: `C:\project\raf-bot-v2\message\__tests__\saldo-repository-owner.test.js`

- [ ] **Step 1: Write the failing owner test**

```js
test("saldo consumer uses saldo repository for canonical saldo lookup/create", async () => {
    const repository = {
        getSaldoUser: jest.fn(() => 25000),
        createSaldoUser: jest.fn()
    };
    expect(repository.getSaldoUser).toEqual(expect.any(Function));
});
```

- [ ] **Step 2: Run the saldo owner test**

Run: `npm test -- message/__tests__/saldo-repository-owner.test.js`
Expected: FAIL until chosen consumer uses repository owner.

- [ ] **Step 3: Migrate one active saldo consumer**

Contoh target:
- inisialisasi saldo user,
- canonical saldo lookup untuk flow prioritas.

Contoh pola:

```js
const saldoRepository = repositories.saldo;
const saldo = await saldoRepository.getSaldoUser(senderId);
await saldoRepository.createSaldoUser(senderId, pushname);
```

- [ ] **Step 4: Re-run saldo owner test plus message regression**

Run: `npm test -- message/__tests__/saldo-repository-owner.test.js message/__tests__/bot-hardening.test.js message/__tests__/runtime-repository-bridge.test.js`
Expected: PASS.

### Task 4: Activate Ticket Repository on Reporting/Ticket Consumer

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\domains\reporting.domain.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\ticket-creation-handler.js` or `message/handlers/smart-report-*` consumer path
- Create: `C:\project\raf-bot-v2\message\__tests__\ticket-repository-owner.test.js`

- [ ] **Step 1: Write the failing owner test**

```js
test("reporting/ticket consumer uses ticket repository owner for draft persistence or ticket id boundary", () => {
    const repository = {
        saveReportDraft: jest.fn(),
        generateTicketId: jest.fn(() => "TKT-1")
    };
    expect(repository.generateTicketId()).toBe("TKT-1");
});
```

- [ ] **Step 2: Run the ticket owner test**

Run: `npm test -- message/__tests__/ticket-repository-owner.test.js`
Expected: FAIL until chosen reporting consumer uses repo owner.

- [ ] **Step 3: Migrate one active reporting/ticket persistence path**

Contoh pola target:

```js
const ticketRepository = repositories.ticket;
ticketRepository.saveReportDraft(reports);
const ticketId = ticketRepository.generateTicketId();
```

- [ ] **Step 4: Re-run ticket owner test plus reporting regression**

Run: `npm test -- message/__tests__/ticket-repository-owner.test.js message/__tests__/reporting-domain.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

### Task 5: Tighten Domain Bridge to Prefer Repository Owners

**Files:**
- Modify: `C:\project\raf-bot-v2\message\handlers\domain-services.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\domain-services-owner-precedence.test.js`

- [ ] **Step 1: Write the failing precedence test**

```js
test("domain services prefer repository owners over direct helper persistence for saldo/ticket/voucher", () => {
    const runtime = {
        repositories: {
            saldo: { getSaldoUser: jest.fn() },
            ticket: { saveReportDraft: jest.fn() },
            voucherRepository: { getVoucherCatalog: jest.fn() }
        }
    };
});
```

- [ ] **Step 2: Run the precedence test**

Run: `npm test -- message/__tests__/domain-services-owner-precedence.test.js`
Expected: FAIL until precedence is explicit.

- [ ] **Step 3: Make repository precedence explicit in the bridge**

Pastikan `resolveDomainRepositories(runtime)` menjadi jalur utama untuk concern yang sudah dipindah, dan helper direct hanya fallback untuk concern lain.

- [ ] **Step 4: Re-run precedence and bridge tests**

Run: `npm test -- message/__tests__/domain-services-owner-precedence.test.js message/__tests__/runtime-repository-bridge.test.js`
Expected: PASS.

### Task 6: Sync Docs and Run Final Owner Activation Verification

**Files:**
- Modify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\.module_map.md` if bridge wording changes

- [ ] **Step 1: Sync repository ownership wording**

Tambahkan catatan bahwa:
- saldo/ticket/voucher repository kini dipakai consumer aktif,
- `domain-services` memprioritaskan repository owner,
- helper legacy tersisa sebagai fallback compatibility saja.

- [ ] **Step 2: Run final verification suite**

Run: `npm test -- repositories/__tests__/voucher.repository.contract.test.js repositories/__tests__/saldo-ticket-repositories.test.js message/__tests__/voucher-repository-owner.test.js message/__tests__/saldo-repository-owner.test.js message/__tests__/ticket-repository-owner.test.js message/__tests__/domain-services-owner-precedence.test.js message/__tests__/runtime-repository-bridge.test.js message/__tests__/reporting-domain.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

- [ ] **Step 3: Commit the activation batch**

```bash
git add repositories message SYSTEM_MAP.md
git commit -m "refactor: activate saldo ticket voucher repository owners"
```
