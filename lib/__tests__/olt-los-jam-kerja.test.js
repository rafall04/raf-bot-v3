/**
 * Header Doc
 * Purpose : Membuktikan notif LOS ke pelanggan SADAR JAM KERJA teknisi (#b269) — kabel putus
 *           di luar jam kerja tak boleh dijanjikan "sedang menangani".
 * Caller  : jest
 * Deps    : lib/olt-los-broadcaster, lib/working-hours-helper (di-mock supaya jamnya pasti)
 * MainFuncs: -
 * SideEffects: tidak ada (semua I/O di-inject)
 */
jest.mock("../working-hours-helper", () => ({
    ...jest.requireActual("../working-hours-helper"),
    waktuMulaiKerjaBerikutnya: jest.fn(),
}));
const { waktuMulaiKerjaBerikutnya } = require("../working-hours-helper");
const { createLosBroadcaster } = require("../olt-los-broadcaster");

// Template PERSIS seperti yang tersimpan di config.json kedua bot produksi (tanpa slot
// {penanganan}) — inilah teks yang benar-benar dibaca pelanggan hari ini.
const TEMPLATE_PRODUKSI =
    "Halo Kak {customer_name} 👋\n\n" +
    "Koneksi internet di lokasi Kakak *terputus*. Ini gangguan di jaringan kami — *bukan dari perangkat Kakak*, jadi tidak perlu restart modem atau ubah pengaturan apa pun 🙏\n\n" +
    "{area_note}\n\n" +
    "Tim teknisi sudah dapat infonya dan sedang menangani. Kami *pasti kabari lagi* begitu sudah normal.\n\n" +
    "Kalau Kakak butuh info, boleh balas pesan ini 😊\n" +
    "— {company_name}";

function makeManualTimers() {
    let seq = 0;
    const pending = new Map();
    return {
        setTimeoutFn: (fn, ms) => { const id = ++seq; pending.set(id, { fn, ms }); return id; },
        clearTimeoutFn: (id) => pending.delete(id),
        fireAll: async () => {
            const fns = [...pending.values()].map((t) => t.fn);
            pending.clear();
            for (const fn of fns) await fn();
        },
    };
}

const losEvent = (mac) => ({ mac, event_type: "los", classification_confidence: 0.85, slot: "1", onu: "4", olt_id: "OLT-A" });

async function kirimPesanPelanggan(notifyCustomer) {
    const timers = makeManualTimers();
    const sendCritical = jest.fn().mockResolvedValue({ delivered: true });
    let store = [];
    const b = createLosBroadcaster({
        getConfig: () => ({
            enabled: true, confidenceThreshold: 0.6, confirmationWindowMs: 180000,
            clusterFlushMs: 20000, clusterThreshold: 3, rebroadcastCooldownMs: 1800000,
            notifyCustomer,
        }),
        getTeknisiRecipients: () => ["62811"],
        sendCritical,
        resolveCustomer: () => ({ id: 1, name: "Budi", phone_number: "62800", address: "Jl. Mawar" }),
        now: () => Date.now(),
        setTimeoutFn: timers.setTimeoutFn,
        clearTimeoutFn: timers.clearTimeoutFn,
        loadIncidents: () => store,
        saveIncidents: (l) => { store = l; },
        logger: { log: () => {}, warn: () => {}, error: () => {} },
        verifyLosBatch: async () => new Map(),
    });
    b.handleOltEvent(losEvent("AABB"));
    await timers.fireAll();   // konfirmasi
    await timers.fireAll();   // flush → broadcast teknisi + jadwalkan timer pelanggan
    await timers.fireAll();   // timer pelanggan
    const call = sendCritical.mock.calls.find((c) => c[2] && c[2].label === "los_customer_notify");
    return call ? call[1].text : null;
}

describe("#b269 — notif LOS pelanggan menyesuaikan jam kerja teknisi", () => {
    const NOTIFY = { enabled: true, delayMs: 3600000, onlyIfStillDown: false, messageTemplate: TEMPLATE_PRODUKSI };
    beforeEach(() => jest.clearAllMocks());

    test("DALAM jam kerja → teks lama tak diubah sama sekali (tanpa kebisingan tambahan)", async () => {
        waktuMulaiKerjaBerikutnya.mockReturnValue({ dalamJamKerja: true, teks: null });
        const teks = await kirimPesanPelanggan(NOTIFY);
        expect(teks).toMatch(/sedang menangani/);
        expect(teks).not.toMatch(/di luar jam kerja/i);
    });

    test("!! DI LUAR jam kerja + template produksi TANPA slot → tetap dapat catatan jujur", async () => {
        // Inilah inti perbaikannya: kedua bot menyimpan template sendiri di config.json
        // (merge-key, tak pernah ditimpa deploy). Kalau perbaikan hanya lewat slot,
        // pelanggan jam 2 pagi akan terus dijanjikan penanganan yang tak terjadi.
        waktuMulaiKerjaBerikutnya.mockReturnValue({ dalamJamKerja: false, teks: "besok pukul 08:00 WIB" });
        const teks = await kirimPesanPelanggan(NOTIFY);
        expect(teks).toMatch(/di luar jam kerja/i);
        expect(teks).toMatch(/besok pukul 08:00 WIB/);
    });

    test("catatan disisipkan DI ATAS tanda tangan, bukan sesudahnya", async () => {
        waktuMulaiKerjaBerikutnya.mockReturnValue({ dalamJamKerja: false, teks: "besok pukul 08:00 WIB" });
        const teks = await kirimPesanPelanggan(NOTIFY);
        const baris = teks.split("\n").filter((l) => l.trim());
        expect(baris[baris.length - 1].trim().startsWith("—")).toBe(true);
    });

    test("template BARU dengan slot {penanganan} → kalimatnya diganti, tidak digandakan", async () => {
        waktuMulaiKerjaBerikutnya.mockReturnValue({ dalamJamKerja: false, teks: "besok pukul 08:00 WIB" });
        const teks = await kirimPesanPelanggan({
            ...NOTIFY,
            messageTemplate: "Halo Kak {customer_name}\n\n{penanganan}\n\n— {company_name}",
        });
        expect(teks).toMatch(/di luar jam kerja/i);
        expect(teks).not.toMatch(/\{penanganan\}/);
        expect(teks.match(/di luar jam kerja/gi).length).toBe(1);
    });

    test("jam kerja berikutnya tak diketahui → tetap jujur tanpa mengarang jam", async () => {
        waktuMulaiKerjaBerikutnya.mockReturnValue({ dalamJamKerja: false, teks: null });
        const teks = await kirimPesanPelanggan(NOTIFY);
        expect(teks).toMatch(/jam kerja berikutnya/i);
        expect(teks).not.toMatch(/\{waktu_mulai\}/);
        expect(teks).not.toMatch(/undefined|null|NaN/);
    });

    test("slot {waktu_mulai} tak pernah bocor mentah ke pelanggan", async () => {
        waktuMulaiKerjaBerikutnya.mockReturnValue({ dalamJamKerja: false, teks: "hari ini pukul 08:00 WIB" });
        const teks = await kirimPesanPelanggan(NOTIFY);
        expect(teks).not.toMatch(/\{[a-z_]+\}/);
    });
});
