/**
 * Header Doc
 * Purpose: Mengunci jaminan KEJUJURAN DATA pembacaan OLT — tiga cara data OLT pernah berbohong tanpa
 *          gejala, dan ketiganya menyesatkan teknisi ke arah yang sama (mengira pelanggan sehat):
 *          (a) redaman ONU yang sudah mati tetap terbaca sebagai pengukuran saat ini,
 *          (b) walk SNMP setengah jadi disajikan seolah utuh,
 *          (c) SEMUA OLT gagal dibaca dilaporkan `success` berisi nol ONU — di hilir terbaca
 *              "semua pelanggan offline", yaitu kegagalan alat baca yang menyamar jadi vonis.
 * Caller: Jest.
 * Deps: `lib/olt-optical-resolver` (isRxPowerValid), `lib/olt-hioso` (getMultipleOltData) dengan
 *       driver di-stub lewat mock `lib/olt-drivers` — tanpa SNMP.
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("../olt-drivers", () => ({ resolveDriver: jest.fn() }));

const { resolveDriver } = require("../olt-drivers");
const { isRxPowerValid } = require("../olt-optical-resolver");
const { getMultipleOltData } = require("../olt-hioso");

function device(id, name) {
    return { id, name, host: `10.0.0.${id}` };
}

function driverReturning(byHost) {
    return {
        getOltData: jest.fn(async (config) => byHost[config.host]),
    };
}

describe("isRxPowerValid — redaman hanya sah saat ONU benar-benar Online", () => {
    test("ONU Online dengan angka wajar → sah", () => {
        expect(isRxPowerValid({ rxPower: "-21.50", statusKnown: true }, "Online")).toBe(true);
    });

    // INI BUG YANG DIALAMI SAAT KABEL PUTUS: OLT EPON tidak mengosongkan rxPower saat ONU mati,
    // jadi pelanggan LOS memegang angka terakhirnya dan tampil "sinyal bagus".
    test("ONU LOS/Offline/Dying Gasp dengan angka tersisa → TIDAK sah", () => {
        const onu = { rxPower: "-19.20", statusKnown: true };
        expect(isRxPowerValid(onu, "LOS")).toBe(false);
        expect(isRxPowerValid(onu, "Offline")).toBe(false);
        expect(isRxPowerValid(onu, "Dying Gasp")).toBe(false);
    });

    test("status tidak terbaca (walk phaseState kosong) → TIDAK sah walau angkanya ada", () => {
        expect(isRxPowerValid({ rxPower: "-21.50", statusKnown: false }, "Online")).toBe(false);
    });

    test("merk yang tak mengirim statusKnown tetap dianggap terbaca (hanya false eksplisit yang menggugurkan)", () => {
        expect(isRxPowerValid({ rxPower: "-21.50" }, "Online")).toBe(true);
    });

    test("angka bukan bilangan / ONU kosong → TIDAK sah", () => {
        expect(isRxPowerValid({ rxPower: "N/A", statusKnown: true }, "Online")).toBe(false);
        expect(isRxPowerValid(null, "Online")).toBe(false);
    });
});

describe("getMultipleOltData — kegagalan baca tidak menyamar jadi vonis", () => {
    beforeEach(() => jest.clearAllMocks());

    test("SEMUA OLT gagal → status error, BUKAN success berisi nol ONU", async () => {
        resolveDriver.mockReturnValue(driverReturning({
            "10.0.0.1": { status: "error", message: "timeout", onus: [] },
            "10.0.0.2": { status: "error", message: "timeout", onus: [] },
        }));

        const result = await getMultipleOltData([device(1, "OLT-A"), device(2, "OLT-B")]);

        expect(result.status).toBe("error");
        expect(result.onus).toEqual([]);
        expect(result.message).toContain("OLT-A");
    });

    test("sebagian OLT gagal → tetap success, ONU dari OLT yang hidup tetap terpakai", async () => {
        resolveDriver.mockReturnValue(driverReturning({
            "10.0.0.1": { status: "success", onus: [{ macAddress: "aa:bb", rxPower: "-20" }] },
            "10.0.0.2": { status: "error", message: "timeout", onus: [] },
        }));

        const result = await getMultipleOltData([device(1, "OLT-A"), device(2, "OLT-B")]);

        expect(result.status).toBe("success");
        expect(result.onus).toHaveLength(1);
        expect(result.fetchedAt).toEqual(expect.any(String));
    });

    test("walk tidak lengkap dilaporkan ke pemanggil, tidak ditelan", async () => {
        resolveDriver.mockReturnValue(driverReturning({
            "10.0.0.1": {
                status: "success",
                onus: [{ macAddress: "aa:bb", rxPower: "-20", statusKnown: false }],
                incompleteWalks: ["phaseState"],
            },
        }));

        const result = await getMultipleOltData([device(1, "OLT-A")]);

        expect(result.incompleteWalks).toEqual([
            { oltId: 1, oltName: "OLT-A", walks: ["phaseState"] },
        ]);
    });

    // "Tak ada OLT terkonfigurasi" memang sudah error sejak awal (perilaku lama, dipertahankan) —
    // yang penting pesannya beda dari "semua OLT gagal dibaca", karena penanganannya beda: yang
    // satu urusan konfigurasi, yang satu lagi urusan jaringan/OLT.
    test("tanpa device terkonfigurasi tetap error dengan pesan yang berbeda", async () => {
        const result = await getMultipleOltData([]);
        expect(result.status).toBe("error");
        expect(result.message).toBe("No OLT devices configured");
        expect(result.onus).toEqual([]);
    });
});
