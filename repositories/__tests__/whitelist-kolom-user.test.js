/**
 * Header Doc
 * Purpose: Menjaga agar whitelist kolom CREATE dan UPDATE di `api-users.repository.js` tak
 *          menyimpang diam-diam, dan agar setiap field yang dikirim form edit benar-benar
 *          bisa ditulis ke SQLite.
 * Caller: Jest test runner.
 * Deps: `fs`, `path` — membaca sumber repository dan `views/sb-admin/users.php`.
 * MainFuncs: `ambilDaftar`.
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: `dusun` ada di USER_INSERT_COLUMNS dan dikirim form edit, tapi tak pernah ada di
 * whitelist UPDATE. Field non-whitelist di-`return` diam-diam sementara respons tetap 200
 * membawa nilai baru — jadi layar tampak tersimpan, SQLite tidak berubah, dan nilai lama
 * kembali saat bot restart (produksi restart 7-13x/hari). Pola yang sama sudah pernah
 * menggigit di INSERT (#b146). Penjaga ini mengubah drift senyap jadi keputusan tertulis.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SUMBER = fs.readFileSync(
    path.join(__dirname, "..", "api-users.repository.js"),
    "utf8"
);

function ambilDaftar(namaKonstanta) {
    const cocok = SUMBER.match(new RegExp(`${namaKonstanta}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    if (!cocok) throw new Error(`Daftar ${namaKonstanta} tak ditemukan di sumber`);
    return [...cocok[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// Kolom yang SENGAJA tak boleh ditulis lewat jalur update generik. Menambah entri ke sini
// adalah keputusan sadar yang harus disertai alasannya — bukan kelalaian.
const SENGAJA_TAK_BISA_DIUPDATE = {
    id: "kunci primer",
    created_at: "jejak audit, ditulis sekali",
    registration_date: "jejak audit, ditulis sekali",
    updated_at: "diisi sistem, bukan klien",
    is_paid: "status bayar = ledger payment_history, bukan kolom yang diedit tangan",
    status: "ISOLIR ditentukan profil MikroTik, bukan kolom users.status",
    assigned_agen_id: "punya alur penugasan agen sendiri",
    auto_isolir: "dikelola alur isolir",
    subscription_price: "harga efektif lewat getEffectivePrice/katalog paket",
    payment_due_date: "diturunkan dari siklus tagihan",
    odc: "aset jaringan punya alur sendiri (#ODC/#ODP)",
    odp: "aset jaringan punya alur sendiri (#ODC/#ODP)",
    olt: "diisi hasil pemindaian OLT",
    email: "belum dipakai form mana pun",
    alternative_phone: "belum dipakai form mana pun",
    notes: "belum dipakai form mana pun",
};

describe("whitelist kolom CREATE vs UPDATE tidak menyimpang diam-diam", () => {
    test("setiap kolom CREATE ada di UPDATE, atau terdaftar sebagai sengaja-immutable", () => {
        const insert = ambilDaftar("USER_INSERT_COLUMNS");
        const update = ambilDaftar("validColumns");

        const tanpaPenjelasan = insert.filter(
            (k) => !update.includes(k) && !(k in SENGAJA_TAK_BISA_DIUPDATE)
        );

        expect(tanpaPenjelasan).toEqual([]);
    });

    test("kolom yang diklaim sengaja-immutable memang tidak ada di whitelist UPDATE", () => {
        const update = ambilDaftar("validColumns");
        const kontradiksi = Object.keys(SENGAJA_TAK_BISA_DIUPDATE).filter((k) => update.includes(k));

        // Kalau sebuah kolom akhirnya BOLEH diupdate, hapus dari daftar di atas — jangan
        // biarkan dokumentasi dan kode saling bertentangan.
        expect(kontradiksi).toEqual([]);
    });
});

describe("setiap field form edit benar-benar bisa ditulis", () => {
    const HALAMAN = fs.readFileSync(
        path.join(__dirname, "..", "..", "views", "sb-admin", "users.php"),
        "utf8"
    );

    // Field form yang bukan kolom users (kontrol UI / parameter alur), jadi tak perlu ada
    // di whitelist kolom.
    const BUKAN_KOLOM = new Set([
        "id", "id_user_to_edit", "add_to_mikrotik", "free_first_month", "payment_method",
        "reason", "registration_mode", "transmit_power", "device_id_for_ssid_update",
    ]);

    test("tidak ada field form yang dibuang senyap oleh whitelist UPDATE", () => {
        const update = ambilDaftar("validColumns");
        const fieldForm = [...new Set([...HALAMAN.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]))];

        const dibuang = fieldForm.filter((f) => !BUKAN_KOLOM.has(f) && !update.includes(f));

        expect(dibuang).toEqual([]);
    });

    test("dusun — regresi spesifik yang memicu penjaga ini", () => {
        expect(ambilDaftar("validColumns")).toContain("dusun");
        expect(HALAMAN).toContain('name="dusun"');
    });
});

describe("field yang ditolak whitelist tidak dibuang tanpa jejak", () => {
    test("ada peringatan yang dicatat saat field non-whitelist ditolak", () => {
        const potongan = SUMBER.slice(SUMBER.indexOf("if (!validColumns.includes(dbField))"));

        expect(potongan.slice(0, 700)).toMatch(/console\.(warn|error)/);
        expect(potongan.slice(0, 700)).toMatch(/DIBUANG/);
    });
});
