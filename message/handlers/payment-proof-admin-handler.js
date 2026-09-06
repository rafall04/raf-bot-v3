/**
 * Header Doc
 * Purpose: Jalur ADMIN menyetujui/menolak/menghapus bukti pembayaran pelanggan LANGSUNG DARI WHATSAPP —
 *   tanpa membuka portal web dan tanpa mengetik kode panjang. Tiga aksi: konfirmasi (catat lunas),
 *   tolak (bukti sah tapi belum bisa → pelanggan diberi tahu kirim ulang), dan HAPUS (foto PALSU/bukan
 *   bukti bayar mis. keluhan → buang dari antrian TANPA menyentuh pelanggan). Bentuk perintah:
 *     (1) BALASAN ter-quote pada notif bukti → `ok` / `tolak <alasan>` / `hapus` (kode dibaca dari caption);
 *     (2) NOMOR antrian → `terima 1` / `tolak 2 <alasan>` / `hapus 3` (nomor dari perintah `bukti`);
 *     (3) KODE eksplisit → `terima BP-YYMMDD-XXXX` / `tolak BP-… <alasan>` / `hapus BP-…`;
 *     (4) POLOS → `ok` / `tolak` / `hapus` tanpa apa pun: bot menawarkan antrian (1 bukti → minta `ya`,
 *         banyak bukti → daftar bernomor). Bila antrian KOSONG, pesan dilepas (handled:false) supaya
 *         "ok"/"hapus" biasa dari admin tidak dibajak.
 *     (5) BORONGAN → `terima semua`: lunasi SEMUA bukti pending yang masih punya tagihan sekaligus
 *         (yang sudah lunas dilewati), setelah satu penegasan `ya` (state PAYPROOF_CONFIRM_ALL).
 *   Balasan ter-quote `ok` kini menerima ragam afirmatif alami ("ya", "ok mas", "sip") via
 *   isCleanConsent — sasaran sudah pasti (kode dari quote) & confirmProof fail-closed, jadi tetap aman.
 *   Langkah `ya` dan pemilihan angka dilanjutkan oleh state domain `PAYPROOF_*`.
 *   Gate peran PRESISI (admin/owner/superadmin dari accounts.json). Non-admin → `handled:false`
 *   senyap (fitur tak bocor). NEVER-THROW.
 * Caller: message/raf.js (hook teks staf, sesudah routing state, sebelum resolusi intent);
 *   message/handlers/state-domains/payment-proof-admin.state.js (memakai helper eksekusi/daftar).
 * Deps: services/payment-proof.service (listPending/confirmProof/rejectProof),
 *   ./state-domains/wan-switch.state (resolveStaffRole), lib/response-template-helper,
 *   `setUserState` diinjeksi pemanggil (conversation-handler, key stateSender kanonik).
 * MainFuncs: handlePaymentProofAdminDecision, parseProofCommand, extractQuotedText, peelWrappers,
 *   dispatchAction, executeConfirm, executeReject, executeDelete, executeConfirmAll, promptConfirmAll,
 *   replyPendingList, promptDecision, resolvePendingByIndex, isConsentYes, STEP_SELECT, STEP_CONFIRM,
 *   STEP_CONFIRM_ALL.
 * SideEffects: Lewat service — menulis ledger pembayaran (lunas), reaktivasi MikroTik, kirim WA ke
 *   pelanggan (struk/penolakan). HAPUS tidak menyentuh pelanggan/ledger (buang entri saja). Balasan ke
 *   admin lewat `reply` yang diinjeksi; menulis conversation state.
 */
"use strict";

const { renderResponseTemplate } = require("../../lib/response-template-helper");
const { isCleanConsent } = require("../../lib/affirmative-parser");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

const STEP_SELECT = "PAYPROOF_SELECT";
const STEP_CONFIRM = "PAYPROOF_CONFIRM";
// Penegasan `ya` untuk "terima semua" (borongan). Aksi uang massal → wajib satu penegasan.
const STEP_CONFIRM_ALL = "PAYPROOF_CONFIRM_ALL";

// Kata yang WAJAR muncul di balasan konfirmasi pembayaran, jadi TIDAK boleh dianggap "muatan lain"
// oleh isCleanConsent (yang defaultnya menganggap kata-kata ini tanda pesan bukan-konsen). Tanpa ini
// "ya sudah transfer" / "oke bayar masuk" akan ditolak sebagai bukan-persetujuan.
const PAY_ONTOPIC = ["bayar", "pembayaran", "transfer", "tf", "lunas", "terima", "tagihan", "saldo"];

// Format id bukti = BP-YYMMDD-XXXX (lib/id-generator.generatePaymentProofId).
const CODE = "BP-\\d{6}-[A-Z0-9]{4}";
const CODE_ANYWHERE = new RegExp(CODE, "i");

const CONFIRM_WORDS = "terima|konfirmasi|setuju|approve|acc|ok|oke|lunas";
const REJECT_WORDS = "tolak|reject|ditolak";
// Hapus = untuk bukti PALSU (foto yang ternyata bukan transfer, mis. keluhan). Beda dari tolak:
// jalur ini tak pernah menyentuh pelanggan.
const DELETE_WORDS = "hapus|delete";
const YES_WORDS = ["ya", "y", "iya", "ok", "oke", "yes", "lanjut", "gas", "betul", "benar", "sip"];

const CMD_CONFIRM_CODE = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(${CODE})\\s*$`, "i");
const CMD_REJECT_CODE = new RegExp(`^(?:${REJECT_WORDS})\\s+(${CODE})\\s*(.*)$`, "i");
const CMD_DELETE_CODE = new RegExp(`^(?:${DELETE_WORDS})\\s+(${CODE})\\s*(.*)$`, "i");
const CMD_CONFIRM_NUM = new RegExp(`^(?:${CONFIRM_WORDS})\\s+(\\d{1,2})\\s*$`, "i");
const CMD_REJECT_NUM = new RegExp(`^(?:${REJECT_WORDS})\\s+(\\d{1,2})(?:\\s+(.*))?$`, "i");
const CMD_DELETE_NUM = new RegExp(`^(?:${DELETE_WORDS})\\s+(\\d{1,2})(?:\\s+(.*))?$`, "i");
const CMD_BARE_CONFIRM = new RegExp(`^(?:${CONFIRM_WORDS})\\s*$`, "i");
// Pada balasan ter-quote sasarannya sudah pasti, jadi teks di belakang = ALASAN/catatan.
const CMD_QUOTED_REJECT = new RegExp(`^(?:${REJECT_WORDS})\\s*(.*)$`, "i");
const CMD_QUOTED_DELETE = new RegExp(`^(?:${DELETE_WORDS})\\s*(.*)$`, "i");
// Tanpa sasaran, "alasan" tak ada artinya — cocokkan PERSIS supaya "tolak angin" / "hapus dulu"
// tetap lolos ke jalur intent biasa alih-alih dibaca sebagai perintah bukti bayar.
const CMD_BARE_REJECT = new RegExp(`^(?:${REJECT_WORDS})$`, "i");
const CMD_BARE_DELETE = new RegExp(`^(?:${DELETE_WORDS})$`, "i");
const CMD_LIST = /^(?:bukti|bukti bayar|daftar bukti|antrian bukti|antrean bukti)$/i;
// Borongan: "terima semua" / "konfirmasi semua" / "ok semua". Melunasi SEMUA bukti yang masih punya
// tagihan (yang sudah lunas dilewati). Sengaja butuh kata "semua/all" eksplisit — bukan sekadar "ok".
const CMD_CONFIRM_ALL = /^(?:terima|konfirmasi|setuju|acc|lunas|ok|oke)\s+(?:semua|semuanya|all)\s*$/i;

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function padPeriod(month, year) {
    return `${String(month).padStart(2, "0")}/${year}`;
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

// "Ya" yang toleran sapaan ("ok mas", "ya ka", "sip", "iya", "lanjut") untuk langkah penegasan.
// Memakai isCleanConsent (bukan cocok-persis) supaya balasan setuju alami tak lagi ditolak — akar
// masalah yang sama dengan daftar afirmasi cocok-persis yang dulu menolak 83% ucapan setuju nyata.
// Tetap menolak pertanyaan & pesan bermuatan lain ("cek dulu", "ya tapi nanti").
function isConsentYes(text) {
    return isYes(text) || isCleanConsent(text, { onTopic: PAY_ONTOPIC });
}

// Baileys sering MEMBUNGKUS pesan nyata di dalam satu envelope: pesan menghilang (ephemeralMessage),
// lihat-sekali (viewOnceMessage*), dokumen ber-caption (documentWithCaptionMessage), atau pesan hasil
// edit (editedMessage). contextInfo/caption yang kita cari ada SATU lapis lebih dalam. Tanpa mengupas
// lapisan ini, balasan ter-quote pada notif BUKTI (khususnya bukti PDF = documentWithCaptionMessage,
// dan chat dengan "pesan menghilang" aktif) tak pernah ketemu kode BP-nya → konfirmasi diam-diam gagal.
const WRAPPER_KEYS = [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage",
    "editedMessage"
];

/** Kupas envelope pembungkus berlapis sampai ketemu isi pesan sebenarnya. */
function peelWrappers(message) {
    let current = message;
    let guard = 0;
    while (current && typeof current === "object" && guard < 6) {
        const key = Object.keys(current)[0];
        if (WRAPPER_KEYS.includes(key) && current[key] && current[key].message) {
            current = current[key].message;
            guard += 1;
            continue;
        }
        break;
    }
    return current || {};
}

/**
 * Teks pesan yang di-quote (caption gambar/dokumen/video atau teks biasa). "" bila bukan balasan.
 * Mengupas pembungkus (ephemeral/view-once/document-with-caption) baik pada AMPLOP balasan maupun
 * pada pesan yang di-quote, supaya balasan `ok` pada notif bukti PDF / di chat pesan-menghilang tetap
 * bisa menemukan kode BP-nya.
 */
function extractQuotedText(msg) {
    const inner = peelWrappers((msg && msg.message) || {});
    for (const key of Object.keys(inner)) {
        const quotedRaw = inner[key] && inner[key].contextInfo && inner[key].contextInfo.quotedMessage;
        if (!quotedRaw) continue;
        const quoted = peelWrappers(quotedRaw);
        return (quoted.imageMessage && quoted.imageMessage.caption)
            || (quoted.documentMessage && quoted.documentMessage.caption)
            || (quoted.videoMessage && quoted.videoMessage.caption)
            || (quoted.extendedTextMessage && quoted.extendedTextMessage.text)
            || quoted.conversation
            || "";
    }
    return "";
}

/**
 * Kenali perintah bukti bayar dari teks (+ konteks quote). Murni, tanpa efek samping.
 * @returns {{action:'confirm'|'reject'|'delete'|'list', code?:string, index?:number, reason?:string}|null}
 */
function parseProofCommand(text, quotedText = "") {
    const body = String(text || "").trim();
    if (!body) return null;

    // 1) Kode eksplisit — paling tegas, dipakai lebih dulu.
    const confirmCode = body.match(CMD_CONFIRM_CODE);
    if (confirmCode) return { action: "confirm", code: confirmCode[1].toUpperCase() };

    const rejectCode = body.match(CMD_REJECT_CODE);
    if (rejectCode) return { action: "reject", code: rejectCode[1].toUpperCase(), reason: (rejectCode[2] || "").trim() };

    const deleteCode = body.match(CMD_DELETE_CODE);
    if (deleteCode) return { action: "delete", code: deleteCode[1].toUpperCase(), reason: (deleteCode[2] || "").trim() };

    // 2) Nomor antrian.
    const confirmNum = body.match(CMD_CONFIRM_NUM);
    if (confirmNum) return { action: "confirm", index: parseInt(confirmNum[1], 10) };

    const rejectNum = body.match(CMD_REJECT_NUM);
    if (rejectNum) return { action: "reject", index: parseInt(rejectNum[1], 10), reason: (rejectNum[2] || "").trim() };

    const deleteNum = body.match(CMD_DELETE_NUM);
    if (deleteNum) return { action: "delete", index: parseInt(deleteNum[1], 10), reason: (deleteNum[2] || "").trim() };

    if (CMD_LIST.test(body)) return { action: "list" };

    // Borongan "terima semua" — dicek sebelum cabang ter-quote/polos.
    if (CMD_CONFIRM_ALL.test(body)) return { action: "confirm_all" };

    // 3) Balasan ter-quote: hanya sah bila pesan yang dibalas memuat kode bukti — jadi "ok"/"hapus" ke
    // pesan bot lain tidak akan pernah menyentuh pembayaran secara tak sengaja.
    const quotedCode = String(quotedText || "").match(CODE_ANYWHERE);
    if (quotedCode) {
        const code = quotedCode[0].toUpperCase();
        // Cek hapus & tolak DULU: keduanya kata-kunci eksplisit yang membawa alasan, dan "hapus" tak
        // menyentuh pelanggan. Baru sesudah itu tafsirkan konfirmasi.
        const replyDelete = body.match(CMD_QUOTED_DELETE);
        if (replyDelete) return { action: "delete", code, reason: (replyDelete[1] || "").trim() };
        const replyReject = body.match(CMD_QUOTED_REJECT);
        if (replyReject) return { action: "reject", code, reason: (replyReject[1] || "").trim() };
        // Konfirmasi: kata baku ("ok"/"terima"/…) ATAU afirmasi alami ("ya", "ok mas", "sip", "oke kak").
        // Sasaran sudah PASTI (kode dari quote), aktor tergerbang admin, dan confirmProof fail-closed
        // saat tak ada tagihan — jadi menerima ragam afirmatif di sini tetap aman. isCleanConsent
        // menolak pertanyaan & pesan bermuatan lain ("ok cek dulu"), jadi tak asal meloloskan.
        if (CMD_BARE_CONFIRM.test(body) || isCleanConsent(body, { onTopic: PAY_ONTOPIC })) {
            return { action: "confirm", code };
        }
        return null;
    }

    // 4) Polos, tanpa sasaran. Pemanggil yang memutuskan (antrian kosong → lepaskan pesannya).
    if (CMD_BARE_CONFIRM.test(body)) return { action: "confirm" };
    if (CMD_BARE_REJECT.test(body)) return { action: "reject", reason: "" };
    if (CMD_BARE_DELETE.test(body)) return { action: "delete", reason: "" };

    return null;
}

function buildPendingListBody(items) {
    return items.map((r, i) => [
        `*${i + 1}.* ${r.userName} (${r.phone})`,
        `   Tagihan ${padPeriod(r.periodMonth, r.periodYear)}: ${formatRupiah(r.amountDue)}`,
        `   Masuk: ${formatSubmittedAt(r.submittedAt)}`,
        `   Kode: ${r.id}`
    ].join("\n")).join("\n\n");
}

// `describeReactivation` / `reactivationNeedsAttention` diangkat ke lib/services/reactivation-outcome
// supaya SEMUA permukaan settlement (WA ini, web konfirmasi-bayar, callback iPaymu/Tripay/Mayar)
// memakai logika "perlu dicek admin" yang SAMA PERSIS. Nama lokal dipertahankan agar pemakai di bawah tak berubah.
const { describeReactivation, reactivationNeedsAttention } = require("../../lib/services/reactivation-outcome");

function getService(ctx) {
    return ctx.service || require("../../services/payment-proof.service").getPaymentProofService();
}

function resolveRole(ctx) {
    if (typeof ctx.resolveStaffRole === "function") return ctx.resolveStaffRole(ctx);
    const { resolveStaffRole } = require("./state-domains/wan-switch.state");
    // `accounts` disuntik pemanggil (raf.js me-resolve-nya dari runtime, tak selalu ada di global
    // scope yang dioper). Bila kosong, resolveStaffRole jatuh ke `global.accounts` seperti biasa.
    const accounts = ctx.accounts || (ctx.global && ctx.global.accounts);
    return resolveStaffRole({ ...ctx, global: { accounts } });
}

function isAdminActor(ctx) {
    return ADMIN_ROLES.includes(String(resolveRole(ctx) || "").toLowerCase());
}

function adminNameOf(ctx) {
    return ctx.pushname || String(resolveRole(ctx) || "admin");
}

function snapshotOf(record) {
    return {
        id: record.id,
        userName: record.userName,
        phone: record.phone,
        amountDue: record.amountDue,
        periodMonth: record.periodMonth,
        periodYear: record.periodYear,
        submittedAt: record.submittedAt
    };
}

/** Nomor antrian → record. `items` = snapshot state bila ada, else daftar segar. */
function resolvePendingByIndex(service, index, items = null) {
    const list = Array.isArray(items) && items.length ? items : service.listPending();
    if (!Number.isInteger(index) || index < 1 || index > list.length) return null;
    return list[index - 1];
}

// ── Balasan ──

function replyEmptyQueue(ctx) {
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_list_empty",
        "🧾 Tidak ada bukti pembayaran yang menunggu konfirmasi. Bersih! ✅"
    ), { skipDuplicateCheck: true });
}

/** Tampilkan antrian bernomor + simpan snapshot ke state supaya balasan angka polos bermakna. */
async function replyPendingList(ctx, service, action = "confirm") {
    const items = service.listPending();
    if (!items.length) return replyEmptyQueue(ctx);

    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, {
            step: STEP_SELECT,
            action,
            items: items.map(snapshotOf)
        });
    }

    const text = renderResponseTemplate(
        "payment_proof_admin_list",
        "🧾 *ANTRIAN BUKTI BAYAR* (${total})\n\n${daftar}\n\nBalas *angka* untuk memilih (mis. *1*), atau langsung *terima 1* / *tolak 2 <alasan>*.",
        { total: items.length, daftar: buildPendingListBody(items) }
    );
    return ctx.reply(text, { skipDuplicateCheck: true });
}

/** Minta penegasan `ya` untuk satu bukti (dipakai saat perintah polos / pilih nomor). */
async function promptDecision(ctx, record, action) {
    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, { step: STEP_CONFIRM, action, ...snapshotOf(record) });
    }
    const data = {
        nama: record.userName || "-",
        periode: padPeriod(record.periodMonth, record.periodYear),
        jumlah: formatRupiah(record.amountDue),
        kode: record.id
    };
    let text;
    if (action === "reject") {
        text = renderResponseTemplate(
            "payment_proof_admin_reject_prompt",
            "🚫 *Tolak bukti*\n\n${nama} — tagihan ${periode} ${jumlah}\n\nBalas *ya* untuk menolak, atau ketik *alasannya* langsung (mis. nominal kurang).",
            data);
    } else if (action === "delete") {
        text = renderResponseTemplate(
            "payment_proof_admin_delete_prompt",
            "🗑️ *Hapus bukti*\n\n${nama} — tagihan ${periode} ${jumlah}\n\nIni MENGHAPUS entri dari antrian TANPA memberi tahu pelanggan (pakai bila ternyata foto keluhan, bukan transfer).\nBalas *ya* untuk hapus, atau *batal*.",
            data);
    } else {
        text = renderResponseTemplate(
            "payment_proof_admin_confirm_prompt",
            "💰 *Konfirmasi pembayaran*\n\n${nama}\nTagihan ${periode}: ${jumlah}\n\nBalas *ya* untuk tandai LUNAS, atau *tolak <alasan>*.",
            data);
    }
    return ctx.reply(text, { skipDuplicateCheck: true });
}

function replyFailure(ctx, code, result) {
    if (result.reason === "not_found") {
        return ctx.reply(renderResponseTemplate(
            "payment_proof_admin_not_found",
            "❌ Bukti *${kode}* tidak ditemukan. Ketik *bukti* untuk melihat antrian.",
            { kode: code }
        ), { skipDuplicateCheck: true });
    }
    if (result.reason === "already_processed") {
        return ctx.reply(renderResponseTemplate(
            "payment_proof_admin_already_processed",
            "ℹ️ Bukti *${kode}* sudah diproses sebelumnya (status: ${status}).",
            { kode: code, status: result.status || "-" }
        ), { skipDuplicateCheck: true });
    }
    // Tidak ada yang bisa dilunasi. Ini BUKAN error sistem — ini penolakan yang disengaja: menandai
    // "confirmed" tanpa ada tagihan membuat antrian berbohong. Arahkan admin ke *hapus* (aksi yang
    // memang untuk foto bukan-bukti-bayar, dan yang TIDAK mengirim apa pun ke pelanggan).
    if (result.reason === "no_outstanding") {
        return ctx.reply(renderResponseTemplate(
            "payment_proof_admin_no_outstanding",
            "🛑 *${kode}* tidak dikonfirmasi.\n\nPelanggan ini *sudah lunas* untuk periode ${periode} — tidak ada tagihan yang perlu dilunasi, jadi foto ini kemungkinan besar BUKAN bukti pembayaran.\n\n👉 Balas *hapus ${kode}* untuk membuang dari antrian (pelanggan TIDAK dikirimi pesan apa pun).\nKalau ini benar-benar *bayar di muka*, catat lewat menu Bayar di Muka di portal.",
            { kode: code, periode: padPeriod(result.periodMonth, result.periodYear) }
        ), { skipDuplicateCheck: true });
    }
    const pesan = result.reason === "user_not_found"
        ? "data pelanggan tidak ditemukan"
        : (result.error || "kesalahan sistem");
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_error",
        "⚠️ Gagal memproses bukti *${kode}*: ${pesan}.\nBukti TETAP menunggu — coba lagi atau proses lewat portal admin.",
        { kode: code, pesan }
    ), { skipDuplicateCheck: true });
}

// ── Eksekusi ──

async function executeConfirm(ctx, service, code, adminName) {
    const result = await service.confirmProof(code, { adminName });
    if (!result.ok) return replyFailure(ctx, code, result);

    const record = result.record || {};
    const periode = padPeriod(record.periodMonth, record.periodYear);

    if (result.alreadyPaid) {
        return ctx.reply(renderResponseTemplate(
            "payment_proof_admin_confirm_already_paid",
            "✅ Bukti *${kode}* ditandai terkonfirmasi.\n\nTagihan ${periode} milik ${nama} memang SUDAH tercatat lunas sebelumnya, jadi tidak ada struk ganda yang dikirim.",
            { kode: code, periode, nama: record.userName || "-" }
        ), { skipDuplicateCheck: true });
    }

    const sisa = service.listPending().length;
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_confirm_ok",
        "✅ *Pembayaran dikonfirmasi*\n\n${nama} — tagihan ${periode} ${jumlah} tercatat LUNAS.\nStruk sudah dikirim ke pelanggan.${reaktivasi}\n\nSisa antrian: ${sisa} bukti.",
        {
            nama: record.userName || "-",
            periode,
            jumlah: formatRupiah(record.amountDue),
            reaktivasi: describeReactivation(result.settlement && result.settlement.reactivation),
            sisa
        }
    ), { skipDuplicateCheck: true });
}

async function executeReject(ctx, service, code, reason, adminName) {
    const result = await service.rejectProof(code, { adminName, reason });
    if (!result.ok) return replyFailure(ctx, code, result);

    const record = result.record || {};
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_reject_ok",
        "🚫 Bukti *${kode}* dari ${nama} ditolak.\nAlasan: ${alasan}\n\nPelanggan sudah diberi tahu untuk mengirim ulang.",
        { kode: code, nama: record.userName || "-", alasan: reason || "-" }
    ), { skipDuplicateCheck: true });
}

async function executeDelete(ctx, service, code, reason, adminName) {
    const result = await service.deleteProof(code, { adminName, reason });
    if (!result.ok) return replyFailure(ctx, code, result);

    const record = result.record || {};
    const sisa = service.listPending().length;
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_delete_ok",
        "🗑️ Bukti *${kode}* dari ${nama} DIHAPUS dari antrian (dianggap bukan bukti bayar).\nPelanggan *tidak* diberi tahu.\n\nSisa antrian: ${sisa} bukti.",
        { kode: code, nama: record.userName || "-", sisa }
    ), { skipDuplicateCheck: true });
}

/** Jalankan aksi pada satu bukti (id/kode sudah pasti). Satu tempat mapping aksi → eksekutor. */
async function dispatchAction(ctx, service, action, id, reason, adminName) {
    if (action === "reject") return executeReject(ctx, service, id, reason, adminName);
    if (action === "delete") return executeDelete(ctx, service, id, reason, adminName);
    return executeConfirm(ctx, service, id, adminName);
}

// ── Borongan "terima semua" ──

/**
 * Tampilkan SEMUA bukti yang akan dilunasi + minta SATU penegasan `ya`. Aksi uang massal wajib
 * ditegaskan sekali; snapshot disimpan supaya rangkuman "yang akan dikonfirmasi" tetap jelas.
 */
async function promptConfirmAll(ctx, service) {
    const items = service.listPending();
    if (!items.length) return replyEmptyQueue(ctx);

    if (typeof ctx.setUserState === "function" && ctx.stateSender) {
        ctx.setUserState(ctx.stateSender, { step: STEP_CONFIRM_ALL, action: "confirm_all", items: items.map(snapshotOf) });
    }

    const total = items.length;
    const daftar = buildPendingListBody(items);
    // Fallback backtick (bukan kutip biasa): diinterpolasi di tempat, jadi kalau key template hilang
    // pun ${slot} tak bocor mentah ke admin (guard #b251 / kunci-dan-fallback-template).
    const text = renderResponseTemplate(
        "payment_proof_admin_confirm_all_prompt",
        `💰 *Konfirmasi SEMUA bukti* (${total})\n\n${daftar}\n\nBalas *ya* untuk menandai LUNAS semua yang masih punya tagihan (yang sudah lunas otomatis dilewati), atau *batal*.`,
        { total, daftar }
    );
    return ctx.reply(text, { skipDuplicateCheck: true });
}

/** Rakit satu baris ringkas "Nama (Rp…)" untuk daftar hasil borongan. */
function nameList(entries) {
    return entries
        .map((e) => (e.amountDue != null ? `${e.userName} (${formatRupiah(e.amountDue)})` : e.userName))
        .join(", ");
}

/**
 * Eksekusi borongan: lunasi tiap bukti pending lewat service.confirmManyPending (gerbang uang sama —
 * yang tak punya tagihan DILEWATI, tak pernah ditandai lunas), lalu balas RINGKASAN.
 */
async function executeConfirmAll(ctx, service, adminName) {
    const result = await service.confirmManyPending({ adminName });

    if (!result || result.total === 0) return replyEmptyQueue(ctx);

    const parts = [];
    if (result.confirmed.length) parts.push(`✅ ${result.confirmed.length} dikonfirmasi: ${nameList(result.confirmed)}`);
    if (result.alreadyPaid.length) parts.push(`ℹ️ ${result.alreadyPaid.length} sudah lunas sebelumnya: ${nameList(result.alreadyPaid)}`);
    if (result.skipped.length) parts.push(`⏭️ ${result.skipped.length} dilewati (tak ada tagihan): ${nameList(result.skipped)}`);
    if (result.failed.length) parts.push(`⚠️ ${result.failed.length} GAGAL (tetap menunggu): ${nameList(result.failed)}`);
    // Reaktivasi tak selalu berhasil/terbaca — jangan tenggelamkan pelanggan yang mungkin MASIH
    // terisolir walau tagihannya sudah tercatat lunas.
    const perluCek = result.confirmed.filter((c) => reactivationNeedsAttention(c.reactivation));
    if (perluCek.length) parts.push(`🔌 ${perluCek.length} perlu cek isolir manual: ${nameList(perluCek)}`);

    const sisa = service.listPending().length;
    const ringkasan = parts.join("\n") || "Tidak ada yang diproses.";
    // Fallback backtick — lihat catatan di promptConfirmAll.
    return ctx.reply(renderResponseTemplate(
        "payment_proof_admin_confirm_all_summary",
        `💰 *Borongan konfirmasi selesai*\n\n${ringkasan}\n\nStruk terkirim ke pelanggan yang baru lunas.\nSisa antrian: ${sisa} bukti.`,
        { ringkasan, sisa }
    ), { skipDuplicateCheck: true });
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
 * @param {Function} [ctx.resolveStaffRole] - override gate peran (untuk test).
 * @returns {Promise<{handled: boolean}>}
 */
async function handlePaymentProofAdminDecision(ctx) {
    try {
        const command = parseProofCommand(ctx.chats, extractQuotedText(ctx.msg));
        if (!command) return { handled: false };

        // Gate peran SESUDAH parsing: pelanggan yang kebetulan mengetik "ok" tak pernah sampai sini,
        // dan non-admin yang menebak formatnya jatuh senyap ke jalur intent biasa (fitur tak bocor).
        if (!isAdminActor(ctx)) return { handled: false };

        const service = getService(ctx);
        const adminName = adminNameOf(ctx);

        if (command.action === "list") {
            await replyPendingList(ctx, service, "confirm");
            return { handled: true };
        }

        // Borongan "terima semua" → tampilkan daftar + minta satu penegasan `ya` (lanjut di state
        // PAYPROOF_CONFIRM_ALL). Antrian kosong dijawab bersih (perintah eksplisit, bukan "ok" polos).
        if (command.action === "confirm_all") {
            await promptConfirmAll(ctx, service);
            return { handled: true };
        }

        // Sasaran eksplisit (kode / nomor) → langsung eksekusi.
        if (command.code) {
            await dispatchAction(ctx, service, command.action, command.code, command.reason, adminName);
            return { handled: true };
        }

        if (command.index) {
            const target = resolvePendingByIndex(service, command.index);
            if (!target) {
                const pending = service.listPending();
                if (!pending.length) await replyEmptyQueue(ctx);
                else await ctx.reply(renderResponseTemplate(
                    "payment_proof_admin_invalid_choice",
                    "Pilihan tidak valid. Balas angka *1*–*${total}*, atau *batal*.",
                    { total: pending.length }
                ), { skipDuplicateCheck: true });
                return { handled: true };
            }
            await dispatchAction(ctx, service, command.action, target.id, command.reason, adminName);
            return { handled: true };
        }

        // Perintah POLOS ("ok" / "tolak"). Antrian kosong → lepaskan pesannya: admin mungkin sedang
        // mengetik "ok" untuk hal lain, jangan dibajak.
        const pending = service.listPending();
        if (!pending.length) return { handled: false };

        if (pending.length === 1) {
            await promptDecision(ctx, pending[0], command.action);
        } else {
            await replyPendingList(ctx, service, command.action);
        }
        return { handled: true };
    } catch (err) {
        console.error("[PAYMENT_PROOF_ADMIN_ERROR]", err && err.message ? err.message : err);
        // Sudah kadung mengklaim pesan ini — beri tahu admin, jangan diam.
        try {
            await ctx.reply(renderResponseTemplate(
                "payment_proof_admin_error",
                "⚠️ Gagal memproses bukti *${kode}*: ${pesan}.\nBukti TETAP menunggu — coba lagi atau proses lewat portal admin.",
                { kode: "-", pesan: (err && err.message) || "kesalahan sistem" }
            ), { skipDuplicateCheck: true });
        } catch (_replyErr) {
            /* balasan best-effort */
        }
        return { handled: true };
    }
}

module.exports = {
    handlePaymentProofAdminDecision,
    parseProofCommand,
    extractQuotedText,
    // dipakai state domain PAYPROOF_*
    STEP_SELECT,
    STEP_CONFIRM,
    STEP_CONFIRM_ALL,
    CMD_LIST,
    getService,
    isAdminActor,
    adminNameOf,
    isYes,
    isConsentYes,
    executeConfirm,
    executeReject,
    executeDelete,
    executeConfirmAll,
    replyPendingList,
    replyEmptyQueue,
    promptDecision,
    resolvePendingByIndex
};
