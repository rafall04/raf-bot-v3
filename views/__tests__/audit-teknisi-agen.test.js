/**
 * Header Doc
 * Purpose : GUARD tiga temuan audit panel TEKNISI & AGEN (#b301) — semuanya diverifikasi
 *           bug nyata di peramban lebih dulu, bukan artefak pemindai.
 * Caller  : jest
 * Deps    : pemindaian sumber views/sb-admin + static/css (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * Panel teknisi (12 halaman) & agen (2) diukur di Chrome sungguhan pada 375/768/1440,
 * dengan TOKEN PER-PERAN (navbar role-aware baca peran dari cookie). Nol geser horizontal
 * halaman di semua lebar; mayoritas kandidat DIBUANG setelah diverifikasi sebagai non-bug:
 *   - 403 /api/config di teknisi-map-viewer  → disengaja #b253, ditangani .catch (peta jalan)
 *   - 403 /api/agen/customers                → artefak: token admin di endpoint agen-only
 *   - select 1px di halaman teknisi          → native tersembunyi Select2 (widget render 321px)
 *   - .table-scroll teknisi-tutorial 40px    → wadah geser sengaja untuk cheat-sheet
 * Tiga yang LOLOS verifikasi diperbaiki, dan dikunci di sini.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");
const V = path.join(AKAR, "views/sb-admin");
const bacaV = (f) => fs.readFileSync(path.join(V, f), "utf8");

describe("#b301 — papan-psb: kartu ringkasan 2 per baris di HP", () => {
    /*
     * TERUKUR: 4 kartu ringkasan (Belum Kepasang / Terpasang / Komisi …) memakai
     * `col-md-3` TANPA kelas kolom mobile → penuh-selebar-layar dan menumpuk, mendorong
     * papan PSB ke y=1690px (2,1 layar) sebelum baris pertama terlihat. col-md-3 = 100%
     * di bawah breakpoint md. Ini CELAH di aturan 2-up #b297 (kartunya `.card` polos,
     * tak tercakup pengait :has()). Sesudah col-6: kartu 188px (2-up), tabel ke 1,8 layar.
     */
    test("!! keempat kartu ringkasan memakai col-6 (2-up mobile)", () => {
        const s = bacaV("papan-psb.php");
        expect((s.match(/col-6 col-md-3 mb-3/g) || []).length).toBe(4);
        expect(s).not.toMatch(/<div class="col-md-3 mb-3">/);
    });
});

describe("#b301 — agen-pembayaran: tabel ikut pola tumpuk HP", () => {
    /*
     * TERUKUR: #requestTable 378px dalam kotak 321px — kolom "Aksi" (tombol proses bayar)
     * tepinya di 405px, sebagian di luar layar HP, hanya terjangkau geser samping. Modal
     * halaman ini ("Ajukan Pembayaran" + catatan) adalah modal AKSI, bukan detail per-baris
     * → menyembunyikan kolom = data hilang, jadi WAJIB pola tumpuk. Sesudah: 0px meluber,
     * thead tersembunyi, dan penstempel bersama (#b295) melabeli 5 kolom saat baris nyata
     * muncul (diverifikasi dengan menyuntik baris di peramban).
     */
    const s = bacaV("agen-pembayaran.php");
    for (const id of ["requestTable", "customerTable"]) {
        test("#" + id + " ber-kelas tabel-tumpuk-hp", () => {
            const tag = s.match(new RegExp('<table[^>]*id="' + id + '"[^>]*>'));
            expect({ id, ada: !!tag }).toEqual({ id, ada: true });
            expect({ id, tumpuk: /tabel-tumpuk-hp/.test(tag[0]) }).toEqual({ id, tumpuk: true });
        });
    }
});

describe("#b301 — teknisi-map-viewer: teks loading terbaca di kedua tema", () => {
    /*
     * TERUKUR: "Memuat peta dan data..." mewarisi ink tema (near-putih di mode gelap) dan
     * menumpang di atas UBIN PETA Leaflet yang SELALU terang → kontras 1,04 (tak terbaca)
     * selama peta memuat. Diberi permukaan + ink token eksplisit → kontras 14,81.
     */
    const css = fs.readFileSync(path.join(AKAR, "static/css/teknisi-map-viewer.css"), "utf8");
    const blok = css.match(/\.loading-spinner-container\s*\{[^}]*\}/);

    test("kotak loading punya latar & warna eksplisit (bukan mewarisi tema)", () => {
        expect(blok).not.toBeNull();
        expect(blok[0]).toMatch(/background:\s*var\(--surface\)/);
        expect(blok[0]).toMatch(/color:\s*var\(--ink\)/);
    });

    test("warnanya token semantik, bukan literal (agar ikut mode gelap)", () => {
        // Literal seperti #fff/#333 di sini justru mengulang bug aslinya di arah sebaliknya.
        expect(blok[0]).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
});
