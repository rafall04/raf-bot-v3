/**
 * Header Doc
 * Purpose: Test klasifikasi asal-usul modem PSB — BARU / BEKAS <pemilik lama> / TERPAKAI, plus
 *          gerbang gagal-tertutup yang melindungi modem pelanggan hidup dari ditimpa.
 * Caller: Jest.
 * Deps: ../psb-modem-provenance (semua dep di-inject).
 * SideEffects: tidak ada.
 */
"use strict";

const {
    loadActivePppoeUsernames,
    classifyModemCandidate,
    enrichPreviousOwner,
    describeCandidate,
    candidateBadge
} = require("../psb-modem-provenance");

const dev = (over = {}) => ({ deviceId: "dev-1", serialNumber: "48575443AAAA0001", model: "HG8145V5", ...over });

describe("classifyModemCandidate", () => {
    // REGRESI Tanjungharjo 2026-08-02. Test lama memakai `activeUsernames: new Set()` — keadaan yang
    // MUSTAHIL di lapangan: modem polos yang menyala PASTI memegang sesi `tes@hw` yang aktif (itulah
    // cara dia online). Karena test menguji keadaan yang tak pernah terjadi, gerbang lolos hijau
    // sementara di produksi SETIAP modem baru divonis "TERPAKAI pelanggan lain" dan PSB buntu.
    // Sesi aktif di sini SENGAJA diisi — itu keadaan sebenarnya saat teknisi memasang.
    test("modem polos (tes@hw) SEDANG online → tetap BARU & boleh dipakai", () => {
        const r = classifyModemCandidate(
            dev({ currentPPPUsername: "tes@hw" }),
            { users: [], activeUsernames: new Set(["tes@hw"]) }
        );
        expect(r.state).toBe("baru");
        expect(r.assignable).toBe(true);
    });

    // Kredensial bawaan dipakai bersama, jadi baris pelanggan yang (keliru) tersimpan ber-PPPoE
    // `tes@hw` tak boleh mengklaim modem polos milik siapa pun.
    test("baris pelanggan ber-PPPoE bawaan TIDAK mengklaim modem polos lain", () => {
        const r = classifyModemCandidate(
            dev({ deviceId: "dev-polos", currentPPPUsername: "tes@hw" }),
            {
                users: [{ id: 3, name: "Salah Input", device_id: "dev-lain", pppoe_username: "tes@hw" }],
                activeUsernames: new Set(["tes@hw"])
            }
        );
        expect(r.state).toBe("baru");
        expect(r.assignable).toBe(true);
    });

    // Pengecualian kredensial bawaan TIDAK boleh melubangi gerbang: kalau device_id-nya memang
    // tertaut satu pelanggan, modem tetap ditolak walau PPPoE-nya sudah ter-reset ke bawaan.
    test("PPPoE bawaan TAPI device_id tertaut pelanggan → tetap TERPAKAI", () => {
        const r = classifyModemCandidate(
            dev({ deviceId: "dev-1", currentPPPUsername: "tes@hw" }),
            {
                users: [{ id: 7, name: "Budi", device_id: "dev-1", pppoe_username: "budi@rafcybernet" }],
                activeUsernames: new Set(["tes@hw"])
            }
        );
        expect(r.state).toBe("terpakai");
        expect(r.assignable).toBe(false);
        expect(r.ownerSource).toBe("device_id");
    });

    test("PPPoE kosong → tetap BARU (modem belum pernah dikonfigurasi)", () => {
        const r = classifyModemCandidate(dev({ currentPPPUsername: null }), { users: [], activeUsernames: new Set() });
        expect(r.state).toBe("baru");
    });

    test("sesi PPPoE AKTIF → TERPAKAI & DITOLAK (walau tak ada baris pelanggan)", () => {
        const r = classifyModemCandidate(
            dev({ currentPPPUsername: "budi-krajan@rafcybernet" }),
            { users: [], activeUsernames: new Set(["budi-krajan@rafcybernet"]) }
        );
        expect(r.state).toBe("terpakai");
        expect(r.assignable).toBe(false);
        expect(r.ownerSource).toBe("sesi_aktif");
    });

    test("tertaut baris pelanggan lewat device_id → TERPAKAI (sekalipun sedang offline)", () => {
        const r = classifyModemCandidate(
            dev({ currentPPPUsername: "budi@rafcybernet" }),
            { users: [{ id: 7, name: "Budi", device_id: "dev-1", pppoe_username: "budi@rafcybernet" }], activeUsernames: new Set() }
        );
        expect(r.state).toBe("terpakai");
        expect(r.assignable).toBe(false);
        expect(r.ownerName).toBe("Budi");
        expect(r.ownerSource).toBe("device_id");
    });

    // Kasus NYATA di produksi: ada modem pelanggan hidup yang device_id-nya tak tersinkron.
    // Kalau hanya mengandalkan device_id, modem mereka akan tampak "nganggur" dan bisa dirampas.
    test("device_id TAK tersinkron tapi PPPoE cocok pelanggan → tetap TERPAKAI", () => {
        const r = classifyModemCandidate(
            dev({ deviceId: "dev-baru", currentPPPUsername: "wiwit@rafcybernet" }),
            { users: [{ id: 9, name: "Wiwit", device_id: null, pppoe_username: "wiwit@rafcybernet" }], activeUsernames: new Set() }
        );
        expect(r.state).toBe("terpakai");
        expect(r.assignable).toBe(false);
        expect(r.ownerSource).toBe("pppoe");
    });

    test("PPPoE milik orang yang sudah TAK ADA di daftar pelanggan → BEKAS & boleh dipakai", () => {
        const r = classifyModemCandidate(
            dev({ currentPPPUsername: "wimpi_sayekti-ngitik@rafcybernet" }),
            { users: [{ id: 1, name: "Lain", device_id: "dev-9", pppoe_username: "lain@rafcybernet" }], activeUsernames: new Set() }
        );
        expect(r.state).toBe("bekas");
        expect(r.assignable).toBe(true);
        expect(r.previousPppoe).toBe("wimpi_sayekti-ngitik@rafcybernet");
    });

    test("router tak terbaca → sessionsKnown=false, tapi gerbang tautan pelanggan TETAP jalan", () => {
        const buta = classifyModemCandidate(
            dev({ currentPPPUsername: "budi@rafcybernet" }),
            { users: [{ id: 7, name: "Budi", device_id: "dev-1" }], activeUsernames: null }
        );
        expect(buta.sessionsKnown).toBe(false);
        expect(buta.assignable).toBe(false); // tetap ditolak lewat tautan device_id

        // Tanpa tautan apa pun & sesi tak terbaca, modem TIDAK diklaim terpakai (jangan mengarang);
        // dia jatuh ke BEKAS dan teknisi tetap yang mencocokkan stiker.
        const bekas = classifyModemCandidate(dev({ currentPPPUsername: "entah@rafcybernet" }), { users: [], activeUsernames: null });
        expect(bekas.state).toBe("bekas");
        expect(bekas.sessionsKnown).toBe(false);
    });
});

describe("enrichPreviousOwner", () => {
    test("nama pemilik lama diambil dari riwayat OLT (satu-satunya jejak yg selamat dari penghapusan)", async () => {
        const oltRepository = {
            getModemStateByPppoe: jest.fn(async () => ({ mac: "b414e68b23dd", customer_name: "Wimpi Sayekti" }))
        };
        const base = classifyModemCandidate(dev({ currentPPPUsername: "wimpi_sayekti-ngitik@rafcybernet" }), { users: [], activeUsernames: new Set() });
        const r = await enrichPreviousOwner(base, { oltRepository });
        expect(oltRepository.getModemStateByPppoe).toHaveBeenCalledWith("wimpi_sayekti-ngitik@rafcybernet");
        expect(r.ownerName).toBe("Wimpi Sayekti");
        expect(r.ownerSource).toBe("riwayat_olt");
    });

    test("riwayat OLT error → tetap BEKAS tanpa nama (never-throw)", async () => {
        const oltRepository = { getModemStateByPppoe: jest.fn(async () => { throw new Error("db locked"); }) };
        const base = classifyModemCandidate(dev({ currentPPPUsername: "x@rafcybernet" }), { users: [], activeUsernames: new Set() });
        const r = await enrichPreviousOwner(base, { oltRepository, logger: { error() {} } });
        expect(r.state).toBe("bekas");
        expect(r.ownerName).toBeNull();
    });

    test("modem BARU tak perlu lookup OLT sama sekali", async () => {
        const oltRepository = { getModemStateByPppoe: jest.fn() };
        const r = await describeCandidate(
            dev({ currentPPPUsername: "tes@hw" }),
            { users: [], activeUsernames: new Set(["tes@hw"]) },
            { oltRepository }
        );
        expect(oltRepository.getModemStateByPppoe).not.toHaveBeenCalled();
        expect(r.state).toBe("baru");
    });
});

describe("loadActivePppoeUsernames", () => {
    test("bentuk balikan MikroTik yang berbeda-beda tetap ke-unwrap", async () => {
        const arr = [{ name: "A@x" }, { name: "b@X" }];
        for (const shape of [arr, { data: arr }, { data: { data: arr } }, { items: arr }]) {
            const s = await loadActivePppoeUsernames({ getActivePPPoEUsers: async () => shape });
            expect(s).toEqual(new Set(["a@x", "b@x"]));
        }
    });

    test("router gagal / ok:false → null (TIDAK TAHU, bukan 'tak ada yang aktif')", async () => {
        expect(await loadActivePppoeUsernames({ getActivePPPoEUsers: async () => ({ ok: false, message: "timeout" }) })).toBeNull();
        expect(await loadActivePppoeUsernames({
            getActivePPPoEUsers: async () => { throw new Error("boom"); },
            logger: { error() {} }
        })).toBeNull();
    });

    test("tak ada sesi aktif → Set kosong (BEDA dari null)", async () => {
        const s = await loadActivePppoeUsernames({ getActivePPPoEUsers: async () => [] });
        expect(s).toEqual(new Set());
    });
});

describe("candidateBadge", () => {
    test("label ringkas per status", () => {
        expect(candidateBadge({ state: "baru" })).toBe("🆕 BARU");
        expect(candidateBadge({ state: "bekas", ownerName: "Wimpi Sayekti" })).toBe("♻️ BEKAS Wimpi Sayekti");
        expect(candidateBadge({ state: "bekas" })).toBe("♻️ BEKAS");
        expect(candidateBadge({ state: "terpakai", ownerName: "Budi" })).toBe("⛔ TERPAKAI (Budi)");
        expect(candidateBadge(null)).toBe("");
    });
});

// Modem dgn WAN TR-069 terpisah membawa >1 username PPPoE (insiden Dander 2026-08-07): index 1
// bisa berisi akun manajemen/kosong sedangkan PPPoE pelanggan duduk di index lain. Gerbang wajib
// memeriksa SEMUANYA — pelanggan hidup ber-device_id kosong hanya tertangkap lewat tautan PPPoE.
describe("classifyModemCandidate — multi-WAN (allPPPUsernames)", () => {
    test("PPPoE pelanggan hidup di index non-1 → tetap ⛔ TERPAKAI (tautan pppoe)", () => {
        const c = classifyModemCandidate(
            dev({ currentPPPUsername: null, allPPPUsernames: ["budi-krajan@rafcybernet"] }),
            { users: [{ name: "Budi", pppoe_username: "budi-krajan@rafcybernet", device_id: "" }], activeUsernames: new Set() }
        );
        expect(c.state).toBe("terpakai");
        expect(c.assignable).toBe(false);
        expect(c.ownerSource).toBe("pppoe");
        expect(c.ownerName).toBe("Budi");
    });

    test("sesi AKTIF atas username index non-1 → ⛔ TERPAKAI (sesi_aktif)", () => {
        const c = classifyModemCandidate(
            dev({ currentPPPUsername: "tes@hw", allPPPUsernames: ["tes@hw", "sari@rafcybernet"] }),
            { users: [], activeUsernames: new Set(["tes@hw", "sari@rafcybernet"]) }
        );
        expect(c.state).toBe("terpakai");
        expect(c.ownerSource).toBe("sesi_aktif");
    });

    test("semua username bawaan/kosong → tetap 🆕 BARU", () => {
        const c = classifyModemCandidate(
            dev({ currentPPPUsername: null, allPPPUsernames: ["tes@hw"] }),
            { users: [], activeUsernames: new Set(["tes@hw"]) }
        );
        expect(c.state).toBe("baru");
        expect(c.assignable).toBe(true);
    });

    test("username non-bawaan yang pemiliknya sudah dihapus → ♻️ bekas + previousPppoe dari daftar", () => {
        const c = classifyModemCandidate(
            dev({ currentPPPUsername: "tes@hw", allPPPUsernames: ["tes@hw", "Wimpi-Krajan@rafcybernet"] }),
            { users: [], activeUsernames: new Set(["tes@hw"]) }
        );
        expect(c.state).toBe("bekas");
        expect(c.assignable).toBe(true);
        expect(c.previousPppoe).toBe("wimpi-krajan@rafcybernet");
    });
});

describe("candidateBadge — kejujuran saat sesi MikroTik tak terbaca", () => {
    const { candidateBadge } = require("../psb-modem-provenance");

    test("sesi TAK terbaca → badge menandai keraguan, tak mengaku pasti", () => {
        expect(candidateBadge({ state: "baru", sessionsKnown: false })).toContain("⚠️sesi tak terbaca");
        expect(candidateBadge({ state: "bekas", ownerName: "Budi", sessionsKnown: false })).toContain("⚠️sesi tak terbaca");
    });

    test("sesi terbaca → badge bersih (tak ada peringatan palsu)", () => {
        expect(candidateBadge({ state: "baru", sessionsKnown: true })).toBe("🆕 BARU");
        expect(candidateBadge({ state: "bekas", ownerName: "Budi", sessionsKnown: true })).toBe("♻️ BEKAS Budi");
    });

    test("TERPAKAI tak perlu penanda ragu — vonisnya sudah menolak", () => {
        expect(candidateBadge({ state: "terpakai", ownerName: "Sri", sessionsKnown: false })).toBe("⛔ TERPAKAI (Sri)");
    });
});

// ── Gerbang LINTAS-AREA ────────────────────────────────────────────────────────────────────────
// GenieACS dipakai BERSAMA dua bot area, tapi aturan #1 hanya melihat sesi router SENDIRI dan
// aturan #2 hanya melihat pelanggan SENDIRI. Terukur di ACS Dander 2026-08-14: dari 160 device,
// 97 adalah modem pelanggan HIDUP di Tanjungharjo — dan gerbang lama meloloskan SEMUANYA sebagai
// "♻️ BEKAS, boleh dipakai". Pembeda yang dipakai bukan realm (kedua area @rafcybernet, tak bisa
// dibedakan) dan bukan ConnectionStatus (hanya terbaca ~68%), melainkan Uptime PPPoE — terbaca di
// 160/160 device. Uptime > 0 = sesinya hidup di SUATU router, apa pun areanya.
describe("gerbang lintas-area: modem yang sesinya hidup di router area lain", () => {
    const KONTEKS_KOSONG = { users: [], activeUsernames: new Set() };

    test("PPPoE asing + sesi hidup (uptime > 0) → TERPAKAI, tak boleh dipakai", () => {
        const hasil = classifyModemCandidate(
            dev({ currentPPPUsername: "mika_andriani-karang@rafcybernet", pppUptimeSeconds: 160466 }),
            KONTEKS_KOSONG
        );
        expect(hasil.state).toBe("terpakai");
        expect(hasil.assignable).toBe(false);
        expect(hasil.ownerSource).toBe("sesi_modem_aktif");
        // Nama pemiliknya memang TAK diketahui dari sini — ia pelanggan bot sebelah.
        expect(hasil.ownerName).toBeNull();
        expect(hasil.previousPppoe).toBe("mika_andriani-karang@rafcybernet");
    });

    test("modem POLOS (tes@hw) TIDAK ikut terblokir meski sesinya hidup", () => {
        // Justru begitulah modem polos online: memakai kredensial bawaan. Aturan #3 menangkapnya
        // lebih dulu, jadi jalur PSB yang sah tidak ikut mati oleh gerbang baru ini.
        const hasil = classifyModemCandidate(
            dev({ currentPPPUsername: "tes@hw", pppUptimeSeconds: 512 }),
            KONTEKS_KOSONG
        );
        expect(hasil.state).toBe("baru");
        expect(hasil.assignable).toBe(true);
    });

    test("modem copotan SEJATI (sesi mati) tetap BEKAS & boleh dipakai", () => {
        // Secret pemilik lama sudah dicabut → PPP tak pernah terbentuk → uptime 0.
        const hasil = classifyModemCandidate(
            dev({ currentPPPUsername: "wimpi@rafcybernet", pppUptimeSeconds: 0 }),
            KONTEKS_KOSONG
        );
        expect(hasil.state).toBe("bekas");
        expect(hasil.assignable).toBe(true);
    });

    test("uptime TAK TERBACA bukan alasan memblokir — 'tidak tahu' ≠ 'terbukti terpakai'", () => {
        const hasil = classifyModemCandidate(
            dev({ currentPPPUsername: "wimpi@rafcybernet", pppUptimeSeconds: null }),
            KONTEKS_KOSONG
        );
        expect(hasil.state).toBe("bekas");
        expect(hasil.assignable).toBe(true);
    });

    test("pelanggan area SENDIRI tetap ditangkap aturan lama (bukan lewat jalur baru)", () => {
        const hasil = classifyModemCandidate(
            dev({ currentPPPUsername: "sari@rafcybernet", pppUptimeSeconds: 9999 }),
            { users: [{ name: "Sari", pppoe_username: "sari@rafcybernet" }], activeUsernames: new Set() }
        );
        expect(hasil.assignable).toBe(false);
        expect(hasil.ownerSource).toBe("pppoe");   // tautan baris pelanggan, bukan sesi_modem_aktif
        expect(hasil.ownerName).toBe("Sari");
    });
});
