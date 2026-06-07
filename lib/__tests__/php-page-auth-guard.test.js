/**
 * Guard regresi untuk fix keamanan: menutup bypass auth via URL `.php`.
 * Memastikan handler catch-all `.php` hanya merender untuk akun staf (req.user),
 * memblokir customer, dan mengarahkan tamu ke login.
 */
"use strict";

const { requirePhpPageAuth, PUBLIC_PATHS } = require("../http-auth-bootstrap");
const { getInternalServiceToken, verifyInternalServiceToken } = require("../internal-service-token");

function invoke(req) {
    const res = {
        statusCode: null,
        redirectedTo: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.body = obj; return this; },
        send(payload) { this.body = payload; return this; },
        redirect(url) { this.redirectedTo = url; return this; },
    };
    let nextCalled = false;
    requirePhpPageAuth(req, res, () => { nextCalled = true; });
    return { nextCalled, res };
}

describe("requirePhpPageAuth (guard catch-all .php)", () => {
    test("akun staf (req.user) diizinkan -> next()", () => {
        const { nextCalled, res } = invoke({ user: { id: 1, role: "admin" }, headers: {} });
        expect(nextCalled).toBe(true);
        expect(res.statusCode).toBeNull();
        expect(res.redirectedTo).toBeNull();
    });

    test("teknisi diizinkan -> next()", () => {
        const { nextCalled } = invoke({ user: { id: 9, role: "teknisi" }, headers: {} });
        expect(nextCalled).toBe(true);
    });

    test("panggilan internal service (req.internalService) diizinkan -> next()", () => {
        const { nextCalled, res } = invoke({ internalService: true, headers: {} });
        expect(nextCalled).toBe(true);
        expect(res.statusCode).toBeNull();
    });

    test("customer (req.customer, tanpa req.user) diblok -> 403, tidak render", () => {
        const { nextCalled, res } = invoke({ customer: { id: 2 }, headers: {} });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(403);
    });

    test("tamu via browser -> redirect ke /login", () => {
        const { nextCalled, res } = invoke({ headers: {} });
        expect(nextCalled).toBe(false);
        expect(res.redirectedTo).toBe("/login");
    });

    test("tamu via XHR -> 401 JSON (bukan redirect)", () => {
        const { nextCalled, res } = invoke({ xhr: true, headers: {} });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(401);
    });

    test("tamu yang minta JSON (Accept) -> 401", () => {
        const { nextCalled, res } = invoke({ headers: { accept: "application/json" } });
        expect(nextCalled).toBe(false);
        expect(res.statusCode).toBe(401);
    });
});

describe("internal service token (Node -> .php server-to-server)", () => {
    test("token valid terverifikasi dengan JWT secret yang sama", () => {
        const token = getInternalServiceToken("rahasia-jwt");
        expect(verifyInternalServiceToken(token, "rahasia-jwt")).toBe(true);
    });

    test("token ditolak bila JWT secret beda / bogus / kosong", () => {
        const token = getInternalServiceToken("rahasia-jwt");
        expect(verifyInternalServiceToken(token, "secret-lain")).toBe(false);
        expect(verifyInternalServiceToken("bogus", "rahasia-jwt")).toBe(false);
        expect(verifyInternalServiceToken("", "rahasia-jwt")).toBe(false);
        expect(verifyInternalServiceToken(undefined, "rahasia-jwt")).toBe(false);
    });
});

describe("PUBLIC_PATHS — endpoint sensitif tidak boleh publik", () => {
    test("tidak ada /api/monitoring/* di daftar publik (wajib auth)", () => {
        const monitoringPublic = PUBLIC_PATHS.filter((p) => p.startsWith("/api/monitoring"));
        expect(monitoringPublic).toEqual([]);
    });
});
