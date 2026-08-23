/**
 * Header Doc
 * Purpose: Self-service "Cek Koneksi" pelanggan — diagnosa instan status jalur internet (PPPoE),
 *          deteksi kemungkinan gangguan area, ringkas modem/WiFi, dan beri langkah berikut.
 *          Diagnosanya READ-ONLY (tak mengubah saldo/konfigurasi), tapi bila jalur ISP & area
 *          terbukti sehat dan modem masih terjangkau ACS, balasan menyertakan TAWARAN reboot
 *          berbantu — bot meminta izin dulu dan tak pernah mereboot sendiri. Tiket tetap di luar.
 *          ANTI DATA-PALSU (prinsip inti): tak pernah menyajikan pembacaan basi/tak-terverifikasi
 *          sebagai fakta. Verdict jalur-AKTIF berbasis BUKTI (status jalur upstream link utama/
 *          cadangan) dan FAIL-CLOSED — tanpa bukti sehat, bot bilang "aktif, sedang diperiksa",
 *          bukan "koneksi normal". Baris modem hanya tampil bila _lastInform GenieACS masih segar,
 *          dan "0 perangkat terhubung" (tabel host ONU yang kerap keliru) tak pernah diklaim.
 *          Reboot hanya ditawarkan saat gangguan PLAUSIBEL di modem — bukan saat jaringan yang sakit.
 * Caller: `message/handlers/raf-intent-dispatch/customer-service-intents.js` pada intent `CEK_KONEKSI`.
 * Deps: `../../lib/jid-utils` (resolveCustomerBySender), `../../lib/mikrotik` (getActivePPPoEUsers),
 *       `../../lib/wifi` (getSSIDInfo), `../../lib/area-outage-gate` (verdict gangguan area — satu
 *       pemilik rumus ambang, dipakai bersama bot teknisi & gerbang auto outage),
 *       `../../repositories/auto-outage.repository` (state offline_since),
 *       `./template-helpers` (renderResponseTemplate), `../../lib/customer-path-resolver` (IP→jalur LIVE
 *       dari address-list steering RAF-STEER-*, bukan CIDR statik; default gmdp saat tak di-steer)
 *       + lazy `../../lib/upstream-quality-poller` (status jalur upstream, best-effort)
 *       + lazy `../../lib/complaint-signal-service` (sinyal komplain → agregator, fire-and-forget)
 *       + lazy `../../lib/app-entity-extractor` + `../../lib/app-aware-diagnosis` (jawaban
 *         SPESIFIK per aplikasi yang disebut pelanggan, dari matriks reachability live).
 *       + lazy `../../lib/reboot-followup-service` (gate keamanan reboot + penjadwalan follow-up).
 * MainFuncs: `handleCekKoneksi`, `buildRebootOffer`, `resolveUpstreamHealth`, `classifyOnlineVerdict`,
 *            `buildModemLine` (staleness-guarded).
 * SideEffects: Membaca PPP active MikroTik (live, di-cache TTL pendek) + GenieACS (best-effort) lalu reply WhatsApp.
 *              Bila gate reboot lolos: menyetel conversation state `REBOOTFU_OFFER` (JID kanonik).
 */
'use strict';

const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { getActivePPPoEUsers } = require('../../lib/mikrotik');
const { getSSIDInfo } = require('../../lib/wifi');
const { renderResponseTemplate } = require('./template-helpers');
const { resolveCustomerPath } = require('../../lib/customer-path-resolver');
const { hasConnectivityComplaintSignal } = require('../../lib/loose-intent-matcher');
const { evaluateAreaOutage } = require('../../lib/area-outage-gate');

// Cache daftar PPPoE aktif sebentar supaya burst "cek koneksi" tidak menghajar MikroTik.
// addrByUser dipakai seksi upstream (map username → IP remote utk pemetaan jalur).
let activeCache = { at: 0, routerId: null, set: null, addrByUser: null, error: null };
const ACTIVE_CACHE_TTL_MS = 30000;

// Cache laporan status jalur upstream (query SQLite ringan, tapi burst tetap dihemat).
let upstreamReportCache = { at: 0, report: null };
const UPSTREAM_REPORT_TTL_MS = 30000;

// Ambang kemungkinan gangguan area dipusatkan di `lib/area-outage-gate` — dulu rumus yang sama
// disalin di sini, di bot teknisi Telegram, dan tak ada sama sekali di cron auto outage.

// Ambang data GenieACS dianggap BASI: ONU belum inform (mis. buta lintas-PTP) atau ACS tak
// menyimpan _lastInform. Selaras ambang gate reboot — inform periodik ACS prod terukur ~12 mnt,
// jadi 30 mnt = beberapa siklus dan aman dari salah-vonis "basi" pada modem yang sebenarnya sehat.
const MODEM_STALE_MS = 30 * 60 * 1000;

function upstreamSignalAvailable() {
    const up = global.config && global.config.upstreamMonitor;
    return !!(up && up.enabled === true);
}

function normalizeUsername(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

// "Gagal membaca" TIDAK BOLEH menyamar jadi "daftar kosong".
//
// `getActivePPPoEUsers` tidak pernah throw: saat timeout / circuit-breaker terbuka / config
// salah, ia RESOLVE `{ok:false, data:null, errorCode:…}`. Versi lama fungsi ini memulangkan `[]`
// untuk bentuk itu, sehingga SETIAP pelanggan dinilai offline, `offlineCount` = seluruh
// pelanggan ber-PPPoE, gerbang gangguan-area pasti menyala, dan pelanggan yang internetnya
// baik-baik saja dikabari "TERPUTUS — terdeteksi gangguan pada jaringan di area Anda".
// Sekarang: hanya array yang benar-benar terbaca yang dianggap data; bentuk lain = gagal baca.
class MikrotikReadError extends Error {
    constructor(errorCode) {
        super(`Gagal membaca sesi PPPoE aktif dari MikroTik (${errorCode || "UNKNOWN"})`);
        this.name = "MikrotikReadError";
        this.errorCode = errorCode || "UNKNOWN";
    }
}

function unwrapMikrotikList(result) {
    if (Array.isArray(result)) return result;
    // Result-object yang eksplisit gagal → jangan pernah diterjemahkan jadi daftar kosong.
    if (result && typeof result === "object" && result.ok === false) {
        throw new MikrotikReadError(result.errorCode);
    }
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.data?.data)) return result.data.data;
    if (Array.isArray(result?.items)) return result.items;
    // Bentuk tak dikenal (mis. `{ok:true, data:null}`) = tak bisa dipastikan → gagal-tertutup.
    throw new MikrotikReadError("UNPARSEABLE_RESULT");
}

async function getActiveUsernameSet(routerId) {
    const now = Date.now();
    const masihSegar = activeCache.routerId === routerId && now - activeCache.at < ACTIVE_CACHE_TTL_MS;

    // Cache NEGATIF: kegagalan ikut disimpan (sebagai kegagalan, BUKAN sebagai daftar kosong).
    // Saat router sakit, "cek koneksi" biasanya datang berbondong-bondong — tanpa ini tiap pesan
    // menembak ulang router yang sedang bermasalah. Yang di-cache adalah FAKTA "tak bisa dibaca",
    // sehingga jawabannya tetap 'unknown' dan tak pernah berubah jadi vonis offline.
    if (masihSegar && activeCache.error) throw activeCache.error;
    if (masihSegar && activeCache.set) return activeCache.set;

    let list;
    try {
        list = unwrapMikrotikList(await getActivePPPoEUsers({ router_id: routerId }));
    } catch (err) {
        // addrByUser SENGAJA dikosongkan: memetakan jalur upstream pelanggan dari IP lama saat
        // router tak terbaca akan menghasilkan diagnosa yang percaya diri tapi salah.
        activeCache = { at: now, routerId, set: null, addrByUser: null, error: err };
        throw err;
    }
    const set = new Set();
    const addrByUser = new Map();
    for (const item of list) {
        const uname = normalizeUsername(item.name || item.user || item.username);
        if (!uname) continue;
        set.add(uname);
        const addr = item.address || item.ip || null;
        if (addr) addrByUser.set(uname, String(addr));
    }
    activeCache = { at: now, routerId, set, addrByUser, error: null };
    return set;
}

async function getUpstreamReportCached() {
    const now = Date.now();
    if (upstreamReportCache.report && now - upstreamReportCache.at < UPSTREAM_REPORT_TTL_MS) {
        return upstreamReportCache.report;
    }
    // Lazy require: modul poller hanya dimuat bila fitur upstream aktif.
    const { buildStatusReport } = require('../../lib/upstream-quality-poller');
    const report = await buildStatusReport();
    upstreamReportCache = { at: now, report };
    return report;
}

/**
 * Seksi info jalur upstream untuk balasan cek koneksi. Best-effort & senyap saat normal:
 * hanya tampil bila jalur yang dipakai PAKET pelanggan sedang DEGRADASI/GANGGUAN/PUTUS —
 * itulah jawaban "lemot dari sisi mana" saat PPPoE pelanggan sendiri sehat.
 * Tidak pernah throw; gagal apa pun → string kosong.
 */
async function buildUpstreamSection(user) {
    try {
        const upCfg = global.config && global.config.upstreamMonitor;
        if (!upCfg || upCfg.enabled !== true) return '';

        const uname = normalizeUsername(user.pppoe_username);
        const addr = activeCache.addrByUser ? activeCache.addrByUser.get(uname) : null;
        if (!addr) return '';

        // Jalur pelanggan dari STEERING LIVE (bukan CIDR statik) — null bila router tak terbaca.
        const pathKey = await resolveCustomerPath(addr);
        if (!pathKey) return '';

        const report = await getUpstreamReportCached();
        const entry = report && Array.isArray(report.paths)
            ? report.paths.find((p) => p.key === pathKey)
            : null;
        if (!entry) return '';
        if (!['DEGRADASI', 'GANGGUAN', 'PUTUS'].includes(entry.status)) return '';

        // Penghitung angka teknis (targets/avg) DIHAPUS: setelah slot loss/rtt tak lagi dioper,
        // ia jadi kode hantu di dalam fungsi yang tugasnya justru TIDAK menyebut angka —
        // undangan untuk mengulang bug yang sama.

        // Pelanggan jalur MNI: WhatsApp/game dipaksa router lewat IH — bila IH normal,
        // jelaskan kenapa "chat lancar tapi browsing lambat" (pola komplain korpus).
        let catatanKhusus = '';
        if (pathKey === 'mni') {
            const ih = report.paths.find((p) => p.key === 'ih');
            if (ih && ih.status === 'NORMAL') {
                catatanKhusus = renderResponseTemplate(
                    'conncheck_upstream_note_mni',
                    '\n(Catatan: WhatsApp & game Anda lewat jalur berbeda yang saat ini normal — chat/game bisa tetap lancar walau browsing/video lambat.)'
                );
            }
        }

        // STARVASI DATA — `jalur_label`/`status_label`/`loss`/`rtt` SENGAJA tidak dioper lagi.
        //
        // Dulu keempatnya tetap dikirim "sbg var template untuk owner/kustomisasi". Justru itu
        // akarnya: template TERSIMPAN mengalahkan fallback, dan berkas template produksi
        // di-merge-key (tak pernah ditimpa deploy) — jadi teks lama yang berbunyi "jalur
        // upstream yang dipakai paket Anda (MNI) sedang DEGRADASI (loss 2%, respons 310ms)"
        // TETAP HIDUP walau fallback di kode sudah disederhanakan. Selama slotnya dioper,
        // nama ISP internal bisa muncul lagi kapan saja tanpa satu baris kode berubah.
        //
        // Nama jalur juga TAK LAYAK DIPERCAYA untuk pelanggan: peta CIDR→jalur adalah
        // snapshot recon router 2026-07-07 — terukur 13% pelanggan aktif (subnet .80/.73)
        // tak ada di peta, dan premisnya runtuh karena subnet yang sama muncul di DUA
        // address-list router. Menyebut jalur yang SALAH lebih buruk daripada diam.
        //
        // Label/angka tetap dipakai INTERNAL (alert admin, tiket teknisi).
        return renderResponseTemplate(
            'conncheck_upstream_issue',
            `\n\n🛣️ *Info koneksi:* jalur internet yang dipakai paket Anda sedang ada kendala saat ini. ` +
            `Ini dari sisi jaringan kami — *bukan dari perangkat Anda* — dan tim sudah menerima peringatan otomatis. Mohon ditunggu ya 🙏${catatanKhusus}`,
            { catatan_khusus: catatanKhusus }
        );
    } catch (_e) {
        return '';
    }
}

/**
 * Kesehatan jalur upstream untuk pelanggan yang PPPoE-nya AKTIF. READ-ONLY, cached, never-throw.
 * @returns {Promise<{status:string|null, anyDegraded:boolean}>}
 *   status: status jalur yang dipakai IP pelanggan ('NORMAL'|'DEGRADASI'|'GANGGUAN'|'PUTUS') atau
 *           `null` bila fitur mati / IP belum terpetakan ke jalur (pool CIDR belum dikonfigurasi
 *           untuk lokasi ini — akar kegagalan senyap: dulu ini membuat verdict jatuh ke "normal").
 *   anyDegraded: ADA jalur mana pun yang sedang bermasalah — sinyal untuk pelanggan yang IP-nya
 *           belum terpetakan (jangan klaim "normal" saat ada gangguan jalur yang sedang berjalan).
 */
async function resolveUpstreamHealth(user) {
    const out = { status: null, anyDegraded: false };
    try {
        if (!upstreamSignalAvailable()) return out;
        const report = await getUpstreamReportCached();
        if (!report || !Array.isArray(report.paths)) return out;
        out.anyDegraded = report.paths.some((p) => ['DEGRADASI', 'GANGGUAN', 'PUTUS'].includes(p.status));
        const uname = normalizeUsername(user.pppoe_username);
        const addr = activeCache.addrByUser ? activeCache.addrByUser.get(uname) : null;
        if (addr) {
            // Jalur pelanggan dari STEERING LIVE (RAF-STEER-*; default 'gmdp' bila tak di-steer).
            // null = router tak terbaca → status tetap null → verdict fail-closed (bukan asal "normal").
            const pathKey = await resolveCustomerPath(addr);
            if (pathKey) {
                const entry = report.paths.find((p) => p.key === pathKey);
                if (entry) out.status = entry.status;
            }
        }
    } catch (_e) {
        // best-effort — tak boleh menjatuhkan diagnosa
    }
    return out;
}

/**
 * Verdict kesehatan untuk jalur yang PPPoE-nya AKTIF. Prinsip: JANGAN klaim "normal" tanpa bukti
 * (fail-closed). Hanya menyatakan sehat bila jalur pelanggan — atau SEMUA jalur — terpantau baik.
 * @returns {'UPSTREAM_ISSUE'|'POSSIBLE_UPSTREAM'|'HEALTHY'|'INCONCLUSIVE'}
 */
function classifyOnlineVerdict(up) {
    if (up.status && ['DEGRADASI', 'GANGGUAN', 'PUTUS'].includes(up.status)) return 'UPSTREAM_ISSUE';
    if (up.status === 'NORMAL') return 'HEALTHY';
    // status null → IP pelanggan belum terpetakan ke jalur, atau fitur upstream mati.
    if (up.anyDegraded) return 'POSSIBLE_UPSTREAM';
    // DULU: `if (upstreamSignalAvailable()) return 'HEALTHY'` — vonis SEHAT hanya karena FLAG
    // CONFIG menyala. Itu melanggar prinsip yang ditulis di doc fungsi ini sendiri ("JANGAN
    // klaim normal tanpa bukti") dan larangan CLAUDE.md "Gate on evidence, not on a config flag".
    //
    // "Tak ada jalur bermasalah" MENCAKUP "semua jalur UNKNOWN": poller mati, DB kosong, atau
    // bot baru restart (produksi restart berkali-kali sehari). Di keadaan itu bot sedang BUTA,
    // bukan sedang melihat jaringan sehat — dan pelanggan yang mengeluh dibantah "terpantau
    // normal". Sekarang jatuh ke INCONCLUSIVE: "Koneksi Anda terpantau aktif" — jujur, PPPoE
    // memang aktif, tapi kami tidak mengklaim jaringannya normal.
    return 'INCONCLUSIVE'; // tak ada sinyal upstream sama sekali → tak bisa klaim "normal", tapi PPPoE aktif.
}

/**
 * Vonis KESTABILAN jalur pelanggan — menjawab "apakah stabil?", pertanyaan yang berbeda dari
 * "apakah tersambung?" dan yang selama ini tak pernah dijawab.
 *
 * KENAPA PERLU: poller memvonis jalur NORMAL selama loss < 5%. Terukur 30 hari di Tanjungharjo,
 * jam terburuk (20:00) hanya 3,69% — jadi jalur SELALU "normal", sementara 68% keluhan game
 * justru menumpuk jam 16–21. Pelanggan menulis "sinyal merah" lalu dibantah "terpantau normal".
 *
 * Best-effort & never-throw: gagal apa pun → TIDAK_TERPANTAU, bukan klaim sehat.
 */
async function resolveStabilitas(user) {
    try {
        // GERBANG (CLAUDE.md #4): default MATI supaya kode boleh mendarat tanpa mengubah satu pun
        // kalimat yang diterima pelanggan. Menyalakannya keputusan ops — dan lebih penting lagi,
        // ini sakelar MATI seketika kalau nada kalimatnya ternyata keliru di lapangan, tanpa
        // menunggu deploy ulang.
        const gerbang = (global.config && global.config.upstreamMonitor
            && global.config.upstreamMonitor.stabilitasPelanggan) || {};
        if (gerbang.enabled !== true) return { tingkat: 'TIDAK_TERPANTAU', ringkas: null };
        if (!upstreamSignalAvailable()) return { tingkat: 'TIDAK_TERPANTAU', ringkas: null };
        const uname = normalizeUsername(user.pppoe_username);
        const addr = activeCache.addrByUser ? activeCache.addrByUser.get(uname) : null;
        if (!addr) return { tingkat: 'TIDAK_TERPANTAU', ringkas: null };
        const pathKey = await resolveCustomerPath(addr);
        if (!pathKey) return { tingkat: 'TIDAK_TERPANTAU', ringkas: null };

        const { getUpstreamQualityRepository } = require('../../repositories/upstream-quality.repository');
        const { ringkasKualitas, vonisKualitas } = require('../../lib/latency-verdict');
        const cfg = (global.config && global.config.upstreamMonitor) || {};
        const menit = Number(cfg.stabilitasWindowMinutes) > 0 ? Number(cfg.stabilitasWindowMinutes) : 10;
        const sinceIso = new Date(Date.now() - menit * 60 * 1000).toISOString();

        const rows = await getUpstreamQualityRepository().getRecentProbes({ sinceIso, path: pathKey, limit: 500 });
        const ringkas = ringkasKualitas(rows || []);
        return { tingkat: vonisKualitas(ringkas, cfg.ambangStabilitas || {}), ringkas };
    } catch (_e) {
        return { tingkat: 'TIDAK_TERPANTAU', ringkas: null };
    }
}

/**
 * Baris kestabilan untuk pelanggan.
 *
 * !! DILARANG memuat nama jalur/ISP/target/IP maupun angka mentah (#b247/#b248). Yang dioper ke
 * perakit pesan HANYA tingkatnya — angka loss/jitter sengaja TIDAK dioper sama sekali, supaya
 * admin tak bisa menerbitkannya lagi lewat /api/templates tanpa satu baris kode pun berubah.
 */
function buildStabilitasNote(tingkat) {
    if (tingkat === 'TIDAK_STABIL') {
        return renderResponseTemplate(
            'conncheck_stabilitas_buruk',
            `⚠️ Sambungan Anda aktif, tapi *jaringan kami sedang tidak stabil* saat ini. Untuk game atau video call memang akan terasa putus-putus.

Sudah masuk pantauan kami dan sedang ditangani. Kalau sampai malam belum membaik, balas pesan ini ya 🙏`,
            {}
        );
    }
    if (tingkat === 'KURANG_STABIL') {
        return renderResponseTemplate(
            'conncheck_stabilitas_kurang',
            `📶 Sambungan Anda aktif, tapi *jaringan sedang ramai* saat ini sehingga terasa kurang stabil — ini yang bikin game terasa nge-lag walau sinyal WiFi penuh.

Biasanya paling terasa jam 18.00–21.00 dan membaik setelahnya. Ini dari sisi jaringan kami, *bukan dari perangkat Anda*. Sudah kami pantau terus ya 🙏`,
            {}
        );
    }
    return '';
}

/** Baris kesehatan (health note) untuk balasan jalur-AKTIF, dirender per verdict via template. */
function buildHealthNote(verdict) {
    if (verdict === 'HEALTHY') {
        return renderResponseTemplate('conncheck_health_ok', 'Koneksi Anda ke jaringan kami terpantau normal.', {});
    }
    if (verdict === 'POSSIBLE_UPSTREAM') {
        return renderResponseTemplate(
            'conncheck_health_possible',
            'Koneksi Anda aktif. Saat ini *sebagian jalur jaringan kami sedang terganggu* dan sedang kami tangani — ' +
                'bila sebagian layanan terasa lambat, kemungkinan dari sisi ini, *bukan dari perangkat Anda*. Mohon ditunggu ya 🙏',
            {}
        );
    }
    if (verdict === 'INCONCLUSIVE') {
        return renderResponseTemplate('conncheck_health_active', 'Koneksi Anda terpantau aktif.', {});
    }
    // UPSTREAM_ISSUE → dikosongkan di sini; detail jalur dibawa oleh slot ${upstream}.
    return '';
}

function formatTerakhirOnline(offlineSince) {
    if (!offlineSince) return '';
    try {
        const d = new Date(offlineSince);
        if (Number.isNaN(d.getTime())) return '';
        const formatted = d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
        return `\nTerakhir terpantau online: ${formatted}.`;
    } catch (_e) {
        return '';
    }
}

async function buildModemLine(user) {
    if (!user.device_id) return '';
    try {
        // skipRefresh=true: baca cache GenieACS biar cepat & tak men-trip breaker; modem info pelengkap.
        const { uptime, ssid, lastInform } = await getSSIDInfo(user.device_id, true);

        // ANTI DATA-PALSU: bila _lastInform basi/absen, ACS sedang buta terhadap modem ini (mis. ONU
        // belum inform / lintas-PTP putus). Uptime & jumlah perangkat dari cache basi = data palsu —
        // lebih baik DIAM soal modem daripada mengarang. Ini akar "0 perangkat terhubung" menyesatkan.
        const informMs = lastInform ? new Date(lastInform).getTime() : NaN;
        const fresh = Number.isFinite(informMs) && Date.now() - informMs <= MODEM_STALE_MS;
        if (!fresh) return '';

        const jumlahPerangkat = Array.isArray(ssid)
            ? ssid.reduce((n, s) => n + ((s.associatedDevices && s.associatedDevices.length) || 0), 0)
            : 0;

        // Tabel host ONU (mis. Huawei HG8145V5) kerap melaporkan 0 walau WiFi jelas dipakai. Untuk
        // pelanggan yang justru sedang mengeluh, "0 perangkat terhubung" hampir pasti keliru & bikin
        // kecewa — JANGAN diklaim. Tampilkan uptime saja bila hitungannya 0.
        if (jumlahPerangkat > 0) {
            return renderResponseTemplate(
                'conncheck_modem_line',
                `\n📡 Modem: aktif (uptime ${uptime || '-'}), ${jumlahPerangkat} perangkat terhubung.`,
                { uptime: uptime || '-', jumlah_perangkat: jumlahPerangkat }
            );
        }
        return renderResponseTemplate(
            'conncheck_modem_line_nocount',
            `\n📡 Modem: aktif (uptime ${uptime || '-'}).`,
            { uptime: uptime || '-' }
        );
    } catch (_e) {
        return '';
    }
}

/**
 * Tawaran reboot berbantu. Mengembalikan teks tambahan untuk balasan cek koneksi, atau '' bila
 * reboot TIDAK aman/tidak relevan. Efek samping: menyetel conversation state `REBOOTFU_OFFER`
 * (di-key JID kanonik) supaya jawaban izin pelanggan tertangkap.
 * Never-throw: kegagalan apa pun → tanpa tawaran, balasan diagnosa tetap terkirim.
 */
async function buildRebootOffer({ user, resolved, lineStatus, areaOutage, offlineCount, remoteAddr, customerText }) {
    try {
        const { evaluateRebootGate, scheduleFollowupForReboot } = require('../../lib/reboot-followup-service');
        const gate = await evaluateRebootGate({
            user,
            lineStatus,
            areaOutage,
            offlineCount,
            remoteAddr,
            customerText
        });

        // Pelanggan SUDAH mencabut modemnya sendiri. Jangan tawarkan reboot lagi — tapi jangan
        // diam juga: dialah yang paling butuh dikabari. Jadwalkan verifikasi (TANPA reboot);
        // `rebootAt` job = sekarang, dipakai sebagai acuan "modem inform sesudah restart".
        if (!gate.allowed && gate.reason === 'SUDAH_RESTART_SENDIRI') {
            const stateKey = resolved && resolved.canonicalJid;
            if (stateKey) {
                const job = scheduleFollowupForReboot({
                    user,
                    jid: stateKey,
                    reason: 'restart_pelanggan',
                    remoteAddr: remoteAddr || null
                });
                if (job) {
                    console.log(`[REBOOTFU] Pelanggan restart sendiri → pantau ${job.id} (due ${job.dueAt})`);
                    return renderResponseTemplate(
                        'rebootfu_watch_self_restart',
                        `\n\n👀 Baik Kak, saya pantau dari sini ya. Sekitar 6 menit lagi saya cek ulang ` +
                            `dan langsung kabari hasilnya — tidak perlu membalas apa pun 🙏`,
                        { nama: user.name || 'Kak' }
                    );
                }
            }
            return '';
        }

        if (!gate.allowed) {
            if (gate.reason !== 'FITUR_MATI') {
                console.log(`[REBOOTFU] Tawaran reboot dilewati (${gate.reason}, mode=${gate.mode})`);
            }
            return '';
        }

        // M2 — jalur AKTIF (online) tapi pelanggan TIDAK menyebut keluhan (cuma cek status:
        // "cek koneksi", "status internet") → JANGAN tawari reboot; tak ada gejala yang perlu
        // diperbaiki. Menutup "cuma cek malah disuruh reboot" + memutus rantai "ok/siap → reboot
        // modem sehat". Jalur TERPUTUS (offline) tetap ditawari — putusnya itu sendiri buktinya.
        if (lineStatus === 'online' && !hasConnectivityComplaintSignal(customerText || '')) {
            console.log('[REBOOTFU] Tawaran reboot dilewati (jalur sehat, pelanggan tak mengeluh).');
            return '';
        }

        // State WAJIB di-key JID kanonik, bukan @lid (lihat lib/jid-utils).
        const stateKey = resolved && resolved.canonicalJid;
        if (!stateKey) {
            console.warn('[REBOOTFU] Tawaran reboot dibatalkan: JID kanonik tak terselesaikan.');
            return '';
        }

        const { setUserState } = require('./conversation-handler');
        setUserState(stateKey, {
            step: 'REBOOTFU_OFFER',
            targetUser: user,
            remoteAddr: remoteAddr || null,
            reason: gate.reason
        });

        return renderResponseTemplate(
            'rebootfu_offer',
            `\n\n🔄 *Boleh saya nyalakan ulang modemnya dari sini?*\n` +
                `Ini sering memperbaiki kendala seperti ini. Internet akan terputus sekitar 5 menit, ` +
                `lalu saya cek lagi dan kabari Kak.\n\nBalas *ya* kalau boleh, atau *nanti* kalau belum sekarang.`,
            { nama: user.name || 'Kak' }
        );
    } catch (err) {
        console.error(`[REBOOTFU] Gagal menyiapkan tawaran reboot: ${err.message}`);
        return '';
    }
}

/**
 * Tentukan status jalur + heuristik gangguan area dari satu fetch PPP active.
 * @returns {Promise<{lineStatus:'online'|'offline'|'unknown', areaOutage:boolean, offlineCount:number}>}
 */
async function resolveLineStatus({ user, userList, routerId }) {
    const pppoe = normalizeUsername(user.pppoe_username);
    if (!pppoe) {
        return { lineStatus: 'unknown', areaOutage: false, offlineCount: 0 };
    }

    let activeSet;
    try {
        activeSet = await getActiveUsernameSet(routerId);
    } catch (err) {
        // Buta, bukan "semua mati". Dicatat dengan alasan sebenarnya supaya kebutaan router
        // terlihat di log — diam total di sini dulu membuat gangguan MikroTik tak terdeteksi.
        console.warn(`[CEK_KONEKSI] Status jalur TIDAK DAPAT dipastikan: ${err && err.message ? err.message : err}`);
        return { lineStatus: 'unknown', areaOutage: false, offlineCount: 0 };
    }

    const online = activeSet.has(pppoe);
    if (online) {
        return { lineStatus: 'online', areaOutage: false, offlineCount: 0 };
    }

    // Offline → cek apakah banyak pelanggan lain juga offline (indikasi gangguan area).
    const withPppoe = userList.filter((u) => u.pppoe_username);
    const offlineCount = withPppoe.filter((u) => !activeSet.has(normalizeUsername(u.pppoe_username))).length;
    const { areaOutage } = evaluateAreaOutage({
        offlineCount,
        totalWithPppoe: withPppoe.length,
        config: global.config
    });

    return { lineStatus: 'offline', areaOutage, offlineCount };
}

async function handleCekKoneksi({ sender, msg, raf, users, reply, mess, pushname, chats }) {
    const userList = Array.isArray(users) && users.length ? users : global.users || [];

    const resolved = await resolveCustomerBySender({ users: userList, sender, msg, raf });
    const user = resolved.user;

    if (!user) {
        return reply(
            renderResponseTemplate(
                'conncheck_not_registered',
                (mess && mess.userNotRegister) ||
                    'Maaf, nomor Anda belum terdaftar sebagai pelanggan. Silakan hubungi admin untuk bantuan.'
            )
        );
    }

    const nama = user.name || pushname || 'Kak';
    const namaLayanan = (global.config && global.config.nama) || 'Layanan Kami';

    await reply(
        renderResponseTemplate('conncheck_loading', '⏳ Sebentar ya Kak, saya sedang mengecek status koneksi Anda...')
    );

    // Router id + offline_since dari state pemantauan (opsional, untuk "terakhir online").
    let routerId = 'default';
    let offlineSince = null;
    try {
        const repo = require('../../repositories/auto-outage.repository').createAutoOutageRepository();
        const cached = await repo.getStateByUserId(user.id);
        if (cached) {
            if (cached.router_id) routerId = cached.router_id;
            if (cached.offline_since) offlineSince = cached.offline_since;
        }
    } catch (_e) {
        // state opsional — abaikan bila tak tersedia
    }

    const { lineStatus, areaOutage, offlineCount } = await resolveLineStatus({ user, userList, routerId });

    // IP remote PPPoE pelanggan (dari cache PPP active) — dipakai peta jalur + diagnosa app.
    const addr = activeCache.addrByUser
        ? activeCache.addrByUser.get(normalizeUsername(user.pppoe_username))
        : null;

    // Entitas aplikasi yang disebut pelanggan ("tik tok muter", "video FB", "shopee") — jawaban
    // SPESIFIK per-app dari matriks reachability live. Best-effort; kosong bila tak menyebut app.
    let appEntity = null;
    let appDiagnosis = '';
    try {
        if (lineStatus !== 'offline' && chats) {
            const { topAppEntity } = require('../../lib/app-entity-extractor');
            appEntity = topAppEntity(chats);
            if (appEntity) {
                const { buildAppDiagnosis } = require('../../lib/app-aware-diagnosis');
                appDiagnosis = await buildAppDiagnosis({ addr, appEntity });
            }
        }
    } catch (_e) {
        // Diagnosa app opsional — tidak boleh mengganggu balasan cek koneksi.
    }

    // Sinyal komplain → agregator (fire-and-forget): komplain "lemot" yang menumpuk pada jalur
    // upstream yang sama akan dinaikkan sendiri ke owner. Gate config.complaintSignals.enabled.
    // Sertakan app yang disebut supaya alert owner bisa presisi ("5 pelanggan keluhkan TikTok").
    try {
        const { recordComplaint } = require('../../lib/complaint-signal-service');
        recordComplaint({ user, source: 'cek_koneksi', addr, lineStatus, app: appEntity ? appEntity.label : null }).catch(() => {});
    } catch (_e) {
        // Sinyal opsional — tidak boleh mengganggu balasan cek koneksi.
    }

    // Catat konteks komplain (multi-turn): sebutan app polos susulan ("Shopee kak") dalam
    // beberapa menit ke depan akan dikenali fallback sebagai lanjutan → diagnosa app-spesifik.
    try {
        require('../../lib/chat-activity-tracker').noteConnectivityComplaint(sender);
    } catch (_e) {
        // opsional
    }

    const modem = await buildModemLine(user);
    // Seksi jalur upstream (best-effort, kosong saat normal/fitur mati) — jawaban
    // "lemot dari sisi mana" saat PPPoE pelanggan sendiri online tapi jalurnya sakit.
    const upstream = await buildUpstreamSection(user);

    // VERDICT BERBASIS BUKTI (hanya untuk jalur AKTIF): jangan pernah bilang "koneksi normal" tanpa
    // bukti. Jalur pelanggan terpetakan & sakit → UPSTREAM_ISSUE; ada jalur lain sakit tapi IP-nya
    // belum terpetakan → POSSIBLE_UPSTREAM; semua jalur terpantau sehat → HEALTHY; tak ada sinyal
    // upstream sama sekali → INCONCLUSIVE (aktif, tanpa klaim "normal" — fail-closed).
    let verdict = null;
    let healthNote = '';
    if (lineStatus === 'online') {
        verdict = classifyOnlineVerdict(await resolveUpstreamHealth(user));
        healthNote = buildHealthNote(verdict);

        // KESTABILAN: hanya berbicara saat jalur pelanggan terpantau SEHAT menurut vonis lama
        // (HEALTHY/INCONCLUSIVE). Saat sudah UPSTREAM_ISSUE, seksi `upstream` sudah menjelaskan
        // gangguannya — menambah baris kedua cuma membingungkan. Justru pada "sehat"-lah dulu
        // pelanggan dibantah "terpantau normal" padahal jaringannya ramai.
        if (verdict === 'HEALTHY' || verdict === 'INCONCLUSIVE') {
            const stab = await resolveStabilitas(user);
            const catatanStabil = buildStabilitasNote(stab.tingkat);
            if (catatanStabil) {
                // Menggantikan, bukan menumpuk: "terpantau normal" + "sedang ramai" saling
                // membantah di layar pelanggan.
                healthNote = catatanStabil;
            }
        }
    }

    // Tawaran reboot berbantu HANYA saat reboot masuk akal: jalur AKTIF tanpa bukti gangguan jaringan
    // (HEALTHY/INCONCLUSIVE), atau jalur TERPUTUS (pola PPPoE hang klasik). Saat justru JARINGAN yang
    // sakit (UPSTREAM_ISSUE/POSSIBLE_UPSTREAM), reboot tak menolong & menyesatkan → jangan ditawarkan.
    // (Penyaringan "jalur sehat tapi pelanggan cuma cek status, tak mengeluh" ada DI DALAM
    // buildRebootOffer/M2 — di sini tetap dipanggil supaya jalur "sudah restart sendiri" tetap jalan.)
    const rebootEligible =
        lineStatus === 'offline' ||
        (lineStatus === 'online' && (verdict === 'HEALTHY' || verdict === 'INCONCLUSIVE'));
    const rebootOffer = rebootEligible
        ? await buildRebootOffer({
              user,
              resolved,
              lineStatus,
              areaOutage,
              offlineCount,
              remoteAddr: addr,
              customerText: chats
          })
        : '';

    const data = {
        nama,
        nama_layanan: namaLayanan,
        modem,
        upstream,
        health_note: healthNote,
        app: appDiagnosis,
        // SENGAJA TIDAK ADA `jumlah`. Jumlah pelanggan yang ikut offline = data usaha (besar basis
        // pelanggan); saat gangguan massal angkanya nyaris = total pelanggan. Dengan slot-nya tidak
        // dioper sama sekali, admin pun tak bisa membocorkannya lewat edit template di /api/templates.
        // Angka aslinya tetap dipakai internal: gerbang reboot (buildRebootOffer) & bot teknisi.
        terakhir_online: formatTerakhirOnline(offlineSince),
        reboot_offer: rebootOffer,
        // Bila bot sanggup mereboot sendiri, JANGAN suruh pelanggan mencabut listrik — korpus chat
        // menunjukkan mereka sering sudah melakukannya ("ini baru dicoba cabut") dan merasa diabaikan.
        langkah_manual: rebootOffer
            ? ''
            : `\n\n🛠️ Coba langkah cepat ini:\n` +
              `1) Cek kabel & adaptor modem/ONU (apakah lampu *LOS* menyala merah?)\n` +
              `2) Restart modem: cabut listrik ±30 detik, lalu colok kembali\n` +
              `3) Tunggu 2-3 menit hingga lampu kembali normal\n\n` +
              `Masih mati setelah dicoba? Ketik *lapor* untuk membuat laporan ke teknisi. 🙏`
    };

    let key;
    let fallback;
    if (lineStatus === 'online') {
        key = 'conncheck_online';
        fallback =
            `🔎 *STATUS KONEKSI — ${namaLayanan}*\n\nHalo Kak ${nama}! 👋\n\n` +
            `🟢 *Jalur internet: AKTIF*\n${healthNote}${modem}${upstream}${appDiagnosis}\n\n` +
            `✅ Kalau internet terasa lambat:\n` +
            `• Dekatkan perangkat ke modem / kurangi penghalang\n` +
            `• Ketik *cek wifi* untuk lihat perangkat yang terhubung\n` +
            `• Masih bermasalah? ketik *lapor wifi lemot*\n\nTerima kasih 🙏${rebootOffer}`;
    } else if (lineStatus === 'offline' && areaOutage) {
        // Key BARU (v2) sengaja menggantikan `conncheck_offline_area` yang lama: template lama
        // memuat `${jumlah}` dan template PROD di-merge-key (tak pernah ditimpa deploy), jadi
        // memperbaiki teksnya saja tidak menghentikan kebocoran di server yang sudah jalan.
        // Dengan key baru, salinan lama di prod jadi yatim/tak terpakai → bocor berhenti tanpa
        // harus mengedit file template prod satu per satu.
        // Key v3: kalimat "kami akan kabari begitu koneksi pulih" DICABUT karena tidak punya
        // pemilik. Satu-satunya pengabar-pulih di sistem (lib/olt-los-broadcaster) hanya menyapa
        // pelanggan yang IA SENDIRI sudah DM saat gangguan; pelanggan yang tahu dari "cek koneksi"
        // tak pernah masuk daftar itu. Jadi dulu pelanggan disuruh menunggu kabar yang secara
        // struktur tidak akan datang — sambil dilarang membuat laporan.
        //
        // Diganti arahan yang SELALU benar dan bisa dia kerjakan sendiri. Key baru (bukan mengedit
        // v2) karena template produksi di-merge-key: mengedit teks lama tak menghentikan salinan
        // yang sudah hidup di server, sedangkan key baru membuat salinan lama jadi yatim.
        key = 'conncheck_offline_area_v3';
        fallback =
            `🔎 *STATUS KONEKSI — ${namaLayanan}*\n\nHalo Kak ${nama}!\n\n` +
            `🔴 *Jalur internet: TERPUTUS*\n` +
            `⚠️ Terdeteksi *gangguan pada jaringan di area Anda*, dan tim teknisi kami sedang menanganinya.\n\n` +
            `Anda *tidak perlu* membuat laporan terpisah. Untuk memastikan sudah pulih, ketik *cek koneksi* lagi beberapa saat lagi ya 🙏`;
    } else if (lineStatus === 'offline') {
        key = 'conncheck_offline_single';
        fallback =
            `🔎 *STATUS KONEKSI — ${namaLayanan}*\n\nHalo Kak ${nama}!\n\n` +
            `🔴 *Jalur internet: TERPUTUS*\n` +
            `Yang terpantau putus hanya koneksi Anda.${data.terakhir_online}` +
            `${data.langkah_manual}${rebootOffer}`;
    } else {
        key = 'conncheck_unknown';
        fallback =
            `🔎 *STATUS KONEKSI — ${namaLayanan}*\n\nHalo Kak ${nama}!\n\n` +
            `⚪ Status jalur internet Anda belum bisa kami cek otomatis saat ini.${modem}${upstream}${appDiagnosis}\n\n` +
            `Untuk pengecekan lanjutan ketik *cek wifi*, atau ketik *lapor* bila ada kendala. 🙏`;
    }

    return reply(renderResponseTemplate(key, fallback, data));
}

module.exports = {
    handleCekKoneksi,
    resolveLineStatus, // dipakai reboot-modem-handler utk gerbang gangguan-area (M3)
    // Test-only: reset cache in-memori (PPP-active + laporan upstream) agar test deterministik.
    _resetCachesForTest() {
        activeCache = { at: 0, routerId: null, set: null, addrByUser: null, error: null };
        upstreamReportCache = { at: 0, report: null };
    }
};
