/**
 * Header Doc
 * Purpose: Guard RONDE 6 Fase D (#b357) — hubungkan WA ke akun teknisi. Verifikasi: kode ber-TTL
 *   sekali-pakai (valid/invalid/kedaluwarsa/rate), linkWaToAccount menulis `lid` (+phone bila kosong)
 *   dgn AMAN (invalidasi authCache), anti-serobot lid_taken, unlink, updateProfile hanya `name`.
 * Caller: Jest.
 * Deps: ../teknisi-account-link; ../database & ../auth-cache di-mock; withLock ASLI.
 * SideEffects: -
 */
"use strict";

const mockSaveAccounts = jest.fn();
jest.mock("../database", () => ({ saveAccounts: (...a) => mockSaveAccounts(...a) }));
const mockInvAccount = jest.fn();
const mockInvUser = jest.fn();
jest.mock("../auth-cache", () => ({ authCache: { invalidateAccount: (...a) => mockInvAccount(...a), invalidateUser: (...a) => mockInvUser(...a) } }));

const link = require("../teknisi-account-link");

beforeEach(() => {
    link._resetForTest();
    mockSaveAccounts.mockClear(); mockInvAccount.mockClear(); mockInvUser.mockClear();
    global.accounts = [
        { id: 5, username: "budi", name: "Budi", role: "teknisi", phone_number: "" },
        { id: 6, username: "sari", name: "Sari", role: "teknisi", phone_number: "628990001111" },
    ];
});
afterEach(() => { delete global.accounts; });

describe("issue/redeem kode", () => {
    test("kode valid → redeem sekali pakai; redeem kedua = invalid", () => {
        const { code } = link.issueLinkCode(5);
        expect(code).toMatch(/^[A-Z2-9]{8}$/);
        const r1 = link.redeemLinkCode(code, "111@lid");
        expect(r1).toEqual({ ok: true, accountId: "5" }); // key store di-String()-kan; linkWaToAccount tetap cocok via String()
        const r2 = link.redeemLinkCode(code, "111@lid");
        expect(r2.ok).toBe(false);
        expect(r2.reason).toBe("invalid");
    });

    test("kode salah → invalid; case-insensitive & trim", () => {
        const { code } = link.issueLinkCode(5);
        expect(link.redeemLinkCode("SALAHSALAH", "111@lid").ok).toBe(false);
        expect(link.redeemLinkCode("  " + code.toLowerCase() + "  ", "111@lid")).toEqual({ ok: true, accountId: "5" });
    });

    test("rate-limit: setelah MAX_ATTEMPTS gagal → reason rate", () => {
        link.issueLinkCode(5);
        let last;
        for (let i = 0; i < link.MAX_ATTEMPTS + 2; i++) last = link.redeemLinkCode("NOPE" + i, "flooder@lid");
        expect(last.reason).toBe("rate");
    });
});

describe("linkWaToAccount", () => {
    test("tulis lid + phone (kosong diisi) + invalidasi cache", async () => {
        const r = await link.linkWaToAccount({ accountId: 5, senderId: "111@lid", phoneNumber: "628123" });
        expect(r.ok).toBe(true);
        expect(global.accounts[0].lid).toBe("111@lid");
        expect(global.accounts[0].phone_number).toBe("628123"); // tadinya kosong → diisi
        expect(mockSaveAccounts).toHaveBeenCalledTimes(1);
        expect(mockInvAccount).toHaveBeenCalledWith(5, "budi");
        expect(mockInvUser).toHaveBeenCalledWith(5);
    });

    test("phone TIDAK ditimpa bila akun sudah punya", async () => {
        await link.linkWaToAccount({ accountId: 6, senderId: "222@lid", phoneNumber: "628999" });
        expect(global.accounts[1].phone_number).toBe("628990001111"); // tetap
        expect(global.accounts[1].lid).toBe("222@lid");
    });

    test("anti-serobot: senderId sudah dipakai akun lain → lid_taken, tak menulis", async () => {
        global.accounts[1].lid = "111@lid";
        const r = await link.linkWaToAccount({ accountId: 5, senderId: "111@lid", phoneNumber: "628123" });
        expect(r).toMatchObject({ ok: false, reason: "lid_taken" });
        expect(global.accounts[0].lid).toBeUndefined();
        expect(mockSaveAccounts).not.toHaveBeenCalled();
    });

    test("akun tak ada → not_found", async () => {
        const r = await link.linkWaToAccount({ accountId: 999, senderId: "x@lid" });
        expect(r).toMatchObject({ ok: false, reason: "not_found" });
    });
});

describe("unlinkWa & updateProfile", () => {
    test("unlink menghapus lid + invalidasi", async () => {
        global.accounts[0].lid = "111@lid";
        const r = await link.unlinkWa(5);
        expect(r.ok).toBe(true);
        expect(global.accounts[0].lid).toBeUndefined();
        expect(mockInvUser).toHaveBeenCalledWith(5);
    });

    test("updateProfile hanya set name (di-trim, dibatasi), invalidasi", async () => {
        const r = await link.updateProfile(5, { name: "  Budi Santoso  " });
        expect(r.ok).toBe(true);
        expect(global.accounts[0].name).toBe("Budi Santoso");
        expect(mockSaveAccounts).toHaveBeenCalled();
    });

    test("updateProfile nama kosong → invalid, tak menulis", async () => {
        const r = await link.updateProfile(5, { name: "   " });
        expect(r).toMatchObject({ ok: false, reason: "invalid" });
        expect(mockSaveAccounts).not.toHaveBeenCalled();
    });
});
