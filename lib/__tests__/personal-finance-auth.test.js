/**
 * Header Doc
 * Purpose: Mengunci PEMISAHAN otentikasi dompet keuangan pribadi dari sesi admin. Inti yang
 *          diuji: token admin (ditandatangani `config.jwt`) TIDAK PERNAH boleh membuka dompet,
 *          dan token dompet tak berlaku sebagai token admin — walau salah satu cookie bocor.
 * Caller: Jest.
 * Deps: `lib/personal-finance-auth`, `jsonwebtoken`, `fs`.
 * MainFuncs: -
 * SideEffects: Menulis/menghapus `database/personal_finance_auth_test.json`.
 */
"use strict";

const fs = require("fs");
const jwt = require("jsonwebtoken");

const pfAuth = require("../personal-finance-auth");

const USER = "aldi";
const SANDI = "sandi-rahasia-8";

describe("personal-finance-auth", () => {
    afterEach(() => {
        try {
            fs.unlinkSync(pfAuth.authFilePath());
        } catch (_e) {
            /* belum ada → abaikan */
        }
    });

    test("path store memakai berkas TEST, tak menyentuh kredensial asli", () => {
        expect(pfAuth.authFilePath()).toMatch(/personal_finance_auth_test\.json$/);
    });

    test("belum disiapkan → hasCredential false dan semua verifikasi gagal", async () => {
        expect(pfAuth.hasCredential()).toBe(false);
        expect(await pfAuth.verifyCredential(USER, SANDI)).toBe(false);
        expect(pfAuth.verifySessionToken("apa-saja")).toBeNull();
        expect(() => pfAuth.issueSessionToken(USER)).toThrow(/belum disiapkan/i);
    });

    test("set lalu verifikasi kredensial", async () => {
        await pfAuth.setCredential(USER, SANDI);
        expect(pfAuth.hasCredential()).toBe(true);
        expect(await pfAuth.verifyCredential(USER, SANDI)).toBe(true);
        expect(await pfAuth.verifyCredential(USER, "sandi-salah-1")).toBe(false);
        expect(await pfAuth.verifyCredential("orang-lain", SANDI)).toBe(false);
    });

    test("username tak peka huruf besar-kecil dan spasi", async () => {
        await pfAuth.setCredential("  AlDi ", SANDI);
        expect(await pfAuth.verifyCredential("aldi", SANDI)).toBe(true);
        expect(await pfAuth.verifyCredential("ALDI", SANDI)).toBe(true);
    });

    test("sandi pendek ditolak", async () => {
        await expect(pfAuth.setCredential(USER, "pendek")).rejects.toThrow(/minimal 8/i);
        await expect(pfAuth.setCredential("", SANDI)).rejects.toThrow(/username/i);
    });

    test("sandi TIDAK disimpan sebagai teks polos", async () => {
        await pfAuth.setCredential(USER, SANDI);
        const isi = fs.readFileSync(pfAuth.authFilePath(), "utf8");
        expect(isi).not.toContain(SANDI);
        expect(JSON.parse(isi).passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
    });

    test("token sesi sah dikenali", async () => {
        await pfAuth.setCredential(USER, SANDI);
        const token = pfAuth.issueSessionToken(USER);
        expect(pfAuth.verifySessionToken(token)).toEqual({ username: USER });
    });

    // ── INTI PEMISAHAN ──────────────────────────────────────────────────────────
    test("token ADMIN (ditandatangani config.jwt) DITOLAK dompet", async () => {
        await pfAuth.setCredential(USER, SANDI);
        const rahasiaAdmin = "rahasia-jwt-admin";
        const tokenAdmin = jwt.sign({ id: 1, username: "raf", role: "admin" }, rahasiaAdmin, { expiresIn: "1h" });
        expect(pfAuth.verifySessionToken(tokenAdmin)).toBeNull();
    });

    test("token dompet TIDAK bisa diverifikasi dengan rahasia admin (kebalikannya)", async () => {
        await pfAuth.setCredential(USER, SANDI);
        const tokenDompet = pfAuth.issueSessionToken(USER);
        expect(() => jwt.verify(tokenDompet, "rahasia-jwt-admin")).toThrow();
    });

    test("token ber-scope lain ditolak walau ditandatangani rahasia dompet yang benar", async () => {
        await pfAuth.setCredential(USER, SANDI);
        const rahasia = JSON.parse(fs.readFileSync(pfAuth.authFilePath(), "utf8")).sessionSecret;
        const palsu = jwt.sign({ sub: USER, scope: "admin" }, rahasia, { expiresIn: "1h" });
        expect(pfAuth.verifySessionToken(palsu)).toBeNull();
    });

    test("token kedaluwarsa ditolak", async () => {
        await pfAuth.setCredential(USER, SANDI);
        const rahasia = JSON.parse(fs.readFileSync(pfAuth.authFilePath(), "utf8")).sessionSecret;
        const basi = jwt.sign({ sub: USER, scope: "personal-finance" }, rahasia, { expiresIn: -10 });
        expect(pfAuth.verifySessionToken(basi)).toBeNull();
    });

    test("--putus-sesi mematikan token lama; ganti sandi biasa tidak", async () => {
        await pfAuth.setCredential(USER, SANDI);
        const lama = pfAuth.issueSessionToken(USER);

        await pfAuth.setCredential(USER, "sandi-baru-1234");
        expect(pfAuth.verifySessionToken(lama)).toEqual({ username: USER });

        await pfAuth.setCredential(USER, "sandi-baru-5678", { rotateSecret: true });
        expect(pfAuth.verifySessionToken(lama)).toBeNull();
    });

    // Alur ganti sandi bertumpu pada dua sifat ini; diuji sebagai satu skenario utuh.
    describe("skenario ganti sandi", () => {
        test("sandi lama tetap bisa diverifikasi sebelum diganti, dan tidak lagi sesudahnya", async () => {
            await pfAuth.setCredential(USER, SANDI);
            expect(await pfAuth.verifyCredential(USER, SANDI)).toBe(true);

            await pfAuth.setCredential(USER, "sandi-yang-baru", { rotateSecret: true });
            expect(await pfAuth.verifyCredential(USER, SANDI)).toBe(false);
            expect(await pfAuth.verifyCredential(USER, "sandi-yang-baru")).toBe(true);
        });

        test("ganti sandi MENGGUGURKAN sesi lama, dan token yang baru diterbitkan tetap sah", async () => {
            await pfAuth.setCredential(USER, SANDI);
            const sesiLama = pfAuth.issueSessionToken(USER);
            expect(pfAuth.verifySessionToken(sesiLama)).toEqual({ username: USER });

            await pfAuth.setCredential(USER, "sandi-yang-baru", { rotateSecret: true });
            // Perangkat lain: token lama mati.
            expect(pfAuth.verifySessionToken(sesiLama)).toBeNull();
            // Perangkat yang sedang dipakai: token pengganti langsung berlaku.
            const sesiBaru = pfAuth.issueSessionToken(USER);
            expect(pfAuth.verifySessionToken(sesiBaru)).toEqual({ username: USER });
        });
    });

    test("baca cookie dari header mentah maupun req.cookies", () => {
        expect(pfAuth.readSessionCookie({ cookies: { pf_session: "abc" } })).toBe("abc");
        expect(pfAuth.readSessionCookie({ headers: { cookie: "a=1; pf_session=xyz; b=2" } })).toBe("xyz");
        // Cookie sesi ADMIN bernama `token` — tak boleh terbaca sebagai sesi dompet.
        expect(pfAuth.readSessionCookie({ headers: { cookie: "token=tokenadmin" } })).toBeNull();
        expect(pfAuth.readSessionCookie({})).toBeNull();
    });
});
