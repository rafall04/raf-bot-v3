/**
 * Header Doc
 * Purpose: Mengunci aturan gerbang KEPEMILIKAN (`assertBolehAksesPelanggan`) yang dipakai
 *          endpoint ber-`userId` (invoice, OLT) agar pelanggan tak bisa mengintip data
 *          pelanggan lain.
 * Caller: Jest test runner.
 * Deps: `../api-route-helpers`.
 * MainFuncs: —
 * SideEffects: Tidak ada — predikat murni.
 *
 * KENAPA ADA: middleware auth global meloloskan `req.user || req.customer`, jadi endpoint yang
 * hanya memeriksa "ada sesi" bisa dienumerasi. Pelanggan yang login memanggil
 * `?userId=1..2000` dan memanen nama, alamat, nomor HP, paket, harga langganan, NPWP —
 * plus `invoiceNumber` yang lalu dipakai merender HTML/PDF-nya. Endpoint OLT bahkan
 * memulangkan `pppoe_username`, `mac_mikrotik`, `mac_olt`, `rx_power`.
 *
 * CATATAN KEJUJURAN: jalur sesi PELANGGAN belum diverifikasi lewat request nyata ke produksi —
 * token pelanggan hanya bisa dibuat lewat alur login portal, bukan ditandatangani manual.
 * Aturannya dikunci di sini, pada level yang memang menentukan keputusannya.
 */
"use strict";

const { assertBolehAksesPelanggan } = require("../api-route-helpers");

const staf = (role) => ({ user: { id: 1, username: "x", role } });
const pelanggan = (id) => ({ customer: { id } });

describe("staf boleh mengakses userId mana pun", () => {
    test.each(["admin", "owner", "superadmin", "teknisi"])("peran %s", (role) => {
        expect(assertBolehAksesPelanggan(staf(role), 999).ok).toBe(true);
    });
});

describe("sesi pelanggan hanya boleh dirinya sendiri", () => {
    test("userId sendiri diizinkan", () => {
        expect(assertBolehAksesPelanggan(pelanggan(77), 77).ok).toBe(true);
    });

    test("perbandingan tahan beda tipe (string vs number)", () => {
        expect(assertBolehAksesPelanggan(pelanggan(77), "77").ok).toBe(true);
        expect(assertBolehAksesPelanggan({ customer: { id: "77" } }, 77).ok).toBe(true);
    });

    test("userId orang lain DITOLAK", () => {
        expect(assertBolehAksesPelanggan(pelanggan(77), 78).ok).toBe(false);
    });

    test("ditolak dengan 404, BUKAN 403 — 403 sendiri sudah alat enumerasi ID", () => {
        const hasil = assertBolehAksesPelanggan(pelanggan(77), 78);

        // Membedakan "ada tapi bukan milikmu" (403) dari "tidak ada" (404) memberi tahu
        // penyerang ID mana yang valid. Keduanya harus terlihat sama.
        expect(hasil.status).toBe(404);
        expect(hasil.message).not.toMatch(/ditolak|akses|forbidden/i);
    });

    test("menyisir seluruh rentang ID tak memulangkan satu pun izin", () => {
        const aku = 77;
        const bocor = [];
        for (let id = 1; id <= 200; id++) {
            if (id === aku) continue;
            if (assertBolehAksesPelanggan(pelanggan(aku), id).ok) bocor.push(id);
        }

        expect(bocor).toEqual([]);
    });
});

describe("tanpa sesi apa pun", () => {
    test.each([{}, { user: null }, { customer: null }, { user: null, customer: null }])(
        "req %p ditolak 401",
        (req) => {
            const hasil = assertBolehAksesPelanggan(req, 1);

            expect(hasil.ok).toBe(false);
            expect(hasil.status).toBe(401);
        }
    );

    test("peran tak dikenal tidak diam-diam dianggap staf", () => {
        const hasil = assertBolehAksesPelanggan({ user: { id: 9, role: "agen" } }, 5);

        // `agen` bukan staf lapangan maupun pemilik data — tak ada alasan membuka data
        // pelanggan mana pun lewat endpoint ini.
        expect(hasil.ok).toBe(false);
    });
});

describe("endpoint benar-benar memakai gerbangnya", () => {
    const fs = require("fs");
    const path = require("path");
    const baca = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

    test("ketiga endpoint invoice memanggil assertBolehAksesPelanggan", () => {
        const src = baca("invoice.js");
        const jumlah = (src.match(/assertBolehAksesPelanggan\(/g) || []).length;

        // /get-latest-invoice, /view-invoice, /download-invoice-pdf
        expect(jumlah).toBe(3);
    });

    test("endpoint OLT per-pelanggan memakai gerbangnya", () => {
        expect(baca("olt.js")).toMatch(/assertBolehAksesPelanggan\(req, userId\)/);
    });

    test("/refresh-single tidak lagi meloloskan sesi pelanggan", () => {
        const src = baca("olt.js");
        const blok = src.slice(src.indexOf("router.post('/refresh-single'"));

        expect(blok.slice(0, 600)).not.toMatch(/!req\.user && !req\.customer/);
        expect(blok.slice(0, 600)).toMatch(/'teknisi'/);
    });
});
