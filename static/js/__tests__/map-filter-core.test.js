/**
 * Header Doc
 * Purpose: Mengunci dua aturan peta jaringan yang paling mudah rusak diam-diam:
 *          (1) SATU sumber kebenaran penyaringan — termasuk keputusan bahwa "Offline" TIDAK
 *              menyembunyikan ODC/ODP (dulu begitu, dan itu membuang justru konteks yang dicari),
 *          (2) vonis kesehatan ODP — "tak terbaca" tak boleh dihitung sebagai "mati".
 * Caller: Jest.
 * Deps: ../map-filter-core (murni, tanpa DOM).
 * SideEffects: Tidak ada.
 */
"use strict";

const core = require("../map-filter-core");

const ODC = { id: "ODC-1", type: "ODC" };
const ODP = { id: "ODP-1", type: "ODP" };

describe("filter — satu sumber kebenaran", () => {
    test("keadaan awal menampilkan semuanya", () => {
        const s = core.buatFilterState();
        expect(core.bolehTampilAset(s, ODC)).toBe(true);
        expect(core.bolehTampilAset(s, ODP)).toBe(true);
        ["online", "offline", "unknown"].forEach((st) => {
            expect(core.bolehTampilPelanggan(s, st, 1)).toBe(true);
        });
    });

    test("quick filter OFFLINE tetap menampilkan ODC & ODP — konteksnya justru itu yang dicari", () => {
        const s = core.terapkanQuickFilter(core.buatFilterState(), "offline");

        expect(core.bolehTampilAset(s, ODC)).toBe(true);
        expect(core.bolehTampilAset(s, ODP)).toBe(true);
        expect(core.bolehTampilPelanggan(s, "offline", 1)).toBe(true);
        expect(core.bolehTampilPelanggan(s, "online", 2)).toBe(false);
    });

    test("quick filter ASET menyembunyikan seluruh pelanggan, PELANGGAN menyembunyikan seluruh aset", () => {
        const aset = core.terapkanQuickFilter(core.buatFilterState(), "assets");
        expect(core.bolehTampilAset(aset, ODP)).toBe(true);
        expect(core.bolehTampilPelanggan(aset, "online", 1)).toBe(false);

        const pel = core.terapkanQuickFilter(core.buatFilterState(), "customers");
        expect(core.bolehTampilAset(pel, ODP)).toBe(false);
        expect(core.bolehTampilPelanggan(pel, "unknown", 1)).toBe(true);
    });

    test("mematikan satu kategori dari legenda membuat tombol quick filter berhenti mengaku aktif", () => {
        const s = core.terapkanQuickFilter(core.buatFilterState(), "all");
        expect(s.quick).toBe("all");

        core.setelKategori(s, "odp", false);
        expect(core.bolehTampilAset(s, ODP)).toBe(false);
        expect(core.bolehTampilAset(s, ODC)).toBe(true); // kategori lain tak ikut terseret
        expect(s.quick).toBe("custom");
    });

    test("menyusun kembali kategori yang sama persis dgn prasetel membuat tombolnya menyala lagi", () => {
        const s = core.buatFilterState();
        core.setelKategori(s, "online", false);
        core.setelKategori(s, "unknown", false);
        expect(s.quick).toBe("offline"); // odc+odp+offline = prasetel "offline"
    });

    test("pilihan dari Filter Kustom mempersempit, bukan menggantikan, kategori", () => {
        const s = core.buatFilterState();
        const pilihan = new Set(["ODP-1"]);

        expect(core.bolehTampilAset(s, ODP, pilihan)).toBe(true);
        expect(core.bolehTampilAset(s, { id: "ODP-9", type: "ODP" }, pilihan)).toBe(false);

        core.setelKategori(s, "odp", false);
        expect(core.bolehTampilAset(s, ODP, pilihan)).toBe(false); // kategori mati menang
    });
});

describe("kesehatan ODP — 'ODP-nya atau rumahnya?'", () => {
    const pel = (...status) => status.map((s, i) => ({ id: i + 1, status: s }));

    test("mayoritas mati = ODP dicurigai", () => {
        const h = core.hitungKesehatanOdp(pel("offline", "offline", "offline", "online"));
        expect(h.offline).toBe(3);
        expect(h.curiga).toBe(true);
        expect(core.ringkasKesehatan(h)).toMatch(/3 dari 4 pelanggan OFFLINE/);
    });

    test("satu rumah mati di antara yang sehat BUKAN masalah ODP", () => {
        const h = core.hitungKesehatanOdp(pel("online", "online", "online", "offline"));
        expect(h.curiga).toBe(false);
        expect(core.ringkasKesehatan(h)).toMatch(/1 pelanggan offline/);
    });

    test("1 dari 1 mati TIDAK dianggap pola — satu rumah bukan bukti jalur putus", () => {
        const h = core.hitungKesehatanOdp(pel("offline"));
        expect(h.rasio).toBe(1);
        expect(h.curiga).toBe(false);
    });

    test("status tak terbaca TIDAK dihitung sebagai mati", () => {
        const h = core.hitungKesehatanOdp(pel("unknown", "unknown", "offline", "online"));
        expect(h.unknown).toBe(2);
        expect(h.terbaca).toBe(2);
        expect(h.curiga).toBe(true); // 1 dari 2 yang TERBACA mati
        const semuaGelap = core.hitungKesehatanOdp(pel("unknown", "unknown"));
        expect(semuaGelap.curiga).toBe(false); // buta total ⇒ tak menuduh
    });

    test("seluruh penghuni tak terbaca TIDAK boleh berbunyi 'semua online' — itu mengaku sehat saat buta", () => {
        const h = core.hitungKesehatanOdp(pel("unknown", "unknown", "unknown"));
        const kalimat = core.ringkasKesehatan(h);
        expect(kalimat).toMatch(/belum terbaca/i);
        expect(kalimat).not.toMatch(/online/i);
    });

    test("sebagian tak terbaca tetap disebut, bukan disembunyikan", () => {
        const h = core.hitungKesehatanOdp(pel("online", "online", "unknown"));
        expect(core.ringkasKesehatan(h)).toMatch(/Semua 2 pelanggan online \(1 belum terbaca\)/);
    });

    test("ODP kosong tak menuduh apa pun", () => {
        const h = core.hitungKesehatanOdp([]);
        expect(h.curiga).toBe(false);
        expect(core.ringkasKesehatan(h)).toMatch(/Belum ada pelanggan/);
    });
});

describe("hunian ODP", () => {
    test("lencana 3/8 + penanda penuh & hampir penuh", () => {
        expect(core.ringkasHunian(3, 8)).toMatchObject({ teks: "3/8", penuh: false, hampirPenuh: false });
        expect(core.ringkasHunian(7, 8)).toMatchObject({ teks: "7/8", hampirPenuh: true, penuh: false });
        expect(core.ringkasHunian(8, 8)).toMatchObject({ teks: "8/8", penuh: true });
    });

    test("kapasitas 0 = tak dibatasi (konvensi lama), jangan dilaporkan penuh", () => {
        expect(core.ringkasHunian(12, 0)).toMatchObject({ teks: "12", penuh: false });
    });
});
