/**
 * Guard regresi: koneksi Socket.IO wajib auth staf.
 * Menutup kebocoran broadcast (mis. QR WhatsApp via io.emit('qr')) ke klien anonim.
 */
"use strict";

const jwt = require("jsonwebtoken");
const { createSocketAuthMiddleware, extractSocketToken } = require("../http-socket-bootstrap");

const SECRET = "test-secret-jwt";

function mkSocket({ authToken, cookie } = {}) {
    return {
        handshake: {
            auth: authToken ? { token: authToken } : {},
            headers: cookie ? { cookie } : {},
        },
    };
}

function run(socket) {
    let err = null;
    let allowed = false;
    createSocketAuthMiddleware({ jwt: SECRET })(socket, (maybeErr) => {
        if (maybeErr) {
            err = maybeErr;
        } else {
            allowed = true;
        }
    });
    return { allowed, err };
}

describe("Socket.IO auth middleware (staff-only)", () => {
    test("staf (token ber-role via auth.token) -> diizinkan", () => {
        const token = jwt.sign({ id: 1, role: "admin" }, SECRET);
        const { allowed, err } = run(mkSocket({ authToken: token }));
        expect(allowed).toBe(true);
        expect(err).toBeNull();
    });

    test("staf via cookie httpOnly handshake -> diizinkan", () => {
        const token = jwt.sign({ id: 2, role: "teknisi" }, SECRET);
        const { allowed } = run(mkSocket({ cookie: `foo=bar; token=${token}` }));
        expect(allowed).toBe(true);
    });

    test("customer (token ber-name tanpa role) -> ditolak", () => {
        const token = jwt.sign({ id: 3, name: "Budi" }, SECRET);
        const { allowed, err } = run(mkSocket({ authToken: token }));
        expect(allowed).toBe(false);
        expect(err).toBeTruthy();
    });

    test("tanpa token (anonim) -> ditolak", () => {
        const { allowed, err } = run(mkSocket({}));
        expect(allowed).toBe(false);
        expect(err).toBeTruthy();
    });

    test("token ditandatangani secret lain -> ditolak", () => {
        const token = jwt.sign({ id: 4, role: "admin" }, "secret-berbeda");
        const { allowed, err } = run(mkSocket({ authToken: token }));
        expect(allowed).toBe(false);
        expect(err).toBeTruthy();
    });
});

describe("extractSocketToken", () => {
    test("prioritas auth.token, lalu cookie token=, lalu null", () => {
        expect(extractSocketToken(mkSocket({ authToken: "A" }))).toBe("A");
        expect(extractSocketToken(mkSocket({ cookie: "x=1; token=B; y=2" }))).toBe("B");
        expect(extractSocketToken(mkSocket({ cookie: "x=1; y=2" }))).toBeNull();
        expect(extractSocketToken(mkSocket({}))).toBeNull();
    });
});
