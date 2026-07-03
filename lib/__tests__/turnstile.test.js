"use strict";

/**
 * Header Doc
 * Purpose: Guardrail verifikasi Turnstile — pastikan perilaku FAIL-CLOSED: skip saat fitur nonaktif,
 *   tolak saat aktif tetapi secret belum diisi / token kosong (tanpa memanggil jaringan).
 * Caller: Jest (`npx jest lib/__tests__/turnstile.test.js`).
 * Deps: ../turnstile; global.config stub.
 * SideEffects: Tidak ada (cabang yang diuji tidak melakukan HTTP).
 */

const { verifyTurnstile } = require("../turnstile");

afterEach(() => {
    delete global.config;
});

describe("verifyTurnstile (fail-closed)", () => {
    test("fitur nonaktif → skip (ok:true) tanpa jaringan", async () => {
        global.config = { turnstile: { enabled: false } };
        const r = await verifyTurnstile("token", "1.2.3.4");
        expect(r.ok).toBe(true);
        expect(r.skipped).toBe(true);
    });

    test("aktif tapi secretKey placeholder → tolak (secret_missing)", async () => {
        global.config = { turnstile: { enabled: true, secretKey: "ISI_TURNSTILE_SECRET_KEY" } };
        const r = await verifyTurnstile("token");
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("secret_missing");
    });

    test("aktif, secret terisi, token kosong → tolak (token_missing) tanpa jaringan", async () => {
        global.config = { turnstile: { enabled: true, secretKey: "real-secret-key" } };
        const r = await verifyTurnstile("");
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("token_missing");
    });
});
