"use strict";

/**
 * Header Doc
 * Purpose: Guardrail service registrasi publik — pastikan submitPublicRegistration (1) menyimpan lead
 *   berstatus 'lead_online' + created_by 'public_self_service', (2) memberi tahu admin, (3) menolak
 *   saat Turnstile gagal (fail-closed) tanpa menyimpan, (4) TIDAK menyentuh jalur provisioning
 *   (MikroTik/GenieACS) — lead terkarantina dari pipeline instalasi.
 * Caller: Jest (`npx jest lib/__tests__/public-registration-service.test.js`).
 * Deps: fs, path, mock semua dependency I/O service.
 * SideEffects: Tidak ada (semua I/O di-mock).
 */

const fs = require("fs");
const path = require("path");

jest.mock("../turnstile", () => ({ verifyTurnstile: jest.fn() }));
jest.mock("../psb-database", () => ({ getNextAvailablePSBId: jest.fn(), insertPSBRecord: jest.fn() }));
jest.mock("../../repositories/api-psb.repository", () => ({
    createApiPsbRepository: jest.fn(() => ({ updatePsbRecordsSnapshot: jest.fn() }))
}));
jest.mock("../admin-recipients", () => ({ getAdminJids: jest.fn(() => ["628111000111@s.whatsapp.net"]) }));
jest.mock("../whatsapp-critical-delivery", () => ({ sendCritical: jest.fn().mockResolvedValue(true) }));
jest.mock("../whatsapp-delivery-service", () => ({ sendMessage: jest.fn().mockResolvedValue(true) }));
jest.mock("../whatsapp-gateway", () => ({ hasAuthenticatedSession: jest.fn(() => false) }));
jest.mock("../utils", () => ({ normalizePhoneNumber: jest.fn((p) => String(p).replace(/\D/g, "")) }));
jest.mock("../templating", () => ({ renderTemplate: jest.fn(() => "RENDERED_TEMPLATE") }));

const { verifyTurnstile } = require("../turnstile");
const { getNextAvailablePSBId, insertPSBRecord } = require("../psb-database");
const { getAdminJids } = require("../admin-recipients");
const { sendCritical } = require("../whatsapp-critical-delivery");
const { submitPublicRegistration } = require("../services/public-registration-service");

beforeEach(() => {
    jest.clearAllMocks();
    global.__appRuntime = {};
    getNextAvailablePSBId.mockResolvedValue(42);
    insertPSBRecord.mockResolvedValue(42);
    verifyTurnstile.mockResolvedValue({ ok: true, skipped: true });
});

describe("submitPublicRegistration (lead PSB terkarantina)", () => {
    test("valid → lead_online tersimpan + admin dinotifikasi", async () => {
        const res = await submitPublicRegistration({
            name: "Budi",
            phone: "081234567890",
            address: "Jl. Mawar No. 1",
            packageInterest: "10 Mbps",
            requestMeta: { ipAddress: "1.2.3.4", userAgent: "jest" }
        });

        expect(res.ok).toBe(true);
        expect(res.customerId).toBe(42);
        expect(insertPSBRecord).toHaveBeenCalledTimes(1);
        const record = insertPSBRecord.mock.calls[0][0];
        expect(record.psb_status).toBe("lead_online");
        expect(record.created_by).toBe("public_self_service");
        expect(record.psb_data.source).toBe("landing");
        expect(record.psb_data.package_interest).toBe("10 Mbps");
        expect(getAdminJids).toHaveBeenCalled();
        expect(sendCritical).toHaveBeenCalled();
    });

    test("Turnstile gagal → ditolak (fail-closed), TIDAK menyimpan", async () => {
        verifyTurnstile.mockResolvedValue({ ok: false, reason: "verify_failed" });
        const res = await submitPublicRegistration({
            name: "Budi",
            phone: "081234567890",
            address: "Jl. Mawar No. 1"
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("TURNSTILE_FAILED");
        expect(insertPSBRecord).not.toHaveBeenCalled();
    });

    test("input tidak lengkap → INVALID_INPUT tanpa menyimpan", async () => {
        const res = await submitPublicRegistration({ name: "Budi", phone: "", address: "" });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("INVALID_INPUT");
        expect(insertPSBRecord).not.toHaveBeenCalled();
    });

    test("kegagalan simpan lead → PERSIST_ERROR (ok:false)", async () => {
        insertPSBRecord.mockRejectedValue(new Error("db down"));
        const res = await submitPublicRegistration({
            name: "Budi",
            phone: "081234567890",
            address: "Jl. Mawar No. 1"
        });
        expect(res.ok).toBe(false);
        expect(res.code).toBe("PERSIST_ERROR");
    });

    test("guardrail: service TIDAK mengimpor/memanggil jalur provisioning (MikroTik/GenieACS)", () => {
        const src = fs.readFileSync(
            path.join(__dirname, "..", "services", "public-registration-service.js"),
            "utf8"
        );
        // Tidak me-`require` modul MikroTik/GenieACS (komentar penjelas boleh menyebut namanya).
        expect(src).not.toMatch(/require\([^)]*(mikrotik|genieacs)[^)]*\)/i);
        // Tidak MEMANGGIL fungsi provisioning (deteksi pemanggilan: nama fungsi diikuti '(').
        expect(src).not.toMatch(/\b(addPPPoEUser|movePSBToUsers|updatePsbDeviceConfig)\s*\(/);
    });
});
