/**
 * Header Doc
 * Purpose: Mengunci `probeDeviceReachable` (#b261) — bukti POSITIF bahwa modem hidup adalah
 *          connection request yang DIJAWAB (HTTP 200), bukan umur inform. 202 = tidak menjawab.
 *          Gagal/ACS error = `null` (belum tahu), TIDAK BOLEH dibaca sebagai mati.
 * Caller: Jest test runner.
 * Deps: `lib/genieacs` (dengan HTTP-nya dimock lewat axios).
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("axios");
const axios = require("axios");
const { probeDeviceReachable } = require("../genieacs");

const DEV = "00259E-HG8145V5-48575443BC7395B0";

beforeEach(() => {
    jest.resetAllMocks();
    global.config = { genieacsBaseUrl: "http://acs.test:7557", genieacsEnabled: true };
});

const balas = (status) => {
    axios.mockResolvedValue({ status, data: { _id: "task_1" }, headers: {} });
    if (axios.request) axios.request.mockResolvedValue({ status, data: { _id: "task_1" }, headers: {} });
};

describe("#b261 — bukti terjangkau berasal dari jawaban, bukan umur inform", () => {
    test("device_id palsu (mock) → null, jangan menebak", async () => {
        const r = await probeDeviceReachable("DEVICE-93");
        expect(r.reachable).toBeNull();
    });

    test("device_id kosong → null", async () => {
        expect((await probeDeviceReachable("")).reachable).toBeNull();
        expect((await probeDeviceReachable(null)).reachable).toBeNull();
    });

    test("tidak pernah melempar, apa pun yang terjadi di bawahnya", async () => {
        axios.mockRejectedValue(new Error("ACS mati"));
        if (axios.request) axios.request.mockRejectedValue(new Error("ACS mati"));
        const r = await probeDeviceReachable(DEV);
        expect(r).toHaveProperty("reachable");
        expect(r).toHaveProperty("reason");
    });

    test("!! ACS error → null (BELUM TAHU), bukan false", async () => {
        // Aturan rumah: "cannot observe" != "observed bad". Memulangkan false di sini akan
        // membuat pemanggil memberi tahu pelanggan bahwa modemnya mati, padahal yang buta
        // justru kita.
        axios.mockRejectedValue(new Error("timeout"));
        if (axios.request) axios.request.mockRejectedValue(new Error("timeout"));
        const r = await probeDeviceReachable(DEV);
        expect(r.reachable).not.toBe(false);
    });

    test("selalu memulangkan alasan yang bisa dibaca manusia", async () => {
        const r = await probeDeviceReachable("DEVICE-1");
        expect(typeof r.reason).toBe("string");
        expect(r.reason.length).toBeGreaterThan(3);
    });
});

describe("#b261 — probe wajib bersih setelah dirinya sendiri", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "genieacs.js"), "utf8");

    test("status 202 memicu penghapusan tugas yang terlanjur mengantre", () => {
        // 202 = tugas MASUK ANTREAN, dan tugas untuk modem yang tak menjawab tak pernah
        // dieksekusi — ia mengendap selamanya (#b260: 3.797 tugas dari satu modem pensiun).
        // Terbukti perlu: uji pertama probe ini meninggalkan 1 tugas di modem mati.
        const blok = src.slice(src.indexOf("async function probeDeviceReachable"));
        const potong = blok.slice(0, blok.indexOf("async function refreshObjects"));
        expect(potong).toMatch(/httpStatus === 202/);
        expect(potong).toMatch(/genieacsRequest\('delete', `\/tasks\//);
    });

    test("gagal bersih-bersih tidak boleh menjatuhkan vonis", () => {
        const blok = src.slice(src.indexOf("async function probeDeviceReachable"));
        const potong = blok.slice(0, blok.indexOf("async function refreshObjects"));
        // DELETE dibungkus try/catch tersendiri, dan `reachable:false` tetap dipulangkan.
        expect(potong).toMatch(/catch \(_e\) \{ \/\* gagal bersih-bersih/);
        expect(potong).toMatch(/return \{ reachable: false, httpStatus, ms, reason:/);
    });
});
