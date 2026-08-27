/**
 * Header Doc
 * Purpose : Menjaga wizard WA GANTI MODEM (#b282) — urutan langkah, gerbang konfirmasi,
 *           jalur "kredensial WiFi tak terbaca", dan wiring state (prefix GMODEM_).
 * Caller  : jest
 * Deps    : message/handlers/state-domains/ganti-modem.state (semua I/O di-inject)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const fs = require("fs");
const path = require("path");
const domain = require("../ganti-modem.state");

const USERS = [
    { id: 7, name: "Budi Santoso", pppoe_username: "budi@rafnet", device_id: "ACS-LAMA" },
    { id: 9, name: "Sari", pppoe_username: "sari@rafnet", device_id: "ACS-SARI" },
];

function harness(over = {}) {
    const balasan = [];
    const state = { nilai: null };
    const ctx = {
        reply: (t) => { balasan.push(String(t)); return t; },
        setUserState: async (_s, v) => { state.nilai = v; },
        deleteUserState: async () => { state.nilai = null; },
        stateSender: "628@s.whatsapp.net",
        getUsers: () => USERS,
        isCleanConsent: (t) => /^(ya|iya|ok|siap|betul)\b/i.test(String(t || "").trim()),
        layanan: {
            cariDevice: async (teks) => (teks === "HWTC1234ABCD"
                ? { deviceId: "ACS-BARU", kandidat: [], alasan: null }
                : { deviceId: null, kandidat: [], alasan: "tak ditemukan" }),
            gantiModem: async () => ({ ok: true, butuhKredensial: false, langkah: [{ langkah: "pelanggan", ok: true, pesan: "Budi" }], pesan: "Selesai." }),
        },
        ...over,
    };
    return { balasan, state, ctx };
}

describe("#b282 — wizard WA ganti modem", () => {
    test("pemicu dikenali dalam beberapa bentuk", () => {
        expect(domain.isGantiModemTrigger("ganti modem")).toBe(true);
        expect(domain.isGantiModemTrigger("Ganti Modem Budi")).toBe(true);
        expect(domain.isGantiModemTrigger("gantimodem")).toBe(true);
        expect(domain.isGantiModemTrigger("ganti nama wifi")).toBe(false);
        expect(domain.parseGantiModemCommand("ganti modem Budi").query).toBe("Budi");
    });

    test("mulai sesi → daftar bernomor + state di step PICK", async () => {
        const { balasan, state, ctx } = harness();
        await domain.startGantiModemSession({ ...ctx, query: "", staff: { id: 1, name: "Tek" } });
        expect(state.nilai.step).toBe(domain.STEP_PICK);
        expect(state.nilai.kandidatIds).toEqual([7, 9]);
        expect(balasan[0]).toMatch(/1\. Budi Santoso/);
    });

    test("pilih nomor → diminta SN, modem lama ditampilkan", async () => {
        const { balasan, state, ctx } = harness();
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_PICK, kandidatIds: [7, 9] }, text: "1" });
        expect(state.nilai.step).toBe(domain.STEP_DEVICE);
        expect(state.nilai.customerId).toBe(7);
        expect(balasan[0]).toMatch(/ACS-LAMA/);
        expect(balasan[0]).toMatch(/stiker/i);
    });

    test("nomor di luar daftar → diminta ulang, state TIDAK berubah", async () => {
        const { balasan, state, ctx } = harness();
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_PICK, kandidatIds: [7, 9] }, text: "9" });
        expect(state.nilai).toBeNull();
        expect(balasan[0]).toMatch(/1-2/);
    });

    test("SN tak ketemu → tetap di step yang sama, diberi tahu apa yang harus dicek", async () => {
        const { balasan, state, ctx } = harness();
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_DEVICE, customerId: 7 }, text: "SALAH" });
        expect(state.nilai).toBeNull();
        expect(balasan[0]).toMatch(/menyala/i);
        expect(balasan[0]).toMatch(/fiber/i);
    });

    test("!! SN ketemu → WAJIB lewat layar konfirmasi, BUKAN langsung dieksekusi", async () => {
        // Salah ketik SN berarti menyetel modem milik orang lain.
        let dieksekusi = false;
        const { balasan, state, ctx } = harness({
            layanan: {
                cariDevice: async () => ({ deviceId: "ACS-BARU", kandidat: [], alasan: null }),
                gantiModem: async () => { dieksekusi = true; return { ok: true, langkah: [], pesan: "" }; },
            },
        });
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_DEVICE, customerId: 7, customerNama: "Budi Santoso" }, text: "HWTC1234ABCD" });
        expect(dieksekusi).toBe(false);
        expect(state.nilai.step).toBe(domain.STEP_CONFIRM);
        expect(balasan[0]).toMatch(/PERIKSA DULU/);
        expect(balasan[0]).toMatch(/ACS-BARU/);
    });

    test("jawaban selain YA di layar konfirmasi → tidak dieksekusi", async () => {
        let dieksekusi = false;
        const { balasan, ctx } = harness({
            layanan: { cariDevice: async () => ({}), gantiModem: async () => { dieksekusi = true; return { ok: true, langkah: [], pesan: "" }; } },
        });
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_CONFIRM, customerId: 7, deviceBaru: "ACS-BARU" }, text: "nanti dulu" });
        expect(dieksekusi).toBe(false);
        expect(balasan[0]).toMatch(/YA/);
    });

    test("YA → dieksekusi, state dibersihkan, laporan langkah dikirim", async () => {
        const { balasan, state, ctx } = harness();
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_CONFIRM, customerId: 7, deviceBaru: "ACS-BARU" }, text: "ya" });
        expect(state.nilai).toBeNull();
        expect(balasan.join(" ")).toMatch(/GANTI MODEM SELESAI/);
        expect(balasan.join(" ")).toMatch(/pelanggan/);
    });

    test("!! butuh kredensial → PINDAH ke tanya SSID, bukan dianggap gagal", async () => {
        const { balasan, state, ctx } = harness({
            layanan: {
                cariDevice: async () => ({}),
                gantiModem: async () => ({ ok: false, butuhKredensial: true, langkah: [{ langkah: "kredensial-wifi", ok: false, pesan: "tak terbaca" }], pesan: "Butuh nama WiFi & sandi." }),
            },
        });
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_CONFIRM, customerId: 7, deviceBaru: "ACS-BARU" }, text: "ya" });
        expect(state.nilai.step).toBe(domain.STEP_SSID);
        expect(balasan.join(" ")).toMatch(/tidak berubah/);
    });

    test("isi SSID lalu sandi → kembali ke layar konfirmasi", async () => {
        const { balasan, state, ctx } = harness();
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_SSID, customerId: 7, deviceBaru: "ACS-BARU" }, text: "RAF-Budi" });
        expect(state.nilai.step).toBe(domain.STEP_PASSWORD);
        expect(state.nilai.ssid).toBe("RAF-Budi");
        await domain.handleGantiModemState({ ...ctx, state: state.nilai, text: "sandibaru123" });
        expect(state.nilai.step).toBe(domain.STEP_CONFIRM);
        expect(balasan[balasan.length - 1]).toMatch(/PERIKSA DULU/);
    });

    test("sandi < 8 karakter ditolak", async () => {
        const { balasan, state, ctx } = harness();
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_PASSWORD, customerId: 7 }, text: "pendek" });
        expect(state.nilai).toBeNull();
        expect(balasan[0]).toMatch(/8 karakter/);
    });

    test("gagal → dilaporkan apa adanya, bukan 'selesai'", async () => {
        const { balasan, ctx } = harness({
            layanan: {
                cariDevice: async () => ({}),
                gantiModem: async () => ({ ok: false, butuhKredensial: false, langkah: [{ langkah: "terapkan-wifi", ok: false, pesan: "gagal" }], pesan: "Gagal memasang WiFi." }),
            },
        });
        await domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_CONFIRM, customerId: 7, deviceBaru: "ACS-BARU" }, text: "ya" });
        expect(balasan.join(" ")).toMatch(/BELUM SELESAI/);
        // Yang harus TIDAK muncul adalah penanda SUKSES-nya, bukan kata "selesai".
        expect(balasan.join(" ")).not.toContain("✅ *GANTI MODEM SELESAI*");
    });

    test("NEVER-THROW: servis meledak pun tetap membalas & membersihkan state", async () => {
        const { balasan, state, ctx } = harness({
            layanan: { cariDevice: async () => ({}), gantiModem: async () => { throw new Error("boom"); } },
        });
        await expect(domain.handleGantiModemState({ ...ctx, state: { step: domain.STEP_CONFIRM, customerId: 7, deviceBaru: "X" }, text: "ya" }))
            .resolves.not.toThrow();
        expect(state.nilai).toBeNull();
        expect(balasan.length).toBeGreaterThan(0);
    });

    describe("wiring — tanpa ini wizardnya jadi bot yang tuli", () => {
        const akar = path.join(__dirname, "..", "..", "..", "..");
        const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8");

        test("prefix GMODEM_ terdaftar di peta pemilik state", () => {
            expect(baca("message/handlers/conversation-state-owner-map.js")).toMatch(/GMODEM_:\s*"ganti-modem"/);
        });

        test("router punya cabang owner ganti-modem", () => {
            const src = baca("message/handlers/conversation-state-router.js");
            expect(src).toMatch(/owner === "ganti-modem"/);
            expect(src).toMatch(/handleGantiModemState\(domainContext\)/);
        });

        test("!! semua STEP memakai prefix GMODEM_ (kalau tidak, statenya jadi yatim)", () => {
            for (const s of domain.GMODEM_STEPS) expect(s.startsWith("GMODEM_")).toBe(true);
        });

        test("pemicu terpasang di raf.js dan DIBATASI staf", () => {
            const src = baca("message/raf.js");
            expect(src).toMatch(/isGantiModemTrigger/);
            expect(src).toMatch(/startGantiModemSession/);
            const i = src.indexOf("isGantiModemTrigger");
            expect(src.slice(i, i + 900)).toMatch(/resolveAuthorizedStaff/);
        });
    });
});
