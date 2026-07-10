/**
 * Header Doc
 * Purpose: Otak alur "reboot bersyarat + tindak lanjut yang membuktikan". Menentukan apakah reboot
 *          AMAN ditawarkan (jalur ISP/area sehat), mengeksekusi reboot, lalu pada T+N menit
 *          MEMVERIFIKASI modem benar-benar kembali SEBELUM bertanya ke pelanggan. Kalau modem
 *          belum balik, bot tidak bertanya "sudah aman?" — ia melapor jujur & eskalasi ke teknisi.
 * Caller: `message/handlers/connection-check-handler.js` (evaluasi tawaran),
 *         `message/handlers/states/reboot-followup-state-handler.js` (eksekusi + jawaban pelanggan),
 *         `lib/app-runtime.js` (start scheduler).
 * Deps: `./reboot-followup-store`, `./device-status` (isDeviceOnline), `./wifi` (rebootRouter),
 *       `./mikrotik` (getActivePPPoEUsers), `./whatsapp-critical-delivery` (sendCritical),
 *       `./response-template-helper`, `./admin-recipients`, lazy `./upstream-quality-poller`.
 * MainFuncs: `evaluateRebootGate`, `executeRebootAndSchedule`, `scheduleFollowupForReboot`, `tickOnce`,
 *            `startRebootFollowupScheduler`, `runDeepCheck`, `closeJob`.
 * SideEffects: Mengirim task reboot ke GenieACS, menulis `database/reboot-followups.json`,
 *              mengirim pesan WhatsApp proaktif ke pelanggan & admin, menyetel conversation state.
 */
"use strict";

const store = require("./reboot-followup-store");
const { isDeviceOnline } = require("./device-status");
const { renderResponseTemplate } = require("./response-template-helper");

// Jeda sebelum bot memverifikasi modem. Template menjanjikan "5-10 menit"; 6 menit memberi
// ruang boot (3-5 menit) + satu siklus inform GenieACS.
const DEFAULT_FIRST_CHECK_MS = 6 * 60 * 1000;
// Bila modem belum balik, cek sekali lagi setelah jeda ini sebelum menyerah ke teknisi.
const DEFAULT_RETRY_MS = 6 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 2;
const TICK_INTERVAL_MS = 30 * 1000;
// Modem dianggap "sudah balik" bila inform ke ACS < ambang ini.
const ONLINE_INFORM_MAX_MINUTES = 7;

let tickTimer = null;

function cfg() {
    const c = (global.config && global.config.rebootAssist) || {};
    return {
        enabled: c.enabled === true,
        // Tanjungharjo tak punya sinyal kesehatan ISP (upstreamMonitor mati) → gate lebih ketat.
        strictWhenNoUpstreamSignal: c.strictWhenNoUpstreamSignal !== false,
        firstCheckMs: Number.isFinite(c.firstCheckMs) ? c.firstCheckMs : DEFAULT_FIRST_CHECK_MS,
        retryMs: Number.isFinite(c.retryMs) ? c.retryMs : DEFAULT_RETRY_MS,
        notifyAdminOnEscalation: c.notifyAdminOnEscalation !== false
    };
}

function upstreamSignalAvailable() {
    const up = global.config && global.config.upstreamMonitor;
    return !!(up && up.enabled === true);
}

/**
 * Status jalur upstream yang dipakai pelanggan. `null` bila fitur mati / tak terpetakan.
 * Tidak pernah throw.
 */
async function resolveUpstreamStatus(remoteAddr) {
    try {
        if (!upstreamSignalAvailable() || !remoteAddr) return null;
        const { resolvePathForIp } = require("./upstream-path-resolver");
        const resolved = resolvePathForIp(remoteAddr, global.config.upstreamMonitor);
        if (!resolved) return null;
        const { buildStatusReport } = require("./upstream-quality-poller");
        const report = await buildStatusReport();
        const entry = report && Array.isArray(report.paths)
            ? report.paths.find((p) => p.key === resolved.path)
            : null;
        return entry ? entry.status : null;
    } catch (_e) {
        return null;
    }
}

/**
 * Boleh menawarkan reboot? Reboot memutus koneksi seisi rumah, jadi hanya ditawarkan bila
 * masalahnya PLAUSIBEL ada di modem — bukan di jalur ISP, bukan gangguan area.
 *
 * @returns {Promise<{allowed:boolean, reason:string, mode:'full'|'strict'}>}
 */
async function evaluateRebootGate({ user, lineStatus, areaOutage, offlineCount, remoteAddr, customerText }) {
    const conf = cfg();
    const mode = upstreamSignalAvailable() ? "full" : "strict";

    if (!conf.enabled) return { allowed: false, reason: "FITUR_MATI", mode };
    if (!user || !user.device_id) return { allowed: false, reason: "TANPA_DEVICE_ID", mode };

    // Pelanggan voucher tidak punya modem terkelola (sejalan guard reboot-modem-handler).
    if (String(user.subscription || "").toUpperCase().includes("PAKET-VOUCHER")) {
        return { allowed: false, reason: "PELANGGAN_VOUCHER", mode };
    }

    // Gangguan area → reboot satu modem tidak menolong dan menyesatkan.
    if (areaOutage) return { allowed: false, reason: "GANGGUAN_AREA", mode };

    // Pelanggan sudah mencabut modemnya sendiri → menawarkan hal yang sama = mengabaikan dia.
    if (customerText) {
        const { saysAlreadyRestarted } = require("./affirmative-parser");
        if (saysAlreadyRestarted(customerText)) {
            return { allowed: false, reason: "SUDAH_RESTART_SENDIRI", mode };
        }
    }

    // Jalur ISP sedang sakit → jujur saja bahwa ini bukan perangkat pelanggan.
    const upstreamStatus = await resolveUpstreamStatus(remoteAddr);
    if (upstreamStatus && ["DEGRADASI", "GANGGUAN", "PUTUS"].includes(upstreamStatus)) {
        return { allowed: false, reason: "UPSTREAM_SAKIT", mode, upstreamStatus };
    }

    // Tanpa sinyal upstream (Tanjungharjo), kita tak bisa membuktikan ISP sehat. Gate lebih ketat:
    // hanya lanjut bila TIDAK ADA pelanggan lain yang offline — artinya benar-benar terisolasi.
    if (mode === "strict" && conf.strictWhenNoUpstreamSignal && Number(offlineCount) > 0) {
        return { allowed: false, reason: "STRICT_ADA_OFFLINE_LAIN", mode };
    }

    // Modem harus masih terjangkau ACS supaya task reboot bisa mendarat.
    const status = await isDeviceOnline(user.device_id, ONLINE_INFORM_MAX_MINUTES);
    if (status.online !== true) {
        return { allowed: false, reason: "MODEM_TAK_TERJANGKAU", mode };
    }

    // lineStatus 'offline' + modem masih inform = pola PPPoE hang klasik → reboot paling menolong.
    // lineStatus 'online' + pelanggan mengeluh = kandidat reboot juga (setelah ISP terbukti sehat).
    if (lineStatus !== "online" && lineStatus !== "offline") {
        return { allowed: false, reason: "STATUS_JALUR_TAK_PASTI", mode };
    }

    return { allowed: true, reason: lineStatus === "offline" ? "PPPOE_HANG" : "MODEM_KANDIDAT", mode };
}

async function sendToCustomer(jid, text, label) {
    try {
        const { sendCritical } = require("./whatsapp-critical-delivery");
        // KONTRAK: payload wajib objek { text }, bukan string.
        return await sendCritical(jid, { text }, { label, waitForReadyMs: 8000 });
    } catch (err) {
        console.error(`[REBOOTFU] Gagal kirim ke pelanggan (${label}): ${err.message}`);
        return { ok: false };
    }
}

async function notifyAdmins(text) {
    if (!cfg().notifyAdminOnEscalation) return;
    try {
        const { getAdminJids } = require("./admin-recipients");
        const jids = getAdminJids() || [];
        const { sendCritical } = require("./whatsapp-critical-delivery");
        for (const jid of jids) {
            await sendCritical(jid, { text }, { label: "rebootfu_escalation" });
        }
    } catch (err) {
        console.error(`[REBOOTFU] Gagal notifikasi admin: ${err.message}`);
    }
}

/**
 * Catat pekerjaan follow-up untuk reboot yang SUDAH dikirim di tempat lain (mis. intent
 * `REBOOT_MODEM` klasik). Tidak mengirim task reboot apa pun. Never-throw.
 * @returns {object|null} job tersimpan
 */
function scheduleFollowupForReboot({ user, jid, reason = "unknown", remoteAddr = null }) {
    if (!cfg().enabled) return null;
    if (!user || !user.device_id || !jid) return null;

    // Invarian: `@lid` bukan nomor telepon. Menyimpannya sebagai target kirim akan membuat
    // follow-up gagal diam-diam beberapa menit kemudian. Gagal keras di sini, bukan nanti.
    try {
        const { isLidJid } = require("./jid-utils");
        if (isLidJid(jid)) {
            console.error(`[REBOOTFU] Menolak menjadwalkan follow-up: JID @lid belum ternormalisasi (${jid})`);
            return null;
        }
    } catch (_e) {
        // helper opsional — jangan menghalangi penjadwalan bila modul tak tersedia
    }
    const job = store.addJob({
        jid,
        userId: user.id,
        name: user.name,
        deviceId: user.device_id,
        pppoeUsername: user.pppoe_username,
        remoteAddr,
        reason,
        dueAt: new Date(Date.now() + cfg().firstCheckMs).toISOString()
    });
    if (job) console.log(`[REBOOTFU] Follow-up dijadwalkan ${job.id} (due ${job.dueAt})`);
    return job;
}

/**
 * Jalankan reboot lalu catat pekerjaan follow-up yang durabel.
 * @returns {Promise<{ok:boolean, job:object|null, message:string}>}
 */
async function executeRebootAndSchedule({ user, jid, reason = "unknown", remoteAddr = null }) {
    const { rebootRouter } = require("./wifi");
    let result;
    try {
        result = await rebootRouter(user.device_id, {
            operation: "rebootfu.execute",
            featureScope: "customerReboot"
        });
    } catch (err) {
        console.error(`[REBOOTFU] rebootRouter melempar: ${err.message}`);
        return { ok: false, job: null, message: err.message };
    }

    // `ok` di sini HANYA berarti GenieACS menerima task — bukan bukti modem restart.
    // Karena itu pekerjaan follow-up di bawah wajib memverifikasi sendiri.
    if (!result || !result.ok) {
        return { ok: false, job: null, message: (result && result.message) || "Task reboot gagal dikirim" };
    }

    const job = scheduleFollowupForReboot({ user, jid, reason, remoteAddr });
    if (!job) return { ok: false, job: null, message: "Gagal mencatat pekerjaan follow-up" };
    return { ok: true, job, message: "Reboot dikirim" };
}

/**
 * Apakah sesi PPPoE pelanggan aktif? `null` bila tak bisa ditentukan.
 */
async function isPppoeOnline(pppoeUsername, routerId) {
    if (!pppoeUsername) return null;
    try {
        const { getActivePPPoEUsers } = require("./mikrotik");
        const raw = await getActivePPPoEUsers({ router_id: routerId || "default" });
        const list = Array.isArray(raw) ? raw : raw?.data?.data || raw?.data || raw?.items || [];
        const target = String(pppoeUsername).trim().toLowerCase();
        return list.some((i) => String(i.name || i.user || i.username || "").trim().toLowerCase() === target);
    } catch (_e) {
        return null;
    }
}

/**
 * Diagnosa lanjutan saat pelanggan bilang "masih bermasalah" pasca-reboot.
 * Tiket adalah pilihan TERAKHIR — kita cari dulu penyebab yang bisa dijelaskan.
 * @returns {Promise<{verdict:string, detail:string}>}
 */
async function runDeepCheck(job) {
    const pppoe = await isPppoeOnline(job.pppoeUsername, job.routerId);
    if (pppoe === false) {
        return { verdict: "PPPOE_DOWN", detail: "Sesi internet pelanggan tidak aktif setelah reboot." };
    }

    const upstreamStatus = await resolveUpstreamStatus(job.remoteAddr);
    if (upstreamStatus && ["DEGRADASI", "GANGGUAN", "PUTUS"].includes(upstreamStatus)) {
        return { verdict: "UPSTREAM_SAKIT", detail: `Jalur upstream berstatus ${upstreamStatus}.` };
    }

    // Redaman/optik: pemisah masalah fiber vs perangkat rumah. Best-effort.
    try {
        const { getCustomerRedaman } = require("./wifi");
        const redaman = await getCustomerRedaman(job.deviceId);
        const value = parseFloat(redaman && (redaman.redaman || redaman.value));
        if (Number.isFinite(value) && value < -27) {
            return { verdict: "REDAMAN_BURUK", detail: `Redaman optik ${value} dBm (di bawah ambang wajar).` };
        }
    } catch (_e) {
        // opsional
    }

    return { verdict: "SEMUA_HIJAU", detail: "Jalur, upstream, dan optik terpantau normal." };
}

function closeJob(jobId, status = store.STATUS.CLOSED) {
    return store.updateJob(jobId, { status });
}

/**
 * Satu siklus pemeriksaan pekerjaan jatuh tempo. Dipisah dari timer agar bisa diuji.
 */
async function tickOnce(now = Date.now()) {
    const due = store.listDueJobs(now);
    if (!due.length) return { processed: 0 };

    let processed = 0;
    for (const job of due) {
        try {
            await processJob(job);
            processed += 1;
        } catch (err) {
            console.error(`[REBOOTFU] Job ${job.id} gagal diproses: ${err.message}`);
        }
    }
    return { processed };
}

async function processJob(job) {
    const conf = cfg();
    const status = await isDeviceOnline(job.deviceId, ONLINE_INFORM_MAX_MINUTES);
    const pppoe = await isPppoeOnline(job.pppoeUsername, job.routerId);

    // Modem terbukti kembali: inform ACS baru DAN (bila diketahui) PPPoE naik.
    const modemBack = status.online === true && pppoe !== false;

    if (modemBack) {
        const text = renderResponseTemplate(
            "rebootfu_ask",
            `Halo Kak ${job.name || ""}, modemnya sudah menyala kembali dan koneksinya terpantau normal dari sisi kami. \n\n` +
                `Sekarang internetnya sudah lancar?\n\nBalas *sudah* kalau sudah normal, atau *masih* kalau masih bermasalah ya 🙏`,
            { nama: job.name || "Kak" }
        );
        await sendToCustomer(job.jid, text, "rebootfu_ask");

        // Pasang state SETELAH pesan terkirim, supaya jawaban pelanggan tertangkap.
        // State di-set di sini (bukan saat reboot) agar jendela 15 menit dihitung dari pertanyaan.
        try {
            const { setUserState } = require("../message/handlers/conversation-handler");
            setUserState(job.jid, { step: "REBOOTFU_ASK", jobId: job.id });
        } catch (err) {
            console.error(`[REBOOTFU] Gagal set state REBOOTFU_ASK: ${err.message}`);
        }

        store.updateJob(job.id, { status: store.STATUS.ASKED });
        return;
    }

    // Modem BELUM balik. Jangan tanya "sudah aman?" — itu pertanyaan absurd.
    const attempts = (job.attempts || 0) + 1;
    if (attempts < MAX_VERIFY_ATTEMPTS) {
        const text = renderResponseTemplate(
            "rebootfu_still_down",
            `Kak ${job.name || ""}, modemnya belum menyala kembali sepenuhnya. Saya pantau sebentar lagi ya, ` +
                `mohon pastikan kabel listrik modem terpasang. 🙏`,
            { nama: job.name || "Kak" }
        );
        await sendToCustomer(job.jid, text, "rebootfu_still_down");
        store.updateJob(job.id, {
            attempts,
            dueAt: new Date(Date.now() + conf.retryMs).toISOString()
        });
        return;
    }

    // Menyerah → jujur ke pelanggan, eskalasi ke teknisi.
    const text = renderResponseTemplate(
        "rebootfu_failed",
        `Kak ${job.name || ""}, modemnya belum kembali normal setelah dinyalakan ulang. ` +
            `Laporan Anda sudah saya teruskan ke teknisi kami untuk dicek langsung. Mohon ditunggu ya 🙏`,
        { nama: job.name || "Kak" }
    );
    await sendToCustomer(job.jid, text, "rebootfu_failed");
    await notifyAdmins(
        `⚠️ *Reboot tidak pulih*\nPelanggan: ${job.name || "-"} (${job.jid})\nDevice: ${job.deviceId}\n` +
            `Modem tidak inform ke ACS setelah ${MAX_VERIFY_ATTEMPTS} kali cek. Perlu pengecekan teknisi.`
    );
    store.updateJob(job.id, { attempts, status: store.STATUS.ESCALATED });
}

function startRebootFollowupScheduler({ intervalMs = TICK_INTERVAL_MS } = {}) {
    if (!cfg().enabled) {
        console.log("[REBOOTFU] Nonaktif (set config.rebootAssist.enabled=true untuk mengaktifkan)");
        return null;
    }
    if (tickTimer) return tickTimer;

    // Tick memindai `dueAt` dari disk tiap siklus → pekerjaan otomatis pulih setelah pm2 restart.
    tickTimer = setInterval(() => {
        tickOnce().catch((err) => console.error(`[REBOOTFU] Tick gagal: ${err.message}`));
    }, intervalMs);
    if (typeof tickTimer.unref === "function") tickTimer.unref();

    try {
        store.pruneJobs();
    } catch (_e) {
        // opsional
    }
    console.log(`[REBOOTFU] Scheduler start (tick ${Math.round(intervalMs / 1000)}s)`);
    return tickTimer;
}

function stopRebootFollowupScheduler() {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}

module.exports = {
    evaluateRebootGate,
    executeRebootAndSchedule,
    scheduleFollowupForReboot,
    runDeepCheck,
    closeJob,
    tickOnce,
    startRebootFollowupScheduler,
    stopRebootFollowupScheduler,
    notifyAdmins,
    sendToCustomer,
    _internal: { processJob, isPppoeOnline, resolveUpstreamStatus, cfg }
};
