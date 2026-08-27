/**
 * Header Doc
 * Purpose: Mengunci `buildOnuIndex` agar catatan ONU yang BASI tidak mengalahkan yang HIDUP
 *          (#b285). Kalau ini rusak, pelanggan sehat dipulangkan sebagai Offline/LOS tanpa
 *          redaman ke SEMUA pemakai indeks.
 * Caller: Jest
 * Deps: ../olt-optical-resolver (murni untuk fungsi ini).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA: satu modem bisa punya DUA catatan di OLT — yang hidup di PON sekarang, dan
 * catatan basi dari PON/OLT lamanya yang tak pernah dihapus setelah modem dipindah. Indeks
 * lama memakai `=` polos, jadi pemenangnya cuma soal urutan array. TERUKUR di produksi
 * Dander: 5 pelanggan, catatan basi menang **5 dari 5**, dan EMPAT catatan basinya bertanda
 * LOS. Pelanggan nyata yang terdampak: rx -13,64 s/d -21,55 dBm — semuanya sehat.
 */
"use strict";

const { buildOnuIndex } = require("../olt-optical-resolver");

// MAC di OLT berbeda 2 digit TERAKHIR dari MAC MikroTik, jadi indeks memakai 10 heksa pertama.
const PREFIX = "AABBCC1100";
const HIDUP = { macAddress: "AA:BB:CC:11:00:20", status: "Online", rxPower: -15.36, olt_name: "OLT Server" };
const BASI_LOS = { macAddress: "AA:BB:CC:11:00:21", status: "LOS", rxPower: null, olt_name: "OLT Icak" };
const BASI_OFF = { macAddress: "AA:BB:CC:11:00:22", status: "Offline", rxPower: null, olt_name: "OLT Icak" };

describe("#b285 — catatan ONU basi tidak boleh mengalahkan yang hidup", () => {
    test("!! hasilnya TIDAK bergantung urutan array", () => {
        // Inilah bug aslinya: `=` polos membuat elemen terakhir menang.
        expect(buildOnuIndex([HIDUP, BASI_LOS]).oltByMac[PREFIX].status).toBe("Online");
        expect(buildOnuIndex([BASI_LOS, HIDUP]).oltByMac[PREFIX].status).toBe("Online");
    });

    test("Online menang atas LOS maupun Offline, berapa pun jumlah catatan basinya", () => {
        const idx = buildOnuIndex([BASI_OFF, BASI_LOS, HIDUP, BASI_OFF]);
        expect(idx.oltByMac[PREFIX].status).toBe("Online");
        expect(idx.oltByMac[PREFIX].rxPower).toBe(-15.36);
    });

    test("redaman yang ikut terbawa adalah milik catatan HIDUP, bukan null", () => {
        // Yang paling merugikan bukan labelnya, tapi rxPower kosong: cron alert redaman
        // jadi buta untuk pelanggan ini tanpa satu pun pesan galat.
        expect(buildOnuIndex([HIDUP, BASI_LOS]).oltByMac[PREFIX].rxPower).toBe(-15.36);
    });

    test("!! catatan basi yang MASIH memamerkan dBm lama tetap kalah dari yang Online", () => {
        // Ini kasus nyatanya: OLT TIDAK mengosongkan redaman saat ONU mati — angka lama
        // tetap dipamerkan (terukur di OLT Icak: 5 ONU `Down` masih menampilkan -13,44 dst).
        // Tanpa kasus ini, aturan STATUS bisa dirusak tanpa satu tes pun merah karena
        // pemeriksa redaman kebetulan menutupinya (terbukti lewat uji mutasi).
        const basiTapiPunyaRx = { macAddress: "AA:BB:CC:11:00:21", status: "LOS", rxPower: -13.44, olt_name: "OLT Icak" };
        expect(buildOnuIndex([HIDUP, basiTapiPunyaRx]).oltByMac[PREFIX].status).toBe("Online");
        expect(buildOnuIndex([basiTapiPunyaRx, HIDUP]).oltByMac[PREFIX].status).toBe("Online");
        expect(buildOnuIndex([basiTapiPunyaRx, HIDUP]).oltByMac[PREFIX].rxPower).toBe(-15.36);
    });

    test("sama-sama mati → yang punya angka redaman dipilih (lebih berguna)", () => {
        const a = { macAddress: "AA:BB:CC:22:00:01", status: "Offline", rxPower: null };
        const b = { macAddress: "AA:BB:CC:22:00:02", status: "Offline", rxPower: -27.4 };
        expect(buildOnuIndex([a, b]).oltByMac["AABBCC2200"].rxPower).toBe(-27.4);
        expect(buildOnuIndex([b, a]).oltByMac["AABBCC2200"].rxPower).toBe(-27.4);
    });

    test("benar-benar setara → deterministik (yang pertama), bukan acak", () => {
        const a = { macAddress: "AA:BB:CC:33:00:01", status: "Offline", rxPower: null, olt_name: "A" };
        const b = { macAddress: "AA:BB:CC:33:00:02", status: "Offline", rxPower: null, olt_name: "B" };
        expect(buildOnuIndex([a, b]).oltByMac["AABBCC3300"].olt_name).toBe("A");
        expect(buildOnuIndex([a, b]).oltByMac["AABBCC3300"].olt_name).toBe("A");
    });

    test("aturan yang sama berlaku untuk indeks PPPoE & serial", () => {
        const hidup = { macAddress: "11:22:33:44:55:66", description: "budi@rafnet", serial: "SN1", status: "Online", rxPower: -18 };
        const basi = { macAddress: "99:88:77:66:55:44", description: "budi@rafnet", serial: "SN1", status: "LOS", rxPower: null };
        const idx = buildOnuIndex([hidup, basi]);
        expect(idx.oltByPppoe["budi@rafnet"].status).toBe("Online");
        expect(idx.oltBySerial["sn1"].status).toBe("Online");
    });

    test("satu catatan saja tetap masuk apa adanya (tidak ada regresi)", () => {
        const idx = buildOnuIndex([BASI_LOS]);
        expect(idx.oltByMac[PREFIX].status).toBe("LOS");
        expect(buildOnuIndex([]).oltByMac).toEqual({});
        expect(buildOnuIndex(null).oltByMac).toEqual({});
    });

    test("MAC lebih pendek dari 10 heksa diabaikan, tidak melempar", () => {
        expect(() => buildOnuIndex([{ macAddress: "AA:BB", status: "Online" }])).not.toThrow();
        expect(buildOnuIndex([{ macAddress: "AA:BB", status: "Online" }]).oltByMac).toEqual({});
    });
});
