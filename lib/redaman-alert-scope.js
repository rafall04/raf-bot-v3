/**
 * Header Doc
 * Purpose: Menentukan MODEM MANA yang boleh memicu alert redaman, dan apakah nilainya masih
 *          layak dipercaya. Dua gerbang: (1) kepemilikan — hanya modem pelanggan bot ini,
 *          (2) kesegaran — jangan pernah memvonis dari pembacaan buta.
 * Caller: `lib/cron/jobs/redaman-check.js`, test.
 * Deps: tidak ada (murni; `global.*` hanya dipakai sebagai default argumen agar tetap teruji).
 * MainFuncs: `bacaSetelanLingkup`, `bangunPetaDevicePelanggan`, `bacaNilaiRedaman`, `evaluasiDevice`.
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — dua cacat yang TERUKUR di produksi 2026-08-16.
 *
 * 1) SATU ACS DIPAKAI DUA BOT, TAPI CRON MEMINDAI SEMUANYA.
 *    Cron mengambil `queryDevices({projection:['_id']})` tanpa filter apa pun, padahal
 *    `genieacsBaseUrl` kedua bot menunjuk ACS yang sama (172.17.11.2:7557). Terukur:
 *
 *        ACS berisi 160 modem — Dander memiliki 58, Tanjungharjo 96.
 *        Dari 4 modem di bawah toleransi, HANYA 1 milik bot ybs pada masing-masing bot.
 *
 *    Jadi 3 dari 4 alert yang sampai ke teknisi adalah modem milik bot lain, terkirim
 *    dengan nama/HP/alamat/PPPoE serba "(Tidak Terdaftar)" — mustahil ditindaklanjuti.
 *    Menyaring di sini juga memangkas beban ACS: refresh 160 → 58/96 per bot per jam.
 *
 * 2) TAK ADA GERBANG KESEGARAN — "TAK BISA DILIHAT" DISAMAKAN DENGAN "TERLIHAT BURUK".
 *    Cron membaca apa pun yang tersimpan di ACS, setua apa pun. Terukur pada siklus nyata:
 *    sesudah refresh, umur nilai median 0,8 mnt dan p90 1,3 mnt — TAPI 3 modem mati tak
 *    pernah ikut diperbarui dan nilainya berumur ~40 HARI. Kebetulan ketiganya sedang di
 *    atas toleransi, jadi belum pernah meledak; begitu salah satunya membeku pada angka
 *    buruk, teknisi akan dikirimi alert yang sama selamanya dari pembacaan mati.
 *    Ambang bawaan 15 menit = ~10x p90 terukur, jadi hanya menyaring modem yang benar-benar
 *    tak terjangkau, bukan modem lambat.
 */
"use strict";

/** Bawaan ambang kesegaran: 15 menit (~10x p90 umur nilai terukur sesudah refresh). */
const UMUR_MAKS_DEFAULT_MENIT = 15;
/** Bawaan jeda antar-alert untuk device yang sama. */
const COOLDOWN_DEFAULT_JAM = 12;

/** Alasan sebuah device tidak jadi dialert — dihitung supaya tak ada yang hilang diam-diam. */
const ALASAN = {
    ALERT: "alert",
    SEHAT: "sehat",
    BUKAN_PELANGGAN: "bukan_pelanggan",
    TANPA_NILAI: "tanpa_nilai",
    NILAI_BASI: "nilai_basi",
};

function bacaSetelanLingkup(config = (typeof global !== "undefined" ? global.config : null)) {
    const c = (config && config.redamanAlert) || {};
    const umurMenit = Number.parseFloat(c.maxDataAgeMinutes);
    // `redaman_alert_cooldown_hours` = key lama di akar config; tetap dihormati agar
    // instalasi yang sudah menyetelnya tidak berubah perilaku diam-diam.
    const cooldownJam = Number.parseFloat(
        c.cooldownHours !== undefined && c.cooldownHours !== null && c.cooldownHours !== ""
            ? c.cooldownHours
            : (config && config.redaman_alert_cooldown_hours)
    );

    return {
        // Bawaan HIDUP: mengirimi teknisi modem milik bot lain bukan fitur, itu cacat.
        // Tetap bisa dimatikan dari halaman Konfigurasi bila pemilik memang menginginkannya.
        hanyaPelangganSendiri: c.hanyaPelangganSendiri !== false,
        // 0 / negatif = gerbang kesegaran dimatikan (kembali ke perilaku lama).
        maksUmurMs: (Number.isFinite(umurMenit) && umurMenit >= 0 ? umurMenit : UMUR_MAKS_DEFAULT_MENIT) * 60000,
        cooldownMs: (Number.isFinite(cooldownJam) && cooldownJam >= 0 ? cooldownJam : COOLDOWN_DEFAULT_JAM) * 3600000,
    };
}

/**
 * Peta device_id → pelanggan. Satu pelanggan bisa punya beberapa device_id dipisah "|"
 * (konvensi lama di kolom-kolom users), jadi tiap potongan didaftarkan.
 */
function bangunPetaDevicePelanggan(users = (typeof global !== "undefined" ? global.users : null)) {
    const peta = new Map();
    if (!Array.isArray(users)) return peta;
    for (const u of users) {
        if (!u || !u.device_id) continue;
        for (const potongan of String(u.device_id).split("|")) {
            const id = potongan.trim();
            if (id && !peta.has(id)) peta.set(id, u);
        }
    }
    return peta;
}

function ambilJalur(obj, jalur) {
    let cur = obj;
    for (const bagian of String(jalur).split(".")) {
        if (!cur || typeof cur !== "object" || !(bagian in cur)) return undefined;
        cur = cur[bagian];
    }
    return cur;
}

/**
 * Nilai redaman + KAPAN nilai itu direkam. GenieACS menyimpan `_timestamp` per parameter;
 * itulah satu-satunya bukti umur data — `_lastInform` device tidak cukup.
 * @returns {{nilai:*, angka:number, tsMs:number|null, jalur:string}|null}
 */
function bacaNilaiRedaman(device, paths = []) {
    if (!device) return null;
    for (const jalur of paths) {
        const v = ambilJalur(device, jalur);
        if (!v || typeof v !== "object" || typeof v._value === "undefined") continue;

        const mentah = v._value;
        let angka;
        if (typeof mentah === "number") {
            angka = mentah;
        } else if (typeof mentah === "string") {
            const cocok = mentah.match(/-?\d+\.?\d*/);
            angka = cocok ? Number.parseFloat(cocok[0]) : Number.parseInt(mentah, 10);
        } else {
            angka = Number.parseInt(mentah, 10);
        }
        if (Number.isNaN(angka)) continue;

        const ts = v._timestamp ? new Date(v._timestamp).getTime() : NaN;
        return { nilai: mentah, angka, tsMs: Number.isNaN(ts) ? null : ts, jalur };
    }
    return null;
}

/**
 * Putuskan nasib satu device. Fail-closed: nilai tak terbaca atau kedaluwarsa TIDAK
 * menghasilkan alert — bot sedang buta, bukan sedang melihat modem rusak.
 *
 * @param {object} device      record dari `queryDevices` (harus membawa `_timestamp`).
 * @param {object} opsi
 * @param {Map}    opsi.petaPelanggan
 * @param {string[]} opsi.paths
 * @param {number} opsi.rxTolerance   mis. -26 (dBm); lebih negatif = lebih buruk.
 * @param {number} opsi.maksUmurMs    0 = gerbang kesegaran mati.
 * @param {boolean} opsi.hanyaPelangganSendiri
 * @param {number} opsi.sekarang
 * @returns {{alasan:string, pelanggan:object|null, angka:number|null, umurMs:number|null}}
 */
function evaluasiDevice(device, opsi = {}) {
    const {
        petaPelanggan = new Map(),
        paths = [],
        rxTolerance,
        maksUmurMs = 0,
        hanyaPelangganSendiri = true,
        sekarang = Date.now(),
    } = opsi;

    const pelanggan = petaPelanggan.get(device && device._id) || null;
    if (hanyaPelangganSendiri && !pelanggan) {
        return { alasan: ALASAN.BUKAN_PELANGGAN, pelanggan: null, angka: null, umurMs: null };
    }

    const nilai = bacaNilaiRedaman(device, paths);
    if (!nilai) return { alasan: ALASAN.TANPA_NILAI, pelanggan, angka: null, umurMs: null };

    const umurMs = nilai.tsMs === null ? null : sekarang - nilai.tsMs;

    if (nilai.angka >= rxTolerance) {
        return { alasan: ALASAN.SEHAT, pelanggan, angka: nilai.angka, umurMs };
    }

    // Di bawah toleransi — tapi hanya sah divonis kalau pembacaannya masih baru.
    if (maksUmurMs > 0 && (umurMs === null || umurMs > maksUmurMs)) {
        return { alasan: ALASAN.NILAI_BASI, pelanggan, angka: nilai.angka, umurMs };
    }

    return { alasan: ALASAN.ALERT, pelanggan, angka: nilai.angka, umurMs };
}

module.exports = {
    ALASAN,
    UMUR_MAKS_DEFAULT_MENIT,
    COOLDOWN_DEFAULT_JAM,
    bacaSetelanLingkup,
    bangunPetaDevicePelanggan,
    bacaNilaiRedaman,
    evaluasiDevice,
};
