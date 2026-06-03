# Message Handlers Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengonsolidasikan `message/handlers` agar `message/raf.js` menjadi composition router tipis, ownership intent bot jelas, dan flow prioritas punya guardrail regression.

**Architecture:** Kerja dilakukan dari atas ke bawah: pasang guardrail test untuk import surface dan ownership intent, normalkan bot context, lalu pindahkan orchestration domain berisiko tinggi ke facade/domain boundary yang lebih kecil tanpa mengubah command publik. Flow prioritas adalah `report/ticket`, `wifi`, `agent voucher`, dan `saldo/payment`, dengan kompatibilitas sementara ke helper legacy `lib/*`.

**Tech Stack:** Node.js CommonJS, Jest, WhatsApp bot router `message/raf.js`, `message/handlers/*`, service/helper legacy `lib/*`.

---

### Task 1: Add Router Slimming Guardrail

**Files:**
- Create: `C:\project\raf-bot-v2\message\__tests__\raf-router-boundary.test.js`
- Verify: `C:\project\raf-bot-v2\message\raf.js`

- [ ] **Step 1: Write the failing test for `message/raf.js` boundary**

```js
const fs = require("fs");
const path = require("path");

test("message/raf.js only imports pipeline/context/domain facade modules", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "raf.js"), "utf8");

    expect(source).not.toContain("const { addvoucher");
    expect(source).not.toContain("const { addStatik");
    expect(source).not.toContain("const { addATM");
    expect(source).toContain("require('./handlers/raf-intent-dispatch')");
    expect(source).toContain("require('./handlers/raf-state-routing')");
});
```

- [ ] **Step 2: Run the test to verify it fails on current import sprawl**

Run: `npm test -- message/__tests__/raf-router-boundary.test.js`
Expected: FAIL karena `message/raf.js` masih mengimpor helper domain langsung.

- [ ] **Step 3: Make the minimal production change**

```js
const domainHandlers = require("./handlers/domain-handlers");
const domainServices = require("./handlers/domain-services");
```

Tambahkan facade import tipis di `message/raf.js`; jangan pindahkan logic penuh dulu.

- [ ] **Step 4: Re-run the guardrail**

Run: `npm test -- message/__tests__/raf-router-boundary.test.js`
Expected: PASS.

### Task 2: Freeze Intent Ownership Map

**Files:**
- Create: `C:\project\raf-bot-v2\message\handlers\intent-owner-map.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\intent-owner-map.test.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\raf-intent-dispatch.js`

- [ ] **Step 1: Write the failing test for one-owner-per-intent**

```js
const { INTENT_OWNER_MAP } = require("../handlers/intent-owner-map");

test("high-impact intents have a single explicit owner", () => {
    expect(INTENT_OWNER_MAP.LAPOR_GANGGUAN).toBe("reporting");
    expect(INTENT_OWNER_MAP.GANTI_NAMA_WIFI).toBe("wifi");
    expect(INTENT_OWNER_MAP.AGENT_VOUCHER_BELI).toBe("agent-voucher");
    expect(INTENT_OWNER_MAP.TOPUP_SALDO).toBe("saldo-payment");
});
```

- [ ] **Step 2: Run the ownership test to verify the map does not exist yet**

Run: `npm test -- message/__tests__/intent-owner-map.test.js`
Expected: FAIL dengan module/file belum ada.

- [ ] **Step 3: Implement the minimal intent ownership map**

```js
"use strict";

const INTENT_OWNER_MAP = {
    LAPOR_GANGGUAN: "reporting",
    LAPOR_GANGGUAN_MATI: "reporting",
    GANTI_NAMA_WIFI: "wifi",
    GANTI_SANDI_WIFI: "wifi",
    AGENT_VOUCHER_BELI: "agent-voucher",
    AGENT_VOUCHER_JUAL: "agent-voucher",
    TOPUP_SALDO: "saldo-payment",
    BELI_VOUCHER: "saldo-payment"
};

module.exports = {
    INTENT_OWNER_MAP
};
```

- [ ] **Step 4: Wire the dispatcher to read the map**

```js
const { INTENT_OWNER_MAP } = require("./intent-owner-map");
const owner = INTENT_OWNER_MAP[intent] || "legacy";
```

- [ ] **Step 5: Re-run the ownership guardrail**

Run: `npm test -- message/__tests__/intent-owner-map.test.js`
Expected: PASS.

### Task 3: Normalize Bot Context Contract

**Files:**
- Create: `C:\project\raf-bot-v2\message\__tests__\bot-context-contract.test.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\bot-context.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\raf-context.js`

- [ ] **Step 1: Write the failing context contract test**

```js
const { buildBotContext } = require("../handlers/bot-context");

test("buildBotContext produces canonical bot contract", () => {
    const context = buildBotContext({
        raf: { sendMessage: jest.fn() },
        msg: { key: { remoteJid: "12345@lid" } },
        runtime: { id: "runtime-1" },
        data: {
            sender: "12345@lid",
            canonicalSenderId: "628123456789@s.whatsapp.net",
            stateSender: "628123456789@s.whatsapp.net",
            intentOwner: "reporting"
        }
    });

    expect(context).toEqual(expect.objectContaining({
        sender: "12345@lid",
        canonicalSenderId: "628123456789@s.whatsapp.net",
        stateSender: "628123456789@s.whatsapp.net",
        intentOwner: "reporting"
    }));
});
```

- [ ] **Step 2: Run the context test to verify it fails on missing fields**

Run: `npm test -- message/__tests__/bot-context-contract.test.js`
Expected: FAIL karena contract belum penuh.

- [ ] **Step 3: Implement the minimal context additions**

```js
return {
    raf,
    msg,
    runtime,
    sender: data.sender,
    canonicalSenderId: data.canonicalSenderId || data.sender,
    stateSender: data.stateSender || data.canonicalSenderId || data.sender,
    intentOwner: data.intentOwner || "legacy",
    ...data
};
```

- [ ] **Step 4: Re-run existing bot pipeline tests with the new contract**

Run: `npm test -- message/__tests__/bot-context-contract.test.js message/__tests__/bot-pipeline.test.js`
Expected: PASS.

### Task 4: Extract Reporting Domain Facade

**Files:**
- Create: `C:\project\raf-bot-v2\message\handlers\domains\reporting.domain.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\reporting-domain.test.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\raf-intent-dispatch.js`

- [ ] **Step 1: Write the failing test for reporting domain ownership**

```js
jest.mock("../handlers/smart-report-text-menu", () => ({
    startReportFlow: jest.fn().mockResolvedValue({ message: "ok" })
}));

const { handleReportingIntent } = require("../handlers/domains/reporting.domain");

test("reporting domain owns LAPOR_GANGGUAN", async () => {
    const reply = jest.fn();
    const result = await handleReportingIntent({
        intent: "LAPOR_GANGGUAN",
        sender: "6281@s.whatsapp.net",
        stateSender: "6281@s.whatsapp.net",
        pushname: "Tester",
        reply,
        msg: {},
        raf: {}
    });

    expect(result).toEqual(expect.objectContaining({ handled: true }));
    expect(reply).toHaveBeenCalledWith("ok");
});
```

- [ ] **Step 2: Run the reporting test to verify the facade is missing**

Run: `npm test -- message/__tests__/reporting-domain.test.js`
Expected: FAIL karena module domain belum ada.

- [ ] **Step 3: Implement the minimal reporting facade**

```js
"use strict";

const { startReportFlow } = require("../smart-report-text-menu");

async function handleReportingIntent(context) {
    if (context.intent !== "LAPOR_GANGGUAN") {
        return { handled: false };
    }

    const result = await startReportFlow({
        sender: context.sender,
        stateKey: context.stateSender,
        pushname: context.pushname,
        reply: context.reply,
        msg: context.msg,
        raf: context.raf
    });

    if (result.message) {
        await context.reply(result.message);
    }

    return { handled: true, result };
}

module.exports = {
    handleReportingIntent
};
```

- [ ] **Step 4: Delegate from dispatcher to the reporting facade**

```js
const { handleReportingIntent } = require("./domains/reporting.domain");
```

- [ ] **Step 5: Re-run reporting and hardening regression tests**

Run: `npm test -- message/__tests__/reporting-domain.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

### Task 5: Extract WiFi Domain Facade

**Files:**
- Create: `C:\project\raf-bot-v2\message\handlers\domains\wifi.domain.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\wifi-domain.test.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\raf-intent-dispatch.js`

- [ ] **Step 1: Write the failing test for WiFi intent ownership**

```js
jest.mock("../handlers/wifi-management-handler", () => ({
    handleGantiNamaWifi: jest.fn().mockResolvedValue({ success: true })
}));

const { handleWifiIntent } = require("../handlers/domains/wifi.domain");

test("wifi domain owns GANTI_NAMA_WIFI intent", async () => {
    const result = await handleWifiIntent({
        intent: "GANTI_NAMA_WIFI",
        sender: "6281@s.whatsapp.net",
        reply: jest.fn()
    });

    expect(result).toEqual(expect.objectContaining({ handled: true }));
});
```

- [ ] **Step 2: Run the WiFi domain test**

Run: `npm test -- message/__tests__/wifi-domain.test.js`
Expected: FAIL karena facade belum ada.

- [ ] **Step 3: Implement the minimal WiFi facade**

```js
"use strict";

const { handleGantiNamaWifi, handleGantiSandiWifi } = require("../wifi-management-handler");

async function handleWifiIntent(context) {
    if (context.intent === "GANTI_NAMA_WIFI") {
        await handleGantiNamaWifi(context);
        return { handled: true };
    }

    if (context.intent === "GANTI_SANDI_WIFI") {
        await handleGantiSandiWifi(context);
        return { handled: true };
    }

    return { handled: false };
}

module.exports = {
    handleWifiIntent
};
```

- [ ] **Step 4: Re-run WiFi and bot hardening regressions**

Run: `npm test -- message/__tests__/wifi-domain.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

### Task 6: Extract Agent Voucher and Saldo/Payment Facades

**Files:**
- Create: `C:\project\raf-bot-v2\message\handlers\domains\agent-voucher.domain.js`
- Create: `C:\project\raf-bot-v2\message\handlers\domains\saldo-payment.domain.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\agent-voucher-domain.test.js`
- Create: `C:\project\raf-bot-v2\message\__tests__\saldo-payment-domain.test.js`
- Modify: `C:\project\raf-bot-v2\message\handlers\raf-intent-dispatch.js`

- [ ] **Step 1: Write the failing tests for agent voucher and saldo/payment owners**

```js
expect(await handleAgentVoucherIntent({ intent: "AGENT_VOUCHER_BELI" })).toEqual(expect.objectContaining({ handled: true }));
expect(await handleSaldoPaymentIntent({ intent: "BELI_VOUCHER" })).toEqual(expect.objectContaining({ handled: true }));
```

- [ ] **Step 2: Run the domain tests**

Run: `npm test -- message/__tests__/agent-voucher-domain.test.js message/__tests__/saldo-payment-domain.test.js`
Expected: FAIL karena facade belum ada.

- [ ] **Step 3: Implement minimal facades**

```js
async function handleAgentVoucherIntent(context) {
    if (context.intent === "AGENT_VOUCHER_BELI") {
        await handleAgentPurchaseVoucher(context);
        return { handled: true };
    }
    return { handled: false };
}
```

```js
async function handleSaldoPaymentIntent(context) {
    if (context.intent === "BELI_VOUCHER") {
        await handleBeliVoucher(context);
        return { handled: true };
    }
    if (context.intent === "TOPUP_SALDO") {
        await handleTopupSaldoPayment(context);
        return { handled: true };
    }
    return { handled: false };
}
```

- [ ] **Step 4: Re-run domain regressions plus existing hardening tests**

Run: `npm test -- message/__tests__/agent-voucher-domain.test.js message/__tests__/saldo-payment-domain.test.js message/__tests__/bot-hardening.test.js`
Expected: PASS.

### Task 7: Sync Bot Maps and Run Final Verification

**Files:**
- Modify: `C:\project\raf-bot-v2\message\.module_map.md`
- Modify: `C:\project\raf-bot-v2\message\handlers\.module_map.md`
- Verify: `C:\project\raf-bot-v2\SYSTEM_MAP.md`

- [ ] **Step 1: Update module maps to reflect new bot ownership boundaries**

```md
| `message/handlers/domains/reporting.domain.js` | `handleReportingIntent` | Facade owner intent reporting/ticket prioritas. |
| `message/handlers/domains/wifi.domain.js` | `handleWifiIntent` | Facade owner intent WiFi pelanggan. |
| `message/handlers/domains/agent-voucher.domain.js` | `handleAgentVoucherIntent` | Facade owner intent agent voucher. |
| `message/handlers/domains/saldo-payment.domain.js` | `handleSaldoPaymentIntent` | Facade owner intent saldo/payment. |
```

- [ ] **Step 2: Verify whether `SYSTEM_MAP.md` needs wording changes**

Run: `Select-String -Path SYSTEM_MAP.md,message/.module_map.md,message/handlers/.module_map.md -Pattern "message/raf.js|raf-intent-dispatch|domains"`
Expected: results that confirm whether root system map already matches or needs a one-line sync.

- [ ] **Step 3: Run final bot verification suite**

Run: `npm test -- message/__tests__/raf-router-boundary.test.js message/__tests__/intent-owner-map.test.js message/__tests__/bot-context-contract.test.js message/__tests__/reporting-domain.test.js message/__tests__/wifi-domain.test.js message/__tests__/agent-voucher-domain.test.js message/__tests__/saldo-payment-domain.test.js message/__tests__/bot-pipeline.test.js message/__tests__/bot-hardening.test.js message/__tests__/conversation-handler-state-store.test.js`
Expected: PASS.

- [ ] **Step 4: Commit the consolidation batch**

```bash
git add message/raf.js message/handlers/raf-intent-dispatch.js message/handlers/raf-context.js message/handlers/bot-context.js message/handlers/intent-owner-map.js message/handlers/domains message/__tests__/raf-router-boundary.test.js message/__tests__/intent-owner-map.test.js message/__tests__/bot-context-contract.test.js message/__tests__/reporting-domain.test.js message/__tests__/wifi-domain.test.js message/__tests__/agent-voucher-domain.test.js message/__tests__/saldo-payment-domain.test.js message/.module_map.md message/handlers/.module_map.md SYSTEM_MAP.md
git commit -m "refactor: consolidate message handler ownership"
```
