/**
 * Header Doc
 * Purpose: Mengunci bahwa jeda antar-alert redaman BERTAHAN melewati restart proses —
 *          inti perbaikannya, karena versi lamanya `Map` in-memory.
 * Caller: Jest test runner.
 * Deps: `lib/redaman-alert-cooldown-store.js`, `fs`, `os`, `path`.
 * MainFuncs: —
 * SideEffects: Menulis file sementara di direktori temp OS, dibersihkan tiap test.
 *
 * KENAPA: cron redaman berjadwal `0 * * * *` (tiap jam) dan PM2 mencatat 27 restart pada
 * kedua bot produksi. Dengan Map in-memory, tiap restart mengosongkan jeda 12 jam, jadi
 * modem kronis buruk bisa mengalert lagi pada siklus jam berikutnya.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const store = require("../redaman-alert-cooldown-store");

const SEKARANG = Date.UTC(2026, 7, 16, 5, 0, 0);
const JAM = 3600000;
const COOLDOWN = 12 * JAM;

let berkas;
beforeEach(() => {
    berkas = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "redaman-cd-")), "cooldown.json");
});
afterEach(() => {
    try { fs.rmSync(path.dirname(berkas), { recursive: true, force: true }); } catch (_e) { /* abaikan */ }
});

describe("bertahan melewati restart", () => {
    test("catatan yang ditulis terbaca kembali oleh proses baru", () => {
        const peta = store.muat(berkas);
        store.tandaiTerkirim(peta, "DEV-1", SEKARANG);
        expect(store.simpan(peta, berkas)).toBe(true);

        // `muat` di sini mewakili proses yang baru start — tak ada state in-memory tersisa.
        const sesudahRestart = store.muat(berkas);
        expect(store.masihDalamCooldown(sesudahRestart, "DEV-1", COOLDOWN, SEKARANG + 1 * JAM)).toBe(true);
    });

    test("jeda benar-benar habis sesudah masanya lewat", () => {
        const peta = {};
        store.tandaiTerkirim(peta, "DEV-1", SEKARANG);
        store.simpan(peta, berkas);
        const baru = store.muat(berkas);
        expect(store.masihDalamCooldown(baru, "DEV-1", COOLDOWN, SEKARANG + 11.9 * JAM)).toBe(true);
        expect(store.masihDalamCooldown(baru, "DEV-1", COOLDOWN, SEKARANG + 12 * JAM)).toBe(false);
    });

    test("device yang belum pernah dialert selalu boleh", () => {
        expect(store.masihDalamCooldown({}, "BARU", COOLDOWN, SEKARANG)).toBe(false);
    });

    test("cooldown 0 = tanpa jeda", () => {
        const peta = { "DEV-1": SEKARANG };
        expect(store.masihDalamCooldown(peta, "DEV-1", 0, SEKARANG)).toBe(false);
    });
});

describe("tak boleh menjatuhkan cron", () => {
    test("file rusak → mulai kosong, tidak melempar", () => {
        fs.writeFileSync(berkas, "{ini bukan json");
        expect(store.muat(berkas)).toEqual({});
    });

    test("isi bukan objek (array) diabaikan", () => {
        fs.writeFileSync(berkas, JSON.stringify(["a", "b"]));
        expect(store.muat(berkas)).toEqual({});
    });

    test("entri dengan timestamp sampah dibuang saat dibaca", () => {
        fs.writeFileSync(berkas, JSON.stringify({ OK: SEKARANG, RUSAK: "kemarin", NOL: 0 }));
        const peta = store.muat(berkas);
        expect(Object.keys(peta)).toEqual(["OK"]);
    });

    test("file belum ada → kosong, bukan error", () => {
        expect(store.muat(path.join(path.dirname(berkas), "belum-ada.json"))).toEqual({});
    });
});

describe("penulisan atomik & perawatan", () => {
    test("tak meninggalkan file .tmp", () => {
        store.simpan({ "DEV-1": SEKARANG }, berkas);
        expect(fs.existsSync(`${berkas}.tmp`)).toBe(false);
        expect(JSON.parse(fs.readFileSync(berkas, "utf8"))).toEqual({ "DEV-1": SEKARANG });
    });

    test("prune membuang catatan yang jauh kedaluwarsa", () => {
        const peta = { LAMA: SEKARANG - 40 * 24 * JAM, BARU: SEKARANG - JAM };
        expect(Object.keys(store.prune(peta, 30 * 24 * JAM, SEKARANG))).toEqual(["BARU"]);
    });

    test("prune memotong pada batas dan menyisakan yang paling baru", () => {
        const peta = {};
        for (let i = 0; i < store.MAKS_ENTRI + 10; i++) peta[`D${i}`] = SEKARANG - i * 1000;
        const hasil = store.prune(peta, 30 * 24 * JAM, SEKARANG);
        expect(Object.keys(hasil)).toHaveLength(store.MAKS_ENTRI);
        expect(hasil.D0).toBeDefined();                       // paling baru bertahan
        expect(hasil[`D${store.MAKS_ENTRI + 9}`]).toBeUndefined(); // paling tua terbuang
    });
});

describe("cron memakai store durabel ini, bukan Map in-memory", () => {
    test("redaman-check.js tak lagi memegang Map cooldown", () => {
        const src = fs.readFileSync(path.join(__dirname, "..", "cron", "jobs", "redaman-check.js"), "utf8");
        expect(src).toMatch(/redaman-alert-cooldown-store/);
        expect(src).not.toMatch(/lastAlertSentByDeviceId/);
        expect(src).not.toMatch(/new Map\(\)/);
    });
});
