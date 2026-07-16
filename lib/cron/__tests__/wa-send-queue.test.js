/**
 * Header Doc
 * Purpose: Guardrail helper BERSAMA pengiriman WA cron tagihan — RETRY tahan blip koneksi,
 *          tak dobel-kirim, gagal permanen DILAPORKAN (tak hilang diam-diam), buildJid,
 *          dan setelan retry dari config.
 * Caller: Jest.
 * Deps: `../wa-send-queue` (murni, dependency diinjeksi).
 * SideEffects: Tidak ada.
 */
"use strict";

const { sendQueueWithRetry, buildJid, resolveRetryConfig, waitForWa } = require("../wa-send-queue");

const RETRY = { maxAttempts: 3, waWaitMs: 40, pollMs: 5 };
const delay = () => new Promise((r) => setTimeout(r, 1));

function mkLogger() {
    const lines = [];
    const push = (...a) => lines.push(a.map(String).join(" "));
    return { lines, logger: { log: push, warn: push, error: push } };
}

const ITEM = (n) => ({ jid: `62811111111${n}@s.whatsapp.net`, text: "halo", label: `User${n}` });

describe("wa-send-queue", () => {
    test("buildJid: bersihkan non-digit, tolak yang terlalu pendek", () => {
        expect(buildJid(" 6281-234-5678 ")).toBe("62812345678@s.whatsapp.net");
        expect(buildJid("628123456789")).toBe("628123456789@s.whatsapp.net");
        expect(buildJid("123")).toBeNull();
        expect(buildJid("")).toBeNull();
        expect(buildJid(null)).toBeNull();
    });

    test("resolveRetryConfig: default aman + bisa dikalibrasi lewat config.waSendRetry", () => {
        const def = resolveRetryConfig(null);
        expect(def.maxAttempts).toBe(3);
        expect(def.waWaitMs).toBe(60000);
        const custom = resolveRetryConfig({ waSendRetry: { maxAttempts: 5, waitMs: 1000, pollMs: 100 } });
        expect(custom).toEqual({ maxAttempts: 5, waWaitMs: 1000, pollMs: 100 });
    });

    test("jalur normal: semua terkirim, tanpa retry", async () => {
        const sent = [];
        const { lines, logger } = mkLogger();
        const res = await sendQueueWithRetry({
            items: [ITEM(1), ITEM(2)],
            safeSendMessage: async (jid) => { sent.push(jid); return { success: true }; },
            isReady: () => true, delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger,
        });
        expect(res.sent).toBe(2);
        expect(res.failed).toHaveLength(0);
        expect(res.rounds).toBe(1);
        expect(sent).toHaveLength(2);
        expect(lines.join("\n")).toMatch(/Terkirim ke User1/);
    });

    test("BLIP koneksi: WA putus lalu pulih → pesan di-RETRY, tidak hilang", async () => {
        const sent = [];
        let calls = 0;
        const res = await sendQueueWithRetry({
            items: [ITEM(1)],
            safeSendMessage: async (jid) => { sent.push(jid); return { success: true }; },
            isReady: () => { calls += 1; return calls > 2; }, // putus di ronde-1, pulih kemudian
            delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger: mkLogger().logger,
        });
        expect(sent).toHaveLength(1);
        expect(res.sent).toBe(1);
        expect(res.failed).toHaveLength(0);
        expect(res.rounds).toBeGreaterThan(1);
    });

    test("kirim gagal sekali → dicoba ulang, TIDAK dobel-kirim ke nomor yang sudah sukses", async () => {
        const sent = [];
        let n = 0;
        const res = await sendQueueWithRetry({
            items: [ITEM(1), ITEM(2)],
            safeSendMessage: async (jid) => {
                n += 1;
                if (n === 2) return { success: false, error: "timeout" }; // item ke-2 gagal sekali
                sent.push(jid);
                return { success: true };
            },
            isReady: () => true, delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger: mkLogger().logger,
        });
        expect(res.sent).toBe(2);
        expect(res.failed).toHaveLength(0);
        // item-1 hanya sekali (tak dobel), item-2 sukses di ronde ke-2
        expect(sent.filter((j) => j === ITEM(1).jid)).toHaveLength(1);
        expect(sent.filter((j) => j === ITEM(2).jid)).toHaveLength(1);
    });

    test("WA tak pernah pulih → dilaporkan GAGAL eksplisit (bukan hilang diam-diam)", async () => {
        const { lines, logger } = mkLogger();
        const res = await sendQueueWithRetry({
            items: [ITEM(9)],
            safeSendMessage: async () => { throw new Error("tak boleh dipanggil"); },
            isReady: () => false, delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger,
        });
        expect(res.sent).toBe(0);
        expect(res.failed).toHaveLength(1);
        expect(lines.join("\n")).toMatch(/User9.*TAK TERKIRIM setelah 3 ronde/);
    });

    test("safeSendMessage melempar → ditangkap, di-retry, tak menjatuhkan siklus", async () => {
        let n = 0;
        const sent = [];
        const res = await sendQueueWithRetry({
            items: [ITEM(1)],
            safeSendMessage: async (jid) => {
                n += 1;
                if (n === 1) throw new Error("socket mati");
                sent.push(jid);
                return { success: true };
            },
            isReady: () => true, delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger: mkLogger().logger,
        });
        expect(res.sent).toBe(1);
        expect(sent).toHaveLength(1);
    });

    test("antrian kosong → aman, nol ronde", async () => {
        const res = await sendQueueWithRetry({
            items: [], safeSendMessage: async () => ({ success: true }),
            isReady: () => true, delay, retry: RETRY, tag: "T", logger: mkLogger().logger,
        });
        expect(res).toEqual({ sent: 0, failed: [], rounds: 0 });
    });

    test("waitForWa: true saat sudah siap; false saat tak kunjung siap", async () => {
        await expect(waitForWa({ isReady: () => true, delay, maxWaitMs: 20, pollMs: 5 })).resolves.toBe(true);
        await expect(waitForWa({ isReady: () => false, delay, maxWaitMs: 20, pollMs: 5 })).resolves.toBe(false);
    });
});
