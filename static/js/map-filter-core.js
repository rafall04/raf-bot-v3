/**
 * Header Doc
 * Purpose: INTI logika peta jaringan yang murni (tanpa DOM/Leaflet) supaya bisa diuji:
 *          (1) SATU sumber kebenaran untuk penyaringan, dan (2) kesehatan ODP.
 *
 *          KENAPA (1): dulu ada TIGA penulis visibilitas yang tak saling tahu — kotak centang
 *          legenda (`toggleLayerVisibility`) yang menambah/menghapus marker LANGSUNG tanpa mencatat
 *          state, tombol Quick Filter yang menimpa daftar `selected*Ids`, dan modal Filter Kustom.
 *          Akibatnya centang legenda HILANG diam-diam setiap kali peta menyegarkan diri (auto-refresh
 *          30 detik) atau tombol quick filter ditekan: kotaknya masih tercentang, tapi petanya
 *          berkata lain. Sekarang semua kontrol menulis ke `state` yang sama lalu peta digambar ulang
 *          dari state itu — kontradiksi jadi mustahil, bukan sekadar jarang.
 *
 *          KENAPA (2): pertanyaan pertama tiap ada laporan gangguan selalu sama — "ini ODP-nya atau
 *          rumah orang itu?". Datanya sudah ada di layar (status tiap pelanggan + `connected_odp_id`),
 *          cuma tak pernah dijumlahkan per ODP. Satu ODP dengan 4 dari 4 pelanggan mati adalah
 *          kalimat yang sangat berbeda dari 1 dari 4.
 * Caller: `static/js/map-viewer.js` (admin) dan `static/js/teknisi-map-viewer.js`.
 * Deps: Tidak ada.
 * MainFuncs: `buatFilterState`, `terapkanQuickFilter`, `bolehTampilAset`, `bolehTampilPelanggan`,
 *            `hitungKesehatanOdp`, `ringkasKesehatan`.
 * SideEffects: Tidak ada (murni).
 */
(function () {
    "use strict";

    const KATEGORI = ["odc", "odp", "online", "offline", "unknown"];

    /** Ambang "ini ODP-nya, bukan rumahnya". */
    const MIN_PELANGGAN_UNTUK_POLA = 2; // 1 dari 1 mati bukan pola, itu cuma satu rumah
    const RASIO_CURIGA = 0.5;           // separuh atau lebih penghuni mati = jalur/ODP-nya

    function buatFilterState() {
        return {
            kategori: { odc: true, odp: true, online: true, offline: true, unknown: true },
            quick: "all"
        };
    }

    /**
     * Quick Filter kini hanya MENYETEL kategori — tidak lagi mengosongkan daftar pilihan.
     *
     * Perubahan penting: "Online"/"Offline" TIDAK LAGI menyembunyikan ODC/ODP. Dulu memilih
     * "Offline" membuat aset ikut lenyap, padahal justru saat itulah ODP-nya paling perlu dilihat —
     * titik-titik mati tanpa boks induknya tak menjelaskan apa pun.
     */
    function terapkanQuickFilter(state, quick) {
        const k = state.kategori;
        state.quick = quick;

        switch (quick) {
            case "online":
                k.odc = true; k.odp = true;
                k.online = true; k.offline = false; k.unknown = false;
                break;
            case "offline":
                k.odc = true; k.odp = true;
                k.online = false; k.offline = true; k.unknown = false;
                break;
            case "assets":
                k.odc = true; k.odp = true;
                k.online = false; k.offline = false; k.unknown = false;
                break;
            case "customers":
                k.odc = false; k.odp = false;
                k.online = true; k.offline = true; k.unknown = true;
                break;
            case "all":
            default:
                KATEGORI.forEach((c) => { k[c] = true; });
                state.quick = "all";
                break;
        }
        return state;
    }

    /**
     * Menyalakan/mematikan satu kategori dari legenda. Karena quick filter adalah PRASETEL kategori,
     * begitu pengguna menyentuh satu kotak centang, prasetel itu tak lagi menggambarkan keadaan →
     * tandai "kustom" supaya tombol quick filter tidak berbohong dengan tetap terlihat aktif.
     */
    function setelKategori(state, kategori, tampil) {
        if (!Object.prototype.hasOwnProperty.call(state.kategori, kategori)) return state;
        state.kategori[kategori] = !!tampil;
        state.quick = cocokQuickFilter(state);
        return state;
    }

    /** Kalau susunan kategori kebetulan sama persis dgn sebuah prasetel, tombolnya boleh menyala. */
    function cocokQuickFilter(state) {
        const uji = ["all", "online", "offline", "assets", "customers"];
        for (const q of uji) {
            const contoh = terapkanQuickFilter({ kategori: {}, quick: "" }, q).kategori;
            if (KATEGORI.every((c) => !!contoh[c] === !!state.kategori[c])) return q;
        }
        return "custom";
    }

    /** `pilihan` = daftar ID dari modal Filter Kustom (Set). Null/undefined = tak menyaring. */
    function terpilih(pilihan, id) {
        if (!pilihan || typeof pilihan.has !== "function") return true;
        return pilihan.has(String(id));
    }

    function bolehTampilAset(state, asset, pilihan) {
        if (!asset) return false;
        const tipe = String(asset.type || "").toUpperCase();
        if (tipe === "ODC") return !!state.kategori.odc && terpilih(pilihan, asset.id);
        if (tipe === "ODP") return !!state.kategori.odp && terpilih(pilihan, asset.id);
        return false;
    }

    function bolehTampilPelanggan(state, status, id, pilihan) {
        const s = status === "online" || status === "offline" ? status : "unknown";
        return !!state.kategori[s] && terpilih(pilihan, id);
    }

    /**
     * Kesehatan satu ODP dari daftar pelanggan yang menempel padanya.
     * `status` per pelanggan: "online" | "offline" | apa pun lain = tak diketahui (TIDAK dihitung
     * sebagai mati — "tak bisa dibaca" bukan "terbukti mati", pelajaran yang sama dgn diagnosa modem).
     */
    function hitungKesehatanOdp(pelanggan) {
        const daftar = Array.isArray(pelanggan) ? pelanggan : [];
        let online = 0;
        let offline = 0;
        let unknown = 0;

        daftar.forEach((p) => {
            const s = p && p.status;
            if (s === "online") online += 1;
            else if (s === "offline") offline += 1;
            else unknown += 1;
        });

        const terbaca = online + offline;
        const rasio = terbaca ? offline / terbaca : 0;
        const curiga = terbaca >= MIN_PELANGGAN_UNTUK_POLA && rasio >= RASIO_CURIGA;

        return { total: daftar.length, online, offline, unknown, terbaca, rasio, curiga };
    }

    /** Kalimat siap-tampil. Sengaja menyebut ANGKA, bukan cuma warna. */
    function ringkasKesehatan(sehat) {
        if (!sehat || !sehat.total) return "Belum ada pelanggan tersambung";
        if (sehat.curiga) {
            return `${sehat.offline} dari ${sehat.terbaca} pelanggan OFFLINE — periksa ODP/jalurnya dulu`;
        }
        // TAK TERBACA ≠ SEHAT. Tanpa cabang ini, ODP yang seluruh penghuninya tak terbaca berbunyi
        // "Semua 0 pelanggan online" — mengaku sehat justru saat kita buta.
        if (!sehat.terbaca) return `Status ${sehat.total} pelanggan belum terbaca`;
        if (sehat.offline) return `${sehat.offline} pelanggan offline (lainnya normal)`;
        const catatan = sehat.unknown ? ` (${sehat.unknown} belum terbaca)` : "";
        return `Semua ${sehat.online} pelanggan online${catatan}`;
    }

    /** Hunian: dipakai untuk lencana `3/8` sekaligus penanda penuh. */
    function ringkasHunian(terpakai, kapasitas) {
        const t = parseInt(terpakai, 10) || 0;
        const k = parseInt(kapasitas, 10) || 0;
        return {
            terpakai: t,
            kapasitas: k,
            teks: k > 0 ? `${t}/${k}` : String(t),
            penuh: k > 0 && t >= k,
            hampirPenuh: k > 0 && t >= k - 1 && t < k
        };
    }

    const api = {
        KATEGORI,
        MIN_PELANGGAN_UNTUK_POLA,
        RASIO_CURIGA,
        buatFilterState,
        terapkanQuickFilter,
        setelKategori,
        cocokQuickFilter,
        bolehTampilAset,
        bolehTampilPelanggan,
        hitungKesehatanOdp,
        ringkasKesehatan,
        ringkasHunian
    };

    if (typeof window !== "undefined") window.MapFilterCore = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
