/**
 * Header Doc
 * Purpose: Test wizard PSB DM (psb.state) — happy path (KTP→rumah→lokasi→YA→provision+summary),
 *          TIDAK→pilih nomor, BATAL, dan gate dokumen wajib sebelum konfirmasi modem.
 * Caller: Jest.
 * Deps: ../../state-domains/psb.state (deps di-inject).
 * SideEffects: Tulis file dummy ke tmp (dibersihkan afterAll).
 */
"use strict";

const os = require("os");
const fs = require("fs");
const path = require("path");
const { startPsbSession, handlePsbConversationState, handlePsbStateTimeout, buildPppoeUsername, isPsbTutorialTrigger, psbTutorialText, parsePsbScheduleRef, stickerSn, snText } = require("../psb.state");

// Push susulan WiFi (koreksi band) menyentuh GenieACS → di-mock supaya test tak menembak ACS nyata.
jest.mock("../../../../lib/genieacs-helper", () => ({
    updatePsbDeviceConfig: jest.fn(async () => ({ ok: true, message: "ok" }))
}), { virtual: false });
const { updatePsbDeviceConfig: mockPushDevice } = require("../../../../lib/genieacs-helper");

const TMP = path.join(os.tmpdir(), `psb-dm-test-${Date.now()}`);
const PACKAGES = [{ name: "PAKET-110K", profile: "16Mbps" }];
const STAFF = { id: 3, username: "davin", name: "Davin", role: "teknisi" };
const NOW = Date.parse("2026-07-04T10:20:00.000Z");
const CANDIDATES = [
    { deviceId: "dev-A", serialNumber: "48575443AAAA0001", model: "HG8145V5", currentPPPUsername: "tes@hw", registeredDate: "2026-07-04T10:05:00.000Z", registeredTimestamp: Date.parse("2026-07-04T10:05:00.000Z") },
    { deviceId: "dev-B", serialNumber: "48575443BBBB0002", model: "HS8346R5", currentPPPUsername: "old@x", registeredDate: "2026-07-04T09:40:00.000Z", registeredTimestamp: Date.parse("2026-07-04T09:40:00.000Z") }
];
const CAPTION = "#PSB\nNama: Budi Santoso\nDusun: Krajan\nRT/RW: 14/2\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";

// Draft durabel di-stub IN-MEMORY. Store aslinya menulis ke `database/psb-drafts_test.json` yang
// dipakai bersama SELURUH suite (dan bertahan antar-run), sehingga draft sisa satu test membajak
// `#PSB` test berikutnya — bot menawarkan LANJUT alih-alih membuka sesi baru. Stub ini membuat tiap
// harness() mulai bersih; test yang memang menguji jalur lanjut menyuntik draft lewat `seed`.
function memDraftStore(seed = null) {
    let draft = seed;
    return {
        putDraft: jest.fn((ownerKey, d) => {
            draft = { ownerKey, ...d, createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };
            return draft;
        }),
        getDraft: jest.fn(() => draft),
        removeDraft: jest.fn(() => { const ada = !!draft; draft = null; return ada; })
    };
}

function harness(overrides = {}) {
    let state = null;
    const setUserState = jest.fn((k, s) => { state = s; });
    const deleteUserState = jest.fn(() => { state = null; });
    const upsert = jest.fn(async () => ({ status: 201, body: { data: { id: 99 }, device_config: { attempted: true, ok: true, message: "ok" } } }));
    const base = {
        stateSender: "628999@s.whatsapp.net",
        reply: jest.fn(async () => {}),
        setUserState,
        deleteUserState,
        downloadMedia: jest.fn(async () => Buffer.from([1, 2, 3, 4])),
        findRecentPsbCandidates: jest.fn(async () => ({ ok: true, data: CANDIDATES })),
        fetchDeviceCapability: jest.fn(async () => ({ found: true, deviceId: "dev-A", model: "HG8145V5", has5G: true, expectedBulk: ["1", "5"] })),
        scheduleService: {
            getScheduleById: jest.fn(async () => null),
            markScheduleInstalled: jest.fn(async () => ({ ok: true, record: { ref: "PSB-5" } })),
            findOpenScheduleForInstall: jest.fn(async () => null),
            recordWalkInInstall: jest.fn(async () => ({ id: 1, ref: "PSB-1" })),
            getScheduleSummary: jest.fn(async () => ({ terpasang_bulan_ini: 7, belum_kepasang: 3 }))
        },
        usersService: { upsertUserFromAdminPanel: upsert },
        draftStore: memDraftStore(),
        // Klasifikasi asal-usul modem pakai modul ASLI, tapi dua sumber I/O-nya distub:
        // sesi PPPoE MikroTik & riwayat OLT. Tanpa ini tiap test menembak router sungguhan (~6 dtk).
        modemProvenance: {
            ...require("../../../../lib/psb-modem-provenance"),
            // `tes@hw` SENGAJA ada di daftar sesi aktif: modem polos yang menyala memang memegang
            // sesi kredensial bawaan — itulah cara dia online. Stub Set kosong (dipakai sebelumnya)
            // menggambarkan keadaan yang tak pernah terjadi di lapangan dan menyembunyikan regresi
            // Tanjungharjo 2026-08-02 (setiap modem baru divonis "TERPAKAI pelanggan lain").
            loadActivePppoeUsernames: jest.fn(async () => new Set(["tes@hw"]))
        },
        oltRepository: { getModemStateByPppoe: jest.fn(async () => null) },
        getUsers: () => global.users || [],
        getConfig: () => ({ psbIntake: { enabled: true, groupId: "grp@g.us", recencyWindowMinutes: 120 }, defaultBulkSSID: "1" }),
        packages: PACKAGES,
        uploadsBaseDir: TMP,
        sendGroupSummary: jest.fn(async () => {}),
        nowMs: NOW,
        logger: { error() {}, warn() {}, log() {} },
        ...overrides
    };
    return { base, getState: () => state };
}

function imageMsg(caption) { return { message: { imageMessage: caption ? { caption } : {} } }; }
function locMsg() { return { message: { locationMessage: { degreesLatitude: -7.1, degreesLongitude: 111.9 } } }; }

afterAll(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) { /* noop */ } });
beforeEach(() => { global.users = []; });

async function reachConfirm(h) {
    await startPsbSession({ ...h.base, type: "imageMessage", caption: CAPTION, msg: imageMsg(CAPTION), staff: STAFF });
    // foto rumah
    await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
    // share lokasi → memicu deteksi + konfirmasi
    await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
}

describe("psb.state wizard DM", () => {
    test("happy path: KTP→rumah→lokasi→YA → provision modem terpilih + ringkasan grup", async () => {
        const h = harness();
        await reachConfirm(h);
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
        expect(h.getState().context.candidate.deviceId).toBe("dev-A");
        expect(h.base.findRecentPsbCandidates).toHaveBeenCalled();

        // Layar verifikasi menampilkan username rakitan + recap sebelum eksekusi.
        const recap = h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n");
        expect(recap).toMatch(/CEK DULU/);
        expect(recap).toContain("budi_santoso-krajan@rafcybernet");

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        expect(h.base.usersService.upsertUserFromAdminPanel).toHaveBeenCalledTimes(1);
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData).toMatchObject({ name: "Budi Santoso", phone_number: "08123456789", subscription: "PAKET-110K", device_id: "dev-A", registration_mode: "new" });
        // Modem dual-band (fetchDeviceCapability has5G) → set 2.4G+5G, BUKAN default global.
        expect(arg.userData.ssid_indices).toEqual(["1", "5"]);
        // Username dirakit dari Nama+Dusun; password pakai default (harness tak set → fallback rafnet123), BUKAN acak.
        expect(arg.userData.pppoe_username).toBe("budi_santoso-krajan@rafcybernet");
        expect(arg.userData.pppoe_password).toBe("rafnet123");
        // REGRESI (bug "share lokasi pelanggan baru tidak terdeteksi"): lokasi WAJIB di wizard &
        // sudah ditulis ke lokasi.json, TAPI dulu ctx.lokasi TIDAK dikirim ke create API sehingga
        // koordinat tak pernah sampai ke tabel users. Test lama hanya assert SEBAGIAN userData →
        // lokasi tak pernah dicek → bug lolos. Sekarang dikunci.
        expect(arg.userData.latitude).toBe(-7.1);
        expect(arg.userData.longitude).toBe(111.9);
        expect(arg.userData.maps_url).toContain("-7.1,111.9");
        // Push modem OK (device_config.ok) → reply boleh klaim "online" + sebut band 5GHz.
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n")).toMatch(/online/i);
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n")).toMatch(/5GHz/);
        expect(h.base.sendGroupSummary).toHaveBeenCalledTimes(1);
        expect(h.getState()).toBeNull(); // state dibersihkan setelah selesai
    });

    test("ODP terdekat DIUSULKAN di layar konfirmasi & ikut tersimpan saat YA (nol ketik)", async () => {
        const h = harness({
            assetService: {
                suggestOdpForPoint: jest.fn(() => [
                    { asset: { id: "ODP-BALEN-002", name: "ODP Balen 2" }, meters: 35, status: { sisa: 6 } }
                ])
            }
        });
        await reachConfirm(h);

        // Nebeng layar konfirmasi yang SUDAH ada (SN modem) → tak menambah langkah bagi teknisi,
        // tapi usulan ODP tetap lewat MATA MANUSIA sebelum tersimpan (jarak = tebakan, bukan kebenaran).
        const konfirmasi = h.base.reply.mock.calls.at(-1)[0];
        expect(konfirmasi).toContain("ODP Balen 2");
        expect(konfirmasi).toContain("35 m");
        expect(konfirmasi).toContain("sisa 6 port");

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.connected_odp_id).toBe("ODP-BALEN-002");
    });

    test("tak ada ODP terdaftar di dekat rumah → JUJUR & lanjut TANPA ODP (jangan menebak)", async () => {
        const h = harness({ assetService: { suggestOdpForPoint: jest.fn(() => []) } });
        await reachConfirm(h);

        expect(h.base.reply.mock.calls.at(-1)[0]).toContain("belum ada ODP terdaftar");

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.connected_odp_id).toBeUndefined();
    });

    test("dokumen WAJIB: sebelum rumah+lokasi lengkap, modem TIDAK dibaca & TIDAK provision", async () => {
        const h = harness();
        await startPsbSession({ ...h.base, type: "imageMessage", caption: CAPTION, msg: imageMsg(CAPTION), staff: STAFF });
        // hanya kirim lokasi (belum foto rumah)
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.getState().step).toBe("PSB_COLLECT_DOCS");
        expect(h.base.findRecentPsbCandidates).not.toHaveBeenCalled();
        expect(h.base.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
    });

    test("TIDAK → daftar bernomor → pilih 2 → provision dev-B", async () => {
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "TIDAK" });
        expect(h.getState().step).toBe("PSB_PICK_MODEM");

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "2" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.device_id).toBe("dev-B");
    });

    test("BATAL saat konfirmasi → state dihapus, TANPA provision", async () => {
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "batal" });
        expect(h.getState()).toBeNull();
        expect(h.base.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
    });

    test("caption minim (#PSB + Nama saja) → sesi TETAP dibuka (slot-filling), checklist minta sisanya", async () => {
        const h = harness();
        const r = await startPsbSession({ ...h.base, type: "imageMessage", caption: "#PSB\nNama: Budi", msg: imageMsg("#PSB\nNama: Budi"), staff: STAFF });
        expect(r.started).toBe(true);
        expect(h.getState().step).toBe("PSB_COLLECT_DOCS");
        expect(h.getState().context.data.nama).toBe("Budi");
        const reply = h.base.reply.mock.calls.map((c) => c[0]).join("\n");
        expect(reply).toMatch(/lengkapi/i);
        expect(reply).toMatch(/Dusun/); // masih diminta
    });

    test("dusun tetap WAJIB: tak ke konfirmasi tanpa dusun walau field lain + foto + lokasi lengkap", async () => {
        const h = harness();
        const cap = "#PSB\nNama: Budi Santoso\nRT/RW: 14/2\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789"; // tanpa dusun
        await startPsbSession({ ...h.base, type: "imageMessage", caption: cap, msg: imageMsg(cap), staff: STAFF });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.getState().step).toBe("PSB_COLLECT_DOCS"); // masih nunggu dusun
        expect(h.base.findRecentPsbCandidates).not.toHaveBeenCalled();
        // kirim dusun → baru lengkap → konfirmasi
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Dusun: Krajan" });
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
        expect(h.base.findRecentPsbCandidates).toHaveBeenCalled();
    });

    test("slot-filling URUTAN BEBAS: KTP #PSB → foto rumah → lokasi → data TERAKHIR → konfirmasi", async () => {
        const h = harness();
        const r = await startPsbSession({ ...h.base, type: "imageMessage", caption: "#PSB", msg: imageMsg("#PSB"), staff: STAFF });
        expect(r.started).toBe(true);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.getState().step).toBe("PSB_COLLECT_DOCS"); // data belum ada → belum baca modem
        expect(h.base.findRecentPsbCandidates).not.toHaveBeenCalled();
        // data dikirim TERAKHIR (sekaligus)
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Nama: Budi Santoso\nDusun: Krajan\nRT/RW: 14/2\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789" });
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
    });

    test("slot-filling: data DICICIL beberapa pesan → digabung", async () => {
        const h = harness();
        await startPsbSession({ ...h.base, type: "imageMessage", caption: "#PSB\nNama: Budi Santoso", msg: imageMsg("#PSB\nNama: Budi Santoso"), staff: STAFF });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Dusun: Krajan\nRT/RW: 14/2" });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Paket: PAKET-110K\nWiFi: BudiNet" });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Sandi: budi12345\nHP: 08123456789" });
        expect(h.getState().context.data.dusun).toBe("Krajan");
        expect(h.getState().step).toBe("PSB_COLLECT_DOCS"); // data lengkap tapi belum foto/lokasi
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
    });

    test("realm & password default dari config dipakai untuk username/secret", async () => {
        const h = harness({ getConfig: () => ({ psbIntake: { enabled: true, groupId: "grp@g.us", recencyWindowMinutes: 120, pppoeRealm: "@myisp" }, defaultBulkSSID: "1", defaultPPPoEPassword: "sandi999" }) });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.pppoe_username).toBe("budi_santoso-krajan@myisp");
        expect(arg.userData.pppoe_password).toBe("sandi999");
    });

    test("default: TANPA config.psbIntake.freeInstallMonth → free_first_month tidak diaktifkan", async () => {
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.free_first_month).toBe(false);
    });

    test("psbIntake.freeInstallMonth ON → PSB baru bebas tagihan bulan pemasangan (free_first_month:true)", async () => {
        const h = harness({ getConfig: () => ({ psbIntake: { enabled: true, groupId: "grp@g.us", recencyWindowMinutes: 120, freeInstallMonth: true }, defaultBulkSSID: "1" }) });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.free_first_month).toBe(true);
    });

    test("push modem GAGAL (device_config_failed) → reply JUJUR (bukan 'online!') + grup minta tindak lanjut", async () => {
        const failUpsert = jest.fn(async () => ({
            status: 201,
            body: { data: { id: 99 }, device_config: { attempted: true, ok: false, message: "timeout ACS" }, warning: "device_config_failed" }
        }));
        const h = harness({ usersService: { upsertUserFromAdminPanel: failUpsert } });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        const allReplies = h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n");
        expect(allReplies).toMatch(/GAGAL/);
        expect(allReplies).toMatch(/manual/i);
        expect(allReplies).not.toContain("online!"); // anti sukses-semu
        const summary = h.base.sendGroupSummary.mock.calls.map((c) => c[1]).join("\n");
        expect(summary).toMatch(/tindak lanjut/i);
        expect(h.getState()).toBeNull(); // pelanggan tetap terdaftar, sesi ditutup
    });

    test("modem SINGLE-band → hanya set SSID 2.4GHz (index 1), tak nembak index 5", async () => {
        const h = harness({ fetchDeviceCapability: jest.fn(async () => ({ found: true, deviceId: "dev-A", model: "HG8145", has5G: false, expectedBulk: ["1"] })) });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.ssid_indices).toEqual(["1"]);
        const allReplies = h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n");
        expect(allReplies).toMatch(/2\.4GHz/);
        expect(allReplies).not.toMatch(/5GHz/);
    });

    test("kapabilitas band GAGAL dibaca → fallback ke default config + peringatan", async () => {
        const h = harness({
            fetchDeviceCapability: jest.fn(async () => ({ found: false, deviceId: "dev-A" })),
            getConfig: () => ({ psbIntake: { enabled: true, groupId: "grp@g.us", recencyWindowMinutes: 120 }, defaultBulkSSID: "1,5" })
        });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.ssid_indices).toEqual(["1", "5"]); // dari defaultBulkSSID, bukan deteksi
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n---\n")).toMatch(/tak terbaca/);
    });

    test("HP multi-nomor → diteruskan ke create sbg phone_number pipe (628a|628b)", async () => {
        const cap = "#PSB\nNama: Budi Santoso\nDusun: Krajan\nRT/RW: 14/2\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789|6285700000002";
        const h = harness();
        await startPsbSession({ ...h.base, type: "imageMessage", caption: cap, msg: imageMsg(cap), staff: STAFF });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.phone_number).toBe("08123456789|6285700000002");
    });

    test("revisi: SN LENGKAP + password PPPoE DISEMBUNYIKAN + rekap bulanan di ringkasan grup", async () => {
        const h = harness();
        await reachConfirm(h);
        const recap = h.base.reply.mock.calls.map((c) => c[0]).join("\n");
        expect(recap).toContain("budi_santoso-krajan@rafcybernet"); // username tetap tampil
        expect(recap).not.toContain("rafnet123");                    // password PPPoE default disembunyikan
        expect(recap).toContain("48575443AAAA0001");                 // SN LENGKAP
        expect(recap).not.toMatch(/…/);                              // tak ada elipsis SN

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        const allReplies = h.base.reply.mock.calls.map((c) => c[0]).join("\n");
        expect(allReplies).toContain("48575443AAAA0001");   // SN lengkap di reply sukses
        expect(allReplies).not.toContain("rafnet123");      // tetap tanpa password

        // Fase C: tanpa jadwal cocok → dicatat walk-in + rangkuman dari getScheduleSummary (bukan psb-install-stats)
        expect(h.base.scheduleService.findOpenScheduleForInstall).toHaveBeenCalledTimes(1);
        expect(h.base.scheduleService.recordWalkInInstall).toHaveBeenCalledTimes(1);
        expect(h.base.scheduleService.getScheduleSummary).toHaveBeenCalled();
        const summary = h.base.sendGroupSummary.mock.calls.map((c) => c[1]).join("\n");
        expect(summary).toMatch(/Bulan ini: 7 terpasang/);
        expect(summary).toContain("48575443AAAA0001");
        expect(summary).not.toContain("rafnet123");
    });

    test("Fase C: ada jadwal cocok (by HP) → markScheduleInstalled + reply sebut jadwal ditutup", async () => {
        const h = harness({
            scheduleService: {
                findOpenScheduleForInstall: jest.fn(async () => ({ id: 12, ref: "PSB-12" })),
                markScheduleInstalled: jest.fn(async () => ({ ok: true, record: { ref: "PSB-12" } })),
                recordWalkInInstall: jest.fn(async () => ({ id: 1, ref: "PSB-1" })),
                getScheduleSummary: jest.fn(async () => ({ terpasang_bulan_ini: 4, belum_kepasang: 2 }))
            }
        });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        // jadwal cocok → ditutup, BUKAN walk-in
        expect(h.base.scheduleService.markScheduleInstalled).toHaveBeenCalledWith(12, 99, expect.anything());
        expect(h.base.scheduleService.recordWalkInInstall).not.toHaveBeenCalled();
        const allReplies = h.base.reply.mock.calls.map((c) => c[0]).join("\n");
        expect(allReplies).toContain("PSB-12"); // reply teknisi sebut jadwal ditutup
    });

    test("KTP WAJIB: foto KTP gagal diunduh → sesi tak dibuka (S1)", async () => {
        const h = harness({ downloadMedia: jest.fn(async () => null) });
        const r = await startPsbSession({ ...h.base, type: "imageMessage", caption: CAPTION, msg: imageMsg(CAPTION), staff: STAFF });
        expect(r.started).toBe(false);
        expect(h.getState()).toBeNull();
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n")).toMatch(/KTP gagal/i);
    });
});

describe("buildPppoeUsername", () => {
    test("rakit baku: nama(spasi→_) - dusun @ realm, semua huruf kecil", () => {
        expect(buildPppoeUsername("Agus Suprihono", "Tanjungharjo", "rafcybernet", [])).toBe("agus_suprihono-tanjungharjo@rafcybernet");
    });
    test("realm boleh diawali @ (ditoleransi, tak dobel)", () => {
        expect(buildPppoeUsername("Budi", "Krajan", "@rafcybernet", [])).toBe("budi-krajan@rafcybernet");
    });
    test("realm default rafcybernet bila tak diberikan", () => {
        expect(buildPppoeUsername("Budi", "Krajan", undefined, [])).toBe("budi-krajan@rafcybernet");
    });
    test("dedup angka bila bentrok dgn user existing", () => {
        const existing = [{ pppoe_username: "budi-krajan@rafcybernet" }];
        expect(buildPppoeUsername("Budi", "Krajan", "rafcybernet", existing)).toBe("budi-krajan2@rafcybernet");
    });
    test("dusun kosong → jatuh ke nama saja (graceful; wizard mewajibkan dusun di depan)", () => {
        expect(buildPppoeUsername("Putri", "", "rafcybernet", [])).toBe("putri@rafcybernet");
    });
});

describe("panduan PSB (tutorial)", () => {
    test("isPsbTutorialTrigger cocok utk #psb / psb tutorial / panduan psb, TIDAK utk bare 'psb'", () => {
        expect(isPsbTutorialTrigger("#psb")).toBe(true);
        expect(isPsbTutorialTrigger("psb tutorial")).toBe(true);
        expect(isPsbTutorialTrigger("#PSB Tutorial")).toBe(true);
        expect(isPsbTutorialTrigger("panduan psb")).toBe(true);
        expect(isPsbTutorialTrigger("format psb")).toBe(true);
        expect(isPsbTutorialTrigger("psb format")).toBe(true);
        expect(isPsbTutorialTrigger("  tutorial psb  ")).toBe(true);
        expect(isPsbTutorialTrigger("psb")).toBe(false); // bare, ambigu → tak memicu
        expect(isPsbTutorialTrigger("cek koneksi")).toBe(false);
        expect(isPsbTutorialTrigger("")).toBe(false);
    });

    test("psbTutorialText memuat penanda kunci + template + peringatan dusun + logic SLOT-FILLING", () => {
        const t = psbTutorialText();
        expect(t).toMatch(/PANDUAN PSB/);
        expect(t).toContain("#PSB");
        expect(t).toMatch(/Dusun/);
        expect(t).toMatch(/BATAL/);
        expect(t).toMatch(/5GHz/);
        // Logic terkini (slot-filling): data boleh menyusul, urutan bebas, checklist.
        expect(t).toMatch(/URUTAN BEBAS/i);
        expect(t).toMatch(/menyusul|dicicil/i);
        expect(t).toMatch(/checklist/i);
    });

    // Panduan WA harus SELALU menggambarkan format yang benar-benar diminta wizard — panduan basi
    // lebih buruk daripada tak ada panduan (teknisi mengikuti contoh yang lalu ditolak bot).
    test("panduan WA menjelaskan format TERBARU: RT/RW, dusun bernomor, alamat otomatis, label modem, cari", () => {
        const t = psbTutorialText();
        expect(t).toMatch(/RT\/RW/);
        expect(t).toContain("14/2");
        expect(t).toMatch(/balas \*angka\*/i);          // dusun dipilih bernomor
        expect(t).toMatch(/Alamat:/);                    // jalan keluar alamat bebas
        expect(t).toMatch(/alamat lengkap \(Dusun\+RT\/RW\+Desa\+Kec\)/i);
        expect(t).toMatch(/cari /);                      // pencarian modem bekas
        expect(t).toMatch(/BEKAS/);
        expect(t).toMatch(/TERPAKAI/);
    });

    test("template caption yang dikirim bot memuat baris RT/RW", () => {
        expect(psbTutorialText()).toMatch(/RT\/RW: \(mis\. 14\/2\)/);
    });
});

describe("PSB Fase C/2 — link ke jadwal (#PSB PSB-<n>)", () => {
    test("parsePsbScheduleRef: butuh #psb + PSB-<n> (hyphen); tolak tanpa hyphen / tanpa #psb", () => {
        expect(parsePsbScheduleRef("#PSB PSB-12")).toBe(12);
        expect(parsePsbScheduleRef("#psb psb-5")).toBe(5);
        expect(parsePsbScheduleRef("#PSB")).toBeNull();
        expect(parsePsbScheduleRef("#PSB Nama: Budi")).toBeNull();
        expect(parsePsbScheduleRef("#PSB paket PSB2")).toBeNull(); // tanpa hyphen → bukan ref
        expect(parsePsbScheduleRef("PSB-12")).toBeNull();          // tanpa #psb
    });

    const SCHED = {
        id: 12, ref: "PSB-12", name: "Budi Santoso", phone_number: "081234567890",
        dusun: "Krajan", paket: "PAKET-110K", latitude: -7.12, longitude: 111.45,
        ktp_photo_path: "/uploads/psb-jadwal/x/ktp.jpg", house_photo_path: "/uploads/psb-jadwal/x/rumah.jpg", status: "ditugaskan"
    };

    test("#PSB PSB-12 (TEKS, tanpa foto) → pre-fill data+bukti dari jadwal; sisakan WiFi (checklist)", async () => {
        const h = harness({ scheduleService: { getScheduleById: jest.fn(async () => SCHED), markScheduleInstalled: jest.fn(), findOpenScheduleForInstall: jest.fn(), recordWalkInInstall: jest.fn(), getScheduleSummary: jest.fn() } });
        const r = await startPsbSession({ ...h.base, type: "conversation", caption: "#PSB PSB-12", chats: "#PSB PSB-12", msg: {}, staff: STAFF });
        expect(r.started).toBe(true);
        expect(r.linked).toBe("PSB-12");
        const st = h.getState();
        expect(st.step).toBe("PSB_COLLECT_DOCS"); // WiFi belum ada (jadwal tak bawa WiFi) → checklist
        expect(st.context.scheduleId).toBe(12);
        expect(st.context.data.nama).toBe("Budi Santoso");
        expect(st.context.data.hp).toBe("081234567890");
        expect(st.context.data.dusun).toBe("Krajan");
        expect(st.context.data.paket).toBe("PAKET-110K");
        expect(st.context.ktpSaved).toBe(true);   // bukti dari jadwal (nol upload ulang)
        expect(st.context.rumahSaved).toBe(true);
        expect(st.context.lokasi).toEqual({ lat: -7.12, lng: 111.45 });
        const replies = h.base.reply.mock.calls.map((c) => c[0]).join("\n");
        expect(replies).toMatch(/PSB-12/);
        expect(replies).toMatch(/WiFi/i); // minta lengkapi WiFi
    });

    test("link → isi WiFi → YA → provision menutup jadwal EKSPLISIT (markScheduleInstalled scheduleId, bukan auto-match)", async () => {
        const markInstalled = jest.fn(async () => ({ ok: true, record: { ref: "PSB-12" } }));
        const h = harness({ scheduleService: { getScheduleById: jest.fn(async () => SCHED), markScheduleInstalled: markInstalled, findOpenScheduleForInstall: jest.fn(async () => null), recordWalkInInstall: jest.fn(), getScheduleSummary: jest.fn(async () => ({ terpasang_bulan_ini: 3, belum_kepasang: 1 })) } });
        await startPsbSession({ ...h.base, type: "conversation", caption: "#PSB PSB-12", chats: "#PSB PSB-12", msg: {}, staff: STAFF });
        // lengkapi WiFi → melengkapi data → deteksi modem → STEP_CONFIRM
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "WiFi: RumahBudi\nSandi: rahasia123\nRT/RW: 14/2" });
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        // link EKSPLISIT via ctx.scheduleId → auto-match & walk-in TAK dipakai
        expect(markInstalled).toHaveBeenCalledWith(12, 99, expect.anything());
        expect(h.base.scheduleService.findOpenScheduleForInstall).not.toHaveBeenCalled();
        expect(h.base.scheduleService.recordWalkInInstall).not.toHaveBeenCalled();
    });

    test("#PSB PSB-99 tak ditemukan → tolak, tak buka sesi", async () => {
        const h = harness({ scheduleService: { getScheduleById: jest.fn(async () => null), markScheduleInstalled: jest.fn(), findOpenScheduleForInstall: jest.fn(), recordWalkInInstall: jest.fn(), getScheduleSummary: jest.fn() } });
        const r = await startPsbSession({ ...h.base, type: "conversation", caption: "#PSB PSB-99", chats: "#PSB PSB-99", msg: {}, staff: STAFF });
        expect(r.started).toBe(false);
        expect(h.getState()).toBeNull();
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n")).toMatch(/tak ditemukan/i);
    });

    test("#PSB PSB-12 yang sudah terpasang → tolak (tak pasang ulang)", async () => {
        const h = harness({ scheduleService: { getScheduleById: jest.fn(async () => ({ ...SCHED, status: "terpasang" })), markScheduleInstalled: jest.fn(), findOpenScheduleForInstall: jest.fn(), recordWalkInInstall: jest.fn(), getScheduleSummary: jest.fn() } });
        const r = await startPsbSession({ ...h.base, type: "conversation", caption: "#PSB PSB-12", chats: "#PSB PSB-12", msg: {}, staff: STAFF });
        expect(r.started).toBe(false);
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n")).toMatch(/sudah \*terpasang\*/i);
    });
});

// ── Alamat & dusun (P1): teknisi hanya mengetik RT/RW, sisanya dirakit bot ──
describe("PSB alamat & dusun", () => {
    const AREA_CFG = () => ({
        psbIntake: {
            enabled: true, groupId: "grp@g.us", recencyWindowMinutes: 120,
            desa: "Tanjungharjo", kecamatan: "Kapas", dusunList: ["Krajan", "Ngitik", "Karang"]
        },
        defaultBulkSSID: "1"
    });
    const replies = (h) => h.base.reply.mock.calls.map((c) => c[0]).join("\n");

    test("alamat DIRAKIT (Dsn+RT/RW+Ds+Kec) & dusun ikut terkirim sbg kolom sendiri", async () => {
        const h = harness({ getConfig: AREA_CFG });
        await reachConfirm(h);
        // Yang dilihat teknisi di layar konfirmasi = yang akan disimpan.
        expect(replies(h)).toMatch(/Dsn\. Krajan RT 014 RW 002 Ds\. Tanjungharjo Kec\. Kapas/);

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.address).toBe("Dsn. Krajan RT 014 RW 002 Ds. Tanjungharjo Kec. Kapas");
        expect(arg.userData.dusun).toBe("Krajan");
    });

    test("RT/RW WAJIB: data lain + foto + lokasi lengkap pun belum masuk konfirmasi", async () => {
        const h = harness({ getConfig: AREA_CFG });
        const cap = "#PSB\nNama: Budi Santoso\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";
        await startPsbSession({ ...h.base, type: "imageMessage", caption: cap, msg: imageMsg(cap), staff: STAFF });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.getState().step).toBe("PSB_COLLECT_DOCS");

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "RT/RW: 14/2" });
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
    });

    test("dusun dipilih dgn balas ANGKA dari daftar config (ejaan konsisten utk username PPPoE)", async () => {
        const h = harness({ getConfig: AREA_CFG });
        const cap = "#PSB\nNama: Budi Santoso\nRT/RW: 14/2\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";
        await startPsbSession({ ...h.base, type: "imageMessage", caption: cap, msg: imageMsg(cap), staff: STAFF });
        expect(replies(h)).toMatch(/1\.Krajan/);

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "2" });
        expect(h.getState().context.data.dusun).toBe("Ngitik");
    });

    test("angka polos DIABAIKAN saat dusun sudah terisi (tak menabrak slot lain)", async () => {
        const h = harness({ getConfig: AREA_CFG });
        await startPsbSession({ ...h.base, type: "imageMessage", caption: CAPTION, msg: imageMsg(CAPTION), staff: STAFF });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "3" });
        expect(h.getState().context.data.dusun).toBe("Krajan");
    });

    test("Alamat bebas MENGGANTIKAN alamat rakitan & membuat RT/RW tak wajib", async () => {
        const h = harness({ getConfig: AREA_CFG });
        const cap = "#PSB\nNama: Budi Santoso\nDusun: Krajan\nAlamat: Jl. Raya Kapas 12, Bojonegoro\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";
        await startPsbSession({ ...h.base, type: "imageMessage", caption: cap, msg: imageMsg(cap), staff: STAFF });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "imageMessage", msg: imageMsg() });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "locationMessage", msg: locMsg() });
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.address).toBe("Jl. Raya Kapas 12, Bojonegoro");
    });

    test("tanpa dusunList di config → dusun tetap boleh diketik bebas (perilaku lama)", async () => {
        const h = harness();
        await reachConfirm(h);
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
        expect(h.getState().context.data.dusun).toBe("Krajan");
    });
});

// ── Gerbang modem copotan: modem yang masih melayani orang TIDAK boleh ditimpa ──
describe("PSB gerbang asal-usul modem", () => {
    const replies = (h) => h.base.reply.mock.calls.map((c) => c[0]).join("\n");

    test("modem masih tertaut pelanggan → ditandai TERPAKAI & YA DITOLAK (tanpa provisioning)", async () => {
        global.users = [{ id: 5, name: "Budi", device_id: "dev-A", pppoe_username: "budi@rafcybernet" }];
        const h = harness();
        await reachConfirm(h);
        expect(replies(h)).toMatch(/TERPAKAI/);

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        expect(h.base.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
        expect(replies(h)).toMatch(/masih tercatat/i);
        expect(replies(h)).toMatch(/Budi/);
    });

    test("gerbang berlaku juga di jalur pilih-nomor (bukan cuma jalur YA)", async () => {
        global.users = [{ id: 6, name: "Sari", device_id: "dev-B", pppoe_username: "sari@rafcybernet" }];
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "TIDAK" });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "2" });
        expect(h.base.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
        expect(replies(h)).toMatch(/masih tercatat/i);
    });

    // Jebakan lingkaran (insiden Tanjungharjo 2026-08-12): `cari <pemilik lama>` mengembalikan SATU
    // modem, modem itu diblokir, dan pesan penolakannya menyuruh "balas TIDAK untuk pilih dari
    // daftar" — daftar yang isinya modem itu juga. Teknisi berputar sampai menyerah.
    test("semua kandidat ⛔ → pesan tolak menyebut JALAN KELUAR, bukan menyuruh balas TIDAK", async () => {
        global.users = [
            { id: 5, name: "Wiji Rohani", device_id: "dev-A", pppoe_username: "wji@rafcybernet" },
            { id: 6, name: "Sari", device_id: "dev-B", pppoe_username: "sari@rafcybernet" }
        ];
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        const teks = replies(h);
        expect(teks).toMatch(/\*sudah berhenti\*/i);      // jalan keluar sebenarnya
        expect(teks).toMatch(/REFRESH/);
        expect(teks).toMatch(/BATAL/);
        expect(teks).not.toMatch(/balas \*TIDAK\* lalu pilih/i); // saran buntu tak boleh muncul
    });

    test("masih ada modem yang boleh dipakai → saran 'balas TIDAK' TETAP ditawarkan", async () => {
        global.users = [{ id: 5, name: "Wiji Rohani", device_id: "dev-A", pppoe_username: "wji@rafcybernet" }];
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        expect(replies(h)).toMatch(/balas \*TIDAK\* lalu pilih/i); // dev-B masih bebas
    });

    test("daftar bernomor yang SEMUANYA ⛔ ikut menyebut jalan keluar", async () => {
        global.users = [
            { id: 5, name: "Wiji Rohani", device_id: "dev-A", pppoe_username: "wji@rafcybernet" },
            { id: 6, name: "Sari", device_id: "dev-B", pppoe_username: "sari@rafcybernet" }
        ];
        const h = harness();
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "TIDAK" });
        const teks = replies(h);
        expect(teks).toMatch(/Semua modem di daftar ini/i);
        expect(teks).toMatch(/REFRESH/);
    });

    test("modem copotan → label ♻️ BEKAS + nama pemilik lama dari riwayat OLT", async () => {
        const h = harness({
            oltRepository: { getModemStateByPppoe: jest.fn(async (p) => (p === "old@x" ? { customer_name: "Wimpi Sayekti" } : null)) }
        });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "TIDAK" });
        expect(replies(h)).toMatch(/BEKAS Wimpi Sayekti/);
        // Modem polos tetap ditandai BARU.
        expect(replies(h)).toMatch(/🆕 BARU/);
    });

    test("CARI: modem copotan yang tak muncul di daftar 'baru' ketemu lewat nama pemilik lama", async () => {
        const copotan = { deviceId: "dev-C", serialNumber: "48575443FFD52EAD", model: "HG8145V5", currentPPPUsername: "wimpi_sayekti-ngitik@rafcybernet", registeredDate: "2025-08-01T00:00:00.000Z" };
        const findPsbCandidatesByHint = jest.fn(async ({ hint }) => ({ ok: true, data: hint === "wimpi" ? [copotan] : [] }));
        const h = harness({
            findRecentPsbCandidates: jest.fn(async () => ({ ok: true, data: [] })), // daftar "baru" KOSONG
            findPsbCandidatesByHint,
            oltRepository: { getModemStateByPppoe: jest.fn(async () => ({ customer_name: "Wimpi Sayekti" })) }
        });
        await reachConfirm(h);
        // Layar kosong harus MENGAJARI jalan keluarnya, bukan buntu — termasuk resep modem bekas
        // MATI internet (set PPPoE ke tes@hw + REFRESH, TANPA hapus record GenieACS; insiden 2026-08-07).
        expect(replies(h)).toMatch(/cari HWTC49B734AD/);
        expect(replies(h)).toMatch(/cari <nama pemilik lama>/);
        expect(replies(h)).toMatch(/tes@hw/i);
        expect(replies(h)).toMatch(/tak perlu hapus.*GenieACS/i);
        // JANGAN menjanjikan "factory reset → muncul otomatis di daftar": diukur di ACS produksi
        // Dander 2026-08-08, `_lastBootstrap` tak pernah sekali pun bergerak setelah registrasi
        // (0 dari 57 device yang punya field itu), jadi janji tsb tak bisa ditepati.
        expect(replies(h)).not.toMatch(/reset pabrik/i);

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "cari wimpi" });
        expect(findPsbCandidatesByHint).toHaveBeenCalledWith(expect.objectContaining({ hint: "wimpi" }));
        expect(h.getState().step).toBe("PSB_PICK_MODEM");
        expect(replies(h)).toMatch(/BEKAS Wimpi Sayekti/);

        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "1" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.device_id).toBe("dev-C");
    });

    test("CARI tak ketemu → pesan jujur, state tetap, tak ada yang ditulis", async () => {
        const h = harness({ findPsbCandidatesByHint: jest.fn(async () => ({ ok: true, data: [] })) });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "cari zzz999" });
        expect(replies(h)).toMatch(/Tak ada modem cocok/i);
        expect(h.base.usersService.upsertUserFromAdminPanel).not.toHaveBeenCalled();
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
    });

    test("modem copotan BOLEH dipakai — provisioning jalan & jejak 'bekas' ikut dicatat", async () => {
        const h = harness({
            findRecentPsbCandidates: jest.fn(async () => ({ ok: true, data: [CANDIDATES[1]] })),
            oltRepository: { getModemStateByPppoe: jest.fn(async () => ({ customer_name: "Wimpi Sayekti" })) }
        });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });
        expect(h.base.usersService.upsertUserFromAdminPanel).toHaveBeenCalled();
        expect(replies(h)).toMatch(/bekas Wimpi Sayekti/i);
    });
});

// ── P1b: hasil deteksi band yang GAGAL tak boleh mengendap jadi "fakta" ──
describe("PSB koreksi band setelah push", () => {
    test("band gagal saat push → terbaca setelah push → bulk dikoreksi + WiFi band tambahan didorong", async () => {
        let panggilan = 0;
        const fetchDeviceCapability = jest.fn(async () => {
            panggilan += 1;
            // Modem baru semenit terdaftar di ACS: pembacaan PERTAMA belum lihat WLAN 5GHz.
            return panggilan === 1
                ? { found: false }
                : { found: true, has5G: true, expectedBulk: ["1", "5"] };
        });
        const updateUserById = jest.fn(async () => ({ status: 200, body: {} }));
        const upsert = jest.fn(async () => ({ status: 201, body: { data: { id: 99 }, device_config: { attempted: true, ok: true } } }));
        const h = harness({
            fetchDeviceCapability,
            usersService: { upsertUserFromAdminPanel: upsert, updateUserById }
        });
        mockPushDevice.mockClear();

        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        // Push pertama hanya index 1 (fallback), lalu dikoreksi.
        expect(upsert.mock.calls[0][0].userData.ssid_indices).toEqual(["1"]);
        expect(fetchDeviceCapability).toHaveBeenCalledTimes(2);
        expect(updateUserById).toHaveBeenCalledWith(expect.objectContaining({
            id: 99,
            userData: { bulk: ["1", "5"] }
        }));
        // Hanya band yang BELUM tersentuh yang didorong susulan (index 5), bukan mengulang index 1.
        expect(mockPushDevice).toHaveBeenCalledWith("dev-A", expect.objectContaining({ ssidIndices: ["5"] }), expect.anything());
    });

    test("band tetap tak terbaca setelah push → TIDAK menulis tebakan bulk apa pun", async () => {
        const fetchDeviceCapability = jest.fn(async () => ({ found: false }));
        const updateUserById = jest.fn(async () => ({ status: 200, body: {} }));
        const upsert = jest.fn(async () => ({ status: 201, body: { data: { id: 99 }, device_config: { attempted: true, ok: true } } }));
        const h = harness({ fetchDeviceCapability, usersService: { upsertUserFromAdminPanel: upsert, updateUserById } });
        mockPushDevice.mockClear();

        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "YA" });

        expect(updateUserById).not.toHaveBeenCalled();
        expect(mockPushDevice).not.toHaveBeenCalled();
        // Teknisi tetap diberi tahu jujur bahwa band tak terbaca.
        expect(h.base.reply.mock.calls.map((c) => c[0]).join("\n")).toMatch(/Band modem tak terbaca/i);
    });
});

// REGRESI Tanjungharjo 2026-08-02: layar menulis SN bentuk ACS (`4857544349B734AD`) sedangkan stiker
// modem berbunyi `HWTC49B734AD`. Teknisi membandingkan dengan mata, menyimpulkan "bedo" (beda), lalu
// membatalkan PSB atas modem yang sebenarnya BENAR. Bentuk stiker wajib tampil lebih dulu.
describe("tampilan SN (stickerSn / snText)", () => {
    test("SN 16-heksa Huawei → bentuk stiker HWTC… dipulihkan", () => {
        expect(stickerSn("4857544349B734AD")).toBe("HWTC49B734AD");
        expect(stickerSn("485754437c8ebeb1")).toBe("HWTC7C8EBEB1");
    });

    test("snText menaruh bentuk STIKER di depan, bentuk ACS menyusul", () => {
        expect(snText("4857544349B734AD")).toBe("HWTC49B734AD (ACS 4857544349B734AD)");
    });

    test("SN yang bukan bentuk itu dibiarkan apa adanya (jangan mengarang)", () => {
        // ONU ZTE di ACS yang sama — panjang & bentuknya lain.
        expect(stickerSn("EQFLH7U22977")).toBeNull();
        expect(snText("EQFLH7U22977")).toBe("EQFLH7U22977");
        // 16 heksa tapi 8 pertama bukan huruf ASCII → bukan pola vendor, jangan diterjemahkan.
        expect(stickerSn("0011223344556677")).toBeNull();
        expect(snText("")).toBe("");
        expect(snText(null)).toBe("");
    });
});

// INSIDEN Dander 2026-08-07: modem BEKAS — teknisi ketik SN LENGKAP dari stiker & PPPoE lama, dua-
// duanya "tidak terdeteksi"; owner terpaksa set default tes@hw + HAPUS record GenieACS + ulang PSB.
// Suite ini mengunci jalan keluar di dalam wizard: SN polosan langsung dicari, label deteksi jujur
// (reset/online), dan peringatan modem offline SEBELUM eksekusi.
describe("PSB modem bekas (insiden 2026-08-07)", () => {
    const replies = (h) => h.base.reply.mock.calls.map((c) => c[0]).join("\n");
    const { looksLikeSnInput } = require("../psb.state");

    test("looksLikeSnInput: SN stiker/heksa (dgn/tanpa pemisah) YA; kata biasa, angka pilihan, perintah TIDAK", () => {
        expect(looksLikeSnInput("HWTC49B734AD")).toBe(true);
        expect(looksLikeSnInput("4857544349B734AD")).toBe(true);
        expect(looksLikeSnInput("hwtc 49b7 34ad")).toBe(true);
        expect(looksLikeSnInput("HWTC-49B734AD")).toBe(true);
        expect(looksLikeSnInput("49B734AD")).toBe(true);
        expect(looksLikeSnInput("2")).toBe(false);        // pemilih nomor daftar
        expect(looksLikeSnInput("10")).toBe(false);
        expect(looksLikeSnInput("ya")).toBe(false);
        expect(looksLikeSnInput("refresh")).toBe(false);
        expect(looksLikeSnInput("sukirman")).toBe(false); // nama orang → tetap butuh `cari`
        expect(looksLikeSnInput("krajan")).toBe(false);
        expect(looksLikeSnInput("")).toBe(false);
    });

    test("SN polosan tanpa `cari` di layar konfirmasi → langsung dicari", async () => {
        const copotan = { deviceId: "dev-C", serialNumber: "4857544349B734AD", model: "HG8145V5", currentPPPUsername: "wimpi-krajan@rafcybernet", registeredDate: "2025-08-01T00:00:00.000Z", lastInform: "2026-07-01T00:00:00.000Z" };
        const findPsbCandidatesByHint = jest.fn(async () => ({ ok: true, data: [copotan] }));
        const h = harness({ findPsbCandidatesByHint });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "HWTC49B734AD" });
        expect(findPsbCandidatesByHint).toHaveBeenCalledWith(expect.objectContaining({ hint: "HWTC49B734AD" }));
        expect(h.getState().step).toBe("PSB_PICK_MODEM");
        // Modem bekas lama tak inform → daftar menandai offline, bukan "reg X hari lalu" yang menyesatkan.
        expect(replies(h)).toMatch(/offline, terakhir/);
    });

    test("SN polosan juga berlaku di daftar pilih (STEP_PICK); angka tetap memilih nomor", async () => {
        const copotan = { deviceId: "dev-C", serialNumber: "4857544349B734AD", model: "HG8145V5", currentPPPUsername: "wimpi-krajan@rafcybernet", registeredDate: "2025-08-01T00:00:00.000Z" };
        const findPsbCandidatesByHint = jest.fn(async () => ({ ok: true, data: [copotan] }));
        const h = harness({ findPsbCandidatesByHint });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "TIDAK" });
        expect(h.getState().step).toBe("PSB_PICK_MODEM");
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "485754 4349B7 34AD" });
        expect(findPsbCandidatesByHint).toHaveBeenCalledWith(expect.objectContaining({ hint: "485754 4349B7 34AD" }));
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "1" });
        const arg = h.base.usersService.upsertUserFromAdminPanel.mock.calls[0][0];
        expect(arg.userData.device_id).toBe("dev-C");
    });

    test("label deteksi jujur: kandidat `reset` (bootstrap) & `default-online` tampil dgn stempelnya", async () => {
        const h = harness({
            findRecentPsbCandidates: jest.fn(async () => ({
                ok: true,
                data: [
                    { deviceId: "dev-reset", serialNumber: "48575443BBBB0002", model: "HG8145V5", currentPPPUsername: "tes@hw", registeredDate: "2024-03-01T00:00:00.000Z", detectedVia: "reset", detectedAtIso: "2026-07-04T10:10:00.000Z", lastInform: "2026-07-04T10:15:00.000Z" },
                    { deviceId: "dev-polos", serialNumber: "48575443CCCC0003", model: "HG8145V5", currentPPPUsername: "tes@hw", registeredDate: "2024-03-01T00:00:00.000Z", detectedVia: "default-online", detectedAtIso: "2026-07-04T10:12:00.000Z", lastInform: "2026-07-04T10:12:00.000Z" }
                ]
            }))
        });
        await reachConfirm(h);
        expect(replies(h)).toMatch(/di-reset 10 mnt lalu/);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "TIDAK" });
        expect(replies(h)).toMatch(/online 8 mnt lalu/);
        // `_registered` kuno TIDAK ditampilkan sebagai "reg 2 tahun lalu" yang membingungkan.
        expect(replies(h)).not.toMatch(/reg \d+ hari lalu/);
    });

    test("modem terpilih terbukti LAMA tak inform → layar konfirmasi memperingatkan SEBELUM eksekusi", async () => {
        const h = harness({
            findRecentPsbCandidates: jest.fn(async () => ({
                ok: true,
                data: [{ deviceId: "dev-off", serialNumber: "48575443DDDD0004", model: "HG8145V5", currentPPPUsername: "tes@hw", registeredDate: "2026-07-04T09:40:00.000Z", detectedVia: "registered", detectedAtIso: "2026-07-04T09:40:00.000Z", lastInform: "2026-06-01T00:00:00.000Z" }]
            }))
        });
        await reachConfirm(h);
        expect(replies(h)).toMatch(/terakhir terbaca ACS .* pastikan modem MENYALA/i);
    });

    // KEJUJURAN ERROR — akar pengalaman DAVIN: query ACS yang gagal dulu menyamar jadi
    // "tak ada modem", membuat teknisi/owner memvonis modemnya hilang & membongkar GenieACS.
    test("deteksi kandidat GAGAL (ACS error) → pesan 'Gagal membaca', BUKAN 'belum ada modem'", async () => {
        const h = harness({ findRecentPsbCandidates: jest.fn(async () => ({ ok: false, message: "timeout" })) });
        await reachConfirm(h);
        expect(replies(h)).toMatch(/Gagal membaca daftar modem/i);
        expect(replies(h)).not.toMatch(/belum ada modem terbaca/i);
    });

    test("cari saat ACS error → 'Pencarian gagal', BUKAN 'Tak ada modem cocok'", async () => {
        const h = harness({ findPsbCandidatesByHint: jest.fn(async () => ({ ok: false, message: "timeout" })) });
        await reachConfirm(h);
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "cari wimpi" });
        expect(replies(h)).toMatch(/Pencarian gagal/i);
        expect(replies(h)).not.toMatch(/Tak ada modem cocok/i);
    });
});

// Insiden Tanjungharjo 2026-08-12: teknisi sudah mengirim foto KTP, 7 kolom data, foto rumah, dan
// share lokasi — lalu mentok di langkah modem karena record pelanggan lama belum ditutup. Pembebasan
// modem itu HANYA bisa dilakukan admin dan makan >15 menit, jadi sesi mati duluan dan SELURUH kerja
// teknisi hangus. Rangkaian test ini mengunci: kerja itu tak boleh hilang lagi.
describe("PSB kerja teknisi DURABEL (draft + lanjut)", () => {
    const DRAFT_LENGKAP = {
        ownerKey: "628999@s.whatsapp.net",
        step: "PSB_CONFIRM_MODEM",
        tempId: "PSBDM_LAMA",
        dir: "/tmp/psb-lama",
        data: { nama: "Septiana Kurniawati", dusun: "Krajan", rt_rw: "14/2", paket: "PAKET-110K", wifi_ssid: "OKTA", wifi_password: "16042022", hp: "08123456789" },
        ktpSaved: true,
        rumahSaved: true,
        lokasi: { lat: -7.1, lng: 111.9 },
        staff: STAFF,
        createdAt: new Date(NOW - 40 * 60000).toISOString(),
        updatedAt: new Date(NOW - 20 * 60000).toISOString()
    };

    const kirimPsb = (h) => startPsbSession({ ...h.base, type: "imageMessage", caption: "#PSB", msg: imageMsg("#PSB"), staff: STAFF });
    const jawab = (h, chats) => handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats });

    test("tiap langkah ikut ditulis ke draft — dan kandidat modem SENGAJA tidak ikut", async () => {
        const h = harness();
        await reachConfirm(h);
        expect(h.base.draftStore.putDraft).toHaveBeenCalled();
        const [ownerKey, d] = h.base.draftStore.putDraft.mock.calls.at(-1);
        expect(ownerKey).toBe("628999@s.whatsapp.net");
        expect(d.data.nama).toBe("Budi Santoso");
        expect(d.ktpSaved).toBe(true);
        expect(d.rumahSaved).toBe(true);
        expect(d.lokasi).toBeTruthy();
        // Status modem justru hal yang BERUBAH selagi teknisi menunggu — memulihkannya dari draft
        // akan menyajikan vonis basi (mis. tetap ⛔ padahal admin sudah membebaskannya).
        expect(d.candidate).toBeUndefined();
        expect(d.candidates).toBeUndefined();
    });

    test("#PSB saat draft ada → TAWARKAN lanjut, bukan minta semuanya diulang", async () => {
        const h = harness({ draftStore: memDraftStore(DRAFT_LENGKAP) });
        const res = await kirimPsb(h);
        expect(res.resumeOffered).toBe(true);
        expect(h.getState().step).toBe("PSB_RESUME_ASK");
        const teks = h.base.reply.mock.calls.at(-1)[0];
        expect(teks).toMatch(/Septiana Kurniawati/);
        expect(teks).toMatch(/LANJUT/);
        expect(teks).toMatch(/BARU/);
    });

    test("LANJUT → modem dibaca ULANG, tanpa satu pun foto/isian diminta lagi", async () => {
        const h = harness({ draftStore: memDraftStore(DRAFT_LENGKAP) });
        await kirimPsb(h);
        await jawab(h, "LANJUT");
        expect(h.base.findRecentPsbCandidates).toHaveBeenCalled();
        expect(h.base.downloadMedia).not.toHaveBeenCalled();
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
        expect(h.getState().context.data.nama).toBe("Septiana Kurniawati");
        expect(h.getState().context.lokasi).toEqual({ lat: -7.1, lng: 111.9 });
    });

    test("BARU → draft dibuang & teknisi diarahkan mulai dari awal", async () => {
        const ds = memDraftStore(DRAFT_LENGKAP);
        const h = harness({ draftStore: ds });
        await kirimPsb(h);
        await jawab(h, "BARU");
        expect(ds.removeDraft).toHaveBeenCalled();
        expect(h.base.reply.mock.calls.at(-1)[0]).toMatch(/#PSB/);
    });

    test("BATAL di layar tawaran hanya menutup pertanyaan — draft TETAP disimpan", async () => {
        const ds = memDraftStore(DRAFT_LENGKAP);
        const h = harness({ draftStore: ds });
        await kirimPsb(h);
        await jawab(h, "batal");
        expect(ds.removeDraft).not.toHaveBeenCalled();
        expect(h.base.reply.mock.calls.at(-1)[0]).toMatch(/tetap saya simpan/i);
    });

    test("BATAL di tengah wizard = pembatalan sungguhan → draft ikut dibuang", async () => {
        const h = harness();
        await reachConfirm(h);
        await jawab(h, "batal");
        expect(h.base.draftStore.removeDraft).toHaveBeenCalled();
    });

    test("sesi kedaluwarsa TIDAK boleh senyap: draft disimpan + cara melanjutkan diberitahukan", async () => {
        const putDraft = jest.fn();
        const sendReply = jest.fn(async () => {});
        await handlePsbStateTimeout(
            "628999@s.whatsapp.net",
            { step: "PSB_CONFIRM_MODEM", context: { data: { nama: "Septiana" }, ktpSaved: true, rumahSaved: true, lokasi: { lat: 1, lng: 2 } } },
            { draftStore: { putDraft }, sendReply }
        );
        expect(putDraft).toHaveBeenCalled();
        const teks = sendReply.mock.calls[0][0].text;
        expect(teks).toMatch(/tersimpan/i);
        expect(teks).toMatch(/LANJUT/);
    });

    test("timeout tanpa konteks data → tak menyimpan sampah & tak mengirim apa pun", async () => {
        const putDraft = jest.fn();
        const sendReply = jest.fn(async () => {});
        await handlePsbStateTimeout("628999@s.whatsapp.net", { step: "PSB_COLLECT_DOCS", context: null }, { draftStore: { putDraft }, sendReply });
        expect(putDraft).not.toHaveBeenCalled();
        expect(sendReply).not.toHaveBeenCalled();
    });

    test("provision BERHASIL → draft dihapus", async () => {
        const h = harness();
        await reachConfirm(h);
        await jawab(h, "YA");
        expect(h.base.draftStore.removeDraft).toHaveBeenCalled();
    });

    test("provision GAGAL → draft DIPERTAHANKAN (kegagalan bukan salah teknisi)", async () => {
        const h = harness({
            usersService: { upsertUserFromAdminPanel: jest.fn(async () => ({ status: 500, body: { message: "router mati" } })) }
        });
        await reachConfirm(h);
        await jawab(h, "YA");
        expect(h.base.draftStore.removeDraft).not.toHaveBeenCalled();
        expect(h.base.reply.mock.calls.at(-1)[0]).toMatch(/SAYA SIMPAN/i);
    });
});
