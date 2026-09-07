/**
 * Header Doc
 * Purpose: Guard RONDE 6 Fase A — API self-service preferensi teknisi (routes/teknisi-settings-api).
 *   Invariant keamanan: (1) teknisi TERKUNCI ke prefs sendiri — ?teknisi_id diabaikan untuk non-admin;
 *   (2) admin/owner BOLEH target teknisi lain via ?teknisi_id; (3) sanitize hanya meloloskan field
 *   dikenal dengan tipe/rentang benar (anti-injeksi field asing & nilai liar ke store).
 * Caller: Jest.
 * Deps: ../teknisi-settings-api (resolveTargetId & sanitize diekspos untuk uji).
 * SideEffects: -
 */
"use strict";

const api = require("../teknisi-settings-api");
const { resolveTargetId, sanitize } = api;

describe("resolveTargetId — self-scope teknisi", () => {
    test("teknisi TIDAK bisa membaca prefs teknisi lain lewat ?teknisi_id", () => {
        const req = { user: { id: 5, role: "teknisi" }, query: { teknisi_id: "9" } };
        expect(resolveTargetId(req)).toBe("5"); // dipaksa ke dirinya, bukan "9"
    });
    test("admin BOLEH target teknisi lain via ?teknisi_id", () => {
        const req = { user: { id: 1, role: "admin" }, query: { teknisi_id: "9" } };
        expect(resolveTargetId(req)).toBe("9");
    });
    test("owner tanpa ?teknisi_id → dirinya sendiri", () => {
        const req = { user: { id: 2, role: "owner" }, query: {} };
        expect(resolveTargetId(req)).toBe("2");
    });
});

describe("sanitize — hanya field dikenal & tervalidasi", () => {
    test("field asing dibuang; enabled boolean lolos", () => {
        const out = sanitize({ enabled: true, role: "owner", isAdmin: true, __proto__: {} });
        expect(out).toEqual({ enabled: true });
        expect(out.role).toBeUndefined();
    });
    test("channel hanya menerima nilai whitelist", () => {
        expect(sanitize({ channel: "dm" })).toEqual({ channel: "dm" });
        expect(sanitize({ channel: "sms" })).toEqual({}); // ditolak
    });
    test("alerts hanya kelas dikenal & bertipe boolean", () => {
        const out = sanitize({ alerts: { los: false, redaman: "yes", ngawur: true } });
        expect(out.alerts).toEqual({ los: false }); // redaman(non-bool) & ngawur(tak dikenal) dibuang
    });
    test("areas dipangkas, di-trim, dibatasi 50", () => {
        const out = sanitize({ areas: [" ODP-1 ", "", "ODP-2", 123] });
        expect(out.areas).toEqual(["ODP-1", "ODP-2", "123"]);
    });
    test("quietHours: format jam wajib HH:MM", () => {
        const out = sanitize({ quietHours: { enabled: true, start: "22:00", end: "6am" } });
        expect(out.quietHours).toEqual({ enabled: true, start: "22:00" }); // end invalid dibuang
    });
    test("pantau.intervalMs diberi lantai 30dtk, targetDbm numerik lolos", () => {
        const out = sanitize({ pantau: { intervalMs: 1000, targetDbm: -22 } });
        expect(out.pantau.intervalMs).toBe(30000); // dipaksa >= 30000
        expect(out.pantau.targetDbm).toBe(-22);
    });
    test("body kosong → patch kosong (route akan menolak 400)", () => {
        expect(sanitize({})).toEqual({});
    });
});
