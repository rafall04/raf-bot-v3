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
