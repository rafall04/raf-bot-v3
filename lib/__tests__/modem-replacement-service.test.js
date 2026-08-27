/**
 * Header Doc
 * Purpose : Menjaga alur GANTI MODEM (#b281) — terutama bahwa nama & sandi WiFi pelanggan
 *           ikut berpindah, dan bahwa kegagalan TIDAK meninggalkan keadaan setengah jadi.
 * Caller  : jest
 * Deps    : lib/modem-replacement-service (semua I/O di-inject)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const { gantiModem, LANGKAH } = require("../modem-replacement-service");

const LAMA = "00259E-HG8145V5-AAAA";
const BARU = "00259E-HG8245H5-BBBB";

function buatDeps(over = {}) {
    const dipanggil = { simpan: [], wifi: [], log: [] };
    return {
        dipanggil,
        deps: {
            getUsers: () => [{ id: 7, name: "Budi", device_id: LAMA, bulk: "1" }],
            queryDevices: async () => ({ data: [{ _id: BARU }] }),
            getSSIDInfo: async () => ({ ssids: [{ ssid: "RAF-Budi", password: "rahasia123" }] }),
            updateWifiSettings: async (id, payload) => { dipanggil.wifi.push({ id, payload }); return { ok: true, accepted: true, applied: true, status: 200 }; },
            assertWifiChangeApplied: () => {},
            fetchDeviceCapability: async () => ({ found: true, has5G: false, expectedBulk: "1" }),
            simpanDeviceId: async (p, d, b) => { dipanggil.simpan.push({ id: p.id, d, b }); },
            bacaRiwayatWifi: async () => ({ ssid: "", password: "" }),
            logActivity: (x) => dipanggil.log.push(x),
            ...over,
        },
    };
}

describe("#b281 — ganti modem", () => {
    test("jalur normal: WiFi pindah, lalu kepemilikan tercatat", async () => {
        const { deps, dipanggil } = buatDeps();
        const r = await gantiModem({ customerId: 7, deviceIdBaru: BARU, aktor: { username: "teknisi1" } }, deps);
        expect(r.ok).toBe(true);
        expect(dipanggil.wifi).toHaveLength(1);
        expect(dipanggil.wifi[0].id).toBe(BARU);
        expect(dipanggil.wifi[0].payload).toMatchObject({ ssid_1: "RAF-Budi", ssid_password_1: "rahasia123" });
        expect(dipanggil.simpan).toEqual([{ id: 7, d: BARU, b: "1" }]);
    });

    test("!! WiFi diterapkan SEBELUM device_id disimpan", async () => {
        // Kalau dibalik, kegagalan penerapan meninggalkan pelanggan 'pindah di data' tapi
        // modemnya belum siap — dan tiap pembacaan berikutnya menatap perangkat yang salah.
        const urutan = [];
        const { deps } = buatDeps({
            updateWifiSettings: async () => { urutan.push("wifi"); return { ok: true, accepted: true, applied: true }; },
            simpanDeviceId: async () => { urutan.push("simpan"); },
        });
        await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        expect(urutan).toEqual(["wifi", "simpan"]);
    });

    test("!! gagal pasang WiFi → device_id TIDAK jadi disimpan", async () => {
        const { deps, dipanggil } = buatDeps({
            assertWifiChangeApplied: () => { throw new Error("202 queued"); },
        });
        const r = await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        expect(r.ok).toBe(false);
        expect(dipanggil.simpan).toHaveLength(0);
        const l = r.langkah.find((x) => x.langkah === LANGKAH.TERAP_WIFI);
        expect(l.ok).toBe(false);
        expect(l.pesan).toMatch(/DIBATALKAN/);
    });

    test("!! kredensial tak bisa dipastikan → BERHENTI dan minta diisi, bukan lanjut diam-diam", async () => {
        // Modem baru bersetelan pabrik = seluruh perangkat di rumah pelanggan gagal
        // tersambung setelah teknisi pulang.
        const { deps, dipanggil } = buatDeps({
            getSSIDInfo: async () => { throw new Error("modem lama mati"); },
            bacaRiwayatWifi: async () => ({ ssid: "", password: "" }),
        });
        const r = await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        expect(r.ok).toBe(false);
        expect(r.butuhKredensial).toBe(true);
        expect(dipanggil.wifi).toHaveLength(0);
        expect(dipanggil.simpan).toHaveLength(0);
    });

    test("modem lama MATI tapi ada di riwayat → tetap bisa lanjut", async () => {
        const { deps, dipanggil } = buatDeps({
            getSSIDInfo: async () => { throw new Error("mati"); },
            bacaRiwayatWifi: async () => ({ ssid: "RAF-Budi", password: "dariRiwayat9" }),
        });
        const r = await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        expect(r.ok).toBe(true);
        expect(dipanggil.wifi[0].payload.ssid_password_1).toBe("dariRiwayat9");
        expect(r.langkah.find((x) => x.langkah === LANGKAH.KREDENSIAL).pesan).toMatch(/riwayat/);
    });

    test("yang diketik teknisi mengalahkan sumber lain", async () => {
        const { deps, dipanggil } = buatDeps();
        await gantiModem({ customerId: 7, deviceIdBaru: BARU, ssid: "RAF-Baru", password: "ketikan12" }, deps);
        expect(dipanggil.wifi[0].payload).toMatchObject({ ssid_1: "RAF-Baru", ssid_password_1: "ketikan12" });
    });

    test("modem baru belum terlihat di ACS → ditolak dengan sebab yang bisa ditindak", async () => {
        const { deps, dipanggil } = buatDeps({ queryDevices: async () => ({ data: [] }) });
        const r = await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        expect(r.ok).toBe(false);
        expect(dipanggil.wifi).toHaveLength(0);
        expect(r.langkah.find((x) => x.langkah === LANGKAH.DEVICE_BARU).pesan).toMatch(/menyala|fiber|ACS/i);
    });

    test("!! modem milik pelanggan LAIN tidak boleh direbut", async () => {
        const { deps, dipanggil } = buatDeps({
            getUsers: () => [
                { id: 7, name: "Budi", device_id: LAMA },
                { id: 9, name: "Sari", device_id: BARU },
            ],
        });
        const r = await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        expect(r.ok).toBe(false);
        expect(dipanggil.wifi).toHaveLength(0);
        expect(r.langkah.find((x) => x.langkah === LANGKAH.BELUM_DIPAKAI).pesan).toMatch(/Sari/);
    });

    test("modem baru sama dengan yang sekarang → ditolak", async () => {
        const { deps } = buatDeps();
        const r = await gantiModem({ customerId: 7, deviceIdBaru: LAMA }, deps);
        expect(r.ok).toBe(false);
        expect(r.pesan).toMatch(/sama/i);
    });

    test("pelanggan tak ada → ditolak tanpa menyentuh apa pun", async () => {
        const { deps, dipanggil } = buatDeps();
        const r = await gantiModem({ customerId: 999, deviceIdBaru: BARU }, deps);
        expect(r.ok).toBe(false);
        expect(dipanggil.wifi).toHaveLength(0);
    });

    test("modem dual-band → SSID 2.4 DAN 5 ikut disetel", async () => {
        const { deps, dipanggil } = buatDeps({
            fetchDeviceCapability: async () => ({ found: true, has5G: true, expectedBulk: "1,5" }),
        });
        await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        expect(Object.keys(dipanggil.wifi[0].payload).sort())
            .toEqual(["ssid_1", "ssid_5", "ssid_password_1", "ssid_password_5"].sort());
    });

    test("gagal SIMPAN sesudah WiFi terpasang → dikatakan apa adanya, bukan 'berhasil'", async () => {
        const { deps } = buatDeps({ simpanDeviceId: async () => { throw new Error("db mati"); } });
        const r = await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        expect(r.ok).toBe(false);
        const l = r.langkah.find((x) => x.langkah === LANGKAH.SIMPAN);
        expect(l.ok).toBe(false);
        expect(l.pesan).toMatch(/WiFi sudah terpasang/);
    });

    test("NEVER-THROW: dependensi meledak pun memulangkan laporan", async () => {
        const { deps } = buatDeps({ getUsers: () => { throw new Error("boom"); } });
        await expect(gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps)).resolves.toMatchObject({ ok: false });
    });

    test("laporan selalu berisi langkah-langkah supaya teknisi tahu berhenti di mana", async () => {
        const { deps } = buatDeps();
        const r = await gantiModem({ customerId: 7, deviceIdBaru: BARU }, deps);
        const kode = r.langkah.map((x) => x.langkah);
        expect(kode).toEqual(expect.arrayContaining([
            LANGKAH.PELANGGAN, LANGKAH.DEVICE_BARU, LANGKAH.BELUM_DIPAKAI,
            LANGKAH.KREDENSIAL, LANGKAH.TERAP_WIFI, LANGKAH.SIMPAN,
        ]));
    });
});
