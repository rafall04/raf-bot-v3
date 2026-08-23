/**
 * Header Doc
 * Purpose: Alarm ke ADMIN saat KESTABILAN jalur jatuh — supaya masalah jam sibuk ketahuan tanpa
 *          menunggu pelanggan mengeluh. Sengaja TERPISAH dari `lib/upstream-quality-alerter`:
 *          alerter itu menjawab "apakah jalurnya SAKIT" (loss >= 5%), sedangkan ini menjawab
 *          "apakah cukup stabil untuk GAME" (loss >= 2% / jitter >= 5ms, ambang terukur).
 * Caller: `lib/upstream-quality-poller.js` setelah tiap siklus sukses.
 * Deps: `lib/latency-verdict` (vonis, SAMA dengan yang dilihat pelanggan),
 *       `lib/admin-recipients` (getAdminJids), `lib/whatsapp-notification-wrapper` (kirim).
 * MainFuncs: `evaluasiKestabilan`, `resetUntukTest`.
 * SideEffects: Kirim WhatsApp ke ADMIN saja. Never-throw.
 *
 * KENAPA ADA (#b255): pada 2026-08-21 jam 20:14 WIB pelanggan menulis "sinyal merah" saat jalur
 * utama terukur loss 2–4,7% dan hop pertama 4,95%. Tidak ada satu pun alarm menyala, karena
 * ambang alerter `lossWarnPct: 5` tak pernah tercapai — jam TERBURUK sepanjang 30 hari pun hanya
 * 3,69%. Keluhan game menumpuk 68% di jam 16–21, jadi orang yang seharusnya tahu lebih dulu
 * adalah admin, bukan pelanggan.
 *
 * SATU SUMBER VONIS: memakai `latency-verdict` yang sama dengan balasan pelanggan. Kalau admin
 * dan pelanggan memakai ambang berbeda, salah satunya pasti berbohong.
 */
"use strict";

const { ringkasKualitas, vonisKualitas } = require("./latency-verdict");

// State per jalur, in-memory. Alarm kualitas berulang tiap jam sibuk, jadi restart proses
// (7–13x/hari di produksi) hanya menunda alarm satu-dua siklus — tak sepadan dengan menambah
// berkas state baru. Beda dengan alerter jalur-SAKIT yang memang dire-hidrasi dari insiden.
let state = new Map();

function resetUntukTest() {
    state = new Map();
}

function ambilState(pathKey) {
    if (!state.has(pathKey)) state.set(pathKey, { beruntun: 0, terakhirAlarmMs: 0 });
    return state.get(pathKey);
}

/**
 * @param {object} cfg  `config.upstreamMonitor`
 * @param {object} deps { repo, getAdminJids, kirim, nowMs, logger }
 */
async function evaluasiKestabilan(cfg = {}, deps = {}) {
    const out = { dinilai: 0, alarm: 0 };
    try {
        const setelan = cfg.alarmKestabilan || {};
        if (setelan.enabled !== true) return out; // deploy gelap: default MATI

        const siklusBeruntun = Math.max(1, parseInt(setelan.consecutiveCycles, 10) || 3);
        const cooldownMs = Math.max(0, parseInt(setelan.cooldownMinutes, 10) || 120) * 60 * 1000;
        const windowMenit = Math.max(1, parseInt(setelan.windowMinutes, 10) || 10);
        const now = deps.nowMs || Date.now();
        const logger = deps.logger || console;

        const repo = deps.repo || require("../repositories/upstream-quality.repository").getUpstreamQualityRepository();
        const sinceIso = new Date(now - windowMenit * 60 * 1000).toISOString();

        // Penyaring jalur. TERUKUR: alarm menyala ~1,0-1,4x/hari PER JALUR, dan Dander punya 5
        // jalur — tanpa penyaring itu 4-5 alarm sehari, sebagian dari jalur cadangan yang memang
        // kronis (`sf` berbicara di 60% jendela). Alarm untuk keadaan yang tiap hari terjadi
        // melatih pemiliknya mengabaikan alarm, termasuk yang penting.
        // Kosong = semua jalur (perilaku lama), supaya menambah kunci ini tak pernah MEMATIKAN
        // alarm yang sudah dinyalakan seseorang.
        const jalurDialarmi = Array.isArray(setelan.paths) && setelan.paths.length
            ? new Set(setelan.paths.map((x) => String(x)))
            : null;

        const jalur = Array.isArray(cfg.paths) ? cfg.paths : [];
        for (const p of jalur) {
            if (!p || !p.key) continue;
            if (jalurDialarmi && !jalurDialarmi.has(String(p.key))) continue;
            const rows = await repo.getRecentProbes({ sinceIso, path: p.key, limit: 500 });
            const ringkas = ringkasKualitas(rows || []);
            const tingkat = vonisKualitas(ringkas, cfg.ambangStabilitas || {});
            out.dinilai += 1;

            const s = ambilState(p.key);
            // TIDAK_TERPANTAU sengaja TIDAK mereset penghitung dan TIDAK menaikkannya:
            // "tak bisa melihat" bukan "sehat" dan bukan pula "sakit".
            if (tingkat === "TIDAK_TERPANTAU") continue;
            if (tingkat === "STABIL" || tingkat === "KURANG_STABIL") { s.beruntun = 0; continue; }

            s.beruntun += 1;
            if (s.beruntun < siklusBeruntun) continue;
            if (now - s.terakhirAlarmMs < cooldownMs) continue;

            const jids = typeof deps.getAdminJids === "function"
                ? await deps.getAdminJids()
                : await require("./admin-recipients").getAdminJids();
            const daftar = Array.isArray(jids) ? jids : [];
            if (!daftar.length) {
                logger.warn?.("[ALARM_KESTABILAN] jalur tidak stabil tapi tak ada admin terdaftar.");
                continue;
            }

            // Pesan ADMIN — boleh memuat nama jalur & angka mentah. Pesan PELANGGAN tidak,
            // dan keduanya dirakit di tempat berbeda supaya tak mungkin tertukar.
            const teks = [
                "📉 *Kestabilan jaringan turun*",
                "",
                `Jalur: *${p.label || p.key}*`,
                `Paket paling terasa: ${p.affects || "-"}`,
                "",
                `Kehilangan paket : ${ringkas.lossPct}%`,
                `Jitter           : ${ringkas.jitterMs} ms`,
                `Waktu tempuh     : ${ringkas.rttMs} ms`,
                ringkas.hopPertamaLossPct != null ? `Hop pertama kita : ${ringkas.hopPertamaLossPct}%` : null,
                "",
                `Sudah ${s.beruntun} siklus berturut-turut. Game & video call akan terasa putus-putus.`,
                "Pelanggan yang bertanya sekarang akan diberi tahu jaringan sedang ramai — bukan disuruh restart modem."
            ].filter((x) => x !== null).join("\n");

            let terkirim = 0;
            for (const jid of daftar) {
                try {
                    const kirim = deps.kirim || require("./whatsapp-notification-wrapper").sendNotification;
                    const r = await kirim(jid, teks);
                    if (r !== false) terkirim += 1;
                } catch (e) {
                    logger.error?.("[ALARM_KESTABILAN_KIRIM_ERROR]", e && e.message);
                }
            }
            // Cooldown hanya dipasang bila ADA yang benar-benar terkirim — kalau WhatsApp
            // sedang putus, membungkam alarm 2 jam berikutnya justru menyembunyikan masalah.
            if (terkirim > 0) {
                s.terakhirAlarmMs = now;
                out.alarm += 1;
                logger.warn?.(`[ALARM_KESTABILAN] ${p.key} tidak stabil ${s.beruntun} siklus — alarm ke ${terkirim} admin.`);
            }
        }
    } catch (e) {
        (deps.logger || console).error?.("[ALARM_KESTABILAN_ERROR]", e && e.message);
    }
    return out;
}

module.exports = { evaluasiKestabilan, resetUntukTest };
