/**
 * Header Doc
 * Purpose: Mengunci sumber KEDUA kepemilikan alert redaman (#b288) — modem di area kita yang
 *          belum didaftarkan ikut dipantau, TANPA menarik masuk modem bot sebelah.
 * Caller  : jest
 * Deps    : ../redaman-alert-scope (murni).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA: saringan kepemilikan (#b249) benar untuk masalahnya — satu ACS dipakai dua bot,
 * jadi modem bot sebelah tak boleh mengalert teknisi kita. Tapi ia menyapu kategori KETIGA:
 * pelanggan di area KITA yang belum didaftarkan admin. Mereka tak punya `device_id`, jadi
 * redamannya TAK PERNAH diperiksa dan tak pernah bisa memicu alarm. TERUKUR di produksi
 * 2026-08-28: Dander 3 modem asing berredaman buruk — 2 milik kita (kastur-rt11 -28,00 ·
 * mas-bakir -26,02), 1 memang bot sebelah; Tanjungharjo keempatnya bot sebelah.
 */
"use strict";

const { bangunPetaAreaSendiri, bangunPetaDevicePelanggan } = require("../redaman-alert-scope");

function device(id, pppoe) {
    const d = { _id: id };
    if (pppoe !== undefined) {
        d.InternetGatewayDevice = { WANDevice: { 1: { WANConnectionDevice: { 1: { WANPPPConnection: { 1: { Username: { _value: pppoe } } } } } } } };
    }
    return d;
}

const TERDAFTAR = device("ACS-BUDI", "budi@rafnet");
const KITA_TAK_TERDAFTAR = device("ACS-KASTUR", "kastur-rt11@rafnet");
const BOT_SEBELAH = device("ACS-LAIN", "orang-tanjung@rafnet");
const TANPA_PPPOE = device("ACS-KOSONG");

const USERS = [{ id: 7, name: "Budi", pppoe_username: "budi@rafnet", device_id: "ACS-BUDI" }];
const SESI_KITA = ["budi@rafnet", "kastur-rt11@rafnet"];   // router KITA; tak memegang sesi Tanjung

describe("#b288 — modem area sendiri yang belum didaftarkan", () => {
    const peta = bangunPetaDevicePelanggan(USERS);

    test("modem BELUM TERDAFTAR yang punya sesi di router kita → ikut dipantau", () => {
        const r = bangunPetaAreaSendiri([TERDAFTAR, KITA_TAK_TERDAFTAR, BOT_SEBELAH], SESI_KITA, peta);
        expect(r.has("ACS-KASTUR")).toBe(true);
        expect(r.get("ACS-KASTUR").pppoe_username).toBe("kastur-rt11@rafnet");
        expect(r.get("ACS-KASTUR")._belumTerdaftar).toBe(true);
    });

    test("!! modem BOT SEBELAH tetap DITOLAK — inilah yang dijaga saringan lama", () => {
        // Kalau ini rusak, teknisi kita dikirimi modem bot lain lagi (cacat #b249 kembali).
        const r = bangunPetaAreaSendiri([BOT_SEBELAH], SESI_KITA, peta);
        expect(r.has("ACS-LAIN")).toBe(false);
        expect(r.size).toBe(0);
    });

    test("pelanggan yang SUDAH terdaftar tidak diduplikasi", () => {
        const r = bangunPetaAreaSendiri([TERDAFTAR], SESI_KITA, peta);
        expect(r.has("ACS-BUDI")).toBe(false);
    });

    test("modem tanpa username PPPoE dilewati (tak ada dasar mengakui)", () => {
        const r = bangunPetaAreaSendiri([TANPA_PPPOE], SESI_KITA, peta);
        expect(r.size).toBe(0);
    });

    test("!! MikroTik bisu → peta KOSONG, perilaku lama persis (fail-closed)", () => {
        // Sifat fail-closed-nya sebenarnya ditegakkan oleh pemeriksaan keanggotaan
        // `aktif.has(...)` — dikunci tes "modem BOT SEBELAH tetap DITOLAK". `return` awal saat
        // daftar kosong hanya pemangkas beban (163 device di ACS), dan mencabutnya TIDAK
        // mengubah hasil; uji mutasi membuktikannya. Tes ini mengunci HASILnya, bukan jalannya.
        expect(bangunPetaAreaSendiri([KITA_TAK_TERDAFTAR], [], peta).size).toBe(0);
        expect(bangunPetaAreaSendiri([KITA_TAK_TERDAFTAR], null, peta).size).toBe(0);
        expect(bangunPetaAreaSendiri([KITA_TAK_TERDAFTAR], new Set(), peta).size).toBe(0);
    });

    test("pencocokan nama PPPoE tidak peka huruf besar/kecil & spasi", () => {
        const d = device("ACS-X", "  Kastur-RT11@RafNet  ");
        const r = bangunPetaAreaSendiri([d], ["kastur-rt11@rafnet"], peta);
        expect(r.has("ACS-X")).toBe(true);
    });

    test("pelanggan sintetis punya nama & pppoe, TANPA nomor HP", () => {
        // Alert redaman dikirim ke TEKNISI, bukan pelanggan; penyusun pesan punya fallback aman.
        const p = bangunPetaAreaSendiri([KITA_TAK_TERDAFTAR], SESI_KITA, peta).get("ACS-KASTUR");
        expect(p.name).toBe("kastur-rt11@rafnet");
        expect(p.phone_number).toBeUndefined();
        expect(p.device_id).toBe("ACS-KASTUR");
    });

    test("masukan cacat tidak melempar", () => {
        expect(() => bangunPetaAreaSendiri(null, SESI_KITA, peta)).not.toThrow();
        expect(bangunPetaAreaSendiri(null, SESI_KITA, peta).size).toBe(0);
        expect(() => bangunPetaAreaSendiri([null, undefined, {}], SESI_KITA, peta)).not.toThrow();
    });

    test("menerima Set maupun Array untuk daftar sesi", () => {
        const set = new Set(["kastur-rt11@rafnet"]);
        expect(bangunPetaAreaSendiri([KITA_TAK_TERDAFTAR], set, peta).size).toBe(1);
    });
});

describe("#b288 — wiring cron", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "cron", "jobs", "redaman-check.js"), "utf8");

    test("cron memakai fungsinya & meminta jalur PPPoE di query yang sama", () => {
        expect(src).toContain("bangunPetaAreaSendiri");
        expect(src).toContain("...PPP_PATHS");
    });

    test("!! panggilan MikroTik NON-FATAL — alarm yang sudah bekerja tak boleh ikut rusak", () => {
        const i = src.indexOf("getActivePPPoEUsers({ caller: 'cron.redaman.areaSendiri' })");
        expect(i).toBeGreaterThan(-1);
        const sekitar = src.slice(Math.max(0, i - 260), i + 320);
        expect(sekitar).toMatch(/try\s*\{/);
        expect(sekitar).toMatch(/catch/);
    });

    test("!! pesan alarm MENANDAI yang belum didaftarkan (tanpa slot template baru)", () => {
        // Tanpa penanda, teknisi melihat nama PPPoE dengan alamat & nomor kosong lalu
        // mengira datanya rusak. Slot BARU dihindari: template produksi yang belum
        // diperbarui akan mengirim penanda mentah ke teknisi.
        expect(src).toContain("_belumTerdaftar");
        expect(src).toContain("(BELUM DIDAFTARKAN)");
        const i2 = src.indexOf("_belumTerdaftar");
        expect(src.slice(i2 - 400, i2)).toContain("nama_pelanggan");
    });

    test("perluasan hanya berlaku saat hanyaPelangganSendiri menyala", () => {
        // PEMAKAIAN-nya, bukan baris import di atas berkas — indexOf polos menemukan import.
        const i = src.indexOf("bangunPetaAreaSendiri(allDevices");
        const sebelum = src.slice(Math.max(0, i - 900), i);
        expect(sebelum).toContain("setelanLingkup.hanyaPelangganSendiri");
    });
});
