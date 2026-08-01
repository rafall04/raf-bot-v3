/**
 * Header Doc
 * Purpose: Mengunci GAGAL ≠ KOSONG di driver ZTE — cermin dari
 *          `olt-hioso-partial-read.test.js`. `reliableSnmpWalk` dulu menelan setiap error jadi `[]`,
 *          jadi OLT ZTE yang tak menjawab menghasilkan `status:'success'` berisi nol ONU: tak bisa
 *          dibedakan dari OLT sehat tanpa ONU, dan di hilir terbaca "semua pelanggan mati".
 *          Taruhannya besar — 2 dari 3 perangkat di config memakai driver ini, termasuk VANS
 *          (~612 ONU). Bug yang sama sudah diperbaiki di HIOSO; tanpa berkas ini ia tetap hidup
 *          di merk sebelah tanpa satu pun tes berubah merah.
 * Caller: Jest.
 * Deps: `lib/olt-drivers/zte` dengan `./snmp-util` di-mock (tanpa jaringan).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
"use strict";

// Kolom (base OID) yang walk-nya MENOLAK, vs yang menjawab dengan baris.
let mockFailedOids = new Set();
let mockRowsByOid = {};

jest.mock("../olt-drivers/snmp-util", () => ({
    snmpWalk: jest.fn(async (cfg, oid) => {
        if (mockFailedOids.has(oid)) throw new Error("Request timed out");
        return mockRowsByOid[oid] || [];
    }),
    // Optik & ifName lewat GET; tak relevan untuk pembedaan gagal-vs-kosong.
    snmpGet: jest.fn(async () => ({})),
}));

const zte = require("../olt-drivers/zte");

const OID = {
    model: "1.3.6.1.4.1.3902.1012.3.28.1.1.1",
    desc: "1.3.6.1.4.1.3902.1012.3.28.1.1.2",
    portName: "1.3.6.1.4.1.3902.1012.3.28.1.1.3",
    serial: "1.3.6.1.4.1.3902.1012.3.28.1.1.5",
    phaseState: "1.3.6.1.4.1.3902.1012.3.28.2.1.3",
};

const CFG = { host: "10.9.9.9", community: "public", timeout: 5000, retries: 1 };

/** Baris walk berbentuk {oid, value, raw} seperti keluaran snmp-util. */
function rows(baseOid, values) {
    return values.map((v, i) => ({ oid: `${baseOid}.268501248.${i + 1}`, value: v, raw: v }));
}

beforeEach(() => {
    mockFailedOids = new Set();
    mockRowsByOid = {};
});

describe("zte getOltData — walk yang GAGAL tidak disulap jadi 'OLT tanpa ONU'", () => {
    test("SEMUA walk gagal → status error, BUKAN success berisi nol ONU", async () => {
        mockFailedOids = new Set(Object.values(OID).concat([
            "1.3.6.1.4.1.3902.1012.3.28.2.1.4",
            "1.3.6.1.4.1.3902.1012.3.28.2.1.7",
        ]));

        const r = await zte.getOltData(CFG);

        expect(r.status).toBe("error");
        expect(r.onus).toEqual([]);
        expect(r.message).toMatch(/tidak menjawab SNMP/i);
        expect(r.failedWalks).toEqual(expect.arrayContaining(["desc", "serial", "phaseState"]));
    });

    test("kolom inventaris gagal (bukan semua) → tetap error, dengan headline berbeda", async () => {
        mockFailedOids = new Set([OID.desc, OID.serial, OID.phaseState]);

        const r = await zte.getOltData(CFG);

        expect(r.status).toBe("error");
        expect(r.message).toMatch(/gagal pada walk/i);
        expect(r.failedWalks).toEqual(expect.arrayContaining(["desc", "serial", "phaseState"]));
    });

    // Batas yang sengaja dipertahankan, sama seperti di HIOSO: OLT yang memang belum punya ONU
    // (instalasi baru) tidak boleh ikut divonis rusak.
    test("semua walk BERHASIL tapi memang kosong → success (OLT belum punya ONU)", async () => {
        const r = await zte.getOltData(CFG);

        expect(r.status).toBe("success");
        expect(r.onus).toEqual([]);
        expect(r.failedWalks).toEqual([]);
    });

    test("kolom PELENGKAP gagal tapi inventaris utuh → tetap success, kegagalan tercatat", async () => {
        mockRowsByOid = {
            [OID.desc]: rows(OID.desc, ["budi@isp", "sari@isp"]),
            [OID.serial]: rows(OID.serial, ["ZTEGD5D42874", "ZTEGD5D42875"]),
            [OID.phaseState]: rows(OID.phaseState, [6, 6]),
        };
        mockFailedOids = new Set([OID.portName]);

        const r = await zte.getOltData(CFG);

        expect(r.status).toBe("success");
        expect(r.onus).toHaveLength(2);
        expect(r.failedWalks).toEqual(["portName"]);
    });

    // `[]` harus selalu berarti "tak ada yang gagal", tak pernah "driver ini tak bercerita" —
    // kalau tidak, konsumen yang menaruh kepercayaan pada field ini akan disesatkan diam-diam.
    test("hasil sukses & hasil error sama-sama membawa failedWalks/incompleteWalks", async () => {
        const ok = await zte.getOltData(CFG);
        expect(Array.isArray(ok.failedWalks)).toBe(true);
        expect(Array.isArray(ok.incompleteWalks)).toBe(true);

        const bad = await zte.getOltData({ community: "public" }); // tanpa host
        expect(bad.status).toBe("error");
        expect(bad.failedWalks).toEqual([]);
        expect(bad.incompleteWalks).toEqual([]);
    });
});
