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
const { startPsbSession, handlePsbConversationState, buildPppoeUsername, isPsbTutorialTrigger, psbTutorialText, parsePsbScheduleRef } = require("../psb.state");

const TMP = path.join(os.tmpdir(), `psb-dm-test-${Date.now()}`);
const PACKAGES = [{ name: "PAKET-110K", profile: "16Mbps" }];
const STAFF = { id: 3, username: "davin", name: "Davin", role: "teknisi" };
const NOW = Date.parse("2026-07-04T10:20:00.000Z");
const CANDIDATES = [
    { deviceId: "dev-A", serialNumber: "48575443AAAA0001", model: "HG8145V5", currentPPPUsername: "tes@hw", registeredDate: "2026-07-04T10:05:00.000Z", registeredTimestamp: Date.parse("2026-07-04T10:05:00.000Z") },
    { deviceId: "dev-B", serialNumber: "48575443BBBB0002", model: "HS8346R5", currentPPPUsername: "old@x", registeredDate: "2026-07-04T09:40:00.000Z", registeredTimestamp: Date.parse("2026-07-04T09:40:00.000Z") }
];
const CAPTION = "#PSB\nNama: Budi Santoso\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";

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
        const cap = "#PSB\nNama: Budi Santoso\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789"; // tanpa dusun
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
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Nama: Budi Santoso\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789" });
        expect(h.getState().step).toBe("PSB_CONFIRM_MODEM");
    });

    test("slot-filling: data DICICIL beberapa pesan → digabung", async () => {
        const h = harness();
        await startPsbSession({ ...h.base, type: "imageMessage", caption: "#PSB\nNama: Budi Santoso", msg: imageMsg("#PSB\nNama: Budi Santoso"), staff: STAFF });
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "Dusun: Krajan" });
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
        const cap = "#PSB\nNama: Budi Santoso\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789|6285700000002";
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
        await handlePsbConversationState({ ...h.base, stateStep: h.getState().step, teknisiState: h.getState(), type: "conversation", chats: "WiFi: RumahBudi\nSandi: rahasia123" });
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
