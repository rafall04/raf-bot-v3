/**
 * Header Doc
 * Purpose: Mengunci gerbang gagal-tertutup peran teknisi (#b253) — teknisi hanya boleh menyentuh
 *          jalur yang DIDAFTARKAN di `routes/teknisi-izin-api.js`, peran lain tidak terpengaruh,
 *          dan daftar izinnya tidak boleh berisi jalur fiktif.
 * Caller: Jest test runner.
 * Deps: `lib/authz`, `routes/teknisi-izin-api`, `routes/admin-router`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { cocokkanJalur, diizinkan, buatGerbangTeknisi, isAdmin, isTeknisi } = require("../../lib/authz");
const { IZIN_TEKNISI_API } = require("../teknisi-izin-api");

function buatRes() {
    return {
        statusCode: null,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(p) { this.body = p; return this; },
    };
}

function jalankan(gerbang, { method = "GET", path: jalur = "/", user = null } = {}) {
    const req = { method, path: jalur, url: jalur, user };
    const res = buatRes();
    let lanjut = false;
    gerbang(req, res, () => { lanjut = true; });
    return { lanjut, res };
}

const senyap = { warn() {}, error() {}, log() {} };
const gerbangTegak = buatGerbangTeknisi(IZIN_TEKNISI_API, { bacaMode: () => "tegakkan", logger: senyap });

describe("#b253 — pencocokan jalur", () => {
    test("literal cocok persis, beda segmen tidak", () => {
        expect(cocokkanJalur("/api/list/users", "/api/list/users")).toBe(true);
        expect(cocokkanJalur("/api/list/users", "/api/list/packages")).toBe(false);
    });

    test(":param menerima satu segmen, BUKAN lebih", () => {
        expect(cocokkanJalur("/api/ssid/:deviceId", "/api/ssid/dev-A")).toBe(true);
        expect(cocokkanJalur("/api/ssid/:deviceId", "/api/ssid/dev-A/extra")).toBe(false);
        expect(cocokkanJalur("/api/ssid/:deviceId", "/api/ssid")).toBe(false);
    });

    test("tidak boleh cocok sebagai awalan — /api/map/routeXYZ bukan /api/map/route", () => {
        expect(cocokkanJalur("/api/map/route", "/api/map/routeXYZ")).toBe(false);
    });

    test("metode ikut menentukan", () => {
        expect(diizinkan(IZIN_TEKNISI_API, "GET", "/api/list/users")).toBe(true);
        expect(diizinkan(IZIN_TEKNISI_API, "DELETE", "/api/list/users")).toBe(false);
    });
});

describe("#b253 — gerbang hanya menyentuh peran teknisi", () => {
    test.each([
        ["admin", { role: "admin" }],
        ["owner", { role: "owner" }],
        ["superadmin", { role: "superadmin" }],
    ])("peran %s lewat apa adanya walau jalurnya di luar daftar", (_n, user) => {
        const { lanjut, res } = jalankan(gerbangTegak, { path: "/api/mikrotik-devices", user });
        expect(lanjut).toBe(true);
        expect(res.statusCode).toBeNull();
    });

    test("tanpa sesi TIDAK disentuh gerbang ini (ensureAuthenticatedStaff per-rute yang menentukan)", () => {
        const { lanjut } = jalankan(gerbangTegak, { path: "/api/mikrotik-devices", user: null });
        expect(lanjut).toBe(true);
    });

    test("sesi pelanggan TIDAK disentuh gerbang ini", () => {
        const { lanjut } = jalankan(gerbangTegak, { path: "/api/mikrotik-devices", user: { role: "pelanggan" } });
        expect(lanjut).toBe(true);
    });
});

describe("#b253 — teknisi: gagal-tertutup", () => {
    const TEKNISI = { role: "teknisi", username: "davin" };

    test("jalur di LUAR daftar ditolak 403", () => {
        const { lanjut, res } = jalankan(gerbangTegak, { path: "/api/mikrotik-devices", user: TEKNISI });
        expect(lanjut).toBe(false);
        expect(res.statusCode).toBe(403);
        expect(res.body.errorCode).toBe("AUTHORIZATION_ERROR");
    });

    test("pesan penolakan tidak membocorkan nama endpoint/jargon ke layar", () => {
        const { res } = jalankan(gerbangTegak, { path: "/api/mikrotik-devices", user: TEKNISI });
        expect(res.body.message).not.toMatch(/mikrotik-devices|403|AUTHORIZATION/i);
    });

    test.each(IZIN_TEKNISI_API.map((i) => [i.method, i.jalur]))(
        "%s %s DIIZINKAN (halaman teknisi memang memakainya)",
        (method, pola) => {
            const jalur = pola.replace(/:[A-Za-z0-9_]+/g, "contoh");
            const { lanjut, res } = jalankan(gerbangTegak, { method, path: jalur, user: TEKNISI });
            expect(res.statusCode).toBeNull();
            expect(lanjut).toBe(true);
        }
    );

    test("/api/config TETAP tertutup — sengaja tidak masuk daftar walau halaman teknisi memanggilnya", () => {
        const { lanjut } = jalankan(gerbangTegak, { path: "/api/config", user: TEKNISI });
        expect(lanjut).toBe(false);
    });
});

describe("#b253 — mode", () => {
    const TEKNISI = { role: "teknisi", username: "davin" };

    test("mode laporkan MELEWATKAN tapi mencatat", () => {
        const catatan = [];
        const g = buatGerbangTeknisi(IZIN_TEKNISI_API, {
            bacaMode: () => "laporkan",
            logger: { warn: (m) => catatan.push(m) },
        });
        const { lanjut, res } = jalankan(g, { path: "/api/mikrotik-devices", user: TEKNISI });
        expect(lanjut).toBe(true);
        expect(res.statusCode).toBeNull();
        expect(catatan.join(" ")).toMatch(/AUTHZ_TEKNISI_LAPOR/);
    });

    test("mode mati melewatkan tanpa mencatat", () => {
        const catatan = [];
        const g = buatGerbangTeknisi(IZIN_TEKNISI_API, {
            bacaMode: () => "mati",
            logger: { warn: (m) => catatan.push(m) },
        });
        const { lanjut } = jalankan(g, { path: "/api/mikrotik-devices", user: TEKNISI });
        expect(lanjut).toBe(true);
        expect(catatan).toEqual([]);
    });

    test("mode tak dikenal jatuh ke TEGAKKAN, bukan terbuka", () => {
        const g = buatGerbangTeknisi(IZIN_TEKNISI_API, { bacaMode: () => "ngawur", logger: senyap });
        const { lanjut } = jalankan(g, { path: "/api/mikrotik-devices", user: TEKNISI });
        expect(lanjut).toBe(false);
    });
});

describe("#b253 — daftar izin tidak boleh berisi jalur fiktif", () => {
    // Daftar yang menyebut jalur tak-ada akan membusuk diam-diam: ia terlihat memberi izin
    // padahal tidak, dan menyembunyikan bahwa endpoint aslinya sudah pindah/berganti nama.
    const ROUTES = path.join(__dirname, "..");

    function semuaJalurTerdaftar() {
        const kumpulan = new Set();
        for (const berkas of fs.readdirSync(ROUTES).filter((f) => f.endsWith(".js"))) {
            const kode = fs.readFileSync(path.join(ROUTES, berkas), "utf8");
            for (const m of kode.matchAll(/router\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
                kumpulan.add(`${m[1].toUpperCase()} ${m[2].replace(/:[A-Za-z0-9_]+/g, ":x").replace(/\/+$/, "")}`);
            }
        }
        return kumpulan;
    }

    test("setiap entri menunjuk rute yang BENAR-BENAR terdaftar", () => {
        const terdaftar = semuaJalurTerdaftar();
        const fiktif = IZIN_TEKNISI_API
            .map((i) => `${String(i.method).toUpperCase()} ${i.jalur.replace(/:[A-Za-z0-9_]+/g, ":x").replace(/\/+$/, "")}`)
            .filter((k) => !terdaftar.has(k));
        expect(fiktif).toEqual([]);
    });
});

describe("#b253 — predikat peran", () => {
    test("isAdmin/isTeknisi tahan huruf besar-kecil dan nilai kosong", () => {
        expect(isAdmin({ role: "ADMIN" })).toBe(true);
        expect(isAdmin({ role: "teknisi" })).toBe(false);
        expect(isAdmin(null)).toBe(false);
        expect(isTeknisi({ role: "Teknisi" })).toBe(true);
        expect(isTeknisi(undefined)).toBe(false);
    });
});
