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

const { sendQueueWithRetry, buildJid, resolveRetryConfig, resolveBroadcastGuard, waitForWa } = require("../wa-send-queue");

const GUARD = (o = {}) => ({ enabled: true, jitterMaxExtraMs: 0, batchSize: 0, batchPauseMs: 0, breakerThreshold: 0, maxPerRun: 0, minGapMs: 0, ...o });

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

    test("buildJid: nomor awalan 0 DIKONVERSI ke 62 (#b320) — cron tagihan tak lagi buta ke '08xxx'", () => {
        // Akar P1: pelanggan tersimpan '081234567890'; tanpa 0→62 pesan tak pernah sampai tapi cron
        // lapor sukses. Kini konsisten dgn jalur welcome (normalizePhoneNumber).
        expect(buildJid("081234567890")).toBe("6281234567890@s.whatsapp.net");
        expect(buildJid("0812-3456-7890")).toBe("6281234567890@s.whatsapp.net");
        // idempoten: nomor yang sudah 62 tak berubah.
        expect(buildJid("6281234567890")).toBe("6281234567890@s.whatsapp.net");
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

    // ===== ANTI-BAN GUARD (opt-in) =====

    test("guard OFF: return tetap {sent,failed,rounds} (tanpa extras)", async () => {
        const res = await sendQueueWithRetry({
            items: [ITEM(1)], safeSendMessage: async () => ({ success: true }),
            isReady: () => true, delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger: mkLogger().logger,
            guard: { enabled: false }, ledger: null,
        });
        expect(res).toEqual({ sent: 1, failed: [], rounds: 1 });
    });

    test("resolveBroadcastGuard: default OFF + calibratable", () => {
        expect(resolveBroadcastGuard(null).enabled).toBe(false);
        const g = resolveBroadcastGuard({ broadcastGuard: { enabled: true, batchSize: 10, minGapMs: 3600000 } });
        expect(g.enabled).toBe(true);
        expect(g.batchSize).toBe(10);
        expect(g.minGapMs).toBe(3600000);
        expect(g.jitterMaxExtraMs).toBe(4000); // default terisi
    });

    test("(1) jitter: delay = messageDelayMs + floor(random*jitterMaxExtraMs)", async () => {
        const delays = [];
        await sendQueueWithRetry({
            items: [ITEM(1), ITEM(2)], safeSendMessage: async () => ({ success: true }),
            isReady: () => true, delay: (ms) => { delays.push(ms); return Promise.resolve(); },
            messageDelayMs: 2000, retry: RETRY, tag: "T", logger: mkLogger().logger,
            guard: GUARD({ jitterMaxExtraMs: 1000 }), random: () => 0.5, ledger: null,
        });
        expect(delays.length).toBeGreaterThan(0);
        expect(delays.every((d) => d === 2500)).toBe(true); // 2000 + floor(0.5*1000)
    });

    test("(2) batch: jeda batchPauseMs tiap batchSize pesan", async () => {
        const delays = [];
        await sendQueueWithRetry({
            items: [ITEM(1), ITEM(2), ITEM(3)], safeSendMessage: async () => ({ success: true }),
            isReady: () => true, delay: (ms) => { delays.push(ms); return Promise.resolve(); },
            messageDelayMs: 10, retry: RETRY, tag: "T", logger: mkLogger().logger,
            guard: GUARD({ batchSize: 2, batchPauseMs: 5000 }), random: () => 0, ledger: null,
        });
        expect(delays).toContain(5000); // jeda batch setelah pesan ke-2 (masih ada pesan ke-3)
    });

    test("(3) cap: maxPerRun → sisanya deferred, tak dikirim", async () => {
        const sent = [];
        const res = await sendQueueWithRetry({
            items: [ITEM(1), ITEM(2), ITEM(3), ITEM(4)],
            safeSendMessage: async (jid) => { sent.push(jid); return { success: true }; },
            isReady: () => true, delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger: mkLogger().logger,
            guard: GUARD({ maxPerRun: 2 }), ledger: null,
        });
        expect(res.sent).toBe(2);
        expect(res.deferred).toHaveLength(2);
        expect(res.failed).toHaveLength(0);
        expect(sent).toHaveLength(2);
    });

    test("(4) breaker: gagal beruntun → STOP + breakerTripped + alert admin", async () => {
        let breakerCalls = 0;
        const res = await sendQueueWithRetry({
            items: [ITEM(1), ITEM(2), ITEM(3), ITEM(4), ITEM(5)],
            safeSendMessage: async () => ({ success: false, error: "429" }),
            isReady: () => true, delay, messageDelayMs: 0, retry: { maxAttempts: 1, waWaitMs: 10, pollMs: 5 },
            tag: "T", logger: mkLogger().logger,
            guard: GUARD({ breakerThreshold: 2 }), onBreaker: async () => { breakerCalls += 1; }, ledger: null,
        });
        expect(res.breakerTripped).toBe(true);
        expect(res.sent).toBe(0);
        expect(res.failed).toHaveLength(5); // 2 dicoba-gagal + 3 tak-dicoba, semua dilaporkan tak terkirim
        expect(breakerCalls).toBe(1);
    });

    test("(5) ledger: nomor terblokir DILEWATI, sisanya terkirim (fail-open ke shouldSkip)", async () => {
        const sent = [];
        const ledger = {
            shouldSkip: async (jid) => (jid.startsWith("628block") ? { skip: true, reason: "diblokir" } : { skip: false }),
            recordSent: async () => {},
        };
        const blocked = { jid: "628block@s.whatsapp.net", text: "x", label: "Blocked" };
        const res = await sendQueueWithRetry({
            items: [ITEM(1), blocked, ITEM(2)],
            safeSendMessage: async (jid) => { sent.push(jid); return { success: true }; },
            isReady: () => true, delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger: mkLogger().logger,
            guard: GUARD(), ledger,
        });
        expect(res.sent).toBe(2);
        expect(res.skipped).toHaveLength(1);
        expect(res.skipped[0].label).toBe("Blocked");
        expect(sent).not.toContain("628block@s.whatsapp.net");
    });

    test("(6) onWhatsApp: tak terdaftar DILEWATI, terdaftar terkirim, null fail-open (tetap kirim)", async () => {
        const sent = [];
        const check = async (jid) => (jid.includes("dead") ? false : (jid.includes("unknown") ? null : true));
        const res = await sendQueueWithRetry({
            items: [ITEM(1), { jid: "628dead@s.whatsapp.net", text: "x", label: "Dead" }, { jid: "628unknown@s.whatsapp.net", text: "x", label: "Unk" }],
            safeSendMessage: async (jid) => { sent.push(jid); return { success: true }; },
            isReady: () => true, delay, messageDelayMs: 0, retry: RETRY, tag: "T", logger: mkLogger().logger,
            guard: GUARD({ validateOnWhatsApp: true }), checkRegistered: check, ledger: null,
        });
        expect(sent).toContain(ITEM(1).jid);                       // terdaftar → kirim
        expect(sent).toContain("628unknown@s.whatsapp.net");        // null (tak bisa cek) → fail-open kirim
        expect(sent).not.toContain("628dead@s.whatsapp.net");       // tak terdaftar → skip
        expect(res.skipped.some((s) => s.label === "Dead" && /tak terdaftar/.test(s.reason))).toBe(true);
    });
});
