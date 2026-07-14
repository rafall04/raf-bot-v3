/**
 * Header Doc
 * Purpose: Test wizard WA `#ODC`/`#ODP` — teknisi memetakan aset dari lapangan dgn SEDIKIT keputusan:
 *          hanya nama + share lokasi yang wajib; induk ODC DIPILIHKAN otomatis (terdekat) dan tinggal
 *          diiyakan; kapasitas punya default; foto opsional; bot MEMBUKTIKAN hasil (ID + link peta).
 *          Termasuk: tak ada ODC di dekat titik → LANJUT TANPA INDUK (jangan menebak), ganti induk,
 *          afirmasi bahasa nyata ("ok mas"), dan BATAL.
 * Caller: Jest.
 * Deps: ../network-asset.state (assetService di-inject penuh — tak menyentuh file/global).
 * SideEffects: Tidak ada (foto ditulis ke tmp, dibersihkan).
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const {
    startNetworkAssetSession,
    handleNetworkAssetConversationState,
    STEP_COLLECT,
    STEP_CONFIRM,
    STEP_PICK_PARENT
} = require("../network-asset.state");

const TMP = path.join(os.tmpdir(), `aset-test-${Date.now()}`);

function harness(overrides = {}) {
    let state = null;
    const created = [];
    const assetService = {
        createAsset: jest.fn(async (input) => {
            const asset = {
                id: input.type === "ODC" ? "ODC-BALEN-001" : "ODP-BALEN-002",
                ...input,
                capacity_ports: input.capacity_ports,
                ports_used: 0
            };
            created.push(input);
            return asset;
        }),
        findNearest: jest.fn(() => [
            { asset: { id: "ODC-BALEN-001", name: "ODC Balen" }, meters: 120 },
            { asset: { id: "ODC-PASAR-001", name: "ODC Pasar" }, meters: 870 }
        ]),
        getAssetConfig: () => ({ odpSuggestMaxMeters: 250, odcSuggestMaxMeters: 2000, defaultOdpCapacity: 8 }),
        mapsUrl: (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`,
        ...(overrides.assetService || {})
    };

    // assetService sudah digabung PARSIAL di atas — jangan biarkan `...overrides` menimpanya utuh.
    const { assetService: _svcOverride, ...restOverrides } = overrides;
    const base = {
        stateSender: "628999@s.whatsapp.net",
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((_k, s) => { state = s; }),
        deleteUserState: jest.fn(() => { state = null; }),
        downloadMedia: jest.fn(async () => Buffer.from([1, 2, 3, 4])),
        staff: { id: 3, username: "davin", name: "Davin", role: "teknisi" },
        uploadsBaseDir: TMP,
        logger: { error() {}, warn() {} },
        ...restOverrides,
        assetService
    };
    return { base, assetService, created, getState: () => state };
}

const locMsg = () => ({ message: { locationMessage: { degreesLatitude: -7.2501, degreesLongitude: 111.8401 } } });
const lastReply = (h) => h.base.reply.mock.calls.at(-1)[0];

// Lanjutkan percakapan: suntik state terakhir sebagai teknisiState (persis yang dilakukan raf.js).
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

describe("#ODP — jalur normal: nama + share lokasi, induk dipilihkan bot", () => {
    test("trigger membuka sesi & minta 2 hal saja", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });

        expect(h.getState().step).toBe(STEP_COLLECT);
        expect(h.getState().context).toMatchObject({ type: "ODP", name: "Balen 2" });
        expect(lastReply(h)).toContain("Share lokasi");
    });

    test("share lokasi → ODC TERDEKAT dipilih otomatis, teknisi tinggal mengiyakan", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });

        expect(h.getState().step).toBe(STEP_CONFIRM);
        const teks = lastReply(h);
        expect(teks).toContain("ODC Balen");
        expect(teks).toContain("120 m");
        expect(teks).toContain("dipilih otomatis"); // nol ketik: tak perlu hafal ID ODC
    });

    test("YA → tersimpan, dan bot MEMBUKTIKAN hasilnya (ID + kapasitas + induk + link peta)", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ya" });

        expect(h.assetService.createAsset).toHaveBeenCalledTimes(1);
        expect(h.created[0]).toMatchObject({
            type: "ODP",
            name: "Balen 2",
            latitude: -7.2501,
            longitude: 111.8401,
            parent_odc_id: "ODC-BALEN-001", // induk otomatis, bukan ketikan teknisi
            capacity_ports: 8, // default — teknisi tak perlu memutuskan
            created_by: "Davin",
            source: "wa"
        });

        const bukti = lastReply(h);
        expect(bukti).toContain("ODP-BALEN-002");
        expect(bukti).toContain("maps.google.com");
        expect(bukti).toContain("ODC Balen");
        expect(h.getState()).toBeNull(); // sesi ditutup
    });

    test("afirmasi bahasa nyata diterima ('ok mas'), bukan daftar cocok-persis", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ok mas" });

        expect(h.assetService.createAsset).toHaveBeenCalledTimes(1);
    });
});

describe("keputusan yang dibuang & pagar kejujuran", () => {
    test("angka polos = kapasitas port (tertulis di box)", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { chats: "16" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ya" });

        expect(h.created[0].capacity_ports).toBe(16);
    });

    test("TAK ADA ODC di sekitar → lanjut TANPA induk (jangan menebak induk yang jauh)", async () => {
        const h = harness({ assetService: { findNearest: jest.fn(() => []) } });
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Terpencil" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });

        expect(lastReply(h)).toContain("belum ada ODC terdaftar");

        await lanjut(h, { chats: "ya" });
        expect(h.created[0].parent_odc_id).toBeNull();
    });

    test("GANTI → daftar induk bernomor → pilih 2", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });

        await lanjut(h, { chats: "ganti" });
        expect(h.getState().step).toBe(STEP_PICK_PARENT);
        expect(lastReply(h)).toContain("ODC Pasar");

        await lanjut(h, { chats: "2" });
        expect(h.getState().step).toBe(STEP_CONFIRM);

        await lanjut(h, { chats: "ya" });
        expect(h.created[0].parent_odc_id).toBe("ODC-PASAR-001");
    });

    test("pilih 0 = tanpa induk", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ganti" });
        await lanjut(h, { chats: "0" });
        await lanjut(h, { chats: "ya" });

        expect(h.created[0].parent_odc_id).toBeNull();
    });

    test("BATAL → tak ada yang disimpan", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 2" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "batal" });

        expect(h.assetService.createAsset).not.toHaveBeenCalled();
        expect(h.getState()).toBeNull();
    });

    test("tanpa lokasi → TIDAK tersimpan (aset tanpa titik tak berguna di peta)", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODC Balen" });
        await lanjut(h, { chats: "ya" }); // "ya" saat masih COLLECT bukan konfirmasi

        expect(h.assetService.createAsset).not.toHaveBeenCalled();
        expect(h.getState().step).toBe(STEP_COLLECT);
    });

    test("#ODC tanpa nama → bot menanyakan namanya, nama diisi dari balasan", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODC" });
        expect(h.getState().context.name).toBe("");

        await lanjut(h, { chats: "Balen" });
        expect(h.getState().context.name).toBe("Balen");
    });

    test("ODC tidak mencari induk (induk hanya milik ODP)", async () => {
        const h = harness();
        await startNetworkAssetSession({ ...h.base, chats: "#ODC Balen" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ya" });

        expect(h.assetService.findNearest).not.toHaveBeenCalled();
        expect(h.created[0]).toMatchObject({ type: "ODC", parent_odc_id: null });
    });

    test("gagal simpan → pesan jujur, sesi TIDAK ditutup diam-diam", async () => {
        const h = harness({
            assetService: { createAsset: jest.fn(async () => { throw new Error("ODC Balen sudah penuh (2/2 ODP)."); }) }
        });
        await startNetworkAssetSession({ ...h.base, chats: "#ODP Balen 3" });
        await lanjut(h, { type: "locationMessage", msg: locMsg() });
        await lanjut(h, { chats: "ya" });

        expect(lastReply(h)).toContain("sudah penuh");
    });
});
