/**
 * Header Doc
 * Purpose: Mengunci keying rate limiter login pada IDENTITAS, bukan IP. Portal pelanggan
 *   (raff-panel-2) adalah BFF — seluruh pelanggan menembak backend dari satu proses, jadi
 *   backend melihat satu IP untuk semua orang. Key berbasis IP membuat 5 percobaan gagal
 *   dari pelanggan mana pun mengunci login SEMUA pelanggan selama 15 menit.
 * Caller: Jest.
 * Deps: `lib/http-security.js` (resolveAuthLimiterKey).
 * SideEffects: Tidak ada — fungsi keying murni.
 */
"use strict";

const { resolveAuthLimiterKey } = require("../http-security");

// IP yang sama untuk setiap request: inilah yang dilihat backend dari BFF.
const BFF_IP = "192.168.145.245";

function buildRequest(body) {
    return { body, ip: BFF_IP };
}

describe("auth limiter keying", () => {
    // Regresi inti. Kalau ini gagal, satu pelanggan yang salah ketik password bisa
    // mengunci login seluruh pelanggan.
    test("different customers behind the same BFF IP get different buckets", () => {
        const budi = resolveAuthLimiterKey(buildRequest({ username: "budi" }));
        const siti = resolveAuthLimiterKey(buildRequest({ username: "siti" }));

        expect(budi).not.toBe(siti);
        expect(budi).not.toContain(BFF_IP);
        expect(siti).not.toContain(BFF_IP);
    });

    test("the same username always lands in the same bucket", () => {
        expect(resolveAuthLimiterKey(buildRequest({ username: "budi" }))).toBe(
            resolveAuthLimiterKey(buildRequest({ username: "budi" }))
        );
    });

    test("username keying is case- and whitespace-insensitive", () => {
        const plain = resolveAuthLimiterKey(buildRequest({ username: "budi" }));

        expect(resolveAuthLimiterKey(buildRequest({ username: "BUDI" }))).toBe(plain);
        expect(resolveAuthLimiterKey(buildRequest({ username: "  budi  " }))).toBe(plain);
    });

    // Lubang yang sama dengan lockout OTP di lib/otp.js, yang memakai string mentah:
    // satu akun tidak boleh punya tiga jatah hanya karena nomornya ditulis beda.
    test("phone variants of one account share a single bucket", () => {
        const local = resolveAuthLimiterKey(buildRequest({ phoneNumber: "081234567890" }));

        expect(resolveAuthLimiterKey(buildRequest({ phoneNumber: "6281234567890" }))).toBe(local);
        expect(resolveAuthLimiterKey(buildRequest({ phoneNumber: "+6281234567890" }))).toBe(local);
        expect(resolveAuthLimiterKey(buildRequest({ phoneNumber: "+62 812-3456-7890" }))).toBe(local);
    });

    test("different phone numbers get different buckets", () => {
        expect(resolveAuthLimiterKey(buildRequest({ phoneNumber: "081234567890" }))).not.toBe(
            resolveAuthLimiterKey(buildRequest({ phoneNumber: "081299998888" }))
        );
    });

    test("username and phone namespaces do not collide", () => {
        expect(resolveAuthLimiterKey(buildRequest({ username: "6281234567890" }))).not.toBe(
            resolveAuthLimiterKey(buildRequest({ phoneNumber: "6281234567890" }))
        );
    });

    test("falls back to an IP-derived key when the body carries no identity", () => {
        const key = resolveAuthLimiterKey(buildRequest({}));

        expect(key).toContain("auth_ip_");
        expect(typeof key).toBe("string");
    });

    test("survives a missing body without throwing", () => {
        expect(() => resolveAuthLimiterKey({ ip: BFF_IP })).not.toThrow();
        expect(() => resolveAuthLimiterKey({})).not.toThrow();
    });

    test("does not throw on an IPv6 peer", () => {
        expect(() =>
            resolveAuthLimiterKey({ body: {}, ip: "2001:db8::1" })
        ).not.toThrow();
    });
});
