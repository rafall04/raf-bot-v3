/**
 * Header Doc
 * Purpose: Mengunci dua gerbang alert redaman — modem HARUS milik pelanggan bot ini, dan
 *          nilainya HARUS masih layak dipercaya umurnya sebelum dipakai memvonis.
 * Caller: Jest test runner.
 * Deps: `lib/redaman-alert-scope.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada (semua masukan lewat argumen, tanpa global).
 *
 * ANGKA DI SINI DIAMBIL DARI PENGUKURAN PRODUKSI 2026-08-16 (ACS 172.17.11.2:7557):
 *   · 160 modem di ACS; Dander memiliki 58, Tanjungharjo 96 — ACS-nya dipakai berdua.
 *   · 4 modem di bawah toleransi -26 dBm; pada MASING-MASING bot hanya 1 miliknya sendiri.
 *   · Sesudah refresh, umur nilai median 0,8 mnt / p90 1,3 mnt — kecuali 3 modem mati yang
 *     nilainya berumur ~40 hari dan tak pernah ikut diperbarui.
 */
"use strict";

const {
    ALASAN,
    bacaSetelanLingkup,
    bangunPetaDevicePelanggan,
    bacaNilaiRedaman,
    evaluasiDevice,
} = require("../redaman-alert-scope");

const SEKARANG = Date.UTC(2026, 7, 16, 5, 0, 0);
const menitLalu = (n) => new Date(SEKARANG - n * 60000).toISOString();

/** Bentuk record apa adanya dari `queryDevices` GenieACS. */
const buatDevice = (id, nilai, umurMenit) => ({
    _id: id,
    VirtualParameters: {
        RXPower: { _value: nilai, _timestamp: menitLalu(umurMenit) },
    },
});

// Empat modem buruk yang NYATA terbaca di ACS produksi.
const DEV_MILIK_SENDIRI = buatDevice("G8145V5-48575443E2AAF2AC", -33, 1);
const DEV_BOT_LAIN = buatDevice("G8145V5-4857544349ABC7AD", -28, 1);

const USERS = [{ id: 7, name: "Budi", device_id: "G8145V5-48575443E2AAF2AC" }];
const peta = () => bangunPetaDevicePelanggan(USERS);

const dasar = (timpaan = {}) => ({
    petaPelanggan: peta(),
    paths: ["VirtualParameters.RXPower", "VirtualParameters.redaman"],
    rxTolerance: -26,
    maksUmurMs: 15 * 60000,
    hanyaPelangganSendiri: true,
    sekarang: SEKARANG,
    ...timpaan,
});

describe("gerbang kepemilikan — ACS dipakai dua bot", () => {
    test("modem pelanggan sendiri tetap dialert", () => {
        const p = evaluasiDevice(DEV_MILIK_SENDIRI, dasar());
        expect(p.alasan).toBe(ALASAN.ALERT);
        expect(p.pelanggan.name).toBe("Budi");
        expect(p.angka).toBe(-33);
    });

    test("modem bot lain TIDAK dialert walau redamannya buruk", () => {
        // Inilah yang dulu terkirim ke teknisi sebagai "(Tidak Terdaftar)" di semua kolom.
        const p = evaluasiDevice(DEV_BOT_LAIN, dasar());
        expect(p.alasan).toBe(ALASAN.BUKAN_PELANGGAN);
    });

    test("gerbang bisa dimatikan pemilik — perilaku lama kembali", () => {
        const p = evaluasiDevice(DEV_BOT_LAIN, dasar({ hanyaPelangganSendiri: false }));
        expect(p.alasan).toBe(ALASAN.ALERT);
        expect(p.pelanggan).toBeNull();
    });

    test("device_id ganda dipisah '|' tetap terpetakan", () => {
        const m = bangunPetaDevicePelanggan([{ name: "Sari", device_id: "AAA|BBB" }]);
        expect(m.get("AAA").name).toBe("Sari");
        expect(m.get("BBB").name).toBe("Sari");
    });

    test("pelanggan tanpa device_id tak merusak peta", () => {
        const m = bangunPetaDevicePelanggan([{ name: "X" }, null, { name: "Y", device_id: "" }]);
        expect(m.size).toBe(0);
    });
});

describe("gerbang kesegaran — 'tak bisa dilihat' bukan 'terlihat buruk'", () => {
    test("nilai segar di bawah toleransi → alert", () => {
        const p = evaluasiDevice(buatDevice(USERS[0].device_id, -30, 1.3), dasar());
        expect(p.alasan).toBe(ALASAN.ALERT);
    });

    test("nilai 40 HARI (modem mati, tak ikut refresh) TIDAK memicu alert", () => {
        // Kasus nyata: 3 modem di ACS tak pernah diperbarui, umur nilai ~58.700 menit.
        const p = evaluasiDevice(buatDevice(USERS[0].device_id, -30, 58700), dasar());
        expect(p.alasan).toBe(ALASAN.NILAI_BASI);
        expect(p.angka).toBe(-30); // angkanya tetap dilaporkan supaya bisa dihitung/dicatat
    });

    test("tanpa _timestamp = umur tak diketahui → fail-closed, bukan alert", () => {
        const dev = { _id: USERS[0].device_id, VirtualParameters: { RXPower: { _value: -30 } } };
        expect(evaluasiDevice(dev, dasar()).alasan).toBe(ALASAN.NILAI_BASI);
    });

    test("ambang tepat di batas 15 menit masih diterima", () => {
        expect(evaluasiDevice(buatDevice(USERS[0].device_id, -30, 15), dasar()).alasan).toBe(ALASAN.ALERT);
        expect(evaluasiDevice(buatDevice(USERS[0].device_id, -30, 15.1), dasar()).alasan).toBe(ALASAN.NILAI_BASI);
    });

    test("maksUmurMs=0 mematikan gerbang (perilaku lama)", () => {
        const p = evaluasiDevice(buatDevice(USERS[0].device_id, -30, 58700), dasar({ maksUmurMs: 0 }));
        expect(p.alasan).toBe(ALASAN.ALERT);
    });

    test("modem SEHAT tapi nilainya basi tidak dilaporkan sebagai basi", () => {
        // Gerbang kesegaran hanya relevan saat hendak memvonis buruk.
        const p = evaluasiDevice(buatDevice(USERS[0].device_id, -20, 58700), dasar());
        expect(p.alasan).toBe(ALASAN.SEHAT);
    });
});

describe("pembacaan nilai", () => {
    test("string ber-satuan tetap terbaca", () => {
        const dev = { _id: "x", VirtualParameters: { RXPower: { _value: "-26.02 dBm", _timestamp: menitLalu(1) } } };
        expect(bacaNilaiRedaman(dev, ["VirtualParameters.RXPower"]).angka).toBeCloseTo(-26.02);
    });

    test("jatuh ke path cadangan bila path pertama kosong", () => {
        const dev = { _id: "x", VirtualParameters: { redaman: { _value: -21, _timestamp: menitLalu(1) } } };
        const r = bacaNilaiRedaman(dev, ["VirtualParameters.RXPower", "VirtualParameters.redaman"]);
        expect(r.angka).toBe(-21);
        expect(r.jalur).toBe("VirtualParameters.redaman");
    });

    test("nilai tak terbaca angka dilewati, bukan dianggap 0", () => {
        // 0 dBm akan lolos toleransi dan menyembunyikan modem bermasalah.
        const dev = { _id: "x", VirtualParameters: { RXPower: { _value: "N/A", _timestamp: menitLalu(1) } } };
        expect(bacaNilaiRedaman(dev, ["VirtualParameters.RXPower"])).toBeNull();
        expect(evaluasiDevice(dev, dasar({ petaPelanggan: bangunPetaDevicePelanggan([{ device_id: "x" }]) })).alasan)
            .toBe(ALASAN.TANPA_NILAI);
    });
});

describe("menyaring tak boleh membuat modem hilang diam-diam", () => {
    // Menyaring per kepemilikan menciptakan jalur gagal BARU: kalau device_id seorang
    // pelanggan basi (ganti modem, record tak diperbarui), modemnya berhenti terpantau.
    // Sebelum ada saringan ia setidaknya masih muncul (sebagai "(Tidak Terdaftar)").
    // Karena itu cron WAJIB tetap menghitung & mencetak modem asing yang redamannya buruk.
    test("cron menghitung modem asing berredaman buruk dan mencetaknya", () => {
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "..", "cron", "jobs", "redaman-check.js"), "utf8");
        expect(src).toMatch(/asingRedamanBuruk/);
        expect(src).toMatch(/CRON_REDAMAN_CAKUPAN/);
        // Remah-remah itu harus ikut tercetak, bukan cuma dihitung lalu dibuang.
        expect(src).toMatch(/asingBurukNote/);
    });

    test("remah-remah TIDAK menambah panggilan ke ACS (nilai ikut di kueri daftar)", () => {
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.join(__dirname, "..", "cron", "jobs", "redaman-check.js"), "utf8");
        // Kueri langkah 1 harus sudah membawa REDAMAN_PATHS; kalau kembali ke projection
        // '_id' saja, penghitungan asing diam-diam jadi selalu 0.
        expect(src).toMatch(/projection:\s*\['_id',\s*\.\.\.REDAMAN_PATHS\]/);
        expect(src).not.toMatch(/projection:\s*\['_id'\],/);
    });
});

describe("setelan", () => {
    test("bawaan: kepemilikan HIDUP, kesegaran 15 mnt, cooldown 12 jam", () => {
        const s = bacaSetelanLingkup({});
        expect(s.hanyaPelangganSendiri).toBe(true);
        expect(s.maksUmurMs).toBe(15 * 60000);
        expect(s.cooldownMs).toBe(12 * 3600000);
    });

    test("key lama `redaman_alert_cooldown_hours` tetap dihormati", () => {
        expect(bacaSetelanLingkup({ redaman_alert_cooldown_hours: 6 }).cooldownMs).toBe(6 * 3600000);
    });

    test("setelan baru mengalahkan key lama", () => {
        const s = bacaSetelanLingkup({ redaman_alert_cooldown_hours: 6, redamanAlert: { cooldownHours: 2 } });
        expect(s.cooldownMs).toBe(2 * 3600000);
    });

    test("nilai tak masuk akal jatuh ke bawaan, bukan NaN", () => {
        const s = bacaSetelanLingkup({ redamanAlert: { maxDataAgeMinutes: "", cooldownHours: "abc" } });
        expect(s.maksUmurMs).toBe(15 * 60000);
        expect(s.cooldownMs).toBe(12 * 3600000);
    });

    test("pemilik bisa mematikan kedua gerbang lewat konfigurasi", () => {
        const s = bacaSetelanLingkup({ redamanAlert: { hanyaPelangganSendiri: false, maxDataAgeMinutes: 0 } });
        expect(s.hanyaPelangganSendiri).toBe(false);
        expect(s.maksUmurMs).toBe(0);
    });
});
