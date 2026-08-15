/**
 * Header Doc
 * Purpose: Mengunci bahwa kolom `bulk` selalu berupa ARRAY di `global.users`, dari jalur
 *          pemuatan mana pun — pemuatan awal maupun Reload dari halaman Database.
 * Caller: Jest test runner.
 * Deps: `../user-row-normalizer`, pemindaian `../database-reload.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: ada DUA jalur yang mengisi `global.users` dan keduanya MENYIMPANG. Jalur Reload
 * (lib/database-reload.js) tak mem-parse `bulk` sama sekali, sehingga sesudah admin menekan
 * Reload nilainya jadi TEKS mentah (string `"[1,5]"`, bukan array `[1,5]`). Kode yang
 * mengiterasi indeks SSID lalu memperlakukan string itu sebagai daftar KARAKTER — SSID kedua
 * pelanggan berhenti ikut diubah, dan gejalanya baru terlihat saat ganti nama/sandi WiFi
 * massal tak berpengaruh pada sebagian pelanggan.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { parseBulk, normalizeUserRow } = require("../user-row-normalizer");

describe("bulk selalu ARRAY, apa pun bentuk simpanannya", () => {
    test.each([
        ['"[1,5]" (teks JSON dari SQLite)', "[1,5]", [1, 5]],
        ["array yang sudah benar", [1, 5], [1, 5]],
        ["teks kosong", "", []],
        ["teks '[]'", "[]", []],
        ["teks 'null'", "null", []],
        ["null", null, []],
        ["undefined", undefined, []],
    ])("%s", (_nama, masukan, harapan) => {
        expect(parseBulk({ id: 1, bulk: masukan })).toEqual(harapan);
    });

    test("data rusak '[object Object]' jadi [] dengan peringatan, bukan melempar", () => {
        const peringatan = jest.spyOn(console, "warn").mockImplementation(() => {});

        expect(parseBulk({ id: 7, bulk: "[object Object]" })).toEqual([]);
        expect(peringatan).toHaveBeenCalled();

        peringatan.mockRestore();
    });

    test("JSON tak valid jadi [] — satu baris rusak tak menggagalkan seluruh pemuatan", () => {
        const peringatan = jest.spyOn(console, "warn").mockImplementation(() => {});

        expect(parseBulk({ id: 8, bulk: "[1,5" })).toEqual([]);

        peringatan.mockRestore();
    });

    test("JSON valid tapi bukan array tetap jadi []", () => {
        expect(parseBulk({ id: 9, bulk: '{"a":1}' })).toEqual([]);
    });
});

describe("normalizeUserRow menghasilkan bentuk yang konsisten", () => {
    const baris = {
        id: 1,
        name: "Budi",
        phone_number: "628111",
        subscription: "PAKET-110K",
        paid: 1,
        send_invoice: 0,
        is_corporate: 1,
        bulk: "[1,5]",
        connected_odp_id: "",
    };

    test("integer 0/1 dari SQLite dikoersi ke boolean", () => {
        const hasil = normalizeUserRow(baris);

        expect(hasil.paid).toBe(true);
        expect(hasil.send_invoice).toBe(false);
        expect(hasil.is_corporate).toBe(true);
    });

    test("bulk jadi array — inilah regresi yang dijaga", () => {
        expect(normalizeUserRow(baris).bulk).toEqual([1, 5]);
    });

    test("alias lama tetap tersedia", () => {
        const hasil = normalizeUserRow(baris);

        expect(hasil.phone).toBe("628111");
        expect(hasil.package).toBe("PAKET-110K");
    });

    test("connected_odp_id kosong dinormalkan jadi null", () => {
        expect(normalizeUserRow(baris).connected_odp_id).toBeNull();
    });
});

describe("jalur Reload memakai normalizer yang sama", () => {
    test("database-reload.js tak lagi punya transform inline sendiri", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "database-reload.js"), "utf8");

        expect(src).toMatch(/normalizeUserRow\(/);
        // Bentuk lama: objek literal inline TANPA penanganan `bulk`.
        expect(src).not.toMatch(/paid: user\.paid === 1,\s*\n\s*send_invoice/);
    });
});
