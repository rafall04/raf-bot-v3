/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan intent ber-impact tinggi mempunyai owner domain tunggal.
 * Caller: Jest test runner.
 * Deps: `../handlers/intent-owner-map`.
 * MainFuncs: Memverifikasi peta owner intent prioritas.
 * SideEffects: Tidak ada.
 */
"use strict";

const { INTENT_OWNER_MAP } = require("../handlers/intent-owner-map");

describe("intent owner map", () => {
    test("high-impact intents have explicit owners", () => {
        expect(INTENT_OWNER_MAP.LAPOR_GANGGUAN).toBe("reporting");
        expect(INTENT_OWNER_MAP.LAPOR_GANGGUAN_MATI).toBe("reporting");
        expect(INTENT_OWNER_MAP.GANTI_NAMA_WIFI).toBe("wifi");
        expect(INTENT_OWNER_MAP.GANTI_SANDI_WIFI).toBe("wifi");
        expect(INTENT_OWNER_MAP.AGENT_PURCHASE_VOUCHER).toBe("agent-voucher");
        expect(INTENT_OWNER_MAP.AGENT_SELL_VOUCHER).toBe("agent-voucher");
        expect(INTENT_OWNER_MAP.TOPUP_SALDO).toBe("saldo-payment");
        expect(INTENT_OWNER_MAP.BELI_VOUCHER).toBe("saldo-payment");
    });
});
