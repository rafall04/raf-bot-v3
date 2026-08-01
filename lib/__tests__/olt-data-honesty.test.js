/**
 * Header Doc
 * Purpose: Mengunci jaminan KEJUJURAN DATA pembacaan OLT — tiga cara data OLT pernah berbohong tanpa
 *          gejala, dan ketiganya menyesatkan teknisi ke arah yang sama (mengira pelanggan sehat):
 *          (a) redaman ONU yang sudah mati tetap terbaca sebagai pengukuran saat ini,
 *          (b) walk SNMP setengah jadi disajikan seolah utuh,
 *          (c) SEMUA OLT gagal dibaca dilaporkan `success` berisi nol ONU — di hilir terbaca
 *              "semua pelanggan offline", yaitu kegagalan alat baca yang menyamar jadi vonis.
 *          (d) SEBAGIAN OLT gagal: snapshot tetap `success` (benar — data OLT hidup masih berguna)
 *              tapi dulu BISU soal cakupannya, jadi pelanggan di balik OLT yang bisu divonis
 *              "Offline". Snapshot kini wajib menyebut `failedOlts`, dan konsumen wajib memakainya.
 *          (e) penanda per-ONU `statusKnown` dibuang normalizer kontrak, mematikan semua penjaga
 *              di hilir tanpa gejala.
 * Caller: Jest.
 * Deps: `lib/olt-optical-resolver` (isRxPowerValid, isSnapshotReadableFor, createOpticalResolver),
 *       `lib/olt-hioso` (getMultipleOltData) dengan driver di-stub lewat mock `lib/olt-drivers`,
 *       `lib/olt-drivers/contract` (normalizeOnu) — tanpa SNMP.
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("../olt-drivers", () => ({ resolveDriver: jest.fn() }));

const { resolveDriver } = require("../olt-drivers");
const {
    isRxPowerValid,
    isSnapshotReadableFor,
    createOpticalResolver,
} = require("../olt-optical-resolver");
const { getMultipleOltData } = require("../olt-hioso");
const { normalizeOnu } = require("../olt-drivers/contract");

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

    // SEBAGIAN ≠ UTUH. Snapshot yang kehilangan satu OLT memang tetap `success` (tes di atas), TAPI
    // pemanggil TIDAK BISA menyimpulkan kebutaan itu dari `onus`: pelanggan di balik OLT bisu
    // tampak persis sama dengan pelanggan yang benar-benar hilang dari OLT sehat. Tanpa daftar ini
    // seluruh pelanggan OLT mati divonis "Offline" — insiden Dander 192.168.11.2 (53 dari 58).
    test("sebagian OLT gagal → snapshot WAJIB menyebut OLT mana yang tidak terbaca", async () => {
        resolveDriver.mockReturnValue(driverReturning({
            "10.0.0.1": { status: "success", onus: [{ macAddress: "aa:bb", rxPower: "-20" }] },
            "10.0.0.2": { status: "error", message: "timeout", onus: [] },
        }));

        const result = await getMultipleOltData([device(1, "OLT-A"), device(2, "OLT-B")]);

        expect(result.status).toBe("success");
        expect(result.failedOlts).toEqual([
            expect.objectContaining({ oltId: 2, oltName: "OLT-B", message: "timeout" }),
        ]);
    });

    test("semua OLT sehat → failedOlts kosong (bukan undefined)", async () => {
        resolveDriver.mockReturnValue(driverReturning({
            "10.0.0.1": { status: "success", onus: [{ macAddress: "aa:bb" }] },
        }));

        const result = await getMultipleOltData([device(1, "OLT-A")]);

        expect(result.failedOlts).toEqual([]);
    });
});

describe("isSnapshotReadableFor — absennya ONU cuma bermakna bila OLT-nya terbaca", () => {
    const snapshotOk = { status: "success", failedOlts: [] };
    const snapshotPartial = { status: "success", failedOlts: [{ oltId: 2, oltName: "OLT-B" }] };

    test("snapshot utuh → boleh dipakai menyimpulkan", () => {
        expect(isSnapshotReadableFor(snapshotOk, { oltId: 1 })).toBe(true);
        expect(isSnapshotReadableFor(snapshotOk, null)).toBe(true);
    });

    test("OLT pelanggan termasuk yang gagal → TIDAK boleh dipakai", () => {
        expect(isSnapshotReadableFor(snapshotPartial, { oltId: 2 })).toBe(false);
    });

    test("OLT pelanggan sehat walau ada OLT lain gagal → boleh dipakai", () => {
        expect(isSnapshotReadableFor(snapshotPartial, { oltId: 1 })).toBe(true);
    });

    // GAGAL TERTUTUP: kalau kita tak tahu pelanggan ini ada di OLT mana, kita tak bisa menyangkal
    // bahwa dia ada di OLT yang gagal itu.
    test("OLT pelanggan TIDAK diketahui + ada yang gagal → TIDAK boleh dipakai", () => {
        expect(isSnapshotReadableFor(snapshotPartial, null)).toBe(false);
        expect(isSnapshotReadableFor(snapshotPartial, { oltId: null })).toBe(false);
    });

    test("snapshot error / tak ada → TIDAK boleh dipakai", () => {
        expect(isSnapshotReadableFor({ status: "error", onus: [] }, { oltId: 1 })).toBe(false);
        expect(isSnapshotReadableFor(null, { oltId: 1 })).toBe(false);
    });
});

describe("resolveByCustomer — 'tak bisa mengamati' bukan 'mengamati yang mati'", () => {
    const MAC = "AA:BB:CC:DD:EE:FF";

    function resolverWith(overrides = {}) {
        return createOpticalResolver({
            loadCallerIdCache: () => ({}),
            getCachedInfo: () => null,
            getEventByMAC: () => null,
            normalizeForEvent: (m) => m,
            normalizeMAC: (m) => String(m || "").replace(/[:\-\s]/g, "").toUpperCase(),
            getMacForUser: () => ({ mac: MAC, source: "cached" }),
            getOltFromMac: () => ({ oltId: 2, oltName: "OLT-B", oltHost: "10.0.0.2" }),
            ...overrides,
        });
    }

    const user = { pppoe_username: "budi@isp" };

    test("OLT pelanggan tidak terbaca → status 'Tidak terbaca', BUKAN 'Offline'", () => {
        const { resolveByCustomer } = resolverWith();
        const r = resolveByCustomer(user, {
            oltSnapshot: { status: "success", onus: [], failedOlts: [{ oltId: 2, oltName: "OLT-B" }] },
        });

        expect(r.status).toBe("Tidak terbaca");
        expect(r.statusKnown).toBe(false);
        expect(r.isLos).toBe(false);
        expect(r.isDyingGasp).toBe(false);
    });

    test("OLT terbaca & ONU memang tak ada → tetap 'Offline' (vonis yang sah)", () => {
        const { resolveByCustomer } = resolverWith();
        const r = resolveByCustomer(user, {
            oltSnapshot: { status: "success", onus: [], failedOlts: [] },
        });

        expect(r.status).toBe("Offline");
        expect(r.statusKnown).toBe(true);
    });

    // Syslog adalah bukti MANDIRI — tak lewat SNMP ke OLT yang bisu — jadi tetap dipercaya.
    test("OLT tak terbaca TAPI ada bukti syslog LOS → bukti mandiri tetap menang", () => {
        const { resolveByCustomer } = resolverWith({
            getEventByMAC: () => ({ event_type: "los", timestamp: "2026-08-01 10:00:00" }),
        });
        const r = resolveByCustomer(user, {
            oltSnapshot: { status: "success", onus: [], failedOlts: [{ oltId: 2, oltName: "OLT-B" }] },
        });

        expect(r.status).toBe("LOS");
        expect(r.statusKnown).toBe(true);
        expect(r.isLos).toBe(true);
    });
});

describe("normalizeOnu — penanda kejujuran per-ONU tidak boleh dibuang normalizer", () => {
    // Field ini dulu TIDAK ada di literal normalizeOnu, jadi `statusKnown:false` dari driver lenyap
    // begitu melewati dispatcher — dan SEMUA penjaga di hilir (isRxPowerValid, `status_known` di
    // routes/olt.js, verdict TIDAK_TERBACA) diam-diam mengambil cabang "boleh dipercaya".
    test("statusKnown:false BERTAHAN melewati normalizer", () => {
        const out = normalizeOnu({ macAddress: "aa:bb", rxPower: "-21.50", statusKnown: false });
        expect(out.statusKnown).toBe(false);
        expect(isRxPowerValid(out, "Online")).toBe(false);
    });

    test("merk yang tak mengirim statusKnown tetap dianggap terbaca", () => {
        const out = normalizeOnu({ macAddress: "aa:bb", rxPower: "-21.50" });
        expect(out.statusKnown).toBe(true);
        expect(isRxPowerValid(out, "Online")).toBe(true);
    });
});
