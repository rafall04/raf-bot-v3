/**
 * Header Doc
 * Purpose: Mengubah keluaran MENTAH `/tool/traceroute` MikroTik jadi BUKTI yang bisa dipakai
 *          berdebat dengan ISP: memisahkan ronde yang tertumpuk, menggabungkannya per posisi
 *          hop, lalu menetapkan hop mana yang benar-benar mulai kehilangan paket.
 * Caller: `lib/upstream-quality-poller.js` (runTraceProbe), `lib/upstream-quality-alerter.js`.
 * Deps: Tidak ada. Fungsi murni, tanpa I/O.
 * MainFuncs: `pisahkanRonde`, `gabungkanRonde`, `cariHopBermasalah`, `analisaTrace`.
 * SideEffects: Tidak ada.
 *
 * !! KENAPA ADA (#b256). Modul lama menetapkan hop bersalah dengan satu baris:
 *
 *     hops.find((h) => h.address && h.loss_pct >= 50)
 *
 * dan itu memulangkan `null` pada 78 dari 78 trace produksi. Dua sebab, dua-duanya penting:
 *
 * 1. RONDE TERTUMPUK. `/tool/traceroute` itu alat BERJALAN TERUS; walau dipanggil `count=1`,
 *    API memulangkan semua baris yang sempat terpancar — beberapa ronde penuh, tersambung jadi
 *    satu larik seolah jalurnya panjang. Terukur: 71 dari 78 trace memuat alamat BERULANG
 *    (hop 1,2,3 lalu hop 5,6,7 alamatnya sama persis).
 *
 * 2. HOP DIAM DISALAHPAHAMI. 25% baris beralamat KOSONG dengan loss 100%. Itu router yang
 *    membatasi/menolak balasan ICMP — normal dan tidak berbahaya. Router semacam itu MENERUSKAN
 *    paket dengan baik; ia cuma tak mau menjawab paket yang ditujukan KE DIRINYA.
 *
 * !! ATURAN INTI — LOSS BARU BERARTI BILA BERTAHAN SAMPAI TUJUAN. Contoh nyata jalur `gmdp`:
 * hop 2 loss 100% (alamat kosong), tapi hop 11 = 8.8.4.4 loss 0% — tujuan TERCAPAI utuh, jadi
 * jalurnya SEHAT. Menuduh hop 2 di situ berarti menuduh ISP berdasarkan router yang sekadar
 * diam. Sekali salah tuduh, komplain berikutnya yang datanya benar ikut kehilangan kredibilitas.
 * Karena itu modul ini memilih DIAM saat ragu, dan selalu menyertakan `sebab` yang bisa dibaca.
 */
"use strict";

const AMBANG_BAWAAN = {
    lossHopPct: 20,      // hop dianggap kehilangan paket mulai di sini
    toleransiPct: 10,    // hop sesudahnya boleh lebih rendah sebanyak ini dan tetap disebut "bertahan"
    minHopMenjawab: 2    // di bawah ini trace terlalu miskin untuk disimpulkan
};

function angka(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function alamat(h) {
    const a = h && h.address ? String(h.address).trim() : "";
    return a || null;
}

/**
 * Pisahkan larik datar jadi ronde-ronde.
 *
 * Penanda ronde baru: muncul lagi alamat PERTAMA ronde berjalan. Itu tanda paling andal —
 * traceroute selalu memulai dari hop 1 yang sama. Panjang ronde TIDAK tetap (hop yang diam
 * kadang terpancar, kadang tidak), jadi memotong per-N akan salah sejajar.
 */
function pisahkanRonde(hops) {
    const semua = Array.isArray(hops) ? hops : [];
    const ronde = [];
    let kini = [];
    let alamatAwal = null;
    for (const h of semua) {
        const a = alamat(h);
        if (a && alamatAwal && a === alamatAwal && kini.length) {
            ronde.push(kini);
            kini = [];
            alamatAwal = a;
        } else if (a && !alamatAwal) {
            alamatAwal = a;
        }
        kini.push(h);
    }
    if (kini.length) ronde.push(kini);
    return ronde;
}

/** Baris "belum diukur": RouterOS memancarkan placeholder sebelum hop sempat diprobe. */
function placeholder(h) {
    return !alamat(h) && angka(h && h.loss_pct) === 0 && angka(h && h.avg_ms) === 0;
}

/**
 * Gabungkan ronde jadi SATU jalur per posisi hop.
 *
 * !! MENGAMBIL SNAPSHOT TERAKHIR, BUKAN MERATA-RATA — dan ini terukur, bukan selera. `avg_ms`
 * di posisi yang sama IDENTIK PERSIS antar ronde (8,7 → 8,7 → 8,7 pada 78 trace produksi).
 * Kalau tiap ronde itu pengukuran baru, RTT-nya pasti bergoyang. Identik berarti ronde adalah
 * SNAPSHOT BERULANG dari statistik traceroute yang sedang berjalan di router — makin belakang
 * makin banyak probe terkumpul di dalamnya. Merata-rata akan menghitung paket yang sama
 * berkali-kali, dan lebih buruk lagi mengencerkan loss nyata dengan baris placeholder
 * (12% dari seluruh baris: alamat kosong, loss 0, avg 0 = "belum diukur", bukan "sehat").
 */
function gabungkanRonde(ronde) {
    const panjang = ronde.reduce((m, r) => Math.max(m, r.length), 0);
    const jalur = [];
    for (let i = 0; i < panjang; i += 1) {
        const seri = ronde.map((r) => r[i]).filter(Boolean);
        const nyata = seri.filter((h) => !placeholder(h));
        const dipakai = nyata.length ? nyata[nyata.length - 1] : null;
        const beralamat = seri.map(alamat).filter(Boolean);
        jalur.push({
            posisi: i + 1,
            // Alamat boleh diambil dari snapshot mana pun yang sempat menjawab — hop yang diam
            // di snapshot terakhir sering sudah dikenali di snapshot sebelumnya.
            address: beralamat.length ? beralamat[beralamat.length - 1] : null,
            menjawab: beralamat.length > 0,
            lossPct: dipakai ? angka(dipakai.loss_pct) : null,
            avgMs: dipakai && angka(dipakai.avg_ms) ? angka(dipakai.avg_ms) : null,
            snapshot: seri.length,
            snapshotNyata: nyata.length
        });
    }
    return jalur;
}

/**
 * Tetapkan hop pertama yang benar-benar bermasalah — atau `null` beserta sebabnya.
 *
 * Urutan pemeriksaan sengaja KONSERVATIF; tiap gerbang menutup satu cara salah-tuduh:
 *  a. tujuan tercapai utuh  -> jalur sehat, apa pun yang terjadi di tengah (hop diam).
 *  b. hop yang diam         -> tak pernah dituduh; ia tak bisa dinamai dan biasanya cuma
 *                              menolak menjawab dirinya sendiri.
 *  c. loss yang tak bertahan-> pembatasan ICMP, bukan kehilangan paket.
 */
function cariHopBermasalah(jalur, ambangOverride = {}) {
    const a = { ...AMBANG_BAWAAN, ...(ambangOverride || {}) };
    const menjawab = jalur.filter((h) => h.menjawab && h.lossPct !== null);
    if (menjawab.length < a.minHopMenjawab) {
        return { hop: null, sebab: "trace terlalu miskin (hop yang menjawab kurang dari " + a.minHopMenjawab + ")" };
    }

    const terakhir = menjawab[menjawab.length - 1];
    if (terakhir.lossPct < a.lossHopPct) {
        return {
            hop: null,
            sebab: `tujuan akhir (${terakhir.address}) hanya loss ${terakhir.lossPct}% — jalur SEHAT; loss di tengah = router membatasi ICMP, bukan paket hilang`
        };
    }

    for (let i = 0; i < menjawab.length; i += 1) {
        const h = menjawab[i];
        if (h.lossPct < a.lossHopPct) continue;
        // Bertahan? Semua hop MENJAWAB sesudahnya harus tetap tinggi (dengan toleransi).
        const sesudah = menjawab.slice(i + 1);
        const bertahan = sesudah.every((s) => s.lossPct >= h.lossPct - a.toleransiPct);
        if (bertahan) {
            return {
                hop: { address: h.address, loss_pct: h.lossPct, avg_ms: h.avgMs, posisi: h.posisi },
                sebab: `loss ${h.lossPct}% mulai di ${h.address} (hop ke-${h.posisi}) dan BERTAHAN sampai tujuan`
            };
        }
    }
    return { hop: null, sebab: "ada hop ber-loss tinggi tapi loss-nya PULIH di hop berikutnya — ciri pembatasan ICMP, bukan paket hilang" };
}

/**
 * Hop tempat LATENSI paling banyak bertambah.
 *
 * Untuk keluhan game, "di mana lag lahir" sama pentingnya dengan "di mana paket hilang" — dan
 * loss sering 0% justru saat pelanggan mengeluh tersendat. Terukur pada jalur GMDP → server
 * Garena: RTT melompat 13ms → 27,5ms di satu hop; itu setengah dari total latensi jalur.
 *
 * DESKRIPTIF, BUKAN TUDUHAN. Lonjakan RTT bisa sepenuhnya wajar (lompat pulau/negara). Modul ini
 * hanya menunjukkan DI MANA tambahannya, dan pembacanya yang memutuskan apakah itu wajar.
 */
function cariLonjakanRtt(jalur) {
    const menjawab = jalur.filter((h) => h.menjawab && h.avgMs !== null && h.avgMs > 0);
    if (menjawab.length < 2) return null;
    let puncak = null;
    for (let i = 1; i < menjawab.length; i += 1) {
        const delta = menjawab[i].avgMs - menjawab[i - 1].avgMs;
        if (!puncak || delta > puncak.deltaMs) {
            puncak = {
                dari: menjawab[i - 1].address,
                ke: menjawab[i].address,
                deltaMs: Math.round(delta * 10) / 10,
                rttSesudahMs: menjawab[i].avgMs,
                posisi: menjawab[i].posisi
            };
        }
    }
    if (!puncak || puncak.deltaMs <= 0) return null;
    const total = menjawab[menjawab.length - 1].avgMs;
    puncak.porsiPct = total > 0 ? Math.round((puncak.deltaMs / total) * 1000) / 10 : null;
    return puncak;
}

/** Bungkus lengkap: mentah -> ronde -> jalur gabungan -> vonis hop. Tidak pernah throw. */
function analisaTrace(hops, ambangOverride = {}) {
    try {
        const ronde = pisahkanRonde(hops);
        const jalur = gabungkanRonde(ronde);
        const { hop, sebab } = cariHopBermasalah(jalur, ambangOverride);
        const lonjakan = cariLonjakanRtt(jalur);
        return {
            jumlahRonde: ronde.length,
            jalur,
            hopMenjawab: jalur.filter((h) => h.menjawab).length,
            hopDiam: jalur.filter((h) => !h.menjawab).length,
            hopBermasalah: hop,
            lonjakanRtt: lonjakan,
            sebab
        };
    } catch (e) {
        return { jumlahRonde: 0, jalur: [], hopMenjawab: 0, hopDiam: 0, hopBermasalah: null, lonjakanRtt: null, sebab: `gagal menganalisa: ${e.message}` };
    }
}

module.exports = { AMBANG_BAWAAN, pisahkanRonde, gabungkanRonde, cariHopBermasalah, cariLonjakanRtt, analisaTrace };
