/**
 * Header Doc
 * Purpose: Cron siklus tagihan AKHIR BULAN — untuk pelanggan opt-in (`billing_cycle='akhir_bulan'`,
 *   mis. Leny Mustiko Wati) yang sepakat membayar menjelang akhir bulan, BUKAN awal. Satu job harian
 *   yang, relatif ke tanggal terakhir bulan berjalan, menjalankan tiga fase: (1) pengingat H-`reminderDaysBefore`,
 *   (2) peringatan masa tenggang H-`graceDaysBefore`, (3) ISOLIR H-`isolirDaysBefore` (0 = hari terakhir)
 *   bila belum bayar, lalu kirim notifikasi isolir. State holder `cronTaskBillingAkhirBulan`.
 * Caller: `lib/cron.js` (composer) via `initBillingAkhirBulanTask`.
 * Deps: `node-cron`, `../shared` (delay, isValidCron, loadCronConfig, safeSendMessage), `../wa-send-queue`
 *   (sendQueueWithRetry, buildJid, resolveRetryConfig), `../../templating` (renderTemplate),
 *   `../../bill-pay-token` (buildBillPayUrl), `../../whatsapp-gateway` (isReady, getConnectionState),
 *   `../../account-classification` (isInfrastructure, getWhitelistedPackageNames, isEndOfMonthCustomer),
 *   `../../payment-finance-service` (resolveBillingAmount), `../../myfunc` (getProfileBySubscription),
 *   `../../services/isolir-service` (executeProfileAction).
 * MainFuncs: `initBillingAkhirBulanTask(config)`, `runBillingAkhirBulanCycle(nowOverride)`.
 * SideEffects: Jadwalkan job background, kirim WhatsApp (retry), pindah profil PPPoE (isolir), log + ringkasan.
 *
 * KENAPA JOB TERPISAH, bukan menambah cabang ke reminder/grace/isolir standar:
 *   Job standar tick di hari TETAP (reset unpaid tgl 1, tenggang tgl 11, isolir tgl 12). Kohort
 *   akhir-bulan butuh tick RELATIF akhir bulan (28/29/30/31 berbeda tiap bulan), jadi ia perlu tick
 *   HARIAN sendiri. Kohort DIKECUALIKAN dari 4 job standar (lihat isEndOfMonthBillingActive) sehingga
 *   tiap pelanggan ditangani TEPAT satu jalur — tak ada kepemilikan bayangan, tak ada celah. Fitur ini
 *   memakai ULANG layanan kirim + isolir yang sama persis (bukan duplikasi logika uang).
 *
 * GERBANG: seluruh job inert bila `config.billingAkhirBulan.enabled !== true` (deploy gelap default OFF).
 * Bahkan saat ON, hanya pelanggan bertanda `akhir_bulan` yang tersentuh (kohort kosong = no-op).
 */
"use strict";

const cron = require("node-cron");

const { delay, isValidCron, loadCronConfig, safeSendMessage } = require("../shared");
const { sendQueueWithRetry, buildJid, resolveRetryConfig } = require("../wa-send-queue");
const { renderTemplate } = require("../../templating");
const { buildBillPayUrl } = require("../../bill-pay-token");
const { isReady, getConnectionState } = require("../../whatsapp-gateway");
const {
    isInfrastructure,
    getWhitelistedPackageNames,
    isEndOfMonthCustomer,
} = require("../../account-classification");
const { resolveBillingAmount } = require("../../payment-finance-service");
const { getProfileBySubscription } = require("../../myfunc");
const IsolirService = require("../../services/isolir-service");

let cronTaskBillingAkhirBulan = null;
let billingAkhirBulanRunning = false;

const DEFAULT_REMINDER_BEFORE = 5; // H-5 dari akhir bulan
const DEFAULT_GRACE_BEFORE = 2; // H-2 dari akhir bulan
const DEFAULT_ISOLIR_BEFORE = 0; // hari TERAKHIR bulan

/** Baca setelan fitur dari config.json (bukan cron.json). Nilai default aman bila tak diset. */
function readFeatureConfig() {
    const feat = (global.config && global.config.billingAkhirBulan) || {};
    const asInt = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);
    return {
        enabled: feat.enabled === true,
        reminderDaysBefore: asInt(feat.reminderDaysBefore, DEFAULT_REMINDER_BEFORE),
        graceDaysBefore: asInt(feat.graceDaysBefore, DEFAULT_GRACE_BEFORE),
        isolirDaysBefore: asInt(feat.isolirDaysBefore, DEFAULT_ISOLIR_BEFORE),
    };
}

function fmtTanggal(date) {
    return date.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

/** Kohort = pelanggan (bukan infra) yang bertanda siklus akhir-bulan. */
function isCohortMember(user) {
    return !isInfrastructure(user) && isEndOfMonthCustomer(user);
}

/**
 * Kumpulkan target pengingat (reminder / tenggang) untuk kohort yang BELUM bayar.
 * @param {string} templateKey `unpaid_reminder` | `masa_tenggang_reminder`
 * @param {object} ctx { jatuh_tempo, tanggal_isolir, periode, now, tag }
 * @returns {{items: Array, skipped: Array, unpaid: number, whitelisted: number}}
 */
function collectReminderItems(templateKey, ctx) {
    const paketWhitelist = getWhitelistedPackageNames();
    const items = [];
    const skipped = [];
    let unpaid = 0;
    let whitelisted = 0;

    for (const user of global.users || []) {
        if (!isCohortMember(user)) continue;
        if (user.paid) continue; // sudah bayar → tak perlu ditagih
        unpaid++;

        if (paketWhitelist.has(user.subscription)) {
            whitelisted++;
            continue;
        }

        // Nol yang SAH (diskon penuh / paket Rp0) → jangan menagih orang yang tak berutang.
        const packageInfo = (global.packages || []).find((p) => p.name === user.subscription) || {};
        const tagihan = resolveBillingAmount(user, packageInfo.price);
        if (tagihan.zeroIsReal) {
            skipped.push({ name: user.name, reason: `tak ada yang ditagih (${tagihan.reason})` });
            continue;
        }
        if (tagihan.reason === "katalog-tak-terbaca") {
            console.warn(`[${ctx.tag}] Harga efektif tak terbaca untuk ${user.name} — pakai harga paket.`);
        }

        let linkBayar = "";
        try {
            linkBayar = buildBillPayUrl(user, {
                periodMonth: ctx.now.getMonth() + 1,
                periodYear: ctx.now.getFullYear(),
            });
        } catch (linkErr) {
            console.error(`[${ctx.tag}] Gagal buat link bayar untuk ${user.name}: ${linkErr.message}`);
        }

        const messageText = renderTemplate(templateKey, {
            nama_pelanggan: user.name,
            nama_paket: user.subscription,
            harga: tagihan.amount,
            jatuh_tempo: ctx.jatuh_tempo,
            tanggal_isolir: ctx.tanggal_isolir,
            periode: ctx.periode,
            link_bayar: linkBayar,
        });
        if (!messageText || String(messageText).startsWith("Error:")) {
            skipped.push({ name: user.name, reason: `render template ${templateKey} gagal` });
            continue;
        }
        if (!user.phone_number) {
            skipped.push({ name: user.name, reason: "tanpa No HP" });
            continue;
        }
        for (const raw of String(user.phone_number).split("|")) {
            const jid = buildJid(raw);
            if (jid) items.push({ jid, text: messageText, label: user.name });
            else skipped.push({ name: user.name, reason: `nomor tak valid: "${String(raw).trim()}"` });
        }
    }

    return { items, skipped, unpaid, whitelisted };
}

/** Kirim antrian pesan (retry, tak bisu). */
async function sendItems(items, tag) {
    const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay, 10)) || 2000;
    if (items.length > 0 && !isReady()) {
        console.warn(`[${tag}] WhatsApp belum siap (state: ${getConnectionState()}) — antrian ${items.length} pesan akan menunggu & di-retry.`);
    }
    return sendQueueWithRetry({
        items,
        safeSendMessage,
        isReady,
        delay,
        messageDelayMs: messageDelay,
        retry: resolveRetryConfig(global.config),
        tag,
        logger: console,
    });
}

/** Fase pengingat / masa tenggang. */
async function runReminderPhase(templateKey, ctx) {
    const { items, skipped, unpaid, whitelisted } = collectReminderItems(templateKey, ctx);
    const res = await sendItems(items, ctx.tag);
    for (const s of skipped) console.log(`[${ctx.tag}_SKIP] ${s.name}: ${s.reason}`);
    console.log(`[${ctx.tag}] === SUMMARY === kohort_unpaid=${unpaid} whitelisted=${whitelisted} target=${items.length} sent=${res.sent} gagal=${res.failed.length} skipped=${skipped.length}`);
    return { unpaid, whitelisted, target: items.length, sent: res.sent, failed: res.failed.length };
}

/**
 * Fase ISOLIR (hari terakhir). Cermin persis guard di lib/cron/jobs/isolir.js, tapi hanya untuk
 * kohort akhir-bulan. Setelah berhasil isolir → kirim notifikasi isolir (template sama dgn cron standar).
 */
async function runIsolirPhase(ctx) {
    const TAG = "CRON_BAB_ISOLIR";
    const cfg = global.config || {};

    if (cfg.sync_to_mikrotik === false) {
        console.log(`[${TAG}] Sync ke MikroTik DINONAKTIFKAN — lewati isolir.`);
        return { isolated: 0, failed: 0, notified: 0 };
    }
    if (cfg.isolirFeatureEnabled === false) {
        console.log(`[${TAG}] Fitur isolir dinonaktifkan — lewati.`);
        return { isolated: 0, failed: 0, notified: 0 };
    }
    const isolirProfile = cfg.isolir_profile;
    if (!isolirProfile) {
        console.error(`[${TAG}] isolir_profile tak terdefinisi di config — batal.`);
        return { isolated: 0, failed: 0, notified: 0 };
    }

    const paketWhitelist = getWhitelistedPackageNames();
    const candidates = [];
    for (const user of global.users || []) {
        if (!isCohortMember(user)) continue;
        const userProfile = getProfileBySubscription(user.subscription);
        if (
            !user.paid &&
            !paketWhitelist.has(user.subscription) &&
            userProfile !== isolirProfile &&
            user.pppoe_username
        ) {
            candidates.push(user);
        }
    }

    if (candidates.length === 0) {
        console.log(`[${TAG}] Tak ada kandidat isolir kohort akhir-bulan.`);
        return { isolated: 0, failed: 0, notified: 0 };
    }

    const throttleMs = (cfg && parseInt(cfg.isolir_action_delay, 10)) || 500;
    console.log(`[${TAG}] ${candidates.length} kandidat. Proses sequential throttle ${throttleMs}ms.`);

    let isolated = 0;
    let failed = 0;
    const isolatedUsers = [];
    for (const user of candidates) {
        try {
            const actionResult = await IsolirService.executeProfileAction(user, {
                targetProfile: isolirProfile,
                disconnect: true,
                reboot: true,
                caller: "cron.billing-akhir-bulan",
            });
            if (!actionResult || !actionResult.ok) {
                throw new Error(actionResult ? actionResult.message : "Tak ada hasil");
            }
            console.log(`[${TAG}_SUCCESS] ${user.pppoe_username} berhasil diisolir.`);
            isolated++;
            isolatedUsers.push(user);
        } catch (e) {
            console.error(`[${TAG}_ERROR] Gagal isolir ${user.name}: ${e.message || e}`);
            failed++;
        }
        if (throttleMs > 0) await delay(throttleMs);
    }

    // Notifikasi isolir (template sama dgn cron standar). Cron isolir-notification standar tick tgl 12
    // dan MENGECUALIKAN kohort ini, jadi notifikasi HARUS dikirim di sini agar pelanggan tetap diberi tahu.
    const notifItems = [];
    for (const user of isolatedUsers) {
        if (!user.phone_number) continue;
        let linkBayar = "";
        try {
            linkBayar = buildBillPayUrl(user, {
                periodMonth: ctx.now.getMonth() + 1,
                periodYear: ctx.now.getFullYear(),
            });
        } catch (linkErr) {
            console.error(`[${TAG}] Gagal buat link bayar untuk ${user.name}: ${linkErr.message}`);
        }
        const message = renderTemplate("isolir_notification", {
            nama_pelanggan: user.name,
            periode: ctx.periode,
            link_bayar: linkBayar,
        });
        if (!message || String(message).startsWith("Error:")) continue;
        for (const raw of String(user.phone_number).split("|")) {
            const jid = buildJid(raw);
            if (jid) notifItems.push({ jid, text: message, label: user.name });
        }
    }
    const notifRes = notifItems.length ? await sendItems(notifItems, "CRON_BAB_ISOLIR_NOTIF") : { sent: 0, failed: [] };

    console.log(`[${TAG}] === SUMMARY === kandidat=${candidates.length} isolir=${isolated} gagal=${failed} notif=${notifRes.sent}`);
    return { isolated, failed, notified: notifRes.sent };
}

/**
 * Inti siklus harian. Menentukan fase dari jarak hari ke akhir bulan, lalu menjalankannya.
 * @param {Date} [nowOverride] untuk test.
 */
async function runBillingAkhirBulanCycle(nowOverride = null) {
    const feat = readFeatureConfig();
    if (!feat.enabled) {
        // Fitur OFF → job inert (kohort ditangani siklus standar seperti biasa).
        return { skipped: "feature-off" };
    }

    const now = nowOverride || new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate(); // tanggal terakhir bulan ini
    const today = now.getDate();
    const daysUntilEnd = lastDay - today; // 0 = hari terakhir

    const jatuhTempoDate = new Date(y, m, lastDay);
    const isolirDate = new Date(y, m, lastDay - feat.isolirDaysBefore);
    const ctx = {
        now,
        jatuh_tempo: fmtTanggal(jatuhTempoDate),
        tanggal_isolir: fmtTanggal(isolirDate),
        periode: now.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
    };

    console.log(
        `[CRON_BILLING_AKHIR_BULAN] hari=${today} akhir_bulan=${lastDay} sisa=${daysUntilEnd} ` +
        `(reminder H-${feat.reminderDaysBefore}, tenggang H-${feat.graceDaysBefore}, isolir H-${feat.isolirDaysBefore})`
    );

    const hasil = { daysUntilEnd, phases: [] };

    // Fase bisa berimpit bila operator menyetel offset sama — jalankan semua yang cocok.
    if (daysUntilEnd === feat.reminderDaysBefore) {
        hasil.phases.push("reminder");
        hasil.reminder = await runReminderPhase("unpaid_reminder", { ...ctx, tag: "CRON_BAB_REMINDER" });
    }
    if (daysUntilEnd === feat.graceDaysBefore) {
        hasil.phases.push("tenggang");
        hasil.tenggang = await runReminderPhase("masa_tenggang_reminder", { ...ctx, tag: "CRON_BAB_TENGGANG" });
    }
    if (daysUntilEnd === feat.isolirDaysBefore) {
        hasil.phases.push("isolir");
        hasil.isolir = await runIsolirPhase(ctx);
    }

    if (hasil.phases.length === 0) {
        console.log(`[CRON_BILLING_AKHIR_BULAN] Bukan hari aksi (sisa=${daysUntilEnd}) — no-op.`);
    }
    return hasil;
}

/**
 * Jadwalkan/restart task. Schedule + status dibaca dari cron.json (seperti job billing lain);
 * enable fitur dibaca dari config.json saat tiap tick (deploy gelap default OFF).
 */
function initBillingAkhirBulanTask(config) {
    if (cronTaskBillingAkhirBulan) cronTaskBillingAkhirBulan.stop();
    if (config.status_billing_akhir_bulan === true && isValidCron(config.schedule_billing_akhir_bulan)) {
        console.log("[CRON_BILLING_AKHIR_BULAN] Start/restart schedule:", config.schedule_billing_akhir_bulan);
        cronTaskBillingAkhirBulan = cron.schedule(config.schedule_billing_akhir_bulan, async () => {
            if (billingAkhirBulanRunning) {
                console.warn("[CRON_BILLING_AKHIR_BULAN_SKIPPED] Siklus sebelumnya masih jalan, lewati tick ini.");
                return;
            }
            const currentConfig = loadCronConfig();
            if (currentConfig.status_billing_akhir_bulan !== true) return;
            billingAkhirBulanRunning = true;
            try {
                await runBillingAkhirBulanCycle();
            } catch (err) {
                console.error("[CRON_BILLING_AKHIR_BULAN_ERROR]", err.message || err);
            } finally {
                billingAkhirBulanRunning = false;
            }
        });
    } else {
        // Task dinonaktifkan (silent).
    }
}

module.exports = {
    initBillingAkhirBulanTask,
    runBillingAkhirBulanCycle,
    // diekspor untuk test unit
    readFeatureConfig,
    isCohortMember,
};
