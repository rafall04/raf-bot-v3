/**
 * Header Doc
 * Purpose: Vonis KESTABILAN jalur untuk keluhan yang menyangkut game/lag — pertanyaan "apakah
 *          stabil?", yang berbeda dari pertanyaan "apakah tersambung?" yang sudah dijawab
 *          `connection-check-handler`. Murni fungsi: menerima baris probe, memulangkan tingkat
 *          kestabilan + ringkasan angka. TIDAK menyusun kalimat dan TIDAK menyentuh I/O.
 * Caller: `message/handlers/connection-check-handler.js` (jalur pelanggan),
 *         `lib/upstream-quality-alerter.js` (alarm admin).
 * Deps: Tidak ada.
 * MainFuncs: `ringkasKualitas`, `vonisKualitas`, `AMBANG_BAWAAN`.
 * SideEffects: Tidak ada.
 *
 * !! ANGKA AMBANG DIUKUR, BUKAN DITEBAK (aturan CLAUDE.md: "Calibrate thresholds against measured
 * telemetry, never intuition"). Dan kalibrasi PERTAMA modul ini SALAH — kesalahannya ditulis di
 * sini karena persis itu yang paling mudah terulang:
 *
 *   Angka pertama ("jam 20:00 loss 3,69%") lahir dari MEDIAN ANTAR-BARIS persentase loss. Satu
 *   probe di sini cuma mengirim 3-5 paket, jadi `loss_pct` per baris hanya bisa bernilai 0, 20,
 *   40, ... — resolusinya ~20 POIN. Ambang 2% dan 5% lebih halus daripada alat ukurnya, sehingga
 *   keduanya runtuh jadi satu tes yang sama dan tingkat KURANG_STABIL mustahil dicapai lewat loss.
 *   Terbukti saat disimulasikan ke belakang: jam 18:00-21:00 menghasilkan `kurang=0 buruk=18`.
 *   Loss GABUNGAN sebenarnya di jalur itu ~0,65% (target `meta` 6,54%, jadi median tetap perlu).
 *
 * Statistik yang dipakai sekarang: loss dikumpulkan dari HITUNGAN PAKET per target (resolusi
 * halus), lalu MEDIAN ANTAR TARGET (kebal pencilan). Jitter/RTT tetap median antar-baris.
 *
 * Kurva jalur utama Tanjungharjo, 14 hari, jendela 10 menit (persentil ANTAR JENDELA):
 *
 *            loss p50/p75/p90        jitter p50/p90
 *     03:00    0 /  0 /  0             0,25 /  2
 *     12:00    0 /  0 /  4             0,5  / 20
 *     18:00    0 /  6 / 16             0,5  / 25
 *     19:00    0 /  4 / 24             0,5  / 20      <-- p95 loss 34%
 *     20:00    2 /  6 / 20             0,5  / 24
 *     23:00    0 /  0 /  0             0,5  /  6,6
 *
 * Bentuknya MELEDAK-LEDAK, bukan merata: p50 nyaris selalu 0 bahkan di jam puncak, tapi ekornya
 * (p90) melonjak ke 16-24%. Itu persis yang dirasakan pemain game — mulus lalu tiba-tiba tersendat.
 *
 * KENAPA AMBANG BURUK SETINGGI 15%/40ms: disapu terhadap data nyata pada jalur utama KEDUA bot.
 * Dengan ambang lama (5%/10ms) kalimat TERKERAS muncul di 51% jendela puncak Dander — pesan yang
 * muncul 7 dari 10 kali berhenti berarti, dan jam sibuk yang padat memang keadaan RUTIN di sini
 * (GMDP Dander diketahui jenuh jam 18-21). Dengan 15%/40ms:
 *
 *     Dander  gmdp : puncak 8% keras / 60% lembut / 32% diam  — sepi 0% / 2% / 97%
 *     Tanjung main : puncak 12% keras / 32% lembut / 57% diam — sepi 0% / 6% / 94%
 *
 * Jadi: yang rutin ditanggung kalimat LEMBUT ("jaringan sedang ramai"), yang luar biasa baru
 * mendapat kalimat KERAS, dan jam sepi hampir diam total.
 *
 * KENAPA POLLER TAK PERNAH MENANGKAP INI: ambangnya `lossWarnPct: 5` dibandingkan terhadap
 * rata-rata jalur, dan menjawab "apakah jalurnya RUSAK", bukan "apakah cukup stabil untuk GAME".
 */
"use strict";

const AMBANG_BAWAAN = {
    lossPeringatanPct: 2,    // menangkap kemacetan RUTIN jam sibuk (kalimat lembut)
    lossBurukPct: 15,        // luar biasa saja: 8-12% jendela puncak, ~0% jam sepi
    jitterPeringatanMs: 5,   // idem; jam sepi cuma 2-6% jendela yang lewat ambang ini
    jitterBurukMs: 40,       // jauh di atas p95 puncak (~26ms) — bukan keadaan tiap malam
    minSampel: 6            // di bawah ini: TIDAK TERPANTAU, bukan "baik"
};

function angka(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function median(daftar) {
    const a = daftar.filter((x) => x !== null && x !== undefined).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return null;
    const t = Math.floor(a.length / 2);
    return a.length % 2 ? a[t] : (a[t - 1] + a[t]) / 2;
}

/**
 * Loss per TARGET dari hitungan PAKET, bukan median antar-baris persentase.
 *
 * !! INI BUKAN DETAIL GAYA — median antar-baris SALAH untuk loss, dan terukur salahnya.
 * Satu probe di sini mengirim 3-5 paket, jadi resolusi `loss_pct` per baris adalah ~20 POIN
 * (0, 20, 40, ...). Ambang 2% dan 5% lebih halus daripada alat ukurnya, sehingga keduanya
 * runtuh jadi satu tes yang sama ("baris median kehilangan >=1 paket") dan tingkat
 * KURANG_STABIL jadi mustahil dicapai lewat loss. Terbukti di data prod: pada jam 18:00-21:00
 * hasilnya `kurang=0 buruk=18` — pelanggan akan langsung menerima kalimat terkeras, melewati
 * yang lembut. Loss gabungan sebenarnya di jalur itu cuma ~0,65%, bukan 20%.
 *
 * Mengumpulkan paket per target memulihkan resolusi (satu jendela 10 menit = ~50 paket/target),
 * dan MEDIAN ANTAR TARGET tetap menjaga kekebalan terhadap pencilan (`meta` terukur 6,54%
 * sementara target lain ~0,65%). Jadi: paket untuk presisi, median untuk kekebalan.
 *
 * Baris tanpa `sent`/`received` (mis. probe lama) jatuh ke median persentasenya sendiri supaya
 * data historis tetap terbaca, bukan tiba-tiba dianggap sempurna.
 */
function lossPerTarget(rows) {
    const per = new Map();
    for (const r of rows) {
        const k = String((r && r.target_key) || "?");
        const e = per.get(k) || { sent: 0, received: 0, pct: [] };
        const s = angka(r && r.sent);
        const t = angka(r && r.received);
        if (s !== null && t !== null && s > 0) {
            e.sent += s;
            e.received += Math.max(0, Math.min(t, s));
        } else {
            const p = angka(r && r.loss_pct);
            if (p !== null) e.pct.push(p);
        }
        per.set(k, e);
    }
    const out = [];
    for (const e of per.values()) {
        if (e.sent > 0) out.push(100 * (1 - e.received / e.sent));
        else {
            const m = median(e.pct);
            if (m !== null) out.push(m);
        }
    }
    return out;
}

function bulat2(v) {
    return v === null ? null : Math.round(v * 100) / 100;
}

/**
 * Ringkas baris probe jadi satu potret kualitas.
 *
 * !! MEDIAN, BUKAN RATA-RATA — dan itu keputusan yang menentukan. Satu target yang memang buruk
 * secara sistematis menggelembungkan rata-rata: `meta` (157.240.x) terukur loss 7,34% & RTT 264ms
 * di SEMUA jalur sepanjang 30 hari, sehingga rata-rata jam 20:00 tampak 7,12% padahal kenyataannya
 * 3,69%. Median mengabaikan pencilan semacam itu dengan sendirinya, tanpa perlu daftar-hitam target
 * yang harus dirawat manual (dan yang pasti basi begitu target diganti).
 *
 * Baris `gateway` (hop PERTAMA, milik kita sendiri) SENGAJA dipisah: artinya berbeda. Loss di
 * target jauh bisa jadi milik upstream/internet; loss di hop pertama itu jaringan kita sendiri,
 * dan itu yang harus membangunkan admin.
 */
function ringkasKualitas(rows) {
    const semua = Array.isArray(rows) ? rows : [];
    const jauh = semua.filter((r) => r && String(r.target_key || "") !== "gateway");
    const hop1 = semua.filter((r) => r && String(r.target_key || "") === "gateway");

    return {
        sampel: jauh.length,
        lossPct: bulat2(median(lossPerTarget(jauh))),
        jitterMs: bulat2(median(jauh.map((r) => angka(r.jitter_ms)))),
        rttMs: bulat2(median(jauh.map((r) => angka(r.rtt_avg_ms)))),
        hopPertamaLossPct: bulat2(median(lossPerTarget(hop1))),
        hopPertamaSampel: hop1.length
    };
}

/**
 * @returns {'STABIL'|'KURANG_STABIL'|'TIDAK_STABIL'|'TIDAK_TERPANTAU'}
 *
 * `TIDAK_TERPANTAU` adalah keadaan KETIGA yang wajib ada: sampel kurang berarti bot sedang BUTA
 * (poller mati, bot baru restart — produksi restart 7–13x/hari), bukan berarti jaringannya baik.
 * Aturan rumah: "cannot observe" != "observed good".
 */
function vonisKualitas(ringkas, ambangOverride = {}) {
    const a = { ...AMBANG_BAWAAN, ...(ambangOverride || {}) };
    if (!ringkas || ringkas.sampel < a.minSampel) return "TIDAK_TERPANTAU";
    if (ringkas.lossPct === null && ringkas.jitterMs === null) return "TIDAK_TERPANTAU";

    const loss = ringkas.lossPct === null ? 0 : ringkas.lossPct;
    const jitter = ringkas.jitterMs === null ? 0 : ringkas.jitterMs;

    if (loss >= a.lossBurukPct || jitter >= a.jitterBurukMs) return "TIDAK_STABIL";
    if (loss >= a.lossPeringatanPct || jitter >= a.jitterPeringatanMs) return "KURANG_STABIL";
    return "STABIL";
}

module.exports = { AMBANG_BAWAAN, median, ringkasKualitas, vonisKualitas };
