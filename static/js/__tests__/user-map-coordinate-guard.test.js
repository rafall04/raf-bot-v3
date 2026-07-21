/**
 * Header Doc
 * Purpose: Penjaga regresi peta pelanggan — koordinat pelanggan HANYA boleh ditulis oleh tindakan
 *          SENGAJA (klik peta, geser marker, tombol GPS berhasil). Inisialisasi otomatis maupun
 *          KEGAGALAN GPS tak boleh menulis apa pun ke input lat/lng.
 *          AKAR: dulu fallback GPS memanggil `updateMarkerAndInputsUser` dengan koordinat DEFAULT
 *          (-7.24139, 111.83833), sehingga setiap admin yang menyimpan form pelanggan tanpa izin
 *          GPS ikut menstempel titik itu sebagai "rumah pelanggan" — 92 pelanggan di 2 bot berakhir
 *          menumpuk di satu titik yang sama PERSIS (bukan kebetulan: cocok sampai 6 desimal).
 * Caller: Jest.
 * Deps: membaca sumber `static/js/users.js` & `static/js/teknisi-pelanggan.js` (uji berbasis sumber,
 *       sejalan pola guard lain di repo — kode peta terikat Leaflet/DOM sehingga sulit diuji unit).
 * SideEffects: tidak ada (read-only).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const FILES = ["users.js", "teknisi-pelanggan.js"];
const readSource = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

describe.each(FILES)("penjaga koordinat pelanggan — %s", (file) => {
    const src = readSource(file);

    test("tersedia penggeser tampilan peta yang TIDAK menyentuh input lat/lng", () => {
        expect(src).toMatch(/function moveMapViewOnly\s*\(/);
        const body = src.slice(src.indexOf("function moveMapViewOnly"));
        const fnBody = body.slice(0, body.indexOf("}") + 1);
        expect(fnBody).not.toMatch(/latInput|lngInput/);
    });

    test("KEGAGALAN GPS tak pernah menulis koordinat — fallback default hanya menggeser peta", () => {
        const calls = src.match(/handleGeolocationErrorUserModal\([\s\S]{0,400}?\);/g) || [];
        expect(calls.length).toBeGreaterThan(0);
        calls.forEach((c) => {
            expect(c).not.toMatch(/updateMarkerAndInputsUser/);
        });
        // Sisi penerima: parameternya pun dinamai sebagai penggeser tampilan, bukan updater.
        expect(src).toMatch(/function handleGeolocationErrorUserModal\([^)]*mapViewFn\s*\)/);
        expect(src).not.toMatch(/errorText \+= "<br\/>Menampilkan lokasi default\.";/);
    });

    test("INISIALISASI peta hanya menggeser tampilan (lokasi petugas ≠ rumah pelanggan)", () => {
        const init = src.match(/processSuccessfulGeolocationUserModal\(position, "Inisialisasi Peta"[^)]*\)/);
        expect(init).not.toBeNull();
        expect(init[0]).toMatch(/moveMapViewOnly/);
        expect(init[0]).not.toMatch(/updateMarkerAndInputsUser/);
    });

    // Sisi sebaliknya: jalur SENGAJA harus TETAP menulis, jangan sampai perbaikan di atas
    // membuat tombol GPS jadi tak berguna.
    test("tombol GPS yang BERHASIL tetap menulis koordinat (tindakan sengaja)", () => {
        const btn = src.match(/processSuccessfulGeolocationUserModal\(position, "Tombol GPS"[^)]*\)/);
        expect(btn).not.toBeNull();
        expect(btn[0]).toMatch(/updateMarkerAndInputsUser/);
    });

    test("klik peta & geser marker tetap menulis koordinat", () => {
        expect(src).toMatch(/mapInstance\.on\('click',\s*function\s*\(e\)\s*\{\s*updateMarkerAndInputsUser\(e\.latlng\)/);
        expect(src).toMatch(/markerInstance\.on\('dragend'/);
    });
});
