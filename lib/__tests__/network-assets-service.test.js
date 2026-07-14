/**
 * Header Doc
 * Purpose: Uji pemilik tunggal aset jaringan — hitung-ulang port (ODP=jumlah pelanggan, ODC=jumlah ODP
 *          ANAK, idempoten), validasi penyambungan pelanggan→ODP (tak terdaftar / penuh / edit diri
 *          sendiri), pencarian ODP terdekat (urut, radius, ODP penuh tak diusulkan), dan pembuatan aset
 *          (normalisasi tipe, koordinat wajib, kapasitas ODC).
 * Caller: jest.
 * Deps: `../network-assets-service` (data di-inject penuh — tak menyentuh global maupun file).
 * SideEffects: Tidak ada.
 */
"use strict";

const svc = require("../network-assets-service");

// ODC-A (kapasitas 2 ODP) → ODP-1 (kap 2), ODP-2 (kap 0 = tak dibatasi). ODP-3 menggantung tanpa induk.
function makeAssets() {
    return [
        { id: "ODC-A", type: "ODC", name: "ODC Balen", capacity_ports: 2, ports_used: 999, latitude: -7.25, longitude: 111.84 },
        { id: "ODP-1", type: "ODP", name: "ODP Balen 1", parent_odc_id: "ODC-A", capacity_ports: 2, ports_used: 999, latitude: -7.2501, longitude: 111.8401 },
        { id: "ODP-2", type: "ODP", name: "ODP Balen 2", parent_odc_id: "ODC-A", capacity_ports: 0, ports_used: 999, latitude: -7.2600, longitude: 111.8500 },
        { id: "ODP-3", type: "ODP", name: "ODP Yatim", parent_odc_id: null, capacity_ports: 4, ports_used: 999, latitude: -7.3000, longitude: 111.9000 }
    ];
}
function makeUsers() {
    return [
        { id: 1, name: "Budi", connected_odp_id: "ODP-1" },
        { id: 2, name: "Sari", connected_odp_id: "ODP-1" }, // ODP-1 kini 2/2 → PENUH
        { id: 3, name: "CCTV Pasar", connected_odp_id: "ODP-2", account_type: "infrastruktur" },
        { id: 4, name: "Tanpa ODP", connected_odp_id: "" }
    ];
}

describe("recomputePortUsage — port DITURUNKAN dari data, bukan di-increment", () => {
    test("ODP = jumlah pelanggan; ODC = jumlah ODP ANAK (bukan jumlah pelanggan)", () => {
        const assets = makeAssets();
        svc.recomputePortUsage(assets, makeUsers());
        const by = (id) => assets.find((a) => a.id === id);

        expect(by("ODP-1").ports_used).toBe(2); // Budi + Sari
        expect(by("ODP-2").ports_used).toBe(1); // CCTV: akun infra TETAP memakan 1 port fisik
        expect(by("ODP-3").ports_used).toBe(0);

        // INI bug lamanya: updateOdcPortUsage men-SUM ports_used ODP anak (=3 pelanggan) → ODC 2-port
        // terbaca "3/2" alias penuh 150%, dan maknanya berubah-ubah sampai restart.
        expect(by("ODC-A").ports_used).toBe(2); // 2 ODP anak, BUKAN 3 pelanggan
    });

    test("idempoten — dijalankan berulang hasilnya sama (tak ada penghitung yang bisa meleset)", () => {
        const assets = makeAssets();
        const users = makeUsers();
        svc.recomputePortUsage(assets, users);
        const first = assets.map((a) => a.ports_used);
        svc.recomputePortUsage(assets, users);
        svc.recomputePortUsage(assets, users);
        expect(assets.map((a) => a.ports_used)).toEqual(first);
    });

    test("angka tersimpan yang ngawur (999) ditimpa, bukan ditambahi", () => {
        const assets = makeAssets();
        svc.recomputePortUsage(assets, []);
        expect(assets.every((a) => a.ports_used === (a.type === "ODC" ? 2 : 0))).toBe(true);
    });
});

describe("assertOdpAssignable — gerbang anti data sampah", () => {
    const opts = () => ({ assets: svc.recomputePortUsage(makeAssets(), makeUsers()), users: makeUsers() });

    test("ODP tidak terdaftar (typo) → DITOLAK", () => {
        expect(() => svc.assertOdpAssignable("ODP-SALAH-KETIK", opts()))
            .toThrow(/tidak terdaftar/i);
    });

    test("ODP penuh (2/2) → DITOLAK", () => {
        expect(() => svc.assertOdpAssignable("ODP-1", opts())).toThrow(/PENUH 2\/2/);
    });

    test("kapasitas 0 = tak dibatasi → diterima", () => {
        expect(svc.assertOdpAssignable("ODP-2", opts()).id).toBe("ODP-2");
    });

    test("ODP kosong = sah (pelanggan memang belum dipetakan)", () => {
        expect(svc.assertOdpAssignable("", opts())).toBeNull();
        expect(svc.assertOdpAssignable(null, opts())).toBeNull();
    });

    test("EDIT pelanggan yang sudah menempel di ODP penuh → jangan hitung dirinya sendiri lalu vonis penuh", () => {
        // Sari (id 2) sudah di ODP-1 yang 2/2. Menyimpan ulang datanya tak boleh ditolak.
        expect(svc.assertOdpAssignable("ODP-1", { ...opts(), excludeUserId: 2 }).id).toBe("ODP-1");
    });

    test("ID ODC dipakai sebagai ODP → DITOLAK (bukan sekadar 'ada')", () => {
        expect(() => svc.assertOdpAssignable("ODC-A", opts())).toThrow(/tidak terdaftar/i);
    });
});

describe("parseCoord — 'tanpa GPS' TIDAK boleh terbaca sebagai titik (0,0)", () => {
    test("null/kosong/0 = BELUM DISET (bukan Teluk Guinea)", () => {
        // `Number(null) === 0` → memakai Number() polos membuat pelanggan tanpa GPS terbaca "punya
        // GPS di (0,0)", dan halaman melaporkan "0 pelanggan tanpa GPS" padahal puluhan belum
        // dipetakan. Bug ini NYATA: tertangkap saat verifikasi live (Dander melaporkan tanpaGps=0
        // padahal 18 pelanggan lintang-nya NULL).
        expect(svc.parseCoord(null)).toBeNull();
        expect(svc.parseCoord(undefined)).toBeNull();
        expect(svc.parseCoord("")).toBeNull();
        expect(svc.parseCoord(0)).toBeNull();
        expect(svc.parseCoord("0")).toBeNull();
        expect(svc.parseCoord("bukan angka")).toBeNull();

        expect(svc.parseCoord(-7.2501)).toBe(-7.2501);
        expect(svc.parseCoord("111.8401")).toBe(111.8401);
    });

    test("titik (0,0) tak mengusulkan ODP apa pun", () => {
        expect(svc.findNearest(0, 0, "ODP", { assets: makeAssets() })).toEqual([]);
    });

    test("aset tanpa koordinat tak pernah ikut dipertimbangkan", () => {
        const assets = makeAssets().concat([
            { id: "ODP-NULL", type: "ODP", name: "ODP tanpa titik", latitude: null, longitude: null, capacity_ports: 8 }
        ]);
        const hasil = svc.findNearest(-7.25, 111.84, "ODP", { assets, limit: 0 });
        expect(hasil.some((h) => h.asset.id === "ODP-NULL")).toBe(false);
    });
});

describe("findNearest / suggestOdpForPoint", () => {
    const assets = makeAssets();

    test("terurut dari yang terdekat", () => {
        const hasil = svc.findNearest(-7.25, 111.84, "ODP", { assets, limit: 3 });
        expect(hasil.map((h) => h.asset.id)).toEqual(["ODP-1", "ODP-2", "ODP-3"]);
        expect(hasil[0].meters).toBeLessThan(30);
    });

    test("radius maksimum dihormati (yang jauh tak ikut)", () => {
        const hasil = svc.findNearest(-7.25, 111.84, "ODP", { assets, maxMeters: 100, limit: 0 });
        expect(hasil.map((h) => h.asset.id)).toEqual(["ODP-1"]);
    });

    test("usulan pemasangan MELEWATI ODP yang penuh (percuma diusulkan)", () => {
        const usul = svc.suggestOdpForPoint(-7.25, 111.84, {
            assets: svc.recomputePortUsage(makeAssets(), makeUsers()),
            users: makeUsers(),
            maxMeters: 5000
        });
        // ODP-1 (terdekat) PENUH 2/2 → yang diusulkan ODP-2.
        expect(usul[0].asset.id).toBe("ODP-2");
        expect(usul.some((u) => u.asset.id === "ODP-1")).toBe(false);
    });

    test("titik tanpa koordinat → tak mengusulkan apa pun (jangan menebak)", () => {
        expect(svc.findNearest(null, null, "ODP", { assets })).toEqual([]);
        expect(svc.findNearest("", undefined, "ODP", { assets })).toEqual([]);
    });
});

describe("findAssetsByName / getOdpCustomers — teknisi mengetik NAMA, tak pernah hafal ID", () => {
    const assets = makeAssets();

    test("cocok PERSIS menang atas cocok-sebagian", () => {
        const hasil = svc.findAssetsByName("ODP Balen 1", "ODP", assets);
        expect(hasil.map((a) => a.id)).toEqual(["ODP-1"]);
    });

    test("cocok sebagian → SEMUA dikembalikan (pemanggil yang menanyakan, jangan diam-diam ambil satu)", () => {
        const hasil = svc.findAssetsByName("balen", "ODP", assets);
        expect(hasil.map((a) => a.id).sort()).toEqual(["ODP-1", "ODP-2"]);
    });

    test("ID juga diterima (teknisi menyalin dari balasan bot), tak peduli besar-kecil huruf", () => {
        expect(svc.findAssetsByName("odp-3", "ODP", assets).map((a) => a.id)).toEqual(["ODP-3"]);
    });

    test("tipe dihormati: nama ODC tak muncul saat mencari ODP", () => {
        expect(svc.findAssetsByName("ODC Balen", "ODP", assets)).toEqual([]);
    });

    test("getOdpCustomers = kebenaran live dari data pelanggan", () => {
        const nama = svc.getOdpCustomers("ODP-1", { users: makeUsers() }).map((u) => u.name);
        expect(nama).toEqual(["Budi", "Sari"]);
    });
});

describe("updateAsset — nama yang sudah ada = KOREKSI, bukan duplikat", () => {
    function harness() {
        const assets = svc.recomputePortUsage(makeAssets(), makeUsers());
        return {
            assets,
            deps: { updateWithLock: async (fn) => fn(assets), getUsers: () => makeUsers() }
        };
    }

    test("perbaiki titik lokasi (salah share-lok dari lapangan)", async () => {
        const h = harness();
        const a = await svc.updateAsset("ODP-1", { latitude: -7.3, longitude: 111.9 }, h.deps);
        expect(a).toMatchObject({ id: "ODP-1", latitude: -7.3, longitude: 111.9 });
        expect(h.assets.filter((x) => x.type === "ODP")).toHaveLength(3); // TIDAK bertambah
    });

    test("kapasitas TAK BOLEH turun di bawah yang sudah terpasang (itu berbohong soal muatan)", async () => {
        const h = harness();
        // ODP-1 dihuni 2 pelanggan → kapasitas 1 = mustahil.
        await expect(svc.updateAsset("ODP-1", { capacity_ports: 1 }, h.deps))
            .rejects.toThrow(/lebih kecil dari yang sudah terpasang \(2\)/i);
    });

    test("kapasitas boleh naik", async () => {
        const h = harness();
        const a = await svc.updateAsset("ODP-1", { capacity_ports: 16 }, h.deps);
        expect(a.capacity_ports).toBe(16);
    });

    test("pindah induk ke ODC yang PENUH → ditolak", async () => {
        const h = harness();
        // ODC-A kapasitas 2 & sudah punya 2 ODP anak (ODP-1, ODP-2) → ODP-3 tak boleh masuk.
        await expect(svc.updateAsset("ODP-3", { parent_odc_id: "ODC-A" }, h.deps))
            .rejects.toThrow(/sudah penuh \(2\/2 ODP\)/i);
    });

    test("titik baru yang tak valid ditolak (jangan menimpa titik benar dgn 0,0)", async () => {
        const h = harness();
        await expect(svc.updateAsset("ODP-1", { latitude: 0, longitude: 0 }, h.deps))
            .rejects.toThrow(/tidak valid/i);
    });

    test("aset tak dikenal → ditolak", async () => {
        const h = harness();
        await expect(svc.updateAsset("ODP-HANTU", { capacity_ports: 8 }, h.deps)).rejects.toThrow(/tidak ditemukan/i);
    });
});

describe("createAsset — satu jalur pembuatan (web & WA)", () => {
    function harness(seed) {
        const assets = seed || makeAssets();
        return {
            assets,
            deps: {
                updateWithLock: async (fn) => fn(assets),
                getUsers: () => makeUsers()
            }
        };
    }

    test("tipe huruf kecil dinormalisasi jadi ODP (dulu tersimpan 'odp' → tak pernah cocok filter type)", async () => {
        const h = harness();
        const aset = await svc.createAsset(
            { type: "odp", name: "ODP Baru", latitude: -7.26, longitude: 111.85, parent_odc_id: null, capacity_ports: 8 },
            h.deps
        );
        expect(aset.type).toBe("ODP");
        expect(aset.id).toMatch(/^ODP-/);
        expect(aset.ports_used).toBe(0);
    });

    test("koordinat wajib — tanpa titik lokasi, aset tak berguna di peta", async () => {
        const h = harness();
        await expect(svc.createAsset({ type: "ODC", name: "X" }, h.deps)).rejects.toThrow(/lokasi/i);
    });

    test("induk ODC tak ada → ditolak", async () => {
        const h = harness();
        await expect(svc.createAsset(
            { type: "ODP", name: "Y", latitude: -7.2, longitude: 111.8, parent_odc_id: "ODC-HANTU" },
            h.deps
        )).rejects.toThrow(/tidak ditemukan/i);
    });

    test("kapasitas ODC ditegakkan dari JUMLAH ODP ANAK (ODC-A: 2/2) → ODP ke-3 ditolak", async () => {
        const h = harness();
        await expect(svc.createAsset(
            { type: "ODP", name: "ODP Ketiga", latitude: -7.2, longitude: 111.8, parent_odc_id: "ODC-A" },
            h.deps
        )).rejects.toThrow(/sudah penuh \(2\/2 ODP\)/i);
    });

    test("jejak siapa yang memetakan ikut tersimpan", async () => {
        const h = harness();
        const aset = await svc.createAsset(
            { type: "ODC", name: "ODC Baru", latitude: -7.2, longitude: 111.8, created_by: "Teknisi Davin", source: "wa" },
            h.deps
        );
        expect(aset).toMatchObject({ created_by: "Teknisi Davin", source: "wa" });
    });
});
