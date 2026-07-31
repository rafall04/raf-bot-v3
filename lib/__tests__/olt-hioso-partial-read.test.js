/**
 * Header Doc
 * Purpose: Mengunci penolakan PEMBACAAN SEBAGIAN di driver HIOSO. MAC adalah kunci identitas ONU;
 *          filter di `getOltData` membuang setiap ONU ber-MAC 'N/A', jadi satu walk MAC yang kosong
 *          menghapus SELURUH inventaris dan dulu tetap dilaporkan `status:'success'` berisi nol ONU.
 *          Di hilir itu terbaca sebagai "semua pelanggan mati" — terjadi nyata di Tanjungharjo
 *          2026-07-31 (96 pelanggan tampil Offline ~8 menit padahal OLT sehat, 105 ONU terbaca dari
 *          proses terpisah). Snapshot semacam itu kini WAJIB `status:'error'` supaya tidak ikut
 *          ter-cache dan tidak dipakai sebagai vonis.
 * Caller: Jest.
 * Deps: `lib/olt-hioso` dengan `net-snmp` di-mock (tanpa jaringan).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
"use strict";

const OID = {
    name: "1.3.6.1.4.1.25355.3.2.6.3.2.1.37",
    mac: "1.3.6.1.4.1.25355.3.2.6.3.2.1.11",
    phaseState: "1.3.6.1.4.1.25355.3.2.6.3.2.1.39",
    lastDownCause: "1.3.6.1.4.1.25355.3.2.6.3.2.1.41",
    rxPower: "1.3.6.1.4.1.25355.3.2.6.14.2.1.8",
};

// Kolom mana yang mengembalikan data ditentukan per-test lewat variabel ini.
let mockKolomTerisi = {};

jest.mock("net-snmp", () => {
    const ObjectType = { OctetString: 4, Integer: 2, EndOfMibView: 130, NoSuchObject: 128, NoSuchInstance: 129 };
    return {
        Version2c: 1,
        ObjectType,
        createSession: () => ({
            on: () => {},
            close: () => {},
            walk(baseOid, feedCb, doneCb) {
                const isi = mockKolomTerisi[baseOid];
                // Balas asinkron supaya menyerupai I/O sungguhan (Promise.all benar-benar menunggu).
                setImmediate(() => {
                    if (isi && isi.length) {
                        feedCb(isi.map((v, i) => ({
                            oid: `${baseOid}.1.${i + 1}`,
                            value: typeof v === "string" ? Buffer.from(v) : v,
                            type: typeof v === "string" ? ObjectType.OctetString : ObjectType.Integer,
                        })));
                    }
                    doneCb(null);
                });
            },
        }),
    };
});

const { getOltData } = require("../olt-hioso");

const MAC = ["00:11:22:33:44:55", "00:11:22:33:44:66"];

beforeEach(() => {
    mockKolomTerisi = {};
});

describe("getOltData — pembacaan sebagian ditolak, bukan disulap jadi 'nol ONU'", () => {
    test("pembacaan utuh → success dengan ONU terisi", async () => {
        mockKolomTerisi = {
            [OID.mac]: MAC,
            [OID.phaseState]: [1, 1],
            [OID.rxPower]: [-2150, -2200],
            [OID.lastDownCause]: [0, 0],
            [OID.name]: ["ONU-A", "ONU-B"],
        };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.onus).toHaveLength(2);
        expect(r.incompleteWalks).toEqual([]);
    });

    // INTI PERBAIKAN: inilah bentuk kegagalan yang menimpa Tanjungharjo.
    test("walk MAC kosong TAPI kolom lain berisi → status error, BUKAN success berisi nol ONU", async () => {
        mockKolomTerisi = {
            [OID.phaseState]: [1, 1],
            [OID.rxPower]: [-2150, -2200],
            [OID.lastDownCause]: [0, 0],
            [OID.name]: ["ONU-A", "ONU-B"],
        };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("error");
        expect(r.onus).toEqual([]);
        expect(r.incompleteWalks).toContain("mac");
        expect(r.message).toMatch(/tidak utuh/i);
    });

    test("cukup SATU kolom lain terbaca untuk membuktikan pembacaan tidak utuh", async () => {
        mockKolomTerisi = { [OID.phaseState]: [1, 1] };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("error");
    });

    // Batas yang sengaja TIDAK dilewati: OLT yang memang belum punya ONU (instalasi baru) tak boleh
    // dianggap rusak — kalau ini ikut jadi error, dashboard OLT baru akan merah tanpa sebab.
    test("SEMUA walk kosong → tetap success (OLT tanpa ONU itu sah), hanya ditandai", async () => {
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.onus).toEqual([]);
        expect(r.incompleteWalks).toEqual(expect.arrayContaining(["mac", "phaseState", "rxPower"]));
    });

    test("MAC ada tapi kolom optik kosong → tetap success (inventaris masih sahih)", async () => {
        mockKolomTerisi = { [OID.mac]: MAC, [OID.phaseState]: [1, 1] };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.onus).toHaveLength(2);
        expect(r.incompleteWalks).toContain("rxPower");
    });
});
