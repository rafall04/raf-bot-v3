/**
 * Header Doc
 * Purpose: Mengunci perbaikan #b251 di wizard PSB — (1) pemicu provisioning KEMBAR tidak boleh
 *          menjalankan pendaftaran dua kali, (2) teknisi harus menerima ack sebelum kerja panjang,
 *          (3) pesan gagal tidak boleh membocorkan galat database mentah, memvonis "gagal" saat
 *          pelanggannya sudah jadi, atau menjanjikan jalan pemulihan yang draft-nya sudah tiada.
 * Caller: Jest test runner.
 * Deps: `message/handlers/state-domains/psb.state`, mock `lib/genieacs-helper`.
 * MainFuncs: —
 * SideEffects: Menulis berkas sesi ke direktori sementara OS; dibersihkan di afterAll.
 */
"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");

jest.mock("../../../../lib/genieacs-helper", () => ({
    updatePsbDeviceConfig: jest.fn(async () => ({ ok: true, message: "ok" })),
}));

const { startPsbSession, handlePsbConversationState } = require("../psb.state");

const TMP = path.join(os.tmpdir(), `psb-kembar-test-${Date.now()}`);
const PACKAGES = [{ name: "PAKET-110K", profile: "16Mbps" }];
const STAFF = { id: 3, username: "davin", name: "Davin", role: "teknisi" };
const NOW = Date.parse("2026-07-04T10:20:00.000Z");
const CANDIDATES = [
    { deviceId: "dev-A", serialNumber: "48575443AAAA0001", model: "HG8145V5", currentPPPUsername: "tes@hw", registeredDate: "2026-07-04T10:05:00.000Z", registeredTimestamp: Date.parse("2026-07-04T10:05:00.000Z") },
];
const CAPTION = "#PSB\nNama: Budi Santoso\nDusun: Krajan\nRT/RW: 14/2\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";
const PPPOE = "budi_santoso-krajan@rafcybernet";

function memDraftStore(seed = null) {
    let draft = seed;
    return {
        putDraft: jest.fn((ownerKey, d) => { draft = { ownerKey, ...d }; return draft; }),
        getDraft: jest.fn(() => draft),
        removeDraft: jest.fn(() => { const ada = !!draft; draft = null; return ada; }),
    };
}

function harness(overrides = {}) {
    let state = null;
    const base = {
        stateSender: "628999@s.whatsapp.net",
        reply: jest.fn(async () => {}),
        setUserState: jest.fn((k, s) => { state = s; }),
        deleteUserState: jest.fn(() => { state = null; }),
        downloadMedia: jest.fn(async () => Buffer.from([1, 2, 3, 4])),
        findRecentPsbCandidates: jest.fn(async () => ({ ok: true, data: CANDIDATES })),
        fetchDeviceCapability: jest.fn(async () => ({ found: true, deviceId: "dev-A", model: "HG8145V5", has5G: true, expectedBulk: ["1", "5"] })),
        scheduleService: {
            getScheduleById: jest.fn(async () => null),
            markScheduleInstalled: jest.fn(async () => ({ ok: true, record: { ref: "PSB-5" } })),
            findOpenScheduleForInstall: jest.fn(async () => null),
            recordWalkInInstall: jest.fn(async () => ({ id: 1, ref: "PSB-1" })),
            getScheduleSummary: jest.fn(async () => ({ terpasang_bulan_ini: 7, belum_kepasang: 3 })),
        },
        usersService: { upsertUserFromAdminPanel: jest.fn(async () => ({ status: 201, body: { data: { id: 99 }, device_config: { attempted: true, ok: true } } })) },
        draftStore: memDraftStore(),
        modemProvenance: {
            ...require("../../../../lib/psb-modem-provenance"),
            loadActivePppoeUsernames: jest.fn(async () => new Set(["tes@hw"])),
        },
        oltRepository: { getModemStateByPppoe: jest.fn(async () => null) },
        getUsers: () => global.users || [],
        getConfig: () => ({ psbIntake: { enabled: true, groupId: "grp@g.us", recencyWindowMinutes: 120 }, defaultBulkSSID: "1" }),
        packages: PACKAGES,
        uploadsBaseDir: TMP,
        sendGroupSummary: jest.fn(async () => {}),
        nowMs: NOW,
        logger: { error() {}, warn() {}, log() {} },
        ...overrides,
    };
    return { base, getState: () => state };
}

const imageMsg = (caption) => ({ message: { imageMessage: caption ? { caption } : {} } });
const locMsg = () => ({ message: { locationMessage: { degreesLatitude: -7.1, degreesLongitude: 111.9 } } });

async function sampaiKonfirmasi(h) {
    await startPsbSession({ ...h.base, type: "imageMessage", caption: CAPTION, msg: imageMsg(CAPTION), staff: STAFF });
    await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
    await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
}

const kirim = (h, state, teks) => handlePsbConversationState({
    ...h.base, stateStep: state.step, teknisiState: state, type: "conversation", chats: teks,
});

const semuaBalasan = (h) => h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n");

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) { /* noop */ } });
beforeEach(() => { global.users = []; });

describe("#b251 — pemicu provisioning kembar", () => {
    test("pemicu KEDUA saat yang pertama masih jalan → pendaftaran hanya SEKALI", async () => {
        // Insiden nyata 2026-08-20: teknisi mengetik "verifikasi" lalu "VERIFIKASI" berselang
        // 11 detik; keduanya jalan dan saling menabrak.
        let lepaskan;
        const upsert = jest.fn(() => new Promise((resolve) => { lepaskan = resolve; }));
        const h = harness({ usersService: { upsertUserFromAdminPanel: upsert } });
        await sampaiKonfirmasi(h);
        const state = h.getState();

        const jalan1 = kirim(h, state, "YA");   // masih menggantung di upsert
        await kirim(h, state, "YA");            // pemicu kembar

        expect(upsert).toHaveBeenCalledTimes(1);
        expect(semuaBalasan(h)).toMatch(/masih saya kerjakan/i);

        lepaskan({ status: 201, body: { data: { id: 99 }, device_config: { attempted: true, ok: true } } });
        await jalan1;
    });

    test("kunci dilepas setelah selesai — pendaftaran BERIKUTNYA tetap bisa jalan", async () => {
        const h = harness();
        await sampaiKonfirmasi(h);
        await kirim(h, h.getState(), "YA");
        expect(h.base.usersService.upsertUserFromAdminPanel).toHaveBeenCalledTimes(1);

        const h2 = harness();
        await sampaiKonfirmasi(h2);
        await kirim(h2, h2.getState(), "YA");
        expect(h2.base.usersService.upsertUserFromAdminPanel).toHaveBeenCalledTimes(1);
    });

    test("ack terkirim SEBELUM kerja panjang — diamnya bot yang mengundang teknisi mengulang", async () => {
        let lepaskan;
        const upsert = jest.fn(() => new Promise((resolve) => { lepaskan = resolve; }));
        const h = harness({ usersService: { upsertUserFromAdminPanel: upsert } });
        await sampaiKonfirmasi(h);

        const jalan = kirim(h, h.getState(), "YA");
        await new Promise((r) => setImmediate(r));

        expect(semuaBalasan(h)).toMatch(/sedang saya kerjakan/i);

        lepaskan({ status: 201, body: { data: { id: 99 }, device_config: { attempted: true, ok: true } } });
        await jalan;
    });
});

describe("#b251 — pesan gagal harus jujur", () => {
    test("pelanggannya ternyata SUDAH terdaftar → jangan divonis gagal", async () => {
        // URUTANNYA PENTING dan harus meniru insiden aslinya: saat layar konfirmasi dirakit,
        // barisnya BELUM ada (username jadi `...krajan@`, tanpa akhiran angka). Baris itu baru
        // muncul beberapa detik kemudian — ditulis oleh eksekusi KEMBARAN yang lebih dulu selesai.
        // Kalau `global.users` diisi sebelum konfirmasi, bot justru merakit `...krajan2@` dan
        // tesnya menguji keadaan yang tak pernah terjadi.
        const upsert = jest.fn(async () => { throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: users.id"); });
        const h = harness({ usersService: { upsertUserFromAdminPanel: upsert } });
        await sampaiKonfirmasi(h);
        global.users = [{ id: 87, name: "Budi Santoso", pppoe_username: PPPOE }];
        await kirim(h, h.getState(), "YA");

        const balasan = semuaBalasan(h);
        expect(balasan).toMatch(/SUDAH BERHASIL/i);
        expect(balasan).not.toMatch(/SQLITE|UNIQUE constraint/i);
    });

    test("gagal beneran → sebab dalam bahasa manusia, TANPA jargon database", async () => {
        const upsert = jest.fn(async () => { throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: users.id"); });
        const h = harness({ usersService: { upsertUserFromAdminPanel: upsert } });
        await sampaiKonfirmasi(h);
        await kirim(h, h.getState(), "YA");

        const balasan = semuaBalasan(h);
        expect(balasan).not.toMatch(/SQLITE|UNIQUE constraint/i);
        expect(balasan).toMatch(/belum jadi/i);
    });

    test("draft sudah tiada → JANGAN menjanjikan '#PSB lalu LANJUT'", async () => {
        const upsert = jest.fn(async () => { throw new Error("router tidak bisa dihubungi"); });
        const store = memDraftStore();
        const h = harness({ usersService: { upsertUserFromAdminPanel: upsert }, draftStore: store });
        await sampaiKonfirmasi(h);
        // Kembaran yang sukses menghapus draft — persis yang terjadi pada insiden.
        store.getDraft.mockReturnValue(null);
        await kirim(h, h.getState(), "YA");

        const balasan = semuaBalasan(h);
        expect(balasan).toMatch(/perlu diulang dari/i);
        expect(balasan).not.toMatch(/Datamu SAYA SIMPAN/i);
    });

    test("galat HP ganda TIDAK boleh dibaca sebagai bentrok PPPoE", async () => {
        // `lib/phone-validator-international.js` memulangkan "Duplicate phone numbers found in
        // input". Cabang `duplicate` generik akan menyuruh teknisi membetulkan nama PPPoE —
        // hal yang sama sekali tidak rusak.
        const upsert = jest.fn(async () => { throw new Error("Duplicate phone numbers found in input"); });
        const h = harness({ usersService: { upsertUserFromAdminPanel: upsert } });
        await sampaiKonfirmasi(h);
        await kirim(h, h.getState(), "YA");

        const balasan = semuaBalasan(h);
        expect(balasan).toMatch(/nomor HP/i);
        expect(balasan).not.toMatch(/PPPoE-nya sudah dipakai/i);
    });

    test("draft MASIH ada → jalan pemulihan boleh dijanjikan", async () => {
        const upsert = jest.fn(async () => { throw new Error("router tidak bisa dihubungi"); });
        const h = harness({ usersService: { upsertUserFromAdminPanel: upsert } });
        await sampaiKonfirmasi(h);
        await kirim(h, h.getState(), "YA");

        expect(semuaBalasan(h)).toMatch(/Datamu SAYA SIMPAN/i);
    });
});
