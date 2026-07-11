/**
 * Header Doc
 * Purpose: Meredam SPAM notifikasi burst (pengajuan pembayaran teknisi) dengan pola
 *          "leading-edge + trailing summary": notifikasi PERTAMA ke seorang penerima dikirim
 *          segera dengan detail penuh (request tunggal tetap instan), lalu notifikasi berikutnya
 *          dalam jendela `windowMs` DITAHAN dan digabung menjadi SATU ringkasan saat jendela tutup.
 *          Jadi "delay hanya terasa saat banyak" — persis kebutuhan operator.
 * Caller: `routes/requests.js` (notifikasi owner saat pengajuan dibuat), `lib/app-runtime.js`
 *         (start scheduler tick). Bulk-approve meringkas sendiri (deterministik, tanpa modul ini).
 * Deps: `fs`, `path`, `./env-config` (getDatabasePath untuk lokasi store), `./whatsapp-delivery-service`
 *       (sendMessage — delivery boundary, never-throw), `./response-template-helper` (renderResponseTemplate).
 * MainFuncs: `enqueueOrSendFirst`, `tickDigests`, `startDigestScheduler`, `stopDigestScheduler`.
 * SideEffects: Membaca/menulis `database/notification-digest.json` (atau `*_test.json` saat NODE_ENV=test);
 *              mengirim pesan WhatsApp (leading-edge segera + ringkasan saat flush).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_WINDOW_MS = 30 * 60 * 1000; // 30 menit (pilihan operator)
const TICK_INTERVAL_MS = 60 * 1000;
const MAX_BUCKETS = 500;
const MAX_SUMMARY_NAMES = 25; // batasi daftar nama di ringkasan agar pesan tak kepanjangan

let tickTimer = null;

function resolveStorePath() {
    // Store kecil & non-domain → JSON, bukan SQLite. Env-aware supaya test tak menyentuh prod.
    const base = process.env.NODE_ENV === "test" ? "notification-digest_test.json" : "notification-digest.json";
    return path.join(__dirname, "..", "database", base);
}

function loadBuckets(storePath = resolveStorePath()) {
    try {
        if (!fs.existsSync(storePath)) return {};
        const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
        console.warn(`[NOTIF_DIGEST] Gagal membaca store: ${err.message}`);
        return {};
    }
}

function saveBuckets(buckets, storePath = resolveStorePath()) {
    try {
        // Anti-menggelembung: kalau bucket terlalu banyak, buang yang paling lama (windowUntil terkecil).
        let entries = Object.entries(buckets);
        if (entries.length > MAX_BUCKETS) {
            entries = entries.sort((a, b) => (a[1].windowUntil || 0) - (b[1].windowUntil || 0)).slice(-MAX_BUCKETS);
        }
        const dir = path.dirname(storePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(storePath, JSON.stringify(Object.fromEntries(entries), null, 2));
        return true;
    } catch (err) {
        console.error(`[NOTIF_DIGEST] Gagal menulis store: ${err.message}`);
        return false;
    }
}

// Kunci bucket per (penerima, jenis). '|' aman karena JID & kind tak memuatnya.
function bucketKey(recipient, kind) {
    return `${kind}||${recipient}`;
}

async function deliver(recipient, text) {
    try {
        const { sendMessage } = require("./whatsapp-delivery-service");
        // KONTRAK: payload objek { text }, bukan string. Never-throw (delivery boundary menelan error).
        return await sendMessage(recipient, { text }, { skipDuplicateCheck: true });
    } catch (err) {
        console.error(`[NOTIF_DIGEST] Gagal kirim ke ${recipient}: ${err.message}`);
        return { ok: false };
    }
}

/**
 * Notifikasi PERTAMA → kirim detail segera & buka jendela. Berikutnya (jendela terbuka) → tahan.
 *
 * @param {object} p
 * @param {string} p.recipient   JID kanonik penerima (WAJIB bukan @lid).
 * @param {string} p.kind        jenis notifikasi (mis. 'payment_request_new').
 * @param {string} p.detailText  teks detail penuh untuk kiriman leading-edge (sudah dirender template).
 * @param {object} p.summaryItem data ringkas untuk ringkasan (mis. { customerName, price }).
 * @param {number} [p.windowMs]  panjang jendela penggabungan.
 * @returns {Promise<{sent:'detail'|'held'}>}
 */
async function enqueueOrSendFirst({ recipient, kind, detailText, summaryItem, windowMs = DEFAULT_WINDOW_MS, now = Date.now() }) {
    if (!recipient || String(recipient).endsWith("@lid")) {
        // Invarian: jangan pernah kirim ke @lid. Fail loud, jangan diam-diam.
        console.error(`[NOTIF_DIGEST] Penerima tidak sah (kosong/@lid): ${recipient}`);
        return { sent: "none" };
    }

    const storePath = resolveStorePath();
    const buckets = loadBuckets(storePath);
    const key = bucketKey(recipient, kind);
    const bucket = buckets[key];

    // Jendela terbuka? (windowUntil di masa depan)
    if (bucket && Number(bucket.windowUntil) > now) {
        bucket.pending = Array.isArray(bucket.pending) ? bucket.pending : [];
        bucket.pending.push(summaryItem || {});
        buckets[key] = bucket;
        saveBuckets(buckets, storePath);
        return { sent: "held" };
    }

    // Tidak ada jendela terbuka → leading-edge: kirim detail SEGERA + buka jendela baru.
    buckets[key] = { recipient, kind, windowUntil: now + windowMs, pending: [] };
    saveBuckets(buckets, storePath);
    await deliver(recipient, detailText);
    return { sent: "detail" };
}

// Perender ringkasan per-kind. Menerima array summaryItem → satu string (via template).
const summaryRenderers = {
    payment_request_new(items, _recipient) {
        const { renderResponseTemplate } = require("./response-template-helper");
        const total = items.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
        const names = items.map((it) => it.customerName).filter(Boolean);
        const shown = names.slice(0, MAX_SUMMARY_NAMES);
        const sisa = names.length - shown.length;
        const daftar = shown.map((n) => `• ${n}`).join("\n") + (sisa > 0 ? `\n• …dan ${sisa} lainnya` : "");
        const teknisi = items[0] && items[0].teknisiName ? items[0].teknisiName : "Teknisi";
        const adminUrl = (items[0] && items[0].adminUrl) || "";
        const linkLine = adminUrl ? `\n\nTinjau & proses di panel:\n${adminUrl}` : "\n\nTinjau & proses di panel admin.";
        const fallback =
            `🔔 *${items.length} Pengajuan Pembayaran Baru*\n\n` +
            `Teknisi *${teknisi}* mengajukan *${items.length}* perubahan status (total *Rp ${total.toLocaleString("id-ID")}*):\n\n` +
            `${daftar}${linkLine}\n\n_Notifikasi digabung agar tidak spam._`;
        return renderResponseTemplate("payment_request_digest_summary", fallback, {
            count: items.length,
            teknisi_name: teknisi,
            total: `Rp ${total.toLocaleString("id-ID")}`,
            daftar,
            admin_url: adminUrl
        });
    }
};

/**
 * Satu siklus: flush semua bucket yang jendelanya sudah tutup.
 * - pending kosong → jendela sunyi (cuma leading-edge tadi) → tak kirim apa-apa, hapus bucket.
 * - pending ≥ 1 → kirim SATU ringkasan.
 * Dipisah dari timer supaya bisa diuji.
 */
async function tickDigests(now = Date.now()) {
    const storePath = resolveStorePath();
    const buckets = loadBuckets(storePath);
    const due = Object.entries(buckets).filter(([, b]) => Number(b.windowUntil) <= now);
    if (!due.length) return { flushed: 0 };

    let flushed = 0;
    for (const [key, bucket] of due) {
        try {
            const pending = Array.isArray(bucket.pending) ? bucket.pending : [];
            if (pending.length > 0) {
                const render = summaryRenderers[bucket.kind];
                const text = render ? render(pending, bucket.recipient) : `${pending.length} notifikasi tertahan.`;
                await deliver(bucket.recipient, text);
                flushed += 1;
            }
        } catch (err) {
            console.error(`[NOTIF_DIGEST] Flush ${key} gagal: ${err.message}`);
        } finally {
            delete buckets[key];
        }
    }
    saveBuckets(buckets, storePath);
    return { flushed };
}

function startDigestScheduler({ intervalMs = TICK_INTERVAL_MS } = {}) {
    if (tickTimer) return tickTimer;
    // Tick membaca store dari disk tiap siklus → bucket selamat dari pm2 restart (janji ke owner
    // tak hilang; ringkasan tetap terkirim, sedikit telat setelah boot bila jendela sudah lewat).
    tickTimer = setInterval(() => {
        tickDigests().catch((err) => console.error(`[NOTIF_DIGEST] Tick gagal: ${err.message}`));
    }, intervalMs);
    if (typeof tickTimer.unref === "function") tickTimer.unref();
    console.log(`[NOTIF_DIGEST] Scheduler start (tick ${Math.round(intervalMs / 1000)}s)`);
    return tickTimer;
}

function stopDigestScheduler() {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}

module.exports = {
    enqueueOrSendFirst,
    tickDigests,
    startDigestScheduler,
    stopDigestScheduler,
    _internal: { resolveStorePath, loadBuckets, saveBuckets, bucketKey, summaryRenderers, DEFAULT_WINDOW_MS }
};
