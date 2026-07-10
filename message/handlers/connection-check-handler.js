/**
 * Header Doc
 * Purpose: Self-service "Cek Koneksi" pelanggan — diagnosa instan status jalur internet (PPPoE),
 *          deteksi kemungkinan gangguan area, ringkas modem/WiFi, dan beri langkah berikut.
 *          Diagnosanya READ-ONLY (tak mengubah saldo/konfigurasi), tapi bila jalur ISP & area
 *          terbukti sehat dan modem masih terjangkau ACS, balasan menyertakan TAWARAN reboot
 *          berbantu — bot meminta izin dulu dan tak pernah mereboot sendiri. Tiket tetap di luar.
 * Caller: `message/handlers/raf-intent-dispatch/customer-service-intents.js` pada intent `CEK_KONEKSI`.
 * Deps: `../../lib/jid-utils` (resolveCustomerBySender), `../../lib/mikrotik` (getActivePPPoEUsers),
 *       `../../lib/wifi` (getSSIDInfo), `../../repositories/auto-outage.repository` (state offline_since),
 *       `./template-helpers` (renderResponseTemplate), `../../lib/upstream-path-resolver` (IP→jalur)
 *       + lazy `../../lib/upstream-quality-poller` (status jalur upstream, best-effort)
 *       + lazy `../../lib/complaint-signal-service` (sinyal komplain → agregator, fire-and-forget)
 *       + lazy `../../lib/app-entity-extractor` + `../../lib/app-aware-diagnosis` (jawaban
 *         SPESIFIK per aplikasi yang disebut pelanggan, dari matriks reachability live).
 *       + lazy `../../lib/reboot-followup-service` (gate keamanan reboot + penjadwalan follow-up).
 * MainFuncs: `handleCekKoneksi`, `buildRebootOffer`.
 * SideEffects: Membaca PPP active MikroTik (live, di-cache TTL pendek) + GenieACS (best-effort) lalu reply WhatsApp.
 *              Bila gate reboot lolos: menyetel conversation state `REBOOTFU_OFFER` (JID kanonik).
 */
'use strict';

const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { getActivePPPoEUsers } = require('../../lib/mikrotik');
const { getSSIDInfo } = require('../../lib/wifi');
const { renderResponseTemplate } = require('./template-helpers');
const { resolvePathForIp } = require('../../lib/upstream-path-resolver');

// Cache daftar PPPoE aktif sebentar supaya burst "cek koneksi" tidak menghajar MikroTik.
// addrByUser dipakai seksi upstream (map username → IP remote utk pemetaan jalur).
let activeCache = { at: 0, routerId: null, set: null, addrByUser: null };
const ACTIVE_CACHE_TTL_MS = 30000;

// Cache laporan status jalur upstream (query SQLite ringan, tapi burst tetap dihemat).
let upstreamReportCache = { at: 0, report: null };
const UPSTREAM_REPORT_TTL_MS = 30000;

// Ambang kemungkinan gangguan area (jumlah & rasio pelanggan offline berbarengan).
const AREA_OUTAGE_RATIO = 0.3;

function normalizeUsername(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function unwrapMikrotikList(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.data)) return result.data;
    if (Array.isArray(result?.data?.data)) return result.data.data;
    if (Array.isArray(result?.items)) return result.items;
    return [];
}

async function getActiveUsernameSet(routerId) {
    const now = Date.now();
    if (activeCache.set && activeCache.routerId === routerId && now - activeCache.at < ACTIVE_CACHE_TTL_MS) {
        return activeCache.set;
    }
    const list = unwrapMikrotikList(await getActivePPPoEUsers({ router_id: routerId }));
    const set = new Set();
    const addrByUser = new Map();
    for (const item of list) {
        const uname = normalizeUsername(item.name || item.user || item.username);
        if (!uname) continue;
        set.add(uname);
        const addr = item.address || item.ip || null;
        if (addr) addrByUser.set(uname, String(addr));
    }
    activeCache = { at: now, routerId, set, addrByUser };
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

        const resolved = resolvePathForIp(addr, upCfg);
        if (!resolved) return '';

        const report = await getUpstreamReportCached();
        const entry = report && Array.isArray(report.paths)
            ? report.paths.find((p) => p.key === resolved.path)
            : null;
        if (!entry) return '';
        if (!['DEGRADASI', 'GANGGUAN', 'PUTUS'].includes(entry.status)) return '';

        const targets = Array.isArray(entry.targets) ? entry.targets.filter((t) => t.samples > 0) : [];
        const avg = (field) => {
            const vals = targets.map((t) => t[field]).filter((v) => v != null);
            return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(0) : '-';
        };

        // Pelanggan jalur MNI: WhatsApp/game dipaksa router lewat IH — bila IH normal,
        // jelaskan kenapa "chat lancar tapi browsing lambat" (pola komplain korpus).
        let catatanKhusus = '';
        if (resolved.path === 'mni') {
            const ih = report.paths.find((p) => p.key === 'ih');
            if (ih && ih.status === 'NORMAL') {
                catatanKhusus = renderResponseTemplate(
                    'conncheck_upstream_note_mni',
                    '\n(Catatan: WhatsApp & game Anda lewat jalur berbeda yang saat ini normal — chat/game bisa tetap lancar walau browsing/video lambat.)'
                );
            }
        }

        // Pesan pelanggan SEDERHANA: cukup "jalur internet Anda sedang ada kendala" — label ISP
        // internal (GMDP/MNI) & angka loss/rtt tak berarti bagi awam, tetap dikirim sbg var
        // template untuk owner/kustomisasi. Fokus: cepat dipahami + "bukan perangkat Anda".
        const statusLabel = entry.status === 'PUTUS' ? 'TERPUTUS' : entry.status;
        return renderResponseTemplate(
            'conncheck_upstream_issue',
            `\n\n🛣️ *Info koneksi:* jalur internet yang dipakai paket Anda sedang ada kendala saat ini. ` +
            `Ini dari sisi jaringan kami — *bukan dari perangkat Anda* — dan tim sudah menerima peringatan otomatis. Mohon ditunggu ya 🙏${catatanKhusus}`,
            {
                jalur_label: entry.label,
                status_label: statusLabel,
                loss: avg('loss_avg_pct'),
                rtt: avg('rtt_avg_ms'),
                catatan_khusus: catatanKhusus
            }
        );
    } catch (_e) {
        return '';
    }
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
        // skipRefresh=true: baca cache GenieACS biar cepat; modem hanya info pelengkap.
        const { uptime, ssid } = await getSSIDInfo(user.device_id, true);
        const jumlahPerangkat = Array.isArray(ssid)
            ? ssid.reduce((n, s) => n + ((s.associatedDevices && s.associatedDevices.length) || 0), 0)
            : 0;
        return renderResponseTemplate(
            'conncheck_modem_line',
            `\n📡 Modem: aktif (uptime ${uptime || '-'}), ${jumlahPerangkat} perangkat terhubung.`,
            { uptime: uptime || '-', jumlah_perangkat: jumlahPerangkat }
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
    } catch (_e) {
        return { lineStatus: 'unknown', areaOutage: false, offlineCount: 0 };
    }

    const online = activeSet.has(pppoe);
    if (online) {
        return { lineStatus: 'online', areaOutage: false, offlineCount: 0 };
    }

    // Offline → cek apakah banyak pelanggan lain juga offline (indikasi gangguan area).
    const withPppoe = userList.filter((u) => u.pppoe_username);
    const offlineCount = withPppoe.filter((u) => !activeSet.has(normalizeUsername(u.pppoe_username))).length;
    const ratio = withPppoe.length ? offlineCount / withPppoe.length : 0;
    const threshold = parseInt(global.config && global.config.outage_area_threshold, 10) || 5;
    const areaOutage = offlineCount >= threshold || ratio >= AREA_OUTAGE_RATIO;

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

    // Tawaran reboot berbantu: hanya bila jalur ISP & area terbukti sehat, modem masih terjangkau
    // ACS, dan pelanggan belum mencabut modemnya sendiri. Bot TIDAK PERNAH reboot tanpa izin.
    const rebootOffer = await buildRebootOffer({
        user,
        resolved,
        lineStatus,
        areaOutage,
        offlineCount,
        remoteAddr: addr,
        customerText: chats
    });

    const data = {
        nama,
        nama_layanan: namaLayanan,
        modem,
        upstream,
        app: appDiagnosis,
        jumlah: offlineCount,
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
            `🟢 *Jalur internet: AKTIF*\nKoneksi Anda ke jaringan kami normal.${modem}${upstream}${appDiagnosis}\n\n` +
            `✅ Kalau internet terasa lambat:\n` +
            `• Dekatkan perangkat ke modem / kurangi penghalang\n` +
            `• Ketik *cek wifi* untuk lihat perangkat yang terhubung\n` +
            `• Masih bermasalah? ketik *lapor wifi lemot*\n\nTerima kasih 🙏${rebootOffer}`;
    } else if (lineStatus === 'offline' && areaOutage) {
        key = 'conncheck_offline_area';
        fallback =
            `🔎 *STATUS KONEKSI — ${namaLayanan}*\n\nHalo Kak ${nama}!\n\n` +
            `🔴 *Jalur internet: TERPUTUS*\n` +
            `⚠️ Terdeteksi *gangguan area* — sekitar ${offlineCount} pelanggan ikut terdampak. ` +
            `Tim teknisi kami sedang menanganinya.\n\n` +
            `Anda *tidak perlu* membuat laporan; kami akan kabari begitu koneksi pulih. Mohon ditunggu ya 🙏`;
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
    handleCekKoneksi
};
