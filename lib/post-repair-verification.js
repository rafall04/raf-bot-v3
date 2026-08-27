/**
 * Header Doc
 * Purpose: LAPORAN VERIFIKASI PASCA-PERBAIKAN ke grup teknisi. Setelah gangguan area beres, notifikasi
 *          "sudah pulih" saja tidak cukup untuk memutuskan boleh-tidaknya meninggalkan lokasi: yang
 *          dibutuhkan angka NYATA per pelanggan terdampak — status dan redaman hasil pengukuran
 *          SEGAR — termasuk (dan terutama) siapa yang MASIH MATI. Modul ini mengambil snapshot OLT
 *          dengan force-refresh (bukan cache), mengukur tiap pelanggan terdampak, membandingkan
 *          dengan redaman sebelum gangguan bila riwayatnya ada, lalu memilah hasilnya jadi
 *          PULIH / REDAMAN MEMBURUK / MASIH MATI / TAK TERBACA.
 *
 *          ANTI DATA-PALSU: angka redaman hanya dilaporkan sebagai kondisi kini bila `isRxPowerValid`
 *          meloloskannya (OLT EPON tetap menyimpan rxPower terakhir milik ONU yang sudah mati). ONU
 *          yang tak ditemukan/tak terbaca dilaporkan apa adanya sebagai "tak terbaca", TIDAK
 *          diam-diam dihitung pulih — laporan yang menyenangkan tapi salah lebih berbahaya daripada
 *          tidak ada laporan.
 * Caller: `lib/olt-los-broadcaster.js` (hook setelah notif PULIH terkirim, fire-and-forget).
 * Deps: `./olt-optical-resolver` (getOltSnapshot force-refresh, buildOnuIndex, isRxPowerValid),
 *       `./olt-hioso` (normalizeMAC), `./olt-rxpower-history` (redaman sebelum gangguan, opsional),
 *       `./whatsapp-gateway` + `./whatsapp-delivery-service` (boundary kirim — BUKAN Baileys mentah).
 * MainFuncs: `createPostRepairVerifier`, `buildReport`, `buildMessage`, `reportAfterRecovery`.
 * SideEffects: Satu query SNMP segar ke OLT + satu pesan WhatsApp ke grup/teknisi. NEVER-THROW —
 *              kegagalan laporan tak boleh menjatuhkan alur pemulihan. Gate `config.postRepairReport.enabled`
 *              (default OFF).
 */
"use strict";

const DEFAULTS = {
    enabled: false,
    // Jeda supaya ONU sempat stabil & OLT sempat memperbarui pembacaan optik sesudah tersambung.
    settleDelayMs: 2 * 60 * 1000,
    // TERUKUR (2 bot, 2026-07-05..08-27, 91 episode): 82-87% gangguan hanya 1-2 pelanggan.
    // Ambang 3 membuat justru kasus yang PALING butuh bukti — teknisi baru menyambung drop
    // cable satu pelanggan — tak pernah dibuktikan redamannya. Sambungan buruk bisa membuat
    // ONU online lagi dengan redaman jelek; "online" saja bukan bukti perbaikan selesai.
    minAffected: 1,
    // Redaman di bawah ini dianggap perlu perhatian walau ONU sudah online lagi.
    rxWarnDbm: -25,
    // Memburuk sekian dB dibanding sebelum gangguan = sambungan/splicing patut dicek ulang.
    rxDegradeDb: 3,
    // Kosong = ikut grup alarm OLT (config.oltLosBroadcast.groupId).
    groupId: "",
};

function getDefaultConfig() {
    const cfg = (global.config && global.config.postRepairReport) || {};
    return { ...DEFAULTS, ...cfg };
}

function numOr(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function safe(fn, fallback = null) {
    try {
        return fn();
    } catch (__e) {
        return fallback;
    }
}

// Kirim ke grup alarm OLT lewat delivery boundary. Guarded + never-throw (pola sama dengan
// olt-los-broadcaster.defaultPostToGroup dan repair-group-notifier.postToRepairGroup).
async function defaultPostToGroup(groupId, text) {
    try {
        const { isReady } = require("./whatsapp-gateway");
        if (!isReady()) return { sent: false, reason: "wa_offline" };
        const { sendMessage } = require("./whatsapp-delivery-service");
        const result = await sendMessage(groupId, { text }, { skipDuplicateCheck: true });
        return { sent: !!(result && result.sent !== false) };
    } catch (e) {
        console.error("[POST-REPAIR] postToGroup error:", e && e.message);
        return { sent: false, reason: e && e.message };
    }
}

function createPostRepairVerifier(deps = {}) {
    const getConfig = deps.getConfig || getDefaultConfig;
    // Sumber optik (web/snmp) dipilih di `olt-optical-resolver.getOltSnapshot` — satu pemilik
    // keputusan untuk seluruh aplikasi (#b275). Bawaannya WEB; SNMP membuat OLT hang.
    const getOltSnapshot = deps.getOltSnapshot || ((o) => require("./olt-optical-resolver").getOltSnapshot(o));
    // Pembaca PER-ONU (halaman detail OLT) — nilai paling segar.
    //
    // !! Halaman DAFTAR di-cache OLT dan tidak realtime: terukur 6 dari 8 ONU berbeda dari
    // halaman detailnya, selisih s/d 0,23 dB. Kecil, tapi laporan ini justru dibuat untuk
    // melawan data basi — dan di ambang batas 0,23 dB bisa membalik vonis. ONU yang perlu
    // dibaca di sini selalu sedikit (yang baru diperbaiki), jadi biayanya wajar.
    const bacaSegarPerOnu = deps.bacaSegarPerOnu || (async (onu) => {
        try {
            const onuId = onu && onu.onuId;
            if (!onuId || String(onuId).indexOf(":") < 0) return null;
            const devices = require("./olt-manager").getOltDevices() || [];
            const dev = devices.find((d) => d && (d.id === onu.olt_id || d.host === onu.olt_host));
            if (!dev) return null;
            const pon = String(onuId).split(":")[0];
            const r = await require("./olt-web-optical").bacaOnuSegar(dev, pon, onuId);
            return r && r.ok ? r : null;
        } catch (_e) {
            return null;   // never-throw: gagal baca segar = pakai nilai daftar
        }
    });
    const buildOnuIndex = deps.buildOnuIndex || ((onus, opts) => require("./olt-optical-resolver").buildOnuIndex(onus, opts));
    const isRxPowerValid = deps.isRxPowerValid || ((onu, status) => require("./olt-optical-resolver").isRxPowerValid(onu, status));
    const normalizeMAC = deps.normalizeMAC || ((mac) => require("./olt-hioso").normalizeMAC(mac));
    const getRxHistory = deps.getRxHistory || ((mac, since) => require("./olt-rxpower-history").getHistory(mac, since));
    const postToGroup = deps.postToGroup || defaultPostToGroup;
    const sendCritical = deps.sendCritical || ((to, msg, opts) => require("./whatsapp-critical-delivery").sendCritical(to, msg, opts));
    const getTeknisiRecipients = deps.getTeknisiRecipients || (() => require("./olt-los-broadcaster").defaultTeknisiRecipients());
    const getLosConfig = deps.getLosConfig || (() => (global.config && global.config.oltLosBroadcast) || {});
    const now = deps.now || (() => Date.now());
    const setTimer = deps.setTimeoutFn || setTimeout;
    // Verifikasi yang SUDAH dijadwalkan per OLT. Pemulihan yang menyusul digabungkan ke
    // jadwal itu, tidak menjadwalkan snapshot kedua.
    //
    // !! Tanpa ini, menurunkan minAffected ke 1 berarti tiap pemulihan menarik satu snapshot
    // OLT penuh sendiri-sendiri. Pola serentak semacam itu pernah membuat cron redaman
    // memutus dirinya sendiri lewat breaker global dan membutakan monitoring 18 jam.
    const tertunda = new Map();
    const logger = deps.logger || console;

    /** Redaman terakhir yang tercatat SEBELUM gangguan (best-effort; riwayat opsional). */
    function rxBefore(mac, downAtMs) {
        if (!mac || !downAtMs) return null;
        const samples = safe(() => getRxHistory(mac, downAtMs - 6 * 60 * 60 * 1000), []) || [];
        const before = samples.filter((sample) => sample && sample.at != null && sample.at <= downAtMs);
        if (!before.length) return null;
        const last = before[before.length - 1];
        const value = Number(last.rx != null ? last.rx : last.rxPower);
        return Number.isFinite(value) ? value : null;
    }

    /**
     * Ukur ulang tiap pelanggan terdampak dari snapshot OLT SEGAR.
     * @param {{oltKey:string, affected:Array<{mac?:string, slot?:any, onu?:any, name?:string, downAtMs?:number}>}} input
     * @returns {Promise<{rows:Array, summary:object, snapshotOk:boolean}>}
     */
    async function buildReport({ oltKey = "default", affected = [] } = {}) {
        const conf = getConfig();
        // FORCE REFRESH — laporan ini justru dibuat untuk melawan data basi; menyajikannya dari
        // cache akan mengulang persis kesalahan yang mau diperbaiki.
        const snapshot = await getOltSnapshot({ forceRefresh: true });
        const snapshotOk = !!(snapshot && snapshot.status === "success");
        // OLT yang TIDAK MENJAWAB pada snapshot ini. Pelanggan di baliknya bukan "perlu dicek",
        // melainkan "tak bisa kami lihat" — dua hal yang sangat berbeda bagi teknisi di lapangan.
        const oltGagal = ((snapshot && snapshot.failedOlts) || [])
            .map((o) => (o && (o.oltName || o.oltHost)) || null)
            .filter(Boolean);
        const onus = (snapshot && snapshot.onus) || [];
        const index = snapshotOk ? buildOnuIndex(onus, {}) : { oltByMac: {}, oltByPppoe: {}, oltBySerial: {} };

        const rows = await Promise.all(affected.map(async (item) => {
            const mac = item && item.mac ? String(item.mac) : null;
            const prefix = mac ? safe(() => normalizeMAC(mac), "").substring(0, 10) : "";
            const onu = prefix && prefix.length >= 10 ? index.oltByMac[prefix] || null : null;

            const base = {
                name: (item && item.name) || "(tidak teridentifikasi)",
                mac,
                slot: item && item.slot != null ? item.slot : (onu ? onu.slotId : null),
                onu: item && item.onu != null ? item.onu : (onu ? onu.id : null),
                downAtMs: (item && item.downAtMs) || null,
                rxPower: null,
                rxPowerValid: false,
                rxBefore: rxBefore(mac, item && item.downAtMs),
                status: null,
                verdict: "TIDAK_TERBACA",
            };

            // Snapshot gagal atau ONU tak ada di snapshot segar → JANGAN menebak. "Tidak bisa
            // mengamati" bukan "diamati baik", dan juga bukan "diamati mati".
            if (!snapshotOk || !onu) return base;

            // Nilai dari halaman DAFTAR bisa basi — ambil ulang dari halaman detail ONU ini.
            // Gagal? pakai nilai daftar (never-throw), jangan menggagalkan laporannya.
            let segar = null;
            try { segar = await bacaSegarPerOnu(onu); } catch (_e) { segar = null; }
            const onuSegar = segar && segar.rxPower != null ? { ...onu, rxPower: segar.rxPower } : onu;

            const status = onuSegar.status || null;
            const valid = isRxPowerValid(onuSegar, status);
            const rx = Number(parseFloat(onuSegar.rxPower));
            const row = {
                ...base,
                rxPower: Number.isFinite(rx) ? rx : null,
                rxPowerValid: valid,
                status,
            };

            if (onuSegar.statusKnown === false) return { ...row, verdict: "TIDAK_TERBACA" };
            if (status !== "Online") return { ...row, verdict: "MASIH_MATI" };
            if (!valid) return { ...row, verdict: "TIDAK_TERBACA" };

            const warn = numOr(conf.rxWarnDbm, DEFAULTS.rxWarnDbm);
            const degrade = numOr(conf.rxDegradeDb, DEFAULTS.rxDegradeDb);
            const memburuk = row.rxBefore != null && row.rxPower != null && row.rxBefore - row.rxPower >= degrade;
            if (row.rxPower <= warn || memburuk) return { ...row, verdict: "REDAMAN_MEMBURUK" };
            return { ...row, verdict: "PULIH" };
        }));

        const count = (verdict) => rows.filter((row) => row.verdict === verdict).length;
        return {
            rows,
            oltGagal,
            snapshotOk,
            summary: {
                oltKey,
                total: rows.length,
                pulih: count("PULIH"),
                memburuk: count("REDAMAN_MEMBURUK"),
                masihMati: count("MASIH_MATI"),
                takTerbaca: count("TIDAK_TERBACA"),
            },
        };
    }

    function fmtRx(value) {
        return value == null ? "-" : `${value.toFixed(2)} dBm`;
    }

    function fmtPort(row) {
        return row.slot != null || row.onu != null ? ` [${row.slot}/${row.onu}]` : "";
    }

    function line(row, index) {
        const port = fmtPort(row);
        if (row.verdict === "MASIH_MATI") {
            const terakhir = row.rxPower != null ? ` — terakhir ${fmtRx(row.rxPower)} sebelum putus` : "";
            return `${index + 1}. ${row.name}${port} — status ${row.status || "?"}${terakhir}`;
        }
        if (row.verdict === "TIDAK_TERBACA") {
            return `${index + 1}. ${row.name}${port} — tidak terbaca di OLT (perlu cek manual)`;
        }
        const banding = row.rxBefore != null ? ` (sebelum ${fmtRx(row.rxBefore)})` : "";
        return `${index + 1}. ${row.name}${port} — ${fmtRx(row.rxPower)}${banding}`;
    }

    function section(title, rows) {
        if (!rows.length) return "";
        return `\n\n${title}\n${rows.map(line).join("\n")}`;
    }

    function buildMessage(report, { oltKey = "default", waktu = null } = {}) {
        const s = report.summary;
        const jam = waktu || new Date(now()).toLocaleString("id-ID");
        const pick = (verdict) => report.rows.filter((row) => row.verdict === verdict);

        const kepala =
            `🧪 *VERIFIKASI PASCA-PERBAIKAN*\n` +
            `OLT: ${oltKey}\nWaktu ukur: ${jam} (pengukuran BARU, bukan data cache)\n\n` +
            `Terdampak: ${s.total} | Pulih: ${s.pulih} | Perlu perhatian: ${s.memburuk} | ` +
            `Masih mati: ${s.masihMati} | Tak terbaca: ${s.takTerbaca}`;

        const badan =
            section("✅ *PULIH*", pick("PULIH")) +
            section("⚠️ *PULIH TAPI REDAMAN PERLU DICEK*", pick("REDAMAN_MEMBURUK")) +
            section("🔴 *MASIH MATI*", pick("MASIH_MATI")) +
            section("❔ *TIDAK TERBACA DI OLT*", pick("TIDAK_TERBACA"));

        // OLT yang tak menjawab disebut TERANG-TERANGAN. Tanpa ini, pelanggan di baliknya
        // muncul sebagai "tidak terbaca — perlu cek manual" berikut tanda ⛔, seolah mereka
        // mungkin masih mati. Padahal yang terjadi: kita tidak bisa melihat. "Tidak bisa
        // mengamati" bukan "diamati bermasalah".
        const oltGagal = report.oltGagal || [];
        const butaOlt = oltGagal.length > 0;
        const catatanOlt = butaOlt
            // Nama perangkat sering sudah berawalan "OLT" — jangan jadi "OLT OLT Server".
            ? `\n\n⚠️ ${oltGagal.map((n) => (/^olt/i.test(n) ? n : `OLT ${n}`)).join(", ")} tidak menjawab saat diukur — pelanggan di baliknya TIDAK bisa dibuktikan dari sini. Ini bukan berarti mereka mati.`
            : "";

        const ekor =
            s.masihMati > 0
                ? `\n\n⛔ Jangan tutup pekerjaan dulu — masih ada ${s.masihMati + s.takTerbaca} pelanggan yang belum terbukti normal.`
                : s.takTerbaca > 0 && butaOlt
                    ? `\n\n❔ ${s.takTerbaca} pelanggan belum bisa diukur karena OLT-nya tak terjangkau — perlu dicek langsung, bukan lewat laporan ini.`
                    : s.takTerbaca > 0
                        ? `\n\n⛔ Jangan tutup pekerjaan dulu — masih ada ${s.takTerbaca} pelanggan yang belum terbukti normal.`
                        : s.total === 1
                            ? `\n\n✅ Pelanggan terbukti online kembali.`
                            : `\n\n✅ Semua pelanggan terdampak terbukti online kembali.`;

        const catatan = report.snapshotOk
            ? ""
            : `\n\n⚠️ Snapshot OLT gagal diambil — angka di atas TIDAK dapat dipakai. Ulangi verifikasi.`;

        return kepala + badan + catatanOlt + ekor + catatan;
    }

    async function deliver(text) {
        const conf = getConfig();
        const losCfg = getLosConfig() || {};
        const groupId = conf.groupId || losCfg.groupId || "";
        if (groupId) {
            const result = await postToGroup(groupId, text);
            if (result && result.sent) return { via: "group", sent: true };
        }
        // Tak ada grup terkonfigurasi → japri teknisi, supaya laporan tak menguap begitu saja.
        const recipients = safe(() => getTeknisiRecipients(), []) || [];
        let delivered = 0;
        for (const recipient of recipients) {
            try {
                const result = await sendCritical(recipient, { text }, { label: "post_repair_report" });
                if (result && result.delivered) delivered += 1;
            } catch (e) {
                logger.error && logger.error(`[POST-REPAIR] Gagal kirim ke ${recipient}:`, e && e.message);
            }
        }
        return { via: "teknisi", sent: delivered > 0, delivered, recipients: recipients.length };
    }

    /**
     * Ukur + kirim laporan sekarang juga (tanpa jeda). Dipakai test & pemanggil manual.
     */
    async function verifyAndReport({ oltKey = "default", affected = [] } = {}) {
        try {
            if (!affected.length) return { skipped: true, reason: "no_affected" };
            const report = await buildReport({ oltKey, affected });
            const text = buildMessage(report, { oltKey });
            const delivery = await deliver(text);
            logger.log &&
                logger.log(
                    `[POST-REPAIR] Laporan ${oltKey}: ${report.summary.pulih} pulih, ` +
                    `${report.summary.masihMati} masih mati, ${report.summary.takTerbaca} tak terbaca — ` +
                    `kirim via ${delivery.via}=${delivery.sent ? "ya" : "tidak"}.`
                );
            return { report, text, delivery };
        } catch (e) {
            logger.error && logger.error("[POST-REPAIR] verifyAndReport error:", e && e.message);
            return { error: e && e.message };
        }
    }

    /**
     * Hook dari LOS broadcaster setelah notif PULIH. Menjadwalkan verifikasi setelah jeda stabilisasi.
     * NEVER-THROW & fire-and-forget: alur pemulihan tidak boleh bergantung pada laporan ini.
     * @param {{oltKey:string, recovered:Array, stillDown:Array}} input
     */
    function reportAfterRecovery({ oltKey = "default", recovered = [], stillDown = [] } = {}) {
        try {
            const conf = getConfig();
            if (conf.enabled !== true) return { scheduled: false, reason: "disabled" };

            // Yang MASIH MATI wajib ikut — justru merekalah alasan laporan ini ada. Notif pulih
            // bawaan hanya menyebut yang sudah kembali online, sehingga sisa korban tak terlihat.
            const masuk = [...recovered, ...stillDown].filter(Boolean);
            if (!masuk.length) return { scheduled: false, reason: "no_affected" };

            // Sudah ada jadwal untuk OLT ini → cukup gabungkan. Satu snapshot untuk semuanya.
            const adaJadwal = tertunda.get(oltKey);
            if (adaJadwal) {
                for (const it of masuk) adaJadwal.affected.set(kunciTerdampak(it), it);
                return { scheduled: true, coalesced: true, affected: adaJadwal.affected.size };
            }

            const minAffected = numOr(conf.minAffected, DEFAULTS.minAffected);
            if (masuk.length < minAffected) return { scheduled: false, reason: "below_min_affected" };

            const entri = { affected: new Map(), timer: null };
            for (const it of masuk) entri.affected.set(kunciTerdampak(it), it);
            tertunda.set(oltKey, entri);

            const delay = numOr(conf.settleDelayMs, DEFAULTS.settleDelayMs);
            entri.timer = setTimer(() => {
                tertunda.delete(oltKey);   // dibuang SEBELUM kerja, supaya tak menggantung bila gagal
                return verifyAndReport({ oltKey, affected: [...entri.affected.values()] })
                    .catch(() => { /* never-throw */ });
            }, delay);
            if (entri.timer && typeof entri.timer.unref === "function") entri.timer.unref();
            logger.log &&
                logger.log(`[POST-REPAIR] Verifikasi ${oltKey} dijadwalkan ${Math.round(delay / 1000)}s lagi untuk ${entri.affected.size} pelanggan.`);
            return { scheduled: true, affected: entri.affected.size, delayMs: delay };
        } catch (e) {
            logger.error && logger.error("[POST-REPAIR] reportAfterRecovery error:", e && e.message);
            return { scheduled: false, reason: e && e.message };
        }
    }

    /** Identitas satu pelanggan terdampak — dipakai untuk menggabungkan tanpa duplikat. */
    function kunciTerdampak(it) {
        return [it && it.mac, it && it.slot, it && it.onu].map((v) => String(v == null ? "" : v)).join("|");
    }

    return { buildReport, buildMessage, verifyAndReport, reportAfterRecovery };
}

let _singleton = null;
function getPostRepairVerifier() {
    if (!_singleton) _singleton = createPostRepairVerifier();
    return _singleton;
}

module.exports = {
    createPostRepairVerifier,
    getPostRepairVerifier,
    reportAfterRecovery: (input) => getPostRepairVerifier().reportAfterRecovery(input),
    DEFAULTS,
};
