/**
 * Header Doc
 * Purpose: Guard RONDE 6 Fase A — store preferensi per-teknisi (repositories/teknisi-prefs.repository).
 *   Invariant kunci: (1) belum-setel → getPrefs = DEFAULTS (perilaku lama, tak berubah diam-diam);
 *   (2) setPrefs MERGE dalam (alerts/quietHours/pantau tak saling menimpa); (3) tulis atomik (ada file,
 *   parse balik utuh); (4) berkas rusak DIKARANTINA jadi map kosong (fail-safe, bukan lempar).
 * Caller: Jest.
 * Deps: ../teknisi-prefs.repository; fs/os/path (file sementara di tmpdir, TIDAK menyentuh database/).
 * SideEffects: Menulis berkas sementara di os.tmpdir lalu membersihkannya.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const repo = require("../teknisi-prefs.repository");

function tmpFile(tag) {
    return path.join(os.tmpdir(), `teknisi_prefs_test_${tag}_${process.pid}_${Math.floor(Math.random() * 1e6)}.json`);
}
function cleanup(fp) {
    for (const f of [fp, `${fp}`]) { try { fs.existsSync(f) && fs.unlinkSync(f); } catch (_) { /* abaikan */ } }
    // buang berkas karantina .rusak-*
    try {
        const dir = path.dirname(fp), base = path.basename(fp);
        for (const n of fs.readdirSync(dir)) if (n.startsWith(`${base}.rusak-`)) fs.unlinkSync(path.join(dir, n));
    } catch (_) { /* abaikan */ }
}

afterEach(() => repo.reload(tmpFile("noop"))); // reset cache singleton antar-test

describe("teknisi-prefs.repository — default = perilaku lama", () => {
    test("belum pernah setel → getPrefs mengembalikan DEFAULTS lengkap; getRawPrefs = null", () => {
        const fp = tmpFile("default");
        try {
            expect(repo.getRawPrefs("99", fp)).toBeNull();
            const p = repo.getPrefs("99", fp);
            expect(p.enabled).toBe(true);
            expect(p.alerts).toEqual({ los: true, redaman: true, ticket_new: true, post_repair: true });
            expect(p.channel).toBe("both");
            expect(p.areas).toEqual([]);
            expect(p.quietHours.enabled).toBe(false);
            expect(p.snoozeUntil).toBeNull();
        } finally { cleanup(fp); }
    });
});

describe("teknisi-prefs.repository — setPrefs merge + persist", () => {
    test("patch parsial hanya mengubah field terkait; sisanya tetap default", () => {
        const fp = tmpFile("merge");
        try {
            const p1 = repo.setPrefs("7", { channel: "dm", areas: ["ODP-01", "ODP-02"] }, fp);
            expect(p1.channel).toBe("dm");
            expect(p1.areas).toEqual(["ODP-01", "ODP-02"]);
            expect(p1.alerts.los).toBe(true); // default tetap

            // patch kedua: matikan hanya satu kelas alert; area & channel harus BERTAHAN
            const p2 = repo.setPrefs("7", { alerts: { los: false } }, fp);
            expect(p2.alerts.los).toBe(false);
            expect(p2.alerts.redaman).toBe(true); // kelas lain tak tersentuh (merge dalam)
            expect(p2.channel).toBe("dm");
            expect(p2.areas).toEqual(["ODP-01", "ODP-02"]);
        } finally { cleanup(fp); }
    });

    test("tulis atomik: berkas ada & bisa di-parse balik utuh; updatedAt terisi", () => {
        const fp = tmpFile("atomic");
        try {
            repo.setPrefs("12", { enabled: false }, fp);
            expect(fs.existsSync(fp)).toBe(true);
            const raw = JSON.parse(fs.readFileSync(fp, "utf8"));
            expect(raw["12"].enabled).toBe(false);
            expect(typeof raw["12"].updatedAt).toBe("string");
        } finally { cleanup(fp); }
    });

    test("listCustomized hanya berisi id yang PERNAH menyetel", () => {
        const fp = tmpFile("list");
        try {
            repo.setPrefs("3", { enabled: false }, fp);
            repo.setPrefs("8", { channel: "group" }, fp);
            expect(repo.listCustomized(fp).sort()).toEqual(["3", "8"]);
        } finally { cleanup(fp); }
    });
});

describe("teknisi-prefs.repository — fail-safe berkas rusak", () => {
    test("JSON rusak → DIKARANTINA .rusak-*, getPrefs jatuh ke DEFAULTS (tidak lempar)", () => {
        const fp = tmpFile("rusak");
        try {
            fs.writeFileSync(fp, "{ ini bukan json valid ", "utf8");
            repo.reload(fp);
            const p = repo.getPrefs("1", fp);
            expect(p.enabled).toBe(true); // default, bukan crash
            const dir = path.dirname(fp), base = path.basename(fp);
            const quarantined = fs.readdirSync(dir).some((n) => n.startsWith(`${base}.rusak-`));
            expect(quarantined).toBe(true);
        } finally { cleanup(fp); }
    });
});
