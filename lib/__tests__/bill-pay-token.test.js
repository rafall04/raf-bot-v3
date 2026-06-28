/**
 * Test token link bayar tagihan — fokus: sign/verify, anti-tamper, kedaluwarsa,
 * dan stabilitas lintas instance (secret dari config sama → token sama-sama valid).
 */
"use strict";

const { createBillPayToken, verifyBillPayToken, buildBillPayUrl } = require("../bill-pay-token");

beforeEach(() => {
    global.config = { bill_pay_token_secret: "rahasia-uji-123", site_url_bot: "https://dander.example" };
});

describe("bill-pay-token", () => {
    test("roundtrip: token valid → ok + uid + periode", () => {
        const t = createBillPayToken({ id: 42 }, { periodMonth: 6, periodYear: 2026 });
        const r = verifyBillPayToken(t);
        expect(r).toMatchObject({ ok: true, uid: "42", periodMonth: 6, periodYear: 2026 });
    });

    test("tamper payload → signature gagal", () => {
        const t = createBillPayToken({ id: 7 });
        const [payloadB64, sig] = t.split(".");
        const forgedPayload = Buffer.from(JSON.stringify({ uid: "999", exp: Date.now() + 100000 }), "utf8")
            .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const r = verifyBillPayToken(`${forgedPayload}.${sig}`);
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("signature");
        expect(payloadB64).not.toBe(forgedPayload);
    });

    test("token kedaluwarsa → reason expired", () => {
        const t = createBillPayToken({ id: 1 }, { ttlMs: 1000, now: 1_000_000 });
        const r = verifyBillPayToken(t, { now: 1_000_000 + 2000 });
        expect(r).toMatchObject({ ok: false, reason: "expired" });
    });

    test("format salah → reason format (tidak crash)", () => {
        expect(verifyBillPayToken("")).toMatchObject({ ok: false, reason: "format" });
        expect(verifyBillPayToken("tanpatitik")).toMatchObject({ ok: false, reason: "format" });
        expect(verifyBillPayToken(null)).toMatchObject({ ok: false, reason: "format" });
    });

    test("secret beda → token lama tidak valid (anti-tebak lintas-akun)", () => {
        const t = createBillPayToken({ id: 5 });
        global.config = { bill_pay_token_secret: "secret-lain" };
        expect(verifyBillPayToken(t).ok).toBe(false);
    });

    test("buildBillPayUrl pakai base dari config + token valid", () => {
        const url = buildBillPayUrl({ id: 9 }, { periodMonth: 6, periodYear: 2026 });
        expect(url.startsWith("https://dander.example/bayar/")).toBe(true);
        const token = url.split("/bayar/")[1];
        expect(verifyBillPayToken(token)).toMatchObject({ ok: true, uid: "9" });
    });

    test("createBillPayToken tanpa user.id → throw", () => {
        expect(() => createBillPayToken({})).toThrow(/user\.id/);
    });

    test("buildBillPayUrl abaikan site_url_bot localhost → pakai domain publik dari ipaymuCallback", () => {
        global.config = { bill_pay_token_secret: "s", site_url_bot: "http://127.0.0.1:3010", ipaymuCallback: "https://dander.rafnet.my.id/callback/payment" };
        const url = buildBillPayUrl({ id: 1 });
        expect(url.startsWith("https://dander.rafnet.my.id/bayar/")).toBe(true);
    });

    test("buildBillPayUrl utamakan public_url (field setting) di atas site_url_bot internal", () => {
        global.config = { bill_pay_token_secret: "s", public_url: "https://bayar.rafnet.id", site_url_bot: "http://127.0.0.1:3010", ipaymuCallback: "https://dander.rafnet.my.id/callback/payment" };
        const url = buildBillPayUrl({ id: 1 });
        expect(url.startsWith("https://bayar.rafnet.id/bayar/")).toBe(true);
    });
});
