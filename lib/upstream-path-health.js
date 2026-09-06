/**
 * Header Doc
 * Purpose: SATU sumber keputusan "gangguan ini SELURUH-JALUR vs spesifik-layanan" untuk seluruh
 *          alur cek-koneksi. Diangkat dari `message/handlers/connection-check-handler.js` supaya
 *          jalur balasan app-aware (`lib/app-aware-diagnosis.js`) memakai predikat yang SAMA
 *          PERSIS — dua salinan ambang kesehatan jalur adalah cara termudah keduanya menyimpang
 *          diam-diam dan saling membantah di layar pelanggan.
 * Caller: `message/handlers/connection-check-handler.js`, `lib/app-aware-diagnosis.js`.
 * Deps: — (modul daun murni, tak meng-require apa pun; hindari lingkar-dep dgn handler).
 * MainFuncs: `isGatewayHealthy`, `isPathWideIssue`.
 * SideEffects: Tidak ada (fungsi murni atas objek entry status jalur).
 */
"use strict";

// Uplink pelanggan hop-1 terminasi lokal (rtt ~0,1ms), tapi sampel kecil (pingCount 5) bikin 1
// paket hilang = 20%. Ambang tinggi supaya "uplink sakit" hanya divonis saat loss BERTAHAN tinggi
// — bukan noise kuantisasi.
const GATEWAY_LOSS_UNHEALTHY_PCT = 40;

/** Uplink sendiri (gateway hop-1) sehat? Tanpa data gateway → fail-open "sehat" (jangan menuduh). */
function isGatewayHealthy(entry) {
    const g = entry && entry.gateway;
    if (!g) return true;
    const loss = Number(g.loss_avg_pct);
    return !(Number.isFinite(loss) && loss >= GATEWAY_LOSS_UNHEALTHY_PCT);
}

/**
 * Apakah gangguan ini SELURUH-JALUR (uplink sendiri sakit / jalur PUTUS / MAYORITAS target rusak =
 * transit ISP) — vs SPESIFIK-LAYANAN (uplink sehat + sebagian besar internet umum masih normal,
 * cuma 1–2 layanan buruk). Inilah beda "jaringan Anda terganggu" (jujur saat jalur benar rusak)
 * dari "Facebook lagi bermasalah" (jujur saat cuma Meta buruk sementara Cloudflare/Garena/Google
 * normal). TERUKUR di Tanjungharjo: uplink GMDP rtt 0,1ms & Meta 80% loss sendirian pernah bikin
 * SEMUA pelanggan dikabari "jalur terganggu" padahal internetnya baik-baik saja.
 * KONSERVATIF saat data tipis: PUTUS / tanpa rincian target → tetap dianggap seluruh-jalur
 * (jangan menyembunyikan gangguan nyata) — downgrade ke spesifik-layanan HANYA bila ada bukti
 * (uplink sehat + mayoritas target normal).
 */
function isPathWideIssue(entry) {
    if (!entry) return false;
    if (entry.status === 'PUTUS') return true;
    if (!isGatewayHealthy(entry)) return true;
    const targets = Array.isArray(entry.targets) ? entry.targets.filter((t) => t && t.verdict) : [];
    if (!targets.length) return true;
    // MAYORITAS target PARAH (GANGGUAN/PUTUS) = transit ISP benar rusak. DEGRADASI ringan SENGAJA
    // tak dihitung: pada pingCount kecil (5), 1 paket hilang ≈ 7% → target gampang "DEGRADASI"
    // karena noise kuantisasi. TERUKUR: gmdp pernah 4/7 "rusak" padahal cuma Meta yang parah (95%
    // loss) + 3 target 7% (masing-masing 1 paket). Menghitung yang ringan = vonis "jaringan
    // terganggu" padahal internet umum lancar. Degradasi ringan menyeluruh = urusan vonis
    // KESTABILAN (ramai/kurang stabil), bukan "jalur putus".
    const severe = targets.filter((t) => ['GANGGUAN', 'PUTUS'].includes(t.verdict)).length;
    return severe / targets.length >= 0.5;
}

module.exports = { isGatewayHealthy, isPathWideIssue, GATEWAY_LOSS_UNHEALTHY_PCT };
