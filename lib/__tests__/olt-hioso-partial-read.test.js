/**
 * Header Doc
 * Purpose: Mengunci KEJUJURAN pembacaan per-OLT di driver HIOSO — tiga cara pembacaan gagal pernah
 *          menyamar jadi vonis, ketiganya berakhir sebagai "semua pelanggan mati":
 *          (a) walk MAC kosong → seluruh inventaris hilang (MAC kunci identitas ONU, filter di
 *              `getOltData` membuang ONU ber-MAC 'N/A') tapi dilaporkan `success` berisi nol ONU.
 *              Terjadi nyata di Tanjungharjo 2026-07-31 (96 pelanggan Offline ~8 menit, OLT sehat).
 *          (b) walk yang MENOLAK disamakan dengan walk yang memang tak berisi (GAGAL ≠ KOSONG) —
 *              "OLT tak menjawab" tertukar dengan "OLT belum punya ONU" (Dander 192.168.11.2).
 *          (c) baris MAC ADA tapi tak satu pun berbentuk MAC sah → nol ONU tanpa penanda apa pun.
 *          Dikunci juga hal yang membuat (b) sempat lolos hijau: pembatas darurat WAJIB mengikuti
 *          anggaran SNMP dari config, dan mock ini WAJIB memeriksa opsi sesi + penutupan sesi —
 *          mock yang membuang timeout/retries membuat bug penentu waktu tak terlihat sama sekali.
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
let mockFilledColumns = {};
// Kolom yang walk-nya GAGAL (menolak), berbeda dari kolom yang sekadar tak berisi.
let mockFailedColumns = new Set();
// Opsi yang BENAR-BENAR diterima net-snmp, dan berapa kali sesi ditutup. Diperiksa tes: tanpa ini
// `timeout`/`retries` bisa dihapus dari createSession tanpa satu pun tes berubah merah — padahal
// justru dua angka itu yang menentukan kapan sebuah walk menolak.
let mockSessionOptions = null;
let mockCloseCount = 0;

jest.mock("net-snmp", () => {
    const ObjectType = { OctetString: 4, Integer: 2, EndOfMibView: 130, NoSuchObject: 128, NoSuchInstance: 129 };
    return {
        Version2c: 1,
        ObjectType,
        createSession: (host, community, options) => {
            mockSessionOptions = { host, community, ...(options || {}) };
            return {
                on: () => {},
                close: () => { mockCloseCount += 1; },
                walk(baseOid, feedCb, doneCb) {
                    const isi = mockFilledColumns[baseOid];
                    // Balas asinkron supaya menyerupai I/O sungguhan (Promise.all benar-benar menunggu).
                    setImmediate(() => {
                        if (mockFailedColumns.has(baseOid)) {
                            doneCb(new Error("SNMP timeout")); // walk MENOLAK — beda dari walk kosong
                            return;
                        }
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
            };
        },
    };
});

const { getOltData, snmpDeadlineMs } = require("../olt-hioso");

const MAC = ["00:11:22:33:44:55", "00:11:22:33:44:66"];

beforeEach(() => {
    mockFilledColumns = {};
    mockFailedColumns = new Set();
    mockSessionOptions = null;
    mockCloseCount = 0;
});

describe("getOltData — pembacaan sebagian ditolak, bukan disulap jadi 'nol ONU'", () => {
    test("pembacaan utuh → success dengan ONU terisi", async () => {
        mockFilledColumns = {
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
        mockFilledColumns = {
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
        mockFilledColumns = { [OID.phaseState]: [1, 1] };
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
        mockFilledColumns = { [OID.mac]: MAC, [OID.phaseState]: [1, 1] };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.onus).toHaveLength(2);
        expect(r.incompleteWalks).toContain("rxPower");
    });
});

// GAGAL ≠ KOSONG. Dulu `.catch(() => [])` menyamakan keduanya, sehingga OLT yang tak menjawab
// (kasus 192.168.11.2 di Dander: router balas "Destination Host Unreachable") tampil identik dengan
// OLT baru yang memang belum punya ONU — padahal penanganannya berlawanan.
describe("getOltData — walk yang GAGAL dibedakan dari walk yang memang kosong", () => {
    test("SEMUA walk gagal → error 'OLT tidak menjawab', bukan success berisi nol ONU", async () => {
        mockFailedColumns = new Set(Object.values(OID));
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("error");
        expect(r.message).toMatch(/tidak menjawab/i);
        expect(r.failedWalks).toEqual(expect.arrayContaining(["mac", "phaseState", "rxPower"]));
    });

    test("MAC gagal, kolom lain juga kosong → tetap error (kekosongan itu buah kegagalan)", async () => {
        mockFailedColumns = new Set([OID.mac]);
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("error");
        expect(r.failedWalks).toEqual(["mac"]);
        expect(r.message).toMatch(/gagal pada walk/i);
    });

    test("MAC gagal tapi kolom lain berisi → error (aturan #b192 tetap berlaku)", async () => {
        mockFailedColumns = new Set([OID.mac]);
        mockFilledColumns = { [OID.phaseState]: [1, 1] };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("error");
        expect(r.failedWalks).toEqual(["mac"]);
    });

    // Batas penting: OLT baru yang belum punya ONU TIDAK boleh ikut dianggap rusak.
    test("semua walk BERHASIL tapi memang kosong → success (OLT belum punya ONU)", async () => {
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.failedWalks).toEqual([]);
        expect(r.onus).toEqual([]);
    });

    test("satu kolom optik gagal tapi inventaris MAC utuh → tetap success, kegagalan tercatat", async () => {
        mockFailedColumns = new Set([OID.rxPower]);
        mockFilledColumns = { [OID.mac]: MAC, [OID.phaseState]: [1, 1] };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.onus).toHaveLength(2);
        expect(r.failedWalks).toEqual(["rxPower"]);
        expect(r.incompleteWalks).toContain("rxPower");
    });

    // Hanya kolom PEMBAWA INVENTARIS yang boleh membatalkan pembacaan. Aturan ini pernah hilang:
    // gerbang penolakan menghitung SEMUA walk, jadi OLT baru tanpa ONU yang kebetulan timeout di
    // kolom hiasan divonis rusak — dan di lokasi ber-OLT tunggal seluruh halaman ikut merah.
    test("OLT kosong yang hanya gagal di kolom HIASAN (name) tetap success", async () => {
        mockFailedColumns = new Set([OID.name]);
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.onus).toEqual([]);
        expect(r.failedWalks).toEqual(["name"]);
    });

    test("OLT kosong yang hanya gagal di kolom HIASAN (lastDownCause) tetap success", async () => {
        mockFailedColumns = new Set([OID.lastDownCause]);
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.failedWalks).toEqual(["lastDownCause"]);
    });

    // Sisi lain batas yang sama: kegagalan di kolom inventaris TETAP membatalkan.
    test("OLT kosong yang gagal di kolom INVENTARIS (phaseState) tetap DITOLAK", async () => {
        mockFailedColumns = new Set([OID.phaseState]);
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("error");
        expect(r.failedWalks).toEqual(["phaseState"]);
    });

    // Kasus yang komentar di kode sendiri sebut "paling menyesatkan": redaman terisi, status tidak
    // diketahui. Inventarisnya sah jadi pembacaan tak ditolak — tapi tiap ONU WAJIB bertanda, kalau
    // tidak pembaca melihat angka redaman wajar dan menyimpulkan "sinyal bagus".
    test("phaseState gagal tapi MAC utuh → success, TIAP ONU bertanda statusKnown=false", async () => {
        mockFailedColumns = new Set([OID.phaseState]);
        mockFilledColumns = { [OID.mac]: MAC, [OID.rxPower]: [-2150, -2200] };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.onus).toHaveLength(2);
        expect(r.failedWalks).toEqual(["phaseState"]);
        expect(r.onus.every((o) => o.statusKnown === false)).toBe(true);
    });
});

describe("getOltData — yang dihitung ONU yang SELAMAT, bukan baris mentah", () => {
    // Semua gerbang kejujuran dulu mengukur `rows.length`, tak satu pun mengukur ONU yang lolos
    // filter MAC. Jadi OLT yang menjawab dengan nilai MAC tak terbaca (OctetString biner yang
    // hancur saat pembersihan control-char → 'N/A') menghasilkan "sukses berisi nol ONU": wajah
    // yang sama persis dengan insiden Tanjungharjo, lewat pintu yang berbeda.
    test("baris MAC ada tapi tak satu pun berbentuk MAC sah → error", async () => {
        mockFilledColumns = {
            [OID.mac]: ["bukan-mac", "juga-bukan"],
            [OID.phaseState]: [1, 1],
        };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("error");
        expect(r.onus).toEqual([]);
        expect(r.message).toMatch(/berbentuk MAC sah/i);
    });

    test("baris MAC campur — yang sah tetap dipakai, tidak ikut ditolak", async () => {
        mockFilledColumns = {
            [OID.mac]: [MAC[0], "bukan-mac"],
            [OID.phaseState]: [1, 1],
        };
        const r = await getOltData({ host: "10.0.0.1" });
        expect(r.status).toBe("success");
        expect(r.onus).toHaveLength(1);
    });
});

describe("getOltData — pembatas waktu & bentuk hasil", () => {
    // AKAR kenapa pembedaan gagal-vs-kosong sempat jadi kode mati: pembatas darurat dipatok 60 detik
    // sementara anggaran SNMP produksi 30000 × (1+2) = 90 detik. Pembatas selalu menang duluan, dan
    // pemanggil menerima "timeout" polos tanpa failedWalks. Mock membalas seketika sehingga tak ada
    // tes perilaku yang bisa menangkapnya — jadi yang dikunci di sini aritmetikanya langsung.
    test("pembatas darurat WAJIB di atas anggaran SNMP timeout × (1 + retries)", () => {
        expect(snmpDeadlineMs(30000, 2)).toBeGreaterThan(30000 * 3); // config produksi
        expect(snmpDeadlineMs(15000, 2)).toBeGreaterThan(15000 * 3); // default fungsi
        expect(snmpDeadlineMs(5000, 1)).toBeGreaterThan(5000 * 2);
    });

    test("timeout/retries/port/community dari config benar-benar sampai ke sesi SNMP", async () => {
        await getOltData({ host: "10.0.0.9", timeout: 7000, retries: 3, port: 1610, community: "rahasia" });
        expect(mockSessionOptions).toMatchObject({
            host: "10.0.0.9",
            community: "rahasia",
            timeout: 7000,
            retries: 3,
            port: 1610,
        });
    });

    // Jalur penolakan adalah jalur yang justru dilalui SETIAP siklus saat sebuah OLT mati; kalau
    // sesinya tak ditutup di situ, kebocoran soket terjadi terus-menerus, bukan sesekali.
    test("sesi SNMP tetap ditutup pada jalur penolakan", async () => {
        mockFailedColumns = new Set(Object.values(OID));
        await getOltData({ host: "10.0.0.1" });
        expect(mockCloseCount).toBeGreaterThan(0);
    });

    // `[]` harus selalu berarti "tak ada yang gagal" — tak pernah "driver tak bercerita".
    test("hasil error selalu membawa failedWalks & incompleteWalks", async () => {
        const noHost = await getOltData({});
        expect(noHost.status).toBe("error");
        expect(noHost.failedWalks).toEqual([]);
        expect(noHost.incompleteWalks).toEqual([]);
    });
});
