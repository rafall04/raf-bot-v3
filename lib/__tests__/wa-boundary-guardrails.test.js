/**
 * Header Doc
 * Purpose: Guardrail tekstual untuk memastikan boundary WA baru tidak diregresikan ke primitive kirim legacy atau import Baileys langsung pada hotspot stabilisasi.
 * Caller: Jest.
 * Deps: `fs`, `path`, Jest timer, `lib/wa-timing`, dan file target pada route/helper yang sedang dimigrasikan.
 * MainFuncs: Memastikan file target tidak lagi mengandung `sendText(`, import adapter/gateway kirim langsung, atau import Baileys delay di luar boundary; memverifikasi helper delay resolve sesuai durasi.
 * SideEffects: Membaca file source secara read-only.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { waitForWhatsAppDelay } = require("../wa-timing");

function readSource(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8");
}

describe("wa boundary guardrails", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test("wa timing helper resolves after requested duration", async () => {
        jest.useFakeTimers();
        let resolved = false;
        const delayPromise = waitForWhatsAppDelay(25).then(() => {
            resolved = true;
        });

        jest.advanceTimersByTime(24);
        await Promise.resolve();
        expect(resolved).toBe(false);

        jest.advanceTimersByTime(1);
        await delayPromise;
        expect(resolved).toBe(true);
    });

    test("api-voucher route no longer imports legacy sendText adapter", () => {
        const source = readSource("routes/api-voucher-routes.js");
        expect(source).not.toContain("const { sendText } = require('../lib/whatsapp.adapter')");
        expect(source).not.toContain("await sendText(");
    });

    test("approval logic no longer uses direct sendText/sendMedia adapter calls", () => {
        const source = readSource("lib/approval-logic.js");
        expect(source).not.toContain("const { sendText, sendMedia } = require('./whatsapp.adapter')");
        expect(source).not.toContain("await sendText(");
        expect(source).not.toContain("await sendMedia(");
    });

    test.each([
        "lib/approval-logic.js",
        "routes/discount.js",
        "routes/partial-payment.js",
    ])("%s delegates WhatsApp timing to wa-timing boundary", (relativePath) => {
        const source = readSource(relativePath);
        expect(source).not.toContain("import('@whiskeysockets/baileys')");
        expect(source).not.toContain("@whiskeysockets/baileys");
        expect(source).toContain("waitForWhatsAppDelay");
    });

    test("change-package delegates customer notification to sendCritical (guaranteed delivery boundary)", () => {
        // Upgrade dari fire-and-forget domain event ke sendCritical (wait-ready +
        // retry + dead-letter). Tetap tidak boleh pakai raw baileys.
        const source = readSource("routes/change-package.js");
        expect(source).not.toContain("@whiskeysockets/baileys");
        expect(source).toContain("sendCritical");
        expect(source).toContain("whatsapp-critical-delivery");
    });

    test("fast sender now delegates through delivery service", () => {
        const source = readSource("lib/fast-whatsapp-sender.js");
        expect(source).not.toContain("const { isReady, sendText, getConnectionState } = require('./whatsapp-gateway')");
        expect(source).not.toContain("await sendText(");
        expect(source).toContain("sendMessage(");
    });

    test.each([
        "message/handlers/agent-voucher-handler.js",
        "message/handlers/balance-management-handler.js",
        "message/handlers/payment-processor-handler.js",
        "message/handlers/speed-boost-handler.js",
        "message/handlers/speed-payment-handler.js",
        "message/handlers/speed-status-handler.js",
        "lib/cron.js",
        "lib/error-response.js",
        "lib/whatsapp-session-manager.js",
    ])("%s no longer uses legacy send primitives", (relativePath) => {
        const source = readSource(relativePath);
        expect(source).not.toContain("sendText(");
        expect(source).not.toContain("sendPayload(");
        expect(source).not.toContain("sendMedia(");
        expect(source).not.toContain(".sendMessage(");
    });
});
