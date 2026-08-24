/**
 * Header Doc
 * Purpose: Menjawab satu pertanyaan: apakah KOMENTAR SURVEI ini memuat keluhan yang pantas
 *          diteruskan ke owner? Dipakai agar keluhan tidak lolos hanya karena pelanggannya
 *          memberi skor tinggi.
 * Caller: `lib/csat/csat-survey-service.js` (jalur komentar).
 * Deps: Tidak ada. Fungsi murni.
 * MainFuncs: `adaKeluhanDiKomentar`.
 * SideEffects: Tidak ada.
 *
 * !! KENAPA BUKAN MEMAKAI `hasConnectivityComplaintSignal` (#b263). Matcher itu dikalibrasi untuk
 * keluhan SPONTAN ("wifi mati nih"), dan di konteks survei ia salah arah. Diukur pada komentar
 * CSAT NYATA dari produksi: tertangkap 10/15, tapi SALAH TANGKAP 2/10 — dan dua-duanya justru
 * pelanggan yang PUAS:
 *
 *     "Gk ada kak. Makasih kembali"            -> dibaca keluhan
 *     "Ndak ada sangat puas dengan pelayanan"  -> dibaca keluhan
 *
 * Sebabnya konteks: pertanyaan surveinya "ada keluhan?", jadi **"tidak ada" berarti KEBALIKANNYA**.
 * Mengirimi owner alarm tentang pelanggan yang senang adalah cara tercepat membuat alarm diabaikan.
 *
 * URUTAN PEMERIKSAAN SENGAJA: kata keluhan diperiksa DULU, baru penanda "tidak ada". Dengan begitu
 * "gak ada internet dari kemarin" tetap terbaca keluhan, sementara "gak ada kak" tidak.
 */
"use strict";

// Kata yang benar-benar muncul di komentar pelanggan (bukan daftar teoretis). Dialek & salah ketik
// ikut, karena begitulah bentuk aslinya: "ngelaig", "radak lemot", "sinyal e".
const KATA_KELUHAN = [
    // lambat / tersendat — tema NOMOR SATU (50% komentar Tanjungharjo)
    "lemot", "lelet", "lola", "lag", "ngelag", "ngelaig", "nge-lag", "lambat", "lemod",
    "buffer", "loading lama", "lama loading", "lama banget", "muter", "nyendat", "tersendat", "patah",
    // putus / hilang
    "hilang", "putus", "mati", "drop", "disconnect", "terputus", "ilang",
    // jangkauan & sinyal — tema kedua
    "jangkauan", "sempit", "diperkuat", "perkuat", "susah sinyal", "sinyal lemah", "sinyal kurang",
    "tidak sampai", "gak sampai", "ga nyampe", "jauh",
    // permintaan perbaikan — sering berdiri sendiri ("Perbaiki")
    "perbaiki", "diperbaiki", "perbaikan", "dibenerin", "dibetulkan",
    // gangguan umum
    // "keluhan"/"komplain" SENGAJA TIDAK di sini: keduanya META. Terukur pada korpus nyata,
    // satu-satunya komentar yang memuatnya justru PUJIAN — "Sudah baik semua. Kl ada keluhan
    // juga fast respon". Keluhan sungguhan menyebut MASALAHNYA (lemot, mati, hilang), bukan
    // kata "keluhan".
    "gangguan", "error", "trouble", "bermasalah", "kecewa", "mahal"
];

// Penanda "TIDAK ADA keluhan" — jawaban atas pertanyaan survei, bukan keluhan.
const PENANDA_TAK_ADA = [
    "tidak ada", "tdk ada", "tak ada", "gak ada", "gk ada", "ga ada", "nggak ada", "ndak ada",
    "belum ada", "engga ada", "enggak ada", "nihil", "aman", "lancar", "puas", "bagus", "memuaskan",
    "sudah baik", "sdh baik", "sudah oke", "sdh oke", "mantap", "terbaik"
];

// Kata benda layanan: dipakai untuk membedakan "gak ada internet" (KELUHAN) dari "gak ada" (bukan).
const KATA_LAYANAN = ["internet", "jaringan", "sinyal", "wifi", "wi-fi", "koneksi", "jarkom"];

function normalkan(teks) {
    return String(teks || "")
        .toLowerCase()
        .replace(/[²`'"]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * @param {string} komentar
 * @returns {{keluhan: boolean, sebab: string, kata: string|null}}
 *          `sebab` selalu terisi supaya keputusannya bisa dibaca di log, bukan cuma boolean.
 */
function adaKeluhanDiKomentar(komentar) {
    const t = normalkan(komentar);
    if (!t || t.length < 2) return { keluhan: false, sebab: "komentar kosong", kata: null };

    // 1) Kata keluhan menang lebih dulu — "gak ada internet dari kemarin" tetap keluhan.
    const kata = KATA_KELUHAN.find((k) => t.includes(k));
    if (kata) return { keluhan: true, sebab: `memuat kata keluhan "${kata}"`, kata };

    // 2) "tidak ada X" dengan X = layanan → tetap keluhan (mis. "gak ada internet").
    const takAda = PENANDA_TAK_ADA.find((k) => t.includes(k));
    if (takAda && /\b(tidak|tdk|tak|gak|gk|ga|nggak|ndak|belum|engga|enggak)\s+ada\b/.test(t)) {
        const layanan = KATA_LAYANAN.find((k) => t.includes(k));
        if (layanan) return { keluhan: true, sebab: `"tidak ada ${layanan}"`, kata: layanan };
    }

    // 3) Penanda puas / tak ada keluhan → bukan keluhan.
    if (takAda) return { keluhan: false, sebab: `penanda tanpa-keluhan "${takAda}"`, kata: null };

    return { keluhan: false, sebab: "tak ada sinyal keluhan", kata: null };
}

module.exports = { adaKeluhanDiKomentar, _internal: { KATA_KELUHAN, PENANDA_TAK_ADA, normalkan } };
