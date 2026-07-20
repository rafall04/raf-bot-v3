/**
 * Header Doc
 * Purpose: Jalur ADMIN menyetujui/menolak/membatalkan REQUEST GANTI PAKET (yang diajukan teknisi/admin
 *   lewat web) LANGSUNG DARI WHATSAPP — tanpa membuka panel. Pasangan dari notif request paket
 *   (admin_service_package_change_owner_request) yang dikirim ke admin accounts.json. Tiga aksi:
 *     - setujui (ok)   → terapkan ke MikroTik + DB, pelanggan & teknisi diberi tahu;
 *     - tolak <alasan> → request ditolak, pelanggan & teknisi diberi tahu;
 *     - batal          → batalkan DIAM-DIAM (teknisi salah input / duplikat), pelanggan TIDAK disentuh.
 *   Bentuk perintah — SELALU butuh sasaran jelas (tak pernah membajak "ok"/"batal" polos):
 *     (1) BALASAN ter-quote pada notif request → `ok` / `tolak <alasan>` / `batal` (Request ID dibaca
 *         dari teks ter-quote — hanya sah bila memuat pola `req_pkg_…`);
 *     (2) NOMOR antrian → `ok 1` / `tolak 2 <alasan>` / `batal 3` (nomor dari perintah `request paket`);
 *     (3) KODE eksplisit → `ok req_pkg_…` / `tolak req_pkg_… <alasan>` / `batal req_pkg_…`;
 *     (4) DAFTAR → `request paket` menampilkan antrian bernomor.
 *   Perintah POLOS tanpa sasaran (mis. `ok` / `batal` saja) SENGAJA dilepas (handled:false) supaya tak
 *   bentrok dengan antrian bukti-bayar (handler itu jalan lebih dulu) & kata batal universal.
 *   Langkah `ya` / pemilihan angka dilanjutkan state domain `PKGREQ_*`.
 *   Gate peran PRESISI (admin/owner/superadmin dari accounts.json). Non-admin → handled:false senyap.
 *   NEVER-THROW.
 * Caller: message/raf.js (hook teks staf, sesudah routing state & sesudah hook bukti-bayar, sebelum
 *   resolusi intent); message/handlers/state-domains/package-request-admin.state.js (pakai helper).
 * Deps: services/admin.service (createAdminService: listPendingPackageChangeRequests, approvePackageChange),
 *   lib/response-template-helper; `reply` / `setUserState` diinjeksi pemanggil (conversation-handler,
 *   key stateSender kanonik).
 * MainFuncs: handlePackageRequestAdminDecision, parsePackageCommand, extractQuotedText, resolveStaffAccount,
 *   buildActorCtx, isAdminActor, executeApprove/executeReject/executeCancel, replyPendingList,
 *   promptDecision, resolvePendingByIndex, STEP_SELECT, STEP_CONFIRM.
 * SideEffects: Lewat admin.service — update MikroTik + subscription DB, kirim WA ke pelanggan & teknisi
 *   (kecuali aksi batal: pelanggan tak disentuh). Balasan ke admin lewat `reply`; menulis conversation state.
 */
"use strict";

const { renderResponseTemplate } = require("../../lib/response-template-helper");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

const STEP_SELECT = "PKGREQ_SELECT";
const STEP_CONFIRM = "PKGREQ_CONFIRM";

// Format id request paket = req_pkg_<ms>_<base36> (lib/admin-request-persistence.createPackageChangeRequestRecord).
const CODE = "req_pkg_\\d+_[a-z0-9]+";
const CODE_ANYWHERE = new RegExp(CODE, "i");

const CONFIRM_WORDS = "ok|oke|setuju|setujui|approve|acc|terima|ya|iya|sip|gas";
const REJECT_WORDS = "tolak|reject|ditolak";
// batal = batalkan request diam-diam (teknisi salah input / duplikat). Beda dari tolak: pelanggan tak disentuh.
// URUTAN PENTING: "batalkan" HARUS sebelum "batal" — di regex ber-`(.*)` (quote-reply), "batal" yang lebih
// pendek akan cocok lebih dulu dan menyisakan "kan" terbaca sebagai alasan. Alternatif panjang dulu.
const CANCEL_WORDS = "batalkan|batal|cancel|hapus";
const YES_WORDS = ["ya", "y", "iya", "ok", "oke", "yes", "lanjut", "gas", "betul", "benar", "sip", "setuju", "setujui"];

const CMD_CONFIRM_CODE = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(${CODE})\\s*$`, "i");
const CMD_REJECT_CODE = new RegExp(`^(?:${REJECT_WORDS})\\s+(${CODE})\\s*(.*)$`, "i");
const CMD_CANCEL_CODE = new RegExp(`^(?:${CANCEL_WORDS})\\s+(${CODE})\\s*(.*)$`, "i");
// Balasan ter-quote: sasaran sudah pasti (id dari teks ter-quote), teks di belakang = alasan.
const CMD_QUOTED_CONFIRM = new RegExp(`^(?:${CONFIRM_WORDS})\\s*$`, "i");
const CMD_QUOTED_REJECT = new RegExp(`^(?:${REJECT_WORDS})\\s*(.*)$`, "i");
const CMD_QUOTED_CANCEL = new RegExp(`^(?:${CANCEL_WORDS})\\s*(.*)$`, "i");
const CMD_LIST = /^(?:request paket|request ganti paket|antrian paket|antrean paket|daftar request paket|antrian request paket|antrean request paket)$/i;

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function formatSubmittedAt(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "-";
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isYes(text) {
    return YES_WORDS.includes(String(text || "").toLowerCase().trim());
}

/**
 * Teks pesan yang di-quote (caption gambar/dokumen atau teks biasa). "" bila bukan balasan.
 */
function extractQuotedText(msg) {
    const inner = (msg && msg.message) || {};
    for (const key of Object.keys(inner)) {
        const quoted = inner[key] && inner[key].contextInfo && inner[key].contextInfo.quotedMessage;
        if (!quoted) continue;
        return (quoted.imageMessage && quoted.imageMessage.caption)
            || (quoted.documentMessage && quoted.documentMessage.caption)
            || (quoted.extendedTextMessage && quoted.extendedTextMessage.text)
            || quoted.conversation
            || "";
    }
    return "";
}

/**
 * Kenali perintah request paket dari teks (+ konteks quote). Murni, tanpa efek samping.
 * HANYA meng-klaim perintah bersasaran PASTI: kode eksplisit `req_pkg_…`, daftar, atau balasan-quote
 * yang teks ter-quote-nya memuat id request. Perintah bernomor "ok 1" TIDAK dikenali di sini (itu
 * ambigu dengan antrian bukti-bayar) — pemilihan angka hanya via state PKGREQ_SELECT sesudah `request
 * paket`. Perintah polos/bare → null (dilepas: biar tak bentrok bukti-bayar & kata batal universal).
 * @returns {{action:'approve'|'reject'|'cancel'|'list', code?:string, reason?:string}|null}
 */
function parsePackageCommand(text, quotedText = "") {
    const body = String(text || "").trim();
    if (!body) return null;

    // 1) Kode eksplisit.
    const confirmCode = body.match(CMD_CONFIRM_CODE);
    if (confirmCode) return { action: "approve", code: confirmCode[1].toLowerCase() };

    const rejectCode = body.match(CMD_REJECT_CODE);
    if (rejectCode) return { action: "reject", code: rejectCode[1].toLowerCase(), reason: (rejectCode[2] || "").trim() };

    const cancelCode = body.match(CMD_CANCEL_CODE);
    if (cancelCode) return { action: "cancel", code: cancelCode[1].toLowerCase(), reason: (cancelCode[2] || "").trim() };

    if (CMD_LIST.test(body)) return { action: "list" };

    // 2) Balasan ter-quote: hanya sah bila pesan yang dibalas memuat id request (req_pkg_…) — jadi
    // "ok"/"batalkan" ke pesan bot lain tak akan pernah menyentuh request paket secara tak sengaja.
    const quotedCode = String(quotedText || "").match(CODE_ANYWHERE);
    if (quotedCode) {
        const code = quotedCode[0].toLowerCase();
        if (CMD_QUOTED_CONFIRM.test(body)) return { action: "approve", code };
        // Cek cancel & reject; keduanya menutup entri tapi cancel tak menyentuh pelanggan.
        const replyCancel = body.match(CMD_QUOTED_CANCEL);
        if (replyCancel) return { action: "cancel", code, reason: (replyCancel[1] || "").trim() };
        const replyReject = body.match(CMD_QUOTED_REJECT);
        if (replyReject) return { action: "reject", code, reason: (replyReject[1] || "").trim() };
        return null;
    }

    // 3) Polos tanpa sasaran → BUKAN urusan kami (lepaskan supaya tak bentrok dgn bukti-bayar & batal universal).
    return null;
}

function buildPendingListBody(items) {
    return items.map((r, i) => [
        `*${i + 1}.* ${r.userName}`,
        `   ${r.currentPackageName || "-"} → *${r.requestedPackageName}* (${formatRupiah(r.requestedPackagePrice)})`,
        `   Oleh: ${r.requestedBy || "-"} • ${formatSubmittedAt(r.createdAt)}`,
        `   Kode: ${r.id}`
    ].join("\n")).join("\n\n");
}

function describeSync(req) {
    if (!req) return "";
    if (req.sync_status === "applied") return "🔌 Profil MikroTik sudah diperbarui.\n";
    if (req.sync_status === "applied_locally_sync_disabled") return "ℹ️ Sinkronisasi MikroTik nonaktif — perubahan lokal saja.\n";
    return "";
}

function getService(ctx) {
    if (ctx.service) return ctx.service;
    const { createAdminService } = require("../../services/admin.service");
    return createAdminService();
}

/** Cocokkan pengirim ke akun staf accounts.json (lid / phone_number / nomor polos). null bila bukan staf. */
function resolveStaffAccount(ctx) {
    if (typeof ctx.resolveStaffAccount === "function") return ctx.resolveStaffAccount(ctx);
    const accounts = ctx.accounts || (ctx.global && ctx.global.accounts) || (typeof global !== "undefined" ? global.accounts : null) || [];
    const sender = String(ctx.sender || "");
    const plain = String(ctx.plainSenderNumber || "").replace(/\D/g, "");
    return (Array.isArray(accounts) ? accounts : []).find((a) => {
        if (!a) return false;
        if (a.lid && a.lid === sender) return true;
        const ph = String(a.phone_number || "");
        const phNum = ph.replace(/\D/g, "");
        return (ph && (ph === sender || ph === plain)) || (phNum && plain && phNum === plain);
    }) || null;
}

function isAdminActor(ctx) {
    const acct = resolveStaffAccount(ctx);
    return Boolean(acct) && ADMIN_ROLES.includes(String(acct.role || "").toLowerCase());
}

/** Konteks aktor untuk admin.service (id/username/role/name). Tanpa ipAddress/userAgent (bukan HTTP). */
function buildActorCtx(ctx) {
    const acct = resolveStaffAccount(ctx) || {};
    return {
        id: acct.id,
        username: acct.username || ctx.pushname || "admin",
        role: String(acct.role || "admin").toLowerCase(),
        name: acct.name || acct.username || ctx.pushname || "Admin"
    };
}

function snapshotOf(record) {
    return {
        id: record.id,
        userName: record.userName,
        currentPackageName: record.currentPackageName,
        requestedPackageName: record.requestedPackageName,
        requestedPackagePrice: record.requestedPackagePrice,
        requestedBy: record.requestedBy,
        createdAt: record.createdAt
    };
}

/** Daftar request PENDING (via service). [] bila gagal — never-throw. */
async function listPending(service, actorCtx) {
    try {
        const res = await service.listPendingPackageChangeRequests(actorCtx);
        return Array.isArray(res && res.data) ? res.data : [];
    } catch (_e) {
        return [];
    }
}

/** Nomor antrian → record. `items` = snapshot state bila ada, else daftar segar. */
async function resolvePendingByIndex(service, actorCtx, index, items = null) {
    const list = Array.isArray(items) && items.length ? items : await listPending(service, actorCtx);
    if (!Number.isInteger(index) || index < 1 || index > list.length) return null;
    return list[index - 1];
}

// ── Balasan ──

function replyEmptyQueue(ctx) {
    return ctx.reply(renderResponseTemplate(
        "package_request_admin_list_empty",
        "✅ Tidak ada request ganti paket yang menunggu. Bersih!"
    ), { skipDuplicateCheck: true });
}

/** Tampilkan antrian bernomor + simpan snapshot ke state supaya balasan angka polos bermakna. */
async function replyPendingList(ctx, service, actorCtx, action = "approve") {
    const items = await listPending(service, actorCtx);
    if (!items.length) return replyEmptyQueue(ctx);

    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, {
            step: STEP_SELECT,
            action,
            items: items.map(snapshotOf)
        });
    }

    const text = renderResponseTemplate(
        "package_request_admin_list",
        "📦 *ANTRIAN REQUEST GANTI PAKET* (${total})\n\n${daftar}\n\nBalas *angka* untuk memilih (mis. *1*), atau langsung *ok 1* / *tolak 2 <alasan>* / *batalkan 3*.",
        { total: items.length, daftar: buildPendingListBody(items) }
    );
    return ctx.reply(text, { skipDuplicateCheck: true });
}

/** Minta penegasan `ya` untuk satu request (dipakai saat pilih nomor). */
async function promptDecision(ctx, record, action) {
    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, { step: STEP_CONFIRM, action, ...snapshotOf(record) });
    }
    const data = {
        nama: record.userName || "-",
        paketLama: record.currentPackageName || "-",
        paketBaru: record.requestedPackageName || "-",
        harga: formatRupiah(record.requestedPackagePrice),
        kode: record.id
    };
    let text;
    if (action === "reject") {
        text = renderResponseTemplate(
            "package_request_admin_reject_prompt",
            "🚫 *Tolak request paket*\n\n${nama} → ${paketBaru}\n\nBalas *ya* untuk menolak, atau ketik *alasannya* langsung. Pelanggan akan diberi tahu.",
            data);
    } else if (action === "cancel") {
        text = renderResponseTemplate(
            "package_request_admin_cancel_prompt",
            "🗑️ *Batalkan request paket*\n\n${nama} → ${paketBaru}\n\nIni MEMBATALKAN request TANPA memberi tahu pelanggan (pakai bila teknisi salah input / duplikat).\nBalas *ya* untuk batalkan, atau *ga jadi* untuk keluar.",
            data);
    } else {
        text = renderResponseTemplate(
            "package_request_admin_confirm_prompt",
            "📦 *Setujui perubahan paket?*\n\n${nama}\n${paketLama} → *${paketBaru}* (${harga})\n\nBalas *ya* untuk SETUJUI & terapkan ke MikroTik, atau *tolak <alasan>* / *batalkan*.",
            data);
    }
    return ctx.reply(text, { skipDuplicateCheck: true });
}

function replyServiceError(ctx, code, err) {
    const msg = (err && err.message) || "kesalahan sistem";
    if (/mikrotik/i.test(msg)) {
        return ctx.reply(renderResponseTemplate(
            "package_request_admin_mikrotik_failed",
            "⚠️ Gagal menerapkan ke MikroTik untuk *${kode}*: ${pesan}\n\nPaket TIDAK diubah & request tetap menunggu — coba lagi atau proses lewat panel admin.",
            { kode: code, pesan: msg }
        ), { skipDuplicateCheck: true });
    }
    if (/tidak ditemukan/i.test(msg)) {
        return ctx.reply(renderResponseTemplate(
            "package_request_admin_not_found",
            "❌ Request *${kode}* tidak ditemukan. Ketik *request paket* untuk melihat antrian.",
            { kode: code }
        ), { skipDuplicateCheck: true });
    }
    if (/sudah dalam status/i.test(msg)) {
        return ctx.reply(renderResponseTemplate(
            "package_request_admin_already_processed",
            "ℹ️ Request *${kode}* sudah diproses sebelumnya (status: ${status}).",
            { kode: code, status: (msg.match(/status '([^']+)'/) || [])[1] || "-" }
        ), { skipDuplicateCheck: true });
    }
    return ctx.reply(renderResponseTemplate(
        "package_request_admin_error",
        "⚠️ Gagal memproses request *${kode}*: ${pesan}.\nRequest tetap menunggu — coba lagi atau proses lewat panel admin.",
        { kode: code, pesan: msg }
    ), { skipDuplicateCheck: true });
}

// ── Eksekusi (id/kode sudah pasti) ──

async function executeApprove(ctx, service, actorCtx, requestId) {
    let result;
    try {
        result = await service.approvePackageChange({ requestId, action: "approve", notes: "" }, actorCtx);
    } catch (err) {
        return replyServiceError(ctx, requestId, err);
    }
    const req = result.request || {};
    const sisa = (await listPending(service, actorCtx)).length;
    return ctx.reply(renderResponseTemplate(
        "package_request_admin_approve_ok",
        "✅ *Paket diganti*\n\n${nama} sekarang di paket *${paketBaru}*.\n${syncSection}Pelanggan & teknisi sudah diberi tahu.\n\nSisa antrian: ${sisa} request.",
        {
            nama: req.userName || "-",
            paketBaru: req.requestedPackageName || "-",
            syncSection: describeSync(req),
            sisa
        }
    ), { skipDuplicateCheck: true });
}

async function executeReject(ctx, service, actorCtx, requestId, reason) {
    let result;
    try {
        result = await service.approvePackageChange({ requestId, action: "reject", notes: reason || "" }, actorCtx);
    } catch (err) {
        return replyServiceError(ctx, requestId, err);
    }
    const req = result.request || {};
    const sisa = (await listPending(service, actorCtx)).length;
    return ctx.reply(renderResponseTemplate(
        "package_request_admin_reject_ok",
        "🚫 Request paket *${nama}* → ${paketBaru} *ditolak*.\nAlasan: ${alasan}\n\nPelanggan & teknisi sudah diberi tahu.\n\nSisa antrian: ${sisa} request.",
        {
            nama: req.userName || "-",
            paketBaru: req.requestedPackageName || "-",
            alasan: reason || "Ditolak oleh admin.",
            sisa
        }
    ), { skipDuplicateCheck: true });
}

async function executeCancel(ctx, service, actorCtx, requestId, reason) {
    let result;
    try {
        result = await service.approvePackageChange({ requestId, action: "cancel", notes: reason || "" }, actorCtx);
    } catch (err) {
        return replyServiceError(ctx, requestId, err);
    }
    const req = result.request || {};
    const sisa = (await listPending(service, actorCtx)).length;
    return ctx.reply(renderResponseTemplate(
        "package_request_admin_cancel_ok",
        "🗑️ Request paket *${nama}* → ${paketBaru} *dibatalkan* (pelanggan TIDAK diberi tahu).\nTeknisi pengaju sudah diberi tahu.\n\nSisa antrian: ${sisa} request.",
        {
            nama: req.userName || "-",
            paketBaru: req.requestedPackageName || "-",
            sisa
        }
    ), { skipDuplicateCheck: true });
}

/** Jalankan aksi pada satu request (id sudah pasti). Satu tempat mapping aksi → eksekutor. */
async function dispatchAction(ctx, service, actorCtx, action, id, reason) {
    if (action === "reject") return executeReject(ctx, service, actorCtx, id, reason);
    if (action === "cancel") return executeCancel(ctx, service, actorCtx, id, reason);
    return executeApprove(ctx, service, actorCtx, id);
}

/**
 * Hook utama (pesan TANPA state aktif). Selalu `{handled}` — tidak pernah melempar.
 *
 * @param {object} ctx
 * @param {string} ctx.chats - teks pesan masuk.
 * @param {object} ctx.msg - pesan Baileys mentah (untuk membaca quote).
 * @param {string} ctx.sender - JID pengirim apa adanya (bisa @lid; dipakai cocokkan accounts.lid).
 * @param {string} ctx.plainSenderNumber - nomor polos hasil resolusi kanonik.
 * @param {string} ctx.stateSender - JID KANONIK; key conversation state.
 * @param {Array} ctx.accounts - accounts.json runtime (sumber peran staf).
 * @param {string} [ctx.pushname]
 * @param {Function} ctx.reply - helper balas (mendukung { skipDuplicateCheck }).
 * @param {Function} ctx.setUserState - conversation-handler.setUserState.
 * @param {object} [ctx.service] - override service (untuk test).
 * @returns {Promise<{handled: boolean}>}
 */
async function handlePackageRequestAdminDecision(ctx) {
    try {
        const command = parsePackageCommand(ctx.chats, extractQuotedText(ctx.msg));
        if (!command) return { handled: false };

        // Gate peran SESUDAH parsing: non-admin yang menebak formatnya jatuh senyap ke jalur biasa.
        if (!isAdminActor(ctx)) return { handled: false };

        const service = getService(ctx);
        const actorCtx = buildActorCtx(ctx);

        if (command.action === "list") {
            await replyPendingList(ctx, service, actorCtx, "approve");
            return { handled: true };
        }

        // Sasaran eksplisit (kode / balasan-quote yang sudah di-resolve ke kode) → langsung eksekusi.
        if (command.code) {
            await dispatchAction(ctx, service, actorCtx, command.action, command.code, command.reason);
            return { handled: true };
        }

        return { handled: false };
    } catch (err) {
        console.error("[PACKAGE_REQUEST_ADMIN_ERROR]", err && err.message ? err.message : err);
        try {
            await ctx.reply(renderResponseTemplate(
                "package_request_admin_error",
                "⚠️ Gagal memproses request *${kode}*: ${pesan}.\nRequest tetap menunggu — coba lagi atau proses lewat panel admin.",
                { kode: "-", pesan: (err && err.message) || "kesalahan sistem" }
            ), { skipDuplicateCheck: true });
        } catch (_replyErr) {
            /* balasan best-effort */
        }
        return { handled: true };
    }
}

module.exports = {
    handlePackageRequestAdminDecision,
    parsePackageCommand,
    extractQuotedText,
    // dipakai state domain PKGREQ_*
    STEP_SELECT,
    STEP_CONFIRM,
    CMD_LIST,
    getService,
    resolveStaffAccount,
    isAdminActor,
    buildActorCtx,
    isYes,
    listPending,
    executeApprove,
    executeReject,
    executeCancel,
    replyPendingList,
    replyEmptyQueue,
    promptDecision,
    resolvePendingByIndex
};
