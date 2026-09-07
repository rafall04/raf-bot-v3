/**
 * Guard regresi: koneksi Socket.IO wajib auth staf.
 * Menutup kebocoran broadcast (mis. QR WhatsApp via io.emit('qr')) ke klien anonim.
 */
"use strict";

const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { createSocketAuthMiddleware, extractSocketToken, joinRoomsForRole } = require("../http-socket-bootstrap");

const SECRET = "test-secret-jwt";

// #b348: role di-derive dari AKUN (accounts.json via runtime), bukan klaim token. Sumber akun palsu
// untuk uji — id 1=admin, 2=teknisi, 5=owner. id lain (mis. token basi setelah akun dihapus) → null.
const FAKE_ACCOUNTS = [
    { id: 1, username: "admin1", role: "admin" },
    { id: 2, username: "tek1", role: "teknisi" },
    { id: 5, username: "owner1", role: "owner" },
];
function mkDeps(accounts = FAKE_ACCOUNTS) {
    return {
        runtime: { getRepository: (name) => (name === "accounts" ? { getAll: () => accounts } : null) },
        loadJSON: () => accounts,
    };
}

function mkSocket({ authToken, cookie } = {}) {
    return {
        handshake: {
            auth: authToken ? { token: authToken } : {},
            headers: cookie ? { cookie } : {},
        },
    };
}

function run(socket, deps = mkDeps()) {
    let err = null;
    let allowed = false;
    createSocketAuthMiddleware({ jwt: SECRET }, deps)(socket, (maybeErr) => {
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

    // #b348 — role di-derive dari AKUN, bukan klaim token.
    test("token role='admin' TAPI akun sudah didemote jadi teknisi -> socket.data.role = teknisi (dari akun)", () => {
        const token = jwt.sign({ id: 2, role: "admin" }, SECRET); // klaim token BASI: admin
        const socket = mkSocket({ authToken: token });
        const { allowed } = run(socket); // akun id:2 = teknisi
        expect(allowed).toBe(true);
        expect(socket.data.role).toBe("teknisi"); // BUKAN 'admin' dari token
    });

    test("akun DIHAPUS (id token tak ada di accounts) -> koneksi DITOLAK walau token valid", () => {
        const token = jwt.sign({ id: 999, role: "admin" }, SECRET);
        const { allowed, err } = run(mkSocket({ authToken: token }));
        expect(allowed).toBe(false);
        expect(err).toBeTruthy();
    });

    test("akun tetap admin -> masuk room 'admin' (jalur bahagia utuh)", () => {
        const token = jwt.sign({ id: 1, role: "admin" }, SECRET);
        const socket = mkSocket({ authToken: token });
        run(socket);
        expect(socket.data.role).toBe("admin");
    });
});

// #b338 — QR WhatsApp hanya boleh ke room 'admin' (kredensial link = takeover bila bocor ke teknisi/agen).
describe("room-scoping per role (#b338)", () => {
    function runWithSocket(socket) {
        createSocketAuthMiddleware({ jwt: SECRET }, mkDeps())(socket, () => {});
        return socket;
    }

    test("middleware menyimpan role ke socket.data untuk scoping", () => {
        const token = jwt.sign({ id: 1, role: "admin" }, SECRET);
        const socket = runWithSocket(mkSocket({ authToken: token }));
        expect(socket.data && socket.data.role).toBe("admin");
    });

    test("joinRoomsForRole: admin/owner/superadmin → masuk room 'admin'", () => {
        for (const role of ["admin", "owner", "superadmin"]) {
            const joined = [];
            joinRoomsForRole({ data: { role }, join: (r) => joined.push(r) });
            expect(joined).toContain("admin");
        }
    });

    test("joinRoomsForRole: teknisi/agen/customer → TIDAK masuk room 'admin' (tak dapat QR)", () => {
        for (const role of ["teknisi", "agen", undefined, "pelanggan"]) {
            const joined = [];
            joinRoomsForRole({ data: { role }, join: (r) => joined.push(r) });
            expect(joined).not.toContain("admin");
        }
    });

    test("SUMBER: index.js meng-emit QR ke room 'admin', BUKAN io.emit global", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");
        expect(src).toMatch(/io\.to\(['"]admin['"]\)\.emit\(['"]qr['"]/);
        expect(src).not.toMatch(/\bio\.emit\(['"]qr['"]/);
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
