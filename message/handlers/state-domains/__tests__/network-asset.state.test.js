/**
 * Header Doc
 * Purpose: Test domain WA aset jaringan — teknisi menata jaringan sepenuhnya dari lapangan:
 *          petakan (#ODC/#ODP, nama+share lokasi, induk otomatis), **EDIT** kalau nama sudah ada
 *          (bukan duplikat), **ISI** ODP dgn pelanggan (nomor ATAU nama — nama TAK BUTUH GPS, inilah
 *          yang menutup pelanggan lama tanpa koordinat), cek hunian `odp <nama>`, dan `#LOKASI` untuk
 *          menyimpan titik rumah pelanggan.
 *          Dikunci juga: nomor usulan TIDAK bergeser setelah ada yang tersambung (kalau bergeser,
 *          teknisi yang mengetik "2" bisa menyambungkan orang yang SALAH), kapasitas penuh ditolak,
 *          dan pemindahan antar-ODP DIKATAKAN (bukan diam-diam).
 * Caller: Jest.
 * Deps: ../network-asset.state (assetService & usersService di-inject; fungsi murni pakai service asli).
 * SideEffects: Tidak ada (foto ke tmp, dibersihkan).
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const realSvc = require("../../../../lib/network-assets-service");
const {
    startNetworkAssetSession,
    startFillSession,
    startLocationSession,
    startRouteSession,
    inspectOdp,
    handleNetworkAssetConversationState,
    STEP_COLLECT,
    STEP_CONFIRM,
    STEP_ATTACH,
    STEP_PICK_PARENT,
    STEP_ROUTE_WAIT,
    STEP_ROUTE_REPLACE
} = require("../network-asset.state");

const TMP = path.join(os.tmpdir(), `aset-test-${Date.now()}`);

const ODP_BALEN = {
    id: "ODP-BALEN-002", type: "ODP", name: "Balen 2",
    latitude: -7.2501, longitude: 111.8401, capacity_ports: 8, parent_odc_id: "ODC-BALEN-001"
};
const ODC_BALEN = { id: "ODC-BALEN-001", type: "ODC", name: "ODC Balen", latitude: -7.25, longitude: 111.84, capacity_ports: 8 };

function makeUsers() {
    return [
        { id: 1, name: "Budi Santoso", phone_number: "08123456789", latitude: -7.2502, longitude: 111.8402, connected_odp_id: "" },
        { id: 2, name: "Sari Dewi", phone_number: "08129999999", latitude: -7.2505, longitude: 111.8404, connected_odp_id: "" },
        // Joko TANPA GPS — tak akan muncul di usulan jarak, TAPI harus tetap bisa disambungkan lewat NAMA.
        { id: 3, name: "Joko Susilo", phone_number: "08211112222", latitude: null, longitude: null, connected_odp_id: "" },
        { id: 4, name: "Andi Lama", phone_number: "08133334444", latitude: -7.2503, longitude: 111.8403, connected_odp_id: "ODP-LAMA-001" }
    ];
}

function harness(overrides = {}) {
    let state = null;
    let users = makeUsers();
    let assets = [ODC_BALEN, { ...ODP_BALEN }];

    const updateUserById = jest.fn(async ({ id, userData }) => {
        const u = users.find((x) => String(x.id) === String(id));
        if (!u) return { status: 404, body: { message: "tak ada" } };
        Object.assign(u, userData);
        return { status: 200, body: { status: 200 } };
    });

    const assetService = {
        ...realSvc, // parseCoord / haversineMeters / mapsUrl / getAssetConfig ASLI
        createAsset: jest.fn(async (input) => {
            const a = { id: input.type === "ODC" ? "ODC-BARU-001" : "ODP-BARU-001", ports_used: 0, ...input, capacity_ports: input.capacity_ports };
            assets.push(a);
            return a;
        }),
        updateAsset: jest.fn(async (id, patch) => {
            const a = assets.find((x) => x.id === id);
            Object.assign(a, patch);
            return a;
        }),
        findAssetsByName: jest.fn((nama, type) => realSvc.findAssetsByName(nama, type, assets)),
        findAssetById: jest.fn((id) => assets.find((a) => a.id === id) || null),
        getOdpStatus: jest.fn((id) => {
            const a = assets.find((x) => x.id === id);
            if (!a) return { found: false };
            const used = users.filter((u) => String(u.connected_odp_id || "") === String(id)).length;
            const cap = parseInt(a.capacity_ports, 10) || 0;
            return { found: true, id, name: a.name, used, capacity: cap, full: cap > 0 && used >= cap, sisa: cap > 0 ? cap - used : null };
        }),
        getOdpCustomers: jest.fn((id) => users.filter((u) => String(u.connected_odp_id || "") === String(id))),
        findNearest: jest.fn(() => [{ asset: ODC_BALEN, meters: 120 }]),
        suggestOdpForPoint: jest.fn(() => [{ asset: { ...ODP_BALEN }, meters: 35, status: { sisa: 6 } }]),
        ...(overrides.assetService || {})
    };

    const { assetService: _svc, ...rest } = overrides;
    const base = {
        stateSender: "628999@s.whatsapp.net",
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((_k, s) => { state = s; }),
        deleteUserState: jest.fn(() => { state = null; }),
        downloadMedia: jest.fn(async () => Buffer.from([1, 2, 3, 4])),
        staff: { id: 3, username: "davin", name: "Davin", role: "teknisi" },
        uploadsBaseDir: TMP,
        usersService: { updateUserById },
        getUsers: () => users,
        logger: { error() {}, warn() {} },
        ...rest,
        assetService
    };
    return { base, assetService, updateUserById, getState: () => state, getUsers: () => users, getAssets: () => assets };
}

const locMsg = (lat = -7.2501, lng = 111.8401) => ({ message: { locationMessage: { degreesLatitude: lat, degreesLongitude: lng } } });
const lastReply = (h) => h.base.reply.mock.calls.at(-1)[0];
const allReplies = (h) => h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n");

async function lanjut(h, { chats = "", type = "conversation", msg = null } = {}) {
    const state = h.getState();
    return handleNetworkAssetConversationState({
        ...h.base,
        stateStep: state && state.step,
        teknisiState: state,
        chats,
        type,
        msg
    });
}

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) { /* noop */ } });

describe("#ODP baru → langsung ditawari MENGISI (satu kunjungan, dua pekerjaan)", () => {
    async function petakanOdpBaru(h) {
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 3" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ya" });
    }

    test("sesudah tersimpan, bot LANGSUNG menawarkan pelanggan terdekat yang belum ber-ODP", async () => {
        const h = harness();
        await petakanOdpBaru(h);

        expect(h.assetService.createAsset).toHaveBeenCalledTimes(1);
        expect(h.getState().step).toBe(STEP_ATTACH); // sesi TIDAK ditutup — teknisi masih di depan boks

        const menu = lastReply(h);
        expect(menu).toContain("Budi Santoso");
        expect(menu).toContain("Sari Dewi");
        expect(menu).not.toContain("Andi Lama"); // sudah punya ODP → bukan calon
        expect(menu).not.toContain("Joko"); // tanpa GPS → tak bisa DIUSULKAN (tapi tetap bisa lewat nama)
        expect(menu).toContain("nama/HP");
    });

    test("balas nomor → tersambung lewat usersService (validasi kapasitas ikut jalan di sana)", async () => {
        const h = harness();
        await petakanOdpBaru(h);
        await lanjut(h, { chats: "1" });

        expect(h.updateUserById).toHaveBeenCalledTimes(1);
        expect(h.updateUserById.mock.calls[0][0]).toMatchObject({
            id: 1,
            userData: { connected_odp_id: "ODP-BARU-001" }
        });
        expect(lastReply(h)).toContain("Budi Santoso");
        expect(lastReply(h)).toContain("1/8");
    });

    test("NOMOR TIDAK BERGESER sesudah ada yang tersambung (kalau bergeser → salah orang)", async () => {
        const h = harness();
        await petakanOdpBaru(h);
        await lanjut(h, { chats: "1" }); // Budi tersambung
        await lanjut(h, { chats: "2" }); // harus TETAP Sari, bukan naik jadi Budi

        expect(h.updateUserById.mock.calls[1][0].id).toBe(2);
        const menu = allReplies(h);
        expect(menu).toContain("✅ Budi Santoso"); // yang sudah jadi ditandai, bukan dihapus dari daftar
    });

    test("balas NAMA → pelanggan TANPA GPS pun tersambung (inilah yang menutup pelanggan lama)", async () => {
        const h = harness();
        await petakanOdpBaru(h);
        await lanjut(h, { chats: "joko" });

        expect(h.updateUserById).toHaveBeenCalledTimes(1);
        expect(h.updateUserById.mock.calls[0][0].id).toBe(3); // Joko — latitude null
        expect(lastReply(h)).toContain("Joko Susilo");
    });

    test("cari lewat NOMOR HP juga bisa (teknisi sering menyalin dari catatan)", async () => {
        const h = harness();
        await petakanOdpBaru(h);
        await lanjut(h, { chats: "08211112222" });

        expect(h.updateUserById.mock.calls[0][0].id).toBe(3);
    });

    test("SEMUA → sambungkan seluruh calon sekaligus", async () => {
        const h = harness();
        await petakanOdpBaru(h);
        await lanjut(h, { chats: "semua" });

        expect(h.updateUserById).toHaveBeenCalledTimes(2); // Budi + Sari (Joko tak ber-GPS, Andi sudah ber-ODP)
        expect(lastReply(h)).toContain("2/8");
    });

    test("pelanggan yang sudah di ODP lain → dipindah, dan itu DIKATAKAN (bukan diam-diam)", async () => {
        const h = harness();
        await petakanOdpBaru(h);
        await lanjut(h, { chats: "andi" });

        expect(h.updateUserById.mock.calls[0][0].id).toBe(4);
        expect(lastReply(h)).toMatch(/dipindah/i);
    });

    test("ODP penuh → DITOLAK dgn pesan apa adanya dari service (jangan pura-pura sukses)", async () => {
        const h = harness();
        h.base.usersService.updateUserById = jest.fn(async () => ({
            status: 400,
            body: { message: "ODP Balen 3 sudah PENUH 8/8. Pilih ODP lain." }
        }));
        await petakanOdpBaru(h);
        await lanjut(h, { chats: "1" });

        expect(lastReply(h)).toContain("PENUH 8/8");
    });

    test("SELESAI → ringkasan hunian + daftar penghuni, sesi ditutup", async () => {
        const h = harness();
        await petakanOdpBaru(h);
        await lanjut(h, { chats: "1" });
        await lanjut(h, { chats: "selesai" });

        expect(lastReply(h)).toContain("1/8");
        expect(lastReply(h)).toContain("Budi Santoso");
        expect(h.getState()).toBeNull();
    });

    test("ODC tidak menawarkan isi (ODC tak menampung pelanggan)", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODC Pasar" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ya" });

        expect(h.getState()).toBeNull();
        expect(lastReply(h)).toContain("#ODP");
    });
});

describe("#ODP dengan nama yang SUDAH ADA = EDIT, bukan duplikat", () => {
    test("bot membuka menu perbaikan, TIDAK membuat aset kedua", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });

        expect(h.assetService.createAsset).not.toHaveBeenCalled();
        expect(h.getState().step).toBe(STEP_COLLECT);
        expect(h.getState().context.editing).toBe("ODP-BALEN-002");
        expect(lastReply(h)).toContain("sudah terdaftar");
    });

    test("share lokasi baru → titik DIPERBARUI (koreksi salah share-lok dari lapangan)", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.26, 111.85) });

        expect(h.assetService.updateAsset).toHaveBeenCalledWith("ODP-BALEN-002", expect.objectContaining({
            latitude: -7.26, longitude: 111.85
        }));
        expect(h.assetService.createAsset).not.toHaveBeenCalled();
        expect(lastReply(h)).toContain("diperbarui");
    });

    test("balas angka → kapasitas diubah", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { chats: "16" });

        expect(h.assetService.updateAsset).toHaveBeenCalledWith("ODP-BALEN-002", expect.objectContaining({ capacity_ports: 16 }));
    });

    test("ketik ISI → langsung ke mode sambungkan pelanggan", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { chats: "isi" });

        expect(h.getState().step).toBe(STEP_ATTACH);
        expect(lastReply(h)).toContain("Budi Santoso");
    });
});

describe("#ISI <odp> — sambungkan kapan saja", () => {
    test("langsung masuk mode isi dgn daftar calon", async () => {
        const h = harness();
        await startFillSession({ ...h.base, chats: "#ISI Balen 2" });

        expect(h.getState().step).toBe(STEP_ATTACH);
        expect(lastReply(h)).toContain("Balen 2");
        expect(lastReply(h)).toContain("Budi Santoso");
    });

    test("ODP tak ketemu → diarahkan memetakan dulu (bukan diam)", async () => {
        const h = harness();
        await startFillSession({ ...h.base, chats: "#ISI Entah" });

        expect(lastReply(h)).toContain("#ODP Entah");
        expect(h.getState()).toBeNull();
    });
});

describe("cek hunian: `odp <nama>`", () => {
    test("tampilkan hunian + siapa saja + link peta", async () => {
        const h = harness();
        h.getUsers()[0].connected_odp_id = "ODP-BALEN-002"; // Budi sudah di sana

        await inspectOdp({ ...h.base, chats: "odp Balen 2" });

        const t = lastReply(h);
        expect(t).toContain("1/8");
        expect(t).toContain("Budi Santoso");
        expect(t).toContain("maps.google.com");
        expect(t).toContain("#ISI");
    });

    test("`cek odp` juga diterima", async () => {
        const h = harness();
        await inspectOdp({ ...h.base, chats: "cek odp Balen 2" });
        expect(lastReply(h)).toContain("Balen 2");
    });
});

describe("#LOKASI — simpan titik rumah pelanggan (menutup pelanggan tanpa GPS)", () => {
    test("cari pelanggan → share lokasi → tersimpan + langsung ditawari ODP terdekat", async () => {
        const h = harness();
        await startLocationSession({ ...h.base, chats: "#LOKASI joko" });
        expect(lastReply(h)).toContain("Joko Susilo");

        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.2504, 111.8405) });

        const arg = h.updateUserById.mock.calls[0][0];
        expect(arg.id).toBe(3);
        expect(arg.userData).toMatchObject({ latitude: -7.2504, longitude: 111.8405 });
        expect(arg.userData.maps_url).toContain("-7.2504");

        // Sudah punya titik → sekalian tawarkan sambungkan (satu percakapan, dua pekerjaan).
        expect(h.getState().step).toBe(STEP_ATTACH);
        expect(allReplies(h)).toContain("ODP terdekat");
    });

    test("nama ambigu → daftar bernomor (jangan menebak orangnya)", async () => {
        const h = harness();
        h.getUsers().push({ id: 5, name: "Joko Widodo", phone_number: "0855", latitude: null, longitude: null, connected_odp_id: "" });

        await startLocationSession({ ...h.base, chats: "#LOKASI joko" });

        expect(lastReply(h)).toContain("Joko Susilo");
        expect(lastReply(h)).toContain("Joko Widodo");
        expect(h.updateUserById).not.toHaveBeenCalled();
    });

    test("pelanggan tak ketemu → dikatakan, bukan diam", async () => {
        const h = harness();
        await startLocationSession({ ...h.base, chats: "#LOKASI zzz" });
        expect(lastReply(h)).toContain("tak ketemu");
    });
});

describe("petakan aset baru — pagar yang tetap berlaku", () => {
    test("induk ODC dipilih otomatis & teknisi tinggal mengiyakan", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 9" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });

        expect(h.getState().step).toBe(STEP_CONFIRM);
        expect(lastReply(h)).toContain("ODC Balen");
        expect(lastReply(h)).toContain("dipilih otomatis");
    });

    test("GANTI → daftar induk bernomor", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 9" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ganti" });

        expect(h.getState().step).toBe(STEP_PICK_PARENT);
    });

    test("TAK ADA ODC di sekitar → lanjut tanpa induk (jangan menebak)", async () => {
        const h = harness({ assetService: { findNearest: jest.fn(() => []) } });
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Terpencil" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        expect(lastReply(h)).toContain("belum ada ODC terdaftar");

        await lanjut(h, { chats: "ya" });
        expect(h.assetService.createAsset.mock.calls[0][0].parent_odc_id).toBeNull();
    });

    test("BATAL → tak ada yang disimpan", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 9" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "batal" });

        expect(h.assetService.createAsset).not.toHaveBeenCalled();
        expect(h.getState()).toBeNull();
    });

    test("tanpa lokasi → tak tersimpan (aset tanpa titik tak berguna di peta)", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODC Baru Sekali" });
        await lanjut(h, { chats: "ya" });

        expect(h.assetService.createAsset).not.toHaveBeenCalled();
        expect(h.getState().step).toBe(STEP_COLLECT);
    });
});

// ── #JALUR: merekam BENTUK jalur kabel dari lapangan ──
// Peta menggambar ODC→ODP sebagai garis lurus karena tak ada yang pernah memberi tahu bentuknya.
// Yang tahu cuma orang yang menarik kabelnya — dan dia memegang HP, bukan mouse.
describe("#JALUR — rekam jalur kabel ODC→ODP dari lapangan", () => {
    function jalurHarness(routeOverrides = {}) {
        const routeService = {
            getRoute: jest.fn(async () => null),
            saveRoute: jest.fn(async (input) => ({ count: input.points.length, meters: 412 })),
            ...routeOverrides
        };
        return { h: harness({ routeService }), routeService };
    }

    test("membuka mode rekam dan meminta share lokasi TIAP BELOKAN (bukan tiap tiang)", async () => {
        const { h } = jalurHarness();
        await startRouteSession({ ...h.base, chats: "#JALUR Balen 2" });

        expect(h.getState().step).toBe(STEP_ROUTE_WAIT);
        const teks = lastReply(h);
        expect(teks).toContain("BELOKAN");
        expect(teks).toContain("tiap tiang"); // "Tak perlu tiap tiang" — jangan sampai dituntut tiap tiang
        expect(teks).toContain("SELESAI");
    });

    test("SELESAI menyimpan jalur dgn titik ODC di depan & ODP di belakang — ujung tak perlu dipin ulang", async () => {
        const { h, routeService } = jalurHarness();
        await startRouteSession({ ...h.base, chats: "#JALUR Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.2504, 111.8402) });
        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.2506, 111.8405) });
        await lanjut(h, { chats: "selesai" });

        expect(routeService.saveRoute).toHaveBeenCalledTimes(1);
        const dikirim = routeService.saveRoute.mock.calls[0][0];
        expect(dikirim.connectionType).toBe("odc-odp");
        expect(dikirim.sourceId).toBe("ODC-BALEN-001");
        expect(dikirim.targetId).toBe("ODP-BALEN-002");
        expect(dikirim.points).toHaveLength(4); // ODC + 2 belokan + ODP
        expect(dikirim.points[0]).toEqual([ODC_BALEN.latitude, ODC_BALEN.longitude]);
        expect(dikirim.points.at(-1)).toEqual([ODP_BALEN.latitude, ODP_BALEN.longitude]);
        expect(h.getState()).toBeNull(); // sesi ditutup
        expect(lastReply(h)).toContain("Jalur tersimpan");
    });

    test("SELESAI tanpa satu pun belokan TIDAK menyimpan — jalur lurus tak perlu direkam", async () => {
        const { h, routeService } = jalurHarness();
        await startRouteSession({ ...h.base, chats: "#JALUR Balen 2" });
        await lanjut(h, { chats: "selesai" });

        expect(routeService.saveRoute).not.toHaveBeenCalled();
        expect(h.getState().step).toBe(STEP_ROUTE_WAIT); // tetap di mode rekam, bukan gagal senyap
        expect(lastReply(h)).toContain("Belum ada titik");
    });

    test("HAPUS membuang titik terakhir — salah pin itu kejadian normal di lapangan", async () => {
        const { h, routeService } = jalurHarness();
        await startRouteSession({ ...h.base, chats: "#JALUR Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.2504, 111.8402) });
        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.2599, 111.8999) }); // salah pin
        await lanjut(h, { chats: "hapus" });
        await lanjut(h, { chats: "selesai" });

        const dikirim = routeService.saveRoute.mock.calls[0][0];
        expect(dikirim.points).toHaveLength(3); // ODC + 1 belokan (yang salah dibuang) + ODP
        expect(dikirim.points).not.toContainEqual([-7.2599, 111.8999]);
    });

    test("ULANG mengosongkan titik tanpa keluar dari mode rekam", async () => {
        const { h, routeService } = jalurHarness();
        await startRouteSession({ ...h.base, chats: "#JALUR Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.2504, 111.8402) });
        await lanjut(h, { chats: "ulang" });
        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.2507, 111.8408) });
        await lanjut(h, { chats: "selesai" });

        const dikirim = routeService.saveRoute.mock.calls[0][0];
        expect(dikirim.points).toHaveLength(3);
        expect(dikirim.points).not.toContainEqual([-7.2504, 111.8402]);
    });

    test("jalur yang SUDAH ADA tidak ditimpa diam-diam — harus diiyakan dulu", async () => {
        const { h, routeService } = jalurHarness({
            getRoute: jest.fn(async () => ({ points: [[-7.25, 111.84], [-7.2501, 111.8401]], meters: 200 }))
        });
        await startRouteSession({ ...h.base, chats: "#JALUR Balen 2" });

        expect(h.getState().step).toBe(STEP_ROUTE_REPLACE);
        expect(lastReply(h)).toContain("sudah punya jalur");

        await lanjut(h, { chats: "ya" });
        expect(h.getState().step).toBe(STEP_ROUTE_WAIT);
        expect(routeService.saveRoute).not.toHaveBeenCalled(); // baru merekam, belum menyimpan
    });

    test("ODP tanpa induk ODC ditolak dengan ARAHAN, bukan sekadar error", async () => {
        const { routeService } = jalurHarness();
        const hLepas = harness({
            routeService,
            assetService: {
                findAssetsByName: jest.fn(() => [{ id: "ODP-LEPAS", type: "ODP", name: "Lepas", latitude: -7.25, longitude: 111.84, parent_odc_id: "" }])
            }
        });

        await startRouteSession({ ...hLepas.base, chats: "#JALUR Lepas" });

        expect(routeService.saveRoute).not.toHaveBeenCalled();
        expect(lastReply(hLepas)).toContain("#ODP Lepas");
    });

    test("teks biasa saat merekam → diingatkan cara kirim titik + jumlah yang sudah masuk", async () => {
        const { h } = jalurHarness();
        await startRouteSession({ ...h.base, chats: "#JALUR Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg(-7.2504, 111.8402) });
        await lanjut(h, { chats: "sudah sampai mana ya" });

        expect(lastReply(h)).toContain("share lokasi");
        expect(lastReply(h)).toContain("1 titik");
    });
});
