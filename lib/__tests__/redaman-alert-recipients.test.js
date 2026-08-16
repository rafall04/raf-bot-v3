/**
 * Header Doc
 * Purpose: Mengunci bahwa penerima alert redaman BISA diatur per peran (mis. teknisi saja),
 *          bahwa bawaannya setara perilaku lama, dan bahwa nomor format lokal tak lagi
 *          terbuang diam-diam.
 * Caller: Jest test runner.
 * Deps: `lib/redaman-alert-recipients.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada (semua masukan lewat argumen, tanpa global).
 *
 * KENAPA ADA — penerima dulu di-hardcode dan tak bisa diatur:
 *     for (const account of global.accounts)
 *         if (account.phone_number && ... && !account.phone_number.startsWith("0"))
 * Tak ada filter peran, jadi SETIAP akun berponsel dibanjiri. Terukur di produksi
 * 2026-08-16: 3 akun per bot (raf/admin, davin/teknisi, ipan/teknisi) — ketiganya menerima
 * tiap alert, dan pemilik tak punya cara membatasinya ke teknisi saja.
 *
 * `!startsWith("0")` juga BUKAN pilihan peran melainkan pembuangan diam-diam untuk nomor
 * format lokal (08xx) — itulah yang ditutup di sini lewat normalisasi.
 */
"use strict";

const { resolvePenerimaRedaman, bacaSetelanRedaman } = require("../redaman-alert-recipients");

// Susunan akun NYATA produksi saat cacat ini ditemukan.
const AKUN = [
    { username: "raf", role: "admin", phone_number: "6285233047094" },
    { username: "davin", role: "teknisi", phone_number: "6287787262890" },
    { username: "ipan", role: "teknisi", phone_number: "6288994068666" },
];

const jids = (hasil) => hasil.jids.slice().sort();

describe("bawaan = perilaku lama (tak diam-diam mematikan alert siapa pun)", () => {
    test("tanpa config.redamanAlert, SEMUA peran tetap menerima", () => {
        const h = resolvePenerimaRedaman({ accounts: AKUN, config: {} });
        expect(h.aktif).toBe(true);
        expect(h.jids).toHaveLength(3);
    });

    test("setelan default menandai roles=null (artinya semua peran)", () => {
        expect(bacaSetelanRedaman({}).roles).toBeNull();
        expect(bacaSetelanRedaman({}).enabled).toBe(true);
    });
});

describe("bisa dibatasi ke TEKNISI SAJA — inti permintaan pemilik", () => {
    test("roles=['teknisi'] → admin TIDAK menerima", () => {
        const h = resolvePenerimaRedaman({
            accounts: AKUN,
            config: { redamanAlert: { roles: ["teknisi"] } },
        });
        expect(h.jids).toHaveLength(2);
        expect(jids(h)).toEqual(["6287787262890@s.whatsapp.net", "6288994068666@s.whatsapp.net"]);
        expect(h.rincian.every((r) => /teknisi/.test(r.label))).toBe(true);
    });

    test("roles=['admin'] → hanya admin", () => {
        const h = resolvePenerimaRedaman({ accounts: AKUN, config: { redamanAlert: { roles: ["admin"] } } });
        expect(h.jids).toEqual(["6285233047094@s.whatsapp.net"]);
    });

    test("peran ditulis beda kapital tetap cocok", () => {
        const h = resolvePenerimaRedaman({ accounts: AKUN, config: { redamanAlert: { roles: ["TEKNISI"] } } });
        expect(h.jids).toHaveLength(2);
    });

    test("roles=[] → NOL penerima dari akun (sah, bukan diperlakukan sebagai 'semua')", () => {
        // Beda tegas antara "tak ada peran dipilih" dan "roles absen".
        const h = resolvePenerimaRedaman({ accounts: AKUN, config: { redamanAlert: { roles: [] } } });
        expect(h.aktif).toBe(true);
        expect(h.jids).toEqual([]);
    });
});

describe("nomor tambahan di luar daftar akun", () => {
    test("ditambahkan bersama penerima dari peran", () => {
        const h = resolvePenerimaRedaman({
            accounts: AKUN,
            config: { redamanAlert: { roles: ["teknisi"], extraNumbers: ["081999888777"] } },
        });
        expect(h.jids).toHaveLength(3);
        expect(h.jids).toContain("6281999888777@s.whatsapp.net");
    });

    test("bisa dipakai sendirian tanpa peran apa pun", () => {
        const h = resolvePenerimaRedaman({
            accounts: AKUN,
            config: { redamanAlert: { roles: [], extraNumbers: ["+62 819-9988-8777"] } },
        });
        expect(h.jids).toEqual(["6281999888777@s.whatsapp.net"]);
    });

    test("orang yang sama di dua sumber tidak dikirimi dua kali", () => {
        const h = resolvePenerimaRedaman({
            accounts: AKUN,
            config: { redamanAlert: { roles: ["admin"], extraNumbers: ["085233047094"] } },
        });
        expect(h.jids).toEqual(["6285233047094@s.whatsapp.net"]);
    });
});

describe("nomor format lokal tak lagi terbuang diam-diam", () => {
    test("akun ber-08xx TETAP menerima (dulu dilewati `!startsWith('0')`)", () => {
        const akunLokal = [{ username: "budi", role: "teknisi", phone_number: "087787262890" }];
        const h = resolvePenerimaRedaman({ accounts: akunLokal, config: { redamanAlert: { roles: ["teknisi"] } } });
        expect(h.jids).toEqual(["6287787262890@s.whatsapp.net"]);
    });

    test("nomor tak masuk akal dilewati, tanpa melempar", () => {
        const akunRusak = [
            { username: "x", role: "teknisi", phone_number: "" },
            { username: "y", role: "teknisi", phone_number: "-" },
            { username: "z", role: "teknisi" },
        ];
        const h = resolvePenerimaRedaman({ accounts: akunRusak, config: { redamanAlert: { roles: ["teknisi"] } } });
        expect(h.jids).toEqual([]);
    });
});

describe("sakelar mati", () => {
    test("enabled=false → tak seorang pun, dan ditandai tidak aktif", () => {
        const h = resolvePenerimaRedaman({ accounts: AKUN, config: { redamanAlert: { enabled: false } } });
        expect(h.aktif).toBe(false);
        expect(h.jids).toEqual([]);
    });
});

describe("cron memakai resolver ini, bukan filter hardcode lama", () => {
    test("redaman-check.js tak lagi menyaring dengan startsWith('0')", () => {
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "..", "cron", "jobs", "redaman-check.js"), "utf8");
        expect(src).toMatch(/resolvePenerimaRedaman/);
        expect(src).not.toMatch(/phone_number\.startsWith\("0"\)/);
        expect(src).not.toMatch(/for \(const account of global\.accounts\)/);
    });
});
