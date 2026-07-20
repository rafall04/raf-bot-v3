/**
 * OLT LOS Broadcaster
 *
 * Saat pelanggan terdeteksi LOS (Loss of Signal = kemungkinan FIBER PUTUS, bukan
 * Dying Gasp/power), otomatis broadcast WhatsApp ke teknisi. DG TIDAK memicu ini
 * (DG = power outage, tunggu PLN, bukan tugas teknisi).
 *
 * PRESISI (hindari salah-panggil teknisi):
 *   1. Confirmation window — LOS fiber tidak pulih sendiri. Tunggu N menit; kalau
 *      ONU pulih (Discovery) dalam window → BATAL (flap/kedip, bukan putus).
 *   2. Confidence threshold — hanya broadcast kalau classification_confidence cukup.
 *   3. Cluster aggregation — banyak LOS bersamaan → 1 pesan agregat (dugaan
 *      gangguan area/uplink), bukan spam per-pelanggan.
 *   4. Dedup + cooldown — 1 broadcast per insiden; cegah re-broadcast saat flapping.
 *   5. Verifikasi scrape + GERBANG MATI-LISTRIK-AREA — sebelum broadcast, buang LOS yang
 *      web-log OLT buktikan DG, ATAU yang di-kelilingi klaster dying-gasp tetangga se-OLT
 *      (mati listrik area; ONU-nya kebetulan gagal gasp). Anti salah-vonis "fiber putus".
 *
 * NOTIF PELANGGAN (opsional, notifyCustomer): setelah teknisi diberi tahu + jeda anti-kedip,
 * kabari pelanggan dengan teks RINGAN (tanpa klaim "fiber putus"). Saat pulih, kabari lagi
 * "sudah normal" — HANYA ke pelanggan yang tadi sempat dikabari.
 *
 * EFISIEN: event-driven (hook emitEvent syslog/scraper), satu timer per pending LOS.
 * ROBUST: kirim via sendCritical (retry + dead-letter), incident dicatat ke file
 * untuk halaman admin + audit. Timer in-memory (restart di tengah window jarang;
 * incident tetap tercatat untuk review manual).
 *
 * Murni-ish: semua I/O & dependency via injeksi (deps) untuk test deterministik.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { isInfrastructure } = require("./account-classification");

const INCIDENTS_FILE = path.join(__dirname, "..", "database", "los-incidents.json");
const MAX_INCIDENTS = 1000;
// Saat Map lastBroadcast melebihi ambang ini, sapu entri kedaluwarsa (anti memory-leak).
const LAST_BROADCAST_PRUNE_THRESHOLD = 500;

// Teks pelanggan sengaja RINGAN & TIDAK men-diagnosa ("fiber putus") dan TIDAK menjanjikan
// "teknisi menuju lokasi" — karena vonis LOS bisa meleset (mis. ONU gagal kirim dying-gasp
// saat mati listrik area). Cukup: "koneksi terganggu, tim kami cek, mohon tunggu".
const DEFAULT_CUSTOMER_TEMPLATE =
    "Halo Kak {customer_name} 👋\n\n" +
    "Kami lihat koneksi internet di lokasi Kakak lagi terganggu nih. Tim kami sudah dapat infonya dan langsung cek ya 🔧\n\n" +
    "Kakak santai aja, nggak perlu ngapa-ngapain 🙏 Nanti kami kabari lagi kalau sudah normal.\n\n" +
    "Makasih ya Kak 😊\n" +
    "— {company_name}";

// Pesan PULIH ke pelanggan (hanya dikirim ke pelanggan yang tadi sempat dikabari saat gangguan).
const DEFAULT_CUSTOMER_RECOVERY_TEMPLATE =
    "Halo Kak {customer_name} 😊 Koneksi internet di lokasi Kakak sudah kembali normal ya. " +
    "Terima kasih sudah menunggu 🙏 — {company_name}";

const DEFAULTS = {
    enabled: false,
    confidenceThreshold: 0.6,
    confirmationWindowMs: 3 * 60 * 1000, // 3 menit
    clusterFlushMs: 20 * 1000,           // kumpulkan LOS terkonfirmasi 20s sebelum kirim
    clusterThreshold: 3,                 // >= N LOS satu OLT = framing "gangguan area"
    // Notifikasi ke GRUP alarm OLT (grup khusus). Default OFF sampai admin pilih grup.
    notifyGroup: false,
    groupId: "",
    // Japri ke tiap teknisi (perilaku lama). Bisa dimatikan bila cukup pakai grup.
    notifyTeknisi: true,
    // Auto-buat TIKET teknisi dari LOS terkonfirmasi (di `lib/los-ticket-service`).
    // Default OFF (deploy gelap) — aktifkan dari halaman /los-broadcast.
    autoTicket: {
        enabled: false,
        assignTeknisi: "", // kosong = auto assign ke teknisi least-loaded
        priority: "HIGH",
    },
    // Verifikasi OTORITATIF LOS via scrape web log OLT sebelum broadcast (`lib/olt-los-verifier`).
    // Anti salah-vonis mati-listrik massal (DG drop di UDP → dikira LOS). Default ON; degrade
    // otomatis bila bot tak punya device web OLT terkonfigurasi (config.olt.devices).
    verifyViaScrape: {
        enabled: true,
        maxPages: 20,
        timeWindowMinutes: 15,
        // GERBANG MATI-LISTRIK-AREA: sebuah LOS yang di-kelilingi KLASTER dying-gasp tetangga
        // se-OLT (>= dgClusterThreshold ONU gasp dalam windowSeconds) = korban mati listrik area
        // (ONU-nya kebetulan GAGAL kirim dying-gasp), BUKAN fiber putus → disaring, tak di-broadcast.
        // Sinyal dihitung intra-log (jam OLT yg sama) jadi kebal drift jam. Fiber putus asli
        // TIDAK membuat tetangga gasp → aman (klaster ~0), tak akan tersaring.
        areaOutage: {
            enabled: true,
            dgClusterThreshold: 5,
            windowSeconds: 10,
        },
    },
    // Jeda ANTI-KEDIP (flapping), BUKAN pengulangan broadcast. 1 insiden = 1 broadcast.
    // Ini hanya mencegah modem yang turun-naik-turun cepat memicu alert berkali-kali.
    rebroadcastCooldownMs: 30 * 60 * 1000,
    // Notif PULIH: saat ONU yang sudah di-broadcast LOS kembali online (Discovery), kirim kabar
    // pulih ber-DURASI ke grup/teknisi yang sama — menutup alarm yang tergantung. Default OFF
    // (deploy gelap; aktifkan bareng notifyGroup dari /los-broadcast). Best-practice guard:
    //   - recoveryConfirmMs: debounce anti-flap — tunggu stabil sebelum vonis pulih (kalau LOS
    //     lagi dalam window ini → batal, dianggap masih down/kedip).
    //   - recoveryClusterFlushMs: batch pemulihan serentak → 1 pesan "area pulih" (mirror cluster).
    notifyRecovery: false,
    recoveryConfirmMs: 60 * 1000,
    recoveryClusterFlushMs: 20 * 1000,
    // Notifikasi pelanggan otomatis, dijadwalkan SETELAH teknisi diberi tahu.
    notifyCustomer: {
        enabled: false,
        delayMs: 10 * 60 * 1000,   // default 10 menit — timely tapi lewatkan kedip/mati-listrik singkat
        onlyIfStillDown: true,     // batal kalau modem sudah pulih sebelum jadwal
        messageTemplate: DEFAULT_CUSTOMER_TEMPLATE,
        // Kabari pelanggan saat koneksi PULIH — HANYA yang tadi sempat dikabari saat gangguan
        // (kalau tak pernah dikabari, jangan kabari pulih). Butuh notifyRecovery juga aktif.
        notifyOnRecovery: true,
        recoveryMessageTemplate: DEFAULT_CUSTOMER_RECOVERY_TEMPLATE,
    },
};

function defaultLoadIncidents() {
    try {
        if (fs.existsSync(INCIDENTS_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(INCIDENTS_FILE, "utf8"));
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (err) {
        console.error("[LOS-BROADCAST] Gagal baca incidents:", err.message);
    }
    return [];
}

function defaultSaveIncidents(list) {
    try {
        const trimmed = list.length > MAX_INCIDENTS ? list.slice(-MAX_INCIDENTS) : list;
        fs.writeFileSync(INCIDENTS_FILE, JSON.stringify(trimmed, null, 2), "utf8");
    } catch (err) {
        console.error("[LOS-BROADCAST] Gagal tulis incidents:", err.message);
    }
}

function defaultTeknisiRecipients() {
    return (global.accounts || [])
        .filter((acc) => acc && acc.role === "teknisi" && acc.phone_number)
        .map((acc) => String(acc.phone_number).split("|")[0].trim())
        .filter(Boolean);
}

// Post ke GRUP alarm OLT lewat delivery boundary (BUKAN Baileys mentah). Guarded + never-throw.
// Pola sama dengan lib/repair-group-notifier.postToRepairGroup.
async function defaultPostToGroup(groupId, text) {
    try {
        const { isReady } = require("./whatsapp-gateway");
        if (!isReady()) return { sent: false, reason: "wa_offline" };
        const { sendMessage } = require("./whatsapp-delivery-service");
        const result = await sendMessage(groupId, { text }, { skipDuplicateCheck: true });
        return { sent: !!(result && result.sent !== false) };
    } catch (e) {
        console.error("[LOS-BROADCAST] postToGroup error:", e && e.message);
        return { sent: false, reason: e && e.message };
    }
}

function normMac(m) {
    return String(m || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
}

/**
 * Resolver MAC→pelanggan default: best-effort & OFFLINE (tanpa panggilan jaringan).
 * Cocokkan MAC ONU dengan field MAC yang mungkin tersimpan di record pelanggan.
 * Kalau ISP tidak menyimpan MAC di user → return null (notif pelanggan akan di-skip).
 * Bisa diganti resolver lebih pintar via deps.resolveCustomer / resolveCustomerAsync.
 */
function defaultResolveCustomer(mac) {
    const target = normMac(mac);
    if (!target) return null;
    const users = global.users || [];
    for (const u of users) {
        const candidates = [u.mac, u.mac_address, u.macAddress, u.caller_id, u.callerId, u.device_mac, u.onu_mac];
        for (const f of candidates) {
            if (f && normMac(f) === target) return u;
        }
    }
    return null;
}

function createLosBroadcaster(deps = {}) {
    const getConfig = deps.getConfig || (() => (global.config && global.config.oltLosBroadcast) || {});
    const getTeknisiRecipients = deps.getTeknisiRecipients || defaultTeknisiRecipients;
    const postToGroup = deps.postToGroup || defaultPostToGroup;
    const sendCritical = deps.sendCritical || require("./whatsapp-critical-delivery").sendCritical;
    const resolveCustomer = deps.resolveCustomer || defaultResolveCustomer;          // sync, best-effort (teknisi msg)
    const resolveCustomerAsync = deps.resolveCustomerAsync || (async (mac) => resolveCustomer(mac)); // async, untuk notif pelanggan
    const now = deps.now || (() => Date.now());
    const setTimer = deps.setTimeoutFn || setTimeout;
    const clearTimer = deps.clearTimeoutFn || clearTimeout;
    const loadIncidents = deps.loadIncidents || defaultLoadIncidents;
    const saveIncidents = deps.saveIncidents || defaultSaveIncidents;
    const logger = deps.logger || console;
    // Verifikasi otoritatif LOS↔DG via scrape web log OLT (injectable untuk test deterministik).
    const verifyLosBatch = deps.verifyLosBatch || ((macs) => require("./olt-los-verifier").verifyLosBatch(macs));

    const pending = new Map();       // mac -> { incidentId, mac, slot, onu, oltId, customer, timer, detectedAt }
    const lastBroadcast = new Map(); // mac -> ts terakhir broadcast (anti-flapping)
    const activeIncidents = new Map(); // mac -> { incidentId, customer, slot, onu, oltId, customerTimer } (sudah broadcast, belum pulih)
    const recovering = new Map();    // mac -> { active, timer } pulih dalam debounce (anti-flap) sebelum notif
    let readyQueue = [];             // LOS terkonfirmasi menunggu flush cluster
    let flushTimer = null;
    let recoveryReadyQueue = [];     // pemulihan terkonfirmasi menunggu flush cluster
    let recoveryFlushTimer = null;

    function cfg() {
        return { ...DEFAULTS, ...(getConfig() || {}) };
    }

    function genId() {
        return `los_${now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function buildIncident(event) {
        let customer = null;
        // Brand GPON (ZTE) tidak punya MAC: poller-nya resolve pelanggan sendiri
        // (by username PPPoE) dan kirim event.customer pre-resolved. Utamakan itu;
        // fallback resolveCustomer(mac) untuk EPON (HIOSO via syslog/scraper).
        if (event.customer) {
            customer = event.customer;
        } else {
            try {
                customer = resolveCustomer(event.mac) || null;
            } catch (e) {
                logger.error && logger.error("[LOS-BROADCAST] resolveCustomer error:", e.message);
            }
        }
        return {
            incidentId: genId(),
            mac: event.mac,
            slot: event.slot != null ? String(event.slot) : null,
            onu: event.onu != null ? String(event.onu) : null,
            oltId: event.olt_id || event.received_from || null,
            confidence: typeof event.classification_confidence === "number" ? event.classification_confidence : null,
            customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone_number, address: customer.address || customer.alamat || null, account_type: customer.account_type || "pelanggan" } : null,
            detectedAt: new Date(now()).toISOString(),
        };
    }

    function recordIncident(incident, status) {
        const list = loadIncidents();
        list.push({ ...incident, status, createdAt: new Date(now()).toISOString() });
        saveIncidents(list);
    }

    function updateIncident(incidentId, patch) {
        const list = loadIncidents();
        const idx = list.findIndex((i) => i.incidentId === incidentId);
        if (idx >= 0) {
            list[idx] = { ...list[idx], ...patch, updatedAt: new Date(now()).toISOString() };
            saveIncidents(list);
        }
    }

    /**
     * Entry point — dipanggil dari syslog receiver / scraper untuk SETIAP event OLT.
     */
    function handleOltEvent(event) {
        const conf = cfg();
        if (!conf.enabled || !event || !event.mac) return;

        if (event.event_type === "discovery") {
            // Modem pulih: batalkan pending (sebelum broadcast) DAN notif pelanggan
            // terjadwal (setelah broadcast).
            cancelPending(event.mac, "recovered_before_broadcast");
            cancelActiveIncident(event.mac);
            return;
        }
        if (event.event_type !== "los") return;

        // ONU turun LAGI selama debounce pemulihan → batal notif pulih (kedip, masih down).
        // Kembalikan ke insiden aktif yang SAMA (bukan insiden baru) — tak ada spam pulih↔mati.
        if (recovering.has(event.mac)) {
            const r = recovering.get(event.mac);
            clearTimer(r.timer);
            recovering.delete(event.mac);
            activeIncidents.set(event.mac, r.active);
            updateIncident(r.active.incidentId, { recoveredAt: null, recoveryFlappedAt: new Date(now()).toISOString() });
            logger.log && logger.log(`[LOS-BROADCAST] ${event.mac} turun lagi saat debounce pulih — notif pulih dibatalkan (kedip).`);
            return;
        }

        // 2. Confidence gate.
        const confidence = typeof event.classification_confidence === "number" ? event.classification_confidence : 1;
        if (confidence < conf.confidenceThreshold) {
            recordIncident(buildIncident(event), "low_confidence");
            logger.log && logger.log(`[LOS-BROADCAST] LOS confidence rendah (${confidence}) untuk ${event.mac} — tidak auto-broadcast.`);
            return;
        }

        // 4. Dedup + anti-flapping. Sapu entri lama dulu supaya Map tidak bocor.
        pruneLastBroadcast(conf.rebroadcastCooldownMs);
        if (pending.has(event.mac)) return;          // insiden ini sudah dalam proses
        if (activeIncidents.has(event.mac)) return;  // sudah di-broadcast & belum pulih → 1x cukup
        const last = lastBroadcast.get(event.mac);
        if (last && (now() - last) < conf.rebroadcastCooldownMs) return; // anti-kedip

        // 1. Confirmation window — tunggu, batal kalau pulih.
        const incident = buildIncident(event);
        recordIncident(incident, "pending");
        const timer = setTimer(() => onConfirm(event.mac), conf.confirmationWindowMs);
        if (timer && typeof timer.unref === "function") timer.unref();
        pending.set(event.mac, { ...incident, timer });
        logger.log && logger.log(`[LOS-BROADCAST] LOS ${event.mac} pending konfirmasi ${Math.round(conf.confirmationWindowMs / 1000)}s.`);
    }

    function cancelPending(mac, status) {
        const p = pending.get(mac);
        if (!p) return;
        clearTimer(p.timer);
        pending.delete(mac);
        updateIncident(p.incidentId, { status, resolvedAt: new Date(now()).toISOString() });
        logger.log && logger.log(`[LOS-BROADCAST] LOS ${mac} dibatalkan (${status}).`);
    }

    // Modem yang sudah di-broadcast ke teknisi kini PULIH (discovery). Batalkan
    // notif pelanggan yang terjadwal (kecuali onlyIfStillDown=false) & lepas dari
    // daftar insiden aktif → MAC bisa memicu insiden baru di masa depan.
    function cancelActiveIncident(mac) {
        const a = activeIncidents.get(mac);
        if (!a) {
            // Restart-robust: insiden mungkin di-broadcast SEBELUM bot restart (state in-memory
            // hilang). Rekonstruksi dari file incidents supaya notif pulih tetap terkirim.
            scheduleRecoveryFromFile(mac);
            return;
        }
        // ONU pulih → batalkan tiket LOS otomatis bila belum ditangani teknisi (never-throw).
        if (a.ticketId) {
            try { require("./los-ticket-service").maybeCancelLosTicket(a.ticketId); } catch (_e) { /* never-throw */ }
        }
        const ncfg = cfg().notifyCustomer || {};
        if (ncfg.onlyIfStillDown !== false) {
            if (a.customerTimer) clearTimer(a.customerTimer);
            activeIncidents.delete(mac);
            updateIncident(a.incidentId, {
                customerNotifyStatus: a.customerNotified ? "sent" : "cancelled_recovered",
                recoveredAt: new Date(now()).toISOString(),
            });
            logger.log && logger.log(`[LOS-BROADCAST] Modem ${mac} pulih setelah broadcast — notif pelanggan ${a.customerNotified ? "sudah terkirim" : "dibatalkan"}.`);
        } else {
            a.recovered = true;
            updateIncident(a.incidentId, { recoveredAt: new Date(now()).toISOString() });
        }
        // Jadwalkan notif PULIH ke grup/teknisi (debounce anti-flap). Never-throw.
        scheduleRecovery(a);
    }

    // Debounce pemulihan: tahan notif pulih selama recoveryConfirmMs; kalau ONU LOS lagi dalam
    // window itu (handleOltEvent) → dibatalkan. Setelah stabil → masuk antrean flush cluster.
    function scheduleRecovery(active) {
        const conf = cfg();
        if (!conf.notifyRecovery) return;
        if (!active || !active.incidentId) return;
        if (recovering.has(active.mac)) return; // sudah dijadwalkan
        const rec = { active, recoverAtMs: now() };
        const timer = setTimer(() => {
            recovering.delete(active.mac);
            recoveryReadyQueue.push(rec);
            if (!recoveryFlushTimer) {
                recoveryFlushTimer = setTimer(recoveryFlush, cfg().recoveryClusterFlushMs);
                if (recoveryFlushTimer && typeof recoveryFlushTimer.unref === "function") recoveryFlushTimer.unref();
            }
        }, conf.recoveryConfirmMs);
        if (timer && typeof timer.unref === "function") timer.unref();
        rec.timer = timer;
        recovering.set(active.mac, rec);
        logger.log && logger.log(`[LOS-BROADCAST] ${active.mac} terpantau pulih — debounce ${Math.round(conf.recoveryConfirmMs / 1000)}s sebelum kabari grup.`);
    }

    // Rekonstruksi active dari file (pasca-restart) lalu jadwalkan notif pulih. Hanya insiden yang
    // BENAR sudah di-broadcast & belum pernah di-notif pulih (anti-dobel).
    function scheduleRecoveryFromFile(mac) {
        if (!cfg().notifyRecovery) return;
        if (recovering.has(mac)) return;
        try {
            const list = loadIncidents();
            const inc = [...list].reverse().find(
                (i) => i && i.mac === mac && i.status === "broadcasted" && !i.recoveredNotifiedAt && !i.recoveredAt
            );
            if (!inc) return;
            const active = {
                incidentId: inc.incidentId, mac, slot: inc.slot, onu: inc.onu, oltId: inc.oltId,
                customer: inc.customer || null,
                // Pasca-restart: pertahankan apakah pelanggan sudah dikabari saat gangguan supaya
                // notif PULIH ke pelanggan hanya untuk yang memang sempat dikabari.
                customerNotified: inc.customerNotifyStatus === "sent",
                downAtMs: Date.parse(inc.broadcastedAt || inc.detectedAt) || null,
            };
            updateIncident(inc.incidentId, { recoveredAt: new Date(now()).toISOString() });
            scheduleRecovery(active);
        } catch (e) {
            logger.error && logger.error("[LOS-BROADCAST] scheduleRecoveryFromFile error:", e && e.message);
        }
    }

    function fmtDuration(ms) {
        if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
        const menit = Math.max(1, Math.round(ms / 60000));
        if (menit < 60) return `${menit} menit`;
        return `${Math.floor(menit / 60)} jam ${menit % 60} menit`;
    }

    function jamWib(ms) {
        try { return new Date(ms).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }); } catch (_e) { return "-"; }
    }

    function recoveryLine(rec, index) {
        const a = rec.active;
        const cust = a.customer ? a.customer.name : "(tidak teridentifikasi)";
        const dur = a.downAtMs ? fmtDuration(now() - a.downAtMs) : null;
        const port = a.slot != null || a.onu != null ? ` [slot ${a.slot}/onu ${a.onu}]` : "";
        return `${index + 1}. ${cust}${port}${dur ? ` — putus ±${dur}` : ""}`;
    }

    function buildRecoveryMessage(recs, isArea, oltKey) {
        const waktu = new Date(now()).toLocaleString("id-ID");
        if (isArea) {
            const lines = recs.map(recoveryLine).join("\n");
            return `🟢 *PEMULIHAN AREA* — ${recs.length} ONU kembali online\nOLT: ${oltKey}\nWaktu: ${waktu}\n\n${lines}\n\n✅ Gangguan area/uplink tampaknya sudah teratasi.`;
        }
        const rec = recs[0];
        const a = rec.active;
        const cust = a.customer ? a.customer.name : "(tidak teridentifikasi)";
        const addr = a.customer && a.customer.address ? `\nAlamat: ${a.customer.address}` : "";
        const port = a.slot != null || a.onu != null ? `\nPort: slot ${a.slot}/onu ${a.onu}` : "";
        const dur = a.downAtMs ? fmtDuration(now() - a.downAtMs) : null;
        const rentang = a.downAtMs ? `\nDurasi putus: ±${dur} (${jamWib(a.downAtMs)} → ${jamWib(now())})` : "";
        return `🟢 *LOS PULIH* — koneksi kembali normal\n\nPelanggan: ${cust}${addr}${port}\nMAC: ${a.mac}${rentang}\nWaktu: ${waktu}\n\n✅ ONU sudah online lagi (sinyal optik kembali).`;
    }

    async function sendRecovery(oltKey, recs) {
        const conf = cfg();
        const isArea = recs.length >= conf.clusterThreshold;
        const message = buildRecoveryMessage(recs, isArea, oltKey);

        let groupSent = false;
        if (conf.notifyGroup && conf.groupId) {
            try {
                const gr = await postToGroup(conf.groupId, message);
                groupSent = !!(gr && gr.sent);
            } catch (err) {
                logger.error && logger.error("[LOS-BROADCAST] Gagal post pulih ke grup:", err.message);
            }
        }
        const recipients = conf.notifyTeknisi !== false ? (getTeknisiRecipients() || []) : [];
        let delivered = 0;
        for (const recipient of recipients) {
            try {
                const r = await sendCritical(recipient, { text: message }, { label: "los_recovery" });
                if (r && r.delivered) delivered += 1;
            } catch (err) {
                logger.error && logger.error(`[LOS-BROADCAST] Gagal kirim pulih ke ${recipient}:`, err.message);
            }
        }
        // Notif PULIH ke PELANGGAN — HANYA yang tadi sempat dikabari saat gangguan (kalau tak
        // pernah dikabari, jangan kabari pulih). Skip akun infrastruktur. NEVER-THROW.
        const ncfg = conf.notifyCustomer || {};
        if (ncfg.enabled && ncfg.notifyOnRecovery !== false) {
            for (const rec of recs) {
                try {
                    const a = rec.active;
                    if (!a || !a.customerNotified) continue;
                    if (a.customer && isInfrastructure(a.customer)) continue;
                    const phone = a.customer && a.customer.phone;
                    if (!phone) continue;
                    const custMsg = buildCustomerRecoveryMessage(a.customer, a, ncfg);
                    const phones = String(phone).split("|").map((p) => p.trim()).filter(Boolean);
                    let custDelivered = 0;
                    for (const ph of phones) {
                        const r = await sendCritical(ph, { text: custMsg }, { label: "los_customer_recovery" });
                        if (r && r.delivered) custDelivered += 1;
                    }
                    updateIncident(a.incidentId, {
                        customerRecoveryNotifyStatus: custDelivered > 0 ? "sent" : "queued",
                        customerRecoveryNotifiedAt: new Date(now()).toISOString(),
                    });
                    logger.log && logger.log(`[LOS-BROADCAST] Notif PULIH pelanggan ${a.mac}: ${custDelivered}/${phones.length} terkirim.`);
                } catch (e) {
                    logger.error && logger.error("[LOS-BROADCAST] Notif pulih pelanggan gagal:", e && e.message);
                }
            }
        }

        for (const rec of recs) {
            updateIncident(rec.active.incidentId, {
                recoveredNotifiedAt: new Date(now()).toISOString(),
                recoveryGroupNotified: groupSent,
                recoveryDeliveredCount: delivered,
                downtimeMs: rec.active.downAtMs ? now() - rec.active.downAtMs : null,
            });
        }
        logger.log && logger.log(`[LOS-BROADCAST] Notif PULIH ${recs.length} ONU (area=${isArea}) — grup=${groupSent ? "ya" : "tidak"}, japri ${delivered}/${recipients.length}.`);
    }

    async function recoveryFlush() {
        recoveryFlushTimer = null;
        const batch = recoveryReadyQueue;
        recoveryReadyQueue = [];
        if (!batch.length) return;
        const groups = new Map();
        for (const rec of batch) {
            const key = (rec.active && rec.active.oltId) || "default";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(rec);
        }
        for (const [oltKey, recs] of groups) {
            try {
                await sendRecovery(oltKey, recs);
            } catch (err) {
                logger.error && logger.error("[LOS-BROADCAST] sendRecovery error:", err.message);
            }
        }
    }

    // Cegah memory-leak: Map lastBroadcast hanya dipakai untuk anti-flapping; entri
    // yang sudah lewat cooldown tidak berguna lagi. Sapu saat Map membengkak.
    function pruneLastBroadcast(cooldownMs) {
        if (lastBroadcast.size <= LAST_BROADCAST_PRUNE_THRESHOLD) return;
        const cutoff = now() - (cooldownMs || DEFAULTS.rebroadcastCooldownMs);
        for (const [mac, ts] of lastBroadcast) {
            if (ts < cutoff) lastBroadcast.delete(mac);
        }
    }

    function buildCustomerMessage(customer, incident, ncfg) {
        const tpl = (ncfg.messageTemplate && String(ncfg.messageTemplate).trim())
            ? ncfg.messageTemplate
            : DEFAULT_CUSTOMER_TEMPLATE;
        const portStr = incident.slot != null ? `slot ${incident.slot}/onu ${incident.onu}` : (incident.mac || "-");
        return String(tpl)
            .replace(/\{customer_name\}/g, customer.name || "Pelanggan")
            .replace(/\{address\}/g, customer.address || "-")
            .replace(/\{mac\}/g, incident.mac || portStr)
            .replace(/\{slot\}/g, incident.slot != null ? String(incident.slot) : "-")
            .replace(/\{onu\}/g, incident.onu != null ? String(incident.onu) : "-")
            .replace(/\{company_name\}/g, (global.config && global.config.companyName) || "");
    }

    // Pesan PULIH ke pelanggan (dipakai di sendRecovery). Slot: {customer_name} {address}
    // {duration} {company_name}. Durasi dihitung dari downAtMs insiden.
    function buildCustomerRecoveryMessage(customer, active, ncfg) {
        const tpl = (ncfg.recoveryMessageTemplate && String(ncfg.recoveryMessageTemplate).trim())
            ? ncfg.recoveryMessageTemplate
            : DEFAULT_CUSTOMER_RECOVERY_TEMPLATE;
        const dur = active && active.downAtMs ? fmtDuration(now() - active.downAtMs) : null;
        return String(tpl)
            .replace(/\{customer_name\}/g, (customer && customer.name) || "Pelanggan")
            .replace(/\{address\}/g, (customer && customer.address) || "-")
            .replace(/\{duration\}/g, dur || "-")
            .replace(/\{company_name\}/g, (global.config && global.config.companyName) || "");
    }

    // Dijadwalkan delayMs SETELAH teknisi diberi tahu. Kirim hanya bila modem masih
    // down (entri masih ada di activeIncidents — recovery menghapusnya bila onlyIfStillDown).
    async function onCustomerNotify(mac) {
        const a = activeIncidents.get(mac);
        if (!a) return; // sudah pulih / dibatalkan
        a.customerTimer = null;
        const ncfg = cfg().notifyCustomer || {};

        let customer = a.customer;
        let customerIsInfra = a.customer ? isInfrastructure(a.customer) : false;
        if (!customer || !customer.phone) {
            try {
                const c = await resolveCustomerAsync(mac);
                if (c) {
                    customer = { id: c.id, name: c.name, phone: c.phone_number, address: c.address || c.alamat || null, account_type: c.account_type || "pelanggan" };
                    customerIsInfra = isInfrastructure(c);
                }
            } catch (e) {
                logger.error && logger.error("[LOS-BROADCAST] resolveCustomerAsync error:", e.message);
            }
        }

        // Akun infrastruktur (mis. modem CCTV/monitoring) bukan pelanggan bayar — JANGAN kirim
        // notif "internet putus" ke nomornya. Teknisi sudah diberi tahu lewat broadcast LOS utama.
        if (customerIsInfra) {
            updateIncident(a.incidentId, { customerNotifyStatus: "skipped_infrastructure" });
            logger.log && logger.log(`[LOS-BROADCAST] Notif pelanggan ${mac} dilewati — akun infrastruktur (CCTV/monitoring).`);
            return;
        }

        if (!customer || !customer.phone) {
            updateIncident(a.incidentId, { customerNotifyStatus: "customer_unresolved" });
            logger.warn && logger.warn(`[LOS-BROADCAST] Notif pelanggan ${mac}: pelanggan tak teridentifikasi — dilewati (admin bisa info manual).`);
            return;
        }

        const message = buildCustomerMessage(customer, a, ncfg);
        const phones = String(customer.phone).split("|").map((p) => p.trim()).filter(Boolean);
        let delivered = 0;
        for (const ph of phones) {
            try {
                const r = await sendCritical(ph, { text: message }, { label: "los_customer_notify", waitForReadyMs: 8000 });
                if (r && r.delivered) delivered += 1;
            } catch (e) {
                logger.error && logger.error(`[LOS-BROADCAST] Gagal kirim notif pelanggan ${mac}:`, e.message);
            }
        }
        a.customerNotified = true;
        updateIncident(a.incidentId, {
            customerNotifyStatus: delivered > 0 ? "sent" : "queued",
            customerNotifiedAt: new Date(now()).toISOString(),
            customerName: customer.name,
        });
        logger.log && logger.log(`[LOS-BROADCAST] Notif pelanggan ${customer.name} (${mac}): ${delivered}/${phones.length} terkirim.`);
    }

    function onConfirm(mac) {
        const p = pending.get(mac);
        if (!p) return; // sudah di-cancel (pulih)
        pending.delete(mac);
        readyQueue.push(p);
        if (!flushTimer) {
            flushTimer = setTimer(flush, cfg().clusterFlushMs);
            if (flushTimer && typeof flushTimer.unref === "function") flushTimer.unref();
        }
    }

    async function flush() {
        flushTimer = null;
        const batch = readyQueue;
        readyQueue = [];
        if (!batch.length) return;

        // 3. Group by OLT untuk agregasi cluster.
        const groups = new Map();
        for (const item of batch) {
            const key = item.oltId || "default";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        }
        for (const [oltKey, items] of groups) {
            try {
                await broadcastGroup(oltKey, items);
            } catch (err) {
                logger.error && logger.error("[LOS-BROADCAST] broadcastGroup error:", err.message);
            }
        }
    }

    function formatIncidentLine(it, index) {
        const infraTag = it.customer && isInfrastructure(it.customer) ? " [INFRA/CCTV]" : "";
        const cust = it.customer ? `${it.customer.name}${infraTag}${it.customer.address ? " — " + it.customer.address : ""}` : "(pelanggan tidak teridentifikasi)";
        const port = it.slot != null || it.onu != null ? ` [slot ${it.slot}/onu ${it.onu}]` : "";
        return `${index + 1}. ${cust}\n   MAC: ${it.mac}${port}`;
    }

    function buildMessage(items, isAreaOutage, oltKey) {
        const waktu = new Date(now()).toLocaleString("id-ID");
        if (isAreaOutage) {
            const lines = items.map(formatIncidentLine).join("\n");
            return `🚨 *DUGAAN GANGGUAN AREA / UPLINK*\n\n*${items.length} ONU LOS bersamaan* (kemungkinan fiber backbone / OLT, bukan 1 drop cable).\nOLT: ${oltKey}\nWaktu: ${waktu}\n\n${lines}\n\n⚠️ Mohon cek jalur fiber utama / OLT.`;
        }
        if (items.length === 1) {
            const it = items[0];
            const infraTag = it.customer && isInfrastructure(it.customer) ? " [INFRA/CCTV]" : "";
            const cust = it.customer ? `${it.customer.name}${infraTag}` : "(tidak teridentifikasi)";
            const addr = it.customer && it.customer.address ? `\nAlamat: ${it.customer.address}` : "";
            const phone = it.customer && it.customer.phone ? `\nNo. HP: ${it.customer.phone}` : "";
            const port = it.slot != null || it.onu != null ? `\nPort: slot ${it.slot}/onu ${it.onu}` : "";
            return `🔴 *LOS TERDETEKSI* (kemungkinan FIBER PUTUS)\n\nPelanggan: ${cust}${addr}${phone}\nMAC: ${it.mac}${port}\nWaktu: ${waktu}\n\n💡 LOS = sinyal optik hilang (bukan mati listrik). Mohon cek jalur fiber pelanggan.`;
        }
        const lines = items.map(formatIncidentLine).join("\n");
        return `🔴 *${items.length} LOS TERDETEKSI* (kemungkinan fiber putus)\nOLT: ${oltKey}\nWaktu: ${waktu}\n\n${lines}\n\n💡 Mohon cek jalur fiber pelanggan terkait.`;
    }

    async function broadcastGroup(oltKey, items) {
        const conf = cfg();

        // VERIFIKASI OTORITATIF (anti salah-vonis mati-listrik massal): sebelum broadcast,
        // cross-check tiap LOS ke WEB LOG OLT — yang menyimpan `dying-gasp`+`Lost` permanen,
        // KEBAL packet-loss UDP syslog. HANYA buang yang web-log buktikan DG; selain itu
        // (los / scrape gagal / tak ketemu) → lanjut (fallback aman). NEVER-THROW.
        let verdicts = null;
        try {
            verdicts = await verifyLosBatch(items.map((it) => it.mac));
            const dropped = items.filter((it) => verdicts.get(it.mac) === "dying-gasp");
            if (dropped.length) {
                for (const it of dropped) {
                    updateIncident(it.incidentId, {
                        status: "suppressed_dg_scrape",
                        resolvedAt: new Date(now()).toISOString(),
                    });
                }
                items = items.filter((it) => verdicts.get(it.mac) !== "dying-gasp");
                logger.log && logger.log(`[LOS-BROADCAST] ${dropped.length} LOS ternyata DG (mati listrik) via scrape web log → disaring, tidak di-broadcast.`);
            }
        } catch (err) {
            logger.error && logger.error("[LOS-BROADCAST] Verifikasi scrape error (lanjut tanpa saring):", err && err.message);
        }

        // GERBANG MATI-LISTRIK-AREA: LOS yang di-kelilingi KLASTER dying-gasp tetangga se-OLT
        // serentak = korban mati listrik area (ONU-nya kebetulan GAGAL kirim dying-gasp), BUKAN
        // fiber putus. Buang — jangan broadcast/tiket/notif pelanggan. Sinyal dari verifier
        // (`areaDgClusterByMac`, dihitung intra-log = kebal drift jam OLT). Fail-open: tanpa
        // sinyal → tak menyaring (fiber putus asli tak bikin tetangga gasp → klaster ~0 → aman).
        try {
            const areaCfg = { ...DEFAULTS.verifyViaScrape.areaOutage, ...((conf.verifyViaScrape && conf.verifyViaScrape.areaOutage) || {}) };
            const clusterMap = verdicts && verdicts.areaDgClusterByMac;
            if (areaCfg.enabled !== false && clusterMap && clusterMap.size) {
                const threshold = Number(areaCfg.dgClusterThreshold) || DEFAULTS.verifyViaScrape.areaOutage.dgClusterThreshold;
                const powerDropped = items.filter((it) => (clusterMap.get(it.mac) || 0) >= threshold);
                if (powerDropped.length) {
                    const droppedMacs = new Set(powerDropped.map((it) => it.mac));
                    for (const it of powerDropped) {
                        updateIncident(it.incidentId, {
                            status: "suppressed_area_dg",
                            areaDgCluster: clusterMap.get(it.mac) || 0,
                            resolvedAt: new Date(now()).toISOString(),
                        });
                    }
                    items = items.filter((it) => !droppedMacs.has(it.mac));
                    logger.log && logger.log(`[LOS-BROADCAST] ${powerDropped.length} LOS ternyata kolateral MATI LISTRIK AREA (klaster dying-gasp tetangga) → disaring, tidak di-broadcast.`);
                }
            }
        } catch (err) {
            logger.error && logger.error("[LOS-BROADCAST] Gerbang mati-listrik-area error (lanjut):", err && err.message);
        }

        if (!items.length) return; // semua ternyata DG / mati-listrik area → tak ada yang di-broadcast

        const isAreaOutage = items.length >= conf.clusterThreshold;
        const message = buildMessage(items, isAreaOutage, oltKey);

        // 1) Post ke GRUP alarm OLT (grup khusus) — independen dari japri teknisi.
        let groupSent = false;
        if (conf.notifyGroup && conf.groupId) {
            try {
                const gr = await postToGroup(conf.groupId, message);
                groupSent = !!(gr && gr.sent);
            } catch (err) {
                logger.error && logger.error("[LOS-BROADCAST] Gagal post ke grup:", err.message);
            }
        }

        // 2) Japri tiap teknisi (default ON; bisa dimatikan kalau cukup pakai grup).
        const notifyTeknisi = conf.notifyTeknisi !== false;
        const recipients = notifyTeknisi ? (getTeknisiRecipients() || []) : [];
        let delivered = 0;
        for (const recipient of recipients) {
            try {
                const r = await sendCritical(recipient, { text: message }, { label: "los_broadcast" });
                if (r && r.delivered) delivered += 1;
            } catch (err) {
                logger.error && logger.error(`[LOS-BROADCAST] Gagal kirim ke ${recipient}:`, err.message);
            }
        }

        // Tak ada jalur sama sekali (grup mati & tak ada teknisi) → tandai & selesai.
        if (!groupSent && recipients.length === 0) {
            logger.warn && logger.warn("[LOS-BROADCAST] Tak ada jalur (grup mati & tak ada teknisi) — broadcast dilewati.");
            for (const it of items) updateIncident(it.incidentId, { status: "no_recipients" });
            return;
        }

        const ts = now();
        const ncfg = conf.notifyCustomer || {};
        for (const it of items) {
            lastBroadcast.set(it.mac, ts);
            updateIncident(it.incidentId, {
                status: "broadcasted",
                broadcastedAt: new Date(ts).toISOString(),
                areaOutage: isAreaOutage,
                groupNotified: groupSent,
                recipientsCount: recipients.length,
                deliveredCount: delivered,
            });

            // Lacak insiden aktif (sampai pulih) → jamin 1 broadcast per insiden +
            // jadi anchor untuk notif pelanggan terjadwal.
            const active = {
                incidentId: it.incidentId,
                mac: it.mac,
                slot: it.slot,
                onu: it.onu,
                oltId: it.oltId,
                customer: it.customer,
                customerTimer: null,
                customerNotified: false,
                detectedAt: it.detectedAt || null,
                downAtMs: ts, // waktu broadcast = acuan durasi putus untuk notif pulih
            };
            activeIncidents.set(it.mac, active);

            // Auto-buat tiket dari LOS terkonfirmasi (opsional, never-throw). Simpan ticketId
            // di active agar bisa auto-batal bila ONU pulih sebelum ditangani.
            // GERBANG GANGGUAN-AREA: bila >= clusterThreshold LOS serentak (dugaan area/backbone,
            // atau sisa mati-listrik yang lolos verify), JANGAN buat tiket per-ONU — cukup 1 alarm
            // grup. Cegah banjir tiket & salah-kirim teknisi saat kejadian massal.
            if (!isAreaOutage) {
                try {
                    const losTid = require("./los-ticket-service").maybeCreateLosTicket(it);
                    if (losTid) active.ticketId = losTid;
                } catch (_e) { /* never-throw */ }
            }

            // Jadwalkan notif pelanggan (kalau diaktifkan) — default 1 jam kemudian.
            if (ncfg.enabled) {
                const delayMs = Number.isFinite(ncfg.delayMs) ? ncfg.delayMs : DEFAULTS.notifyCustomer.delayMs;
                const t = setTimer(() => onCustomerNotify(it.mac), delayMs);
                if (t && typeof t.unref === "function") t.unref();
                active.customerTimer = t;
                updateIncident(it.incidentId, {
                    customerNotifyStatus: "scheduled",
                    customerNotifyAt: new Date(ts + delayMs).toISOString(),
                });
            }
        }
        logger.log && logger.log(`[LOS-BROADCAST] Broadcast ${items.length} LOS (area=${isAreaOutage}) — grup=${groupSent ? "ya" : "tidak"}, japri ${delivered}/${recipients.length} teknisi.`);
    }

    return {
        handleOltEvent,
        // Diekspos untuk halaman/route + test.
        listIncidents: () => loadIncidents(),
        _state: () => ({
            pendingCount: pending.size,
            pendingMacs: [...pending.keys()],
            readyQueue: readyQueue.length,
            activeIncidentCount: activeIncidents.size,
            activeIncidentMacs: [...activeIncidents.keys()],
            recoveringCount: recovering.size,
            recoveringMacs: [...recovering.keys()],
            recoveryReadyQueue: recoveryReadyQueue.length,
            lastBroadcastTracked: lastBroadcast.size,
        }),
        _flush: flush,
        _recoveryFlush: recoveryFlush,
        _onCustomerNotify: onCustomerNotify,
    };
}

// Singleton default (dipakai runtime). Test pakai createLosBroadcaster(deps).
let _singleton = null;
function getLosBroadcaster() {
    if (!_singleton) {
        // Resolver runtime: utamakan mapping last-caller-id (offline, dari dashboard
        // OLT), fallback ke field MAC di record user. Best-effort, lazy require.
        const resolveCustomer = (mac) => {
            try {
                const c = require("./olt-customer-resolver").resolveCustomerByMac(mac);
                if (c) return c;
            } catch (__e) { /* ignore — fallback di bawah */ }
            return defaultResolveCustomer(mac);
        };
        _singleton = createLosBroadcaster({ resolveCustomer });
    }
    return _singleton;
}

module.exports = {
    createLosBroadcaster,
    getLosBroadcaster,
    handleOltEvent: (event) => getLosBroadcaster().handleOltEvent(event),
    listLosIncidents: () => getLosBroadcaster().listIncidents(),
    getLosState: () => getLosBroadcaster()._state(),
    defaultTeknisiRecipients,
    DEFAULTS,
    INCIDENTS_FILE,
};
