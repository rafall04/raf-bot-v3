/**
 * Header Doc
 * Purpose: Business rules alur "pelanggan kirim bukti bayar → admin konfirmasi". Menyimpan bukti +
 *   snapshot tagihan, memberi notif admin BERGAMBAR, lalu mengeksekusi konfirmasi (catat lunas via
 *   settleTagihanPayment: applyPaymentStatusChange + reaktivasi best-effort) atau penolakan. Semua
 *   teks user-facing dirender lewat template (response_templates.json) dengan fallback aman.
 * Caller: message/handlers/payment-proof-handler.js (submit); routes/payment-proof.js (list/serve/konfirmasi/tolak).
 * Deps: repositories/payment-proof.repository, lib/payment-finance-service, lib/services/bill-payment-settlement,
 *   lib/whatsapp-delivery-service, lib/whatsapp-critical-delivery, lib/admin-recipients, lib/template-service, lib/id-generator.
 * MainFuncs: createPaymentProofService/getPaymentProofService ->
 *   { handleIncomingProof, listPending, getById, getFilePath, confirmProof, rejectProof }.
 * SideEffects: Tulis store + file bukti, kirim WA (notif admin bergambar + notifikasi hasil ke pelanggan),
 *   menulis ledger pembayaran (paid) + reaktivasi MikroTik via settlement.
 */
"use strict";

const { createPaymentProofRepository } = require("../repositories/payment-proof.repository");
const financeService = require("../lib/payment-finance-service");
const { createBillPaymentSettlement } = require("../lib/services/bill-payment-settlement");
const { renderCategoryTemplate } = require("../lib/template-service");
const { getAdminJids } = require("../lib/admin-recipients");
const { generatePaymentProofId } = require("../lib/id-generator");

function renderResponseTemplate(key, data = {}, fallback = "") {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found && result.text.trim() ? result.text : (fallback || key);
}

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
}

function padPeriod(month, year) {
    return `${String(month).padStart(2, "0")}/${year}`;
}

// Bungkus settlement secara lazy — createBillPaymentSettlement() meng-`require` MikroTik/isolir saat
// dikonstruksi. Menundanya sampai konfirmasi pertama menjaga konstruksi service tetap ringan (mis. saat
// hanya submit bukti / saat di-import di test) tanpa menarik dependency berat WA/MikroTik.
function createLazyBillSettlement() {
    let impl = null;
    return {
        settleTagihanPayment: (args) => {
            if (!impl) impl = createBillPaymentSettlement();
            return impl.settleTagihanPayment(args);
        }
    };
}

function defaultDeps() {
    const delivery = require("../lib/whatsapp-delivery-service");
    return {
        repository: createPaymentProofRepository(),
        getCurrentBillingPeriod: financeService.getCurrentBillingPeriod,
        getPaymentPositionForPeriod: financeService.getPaymentPositionForPeriod,
        getEffectivePrice: financeService.getEffectivePrice,
        billSettlement: createLazyBillSettlement(),
        sendMessageToMany: delivery.sendMessageToMany,
        sendCritical: require("../lib/whatsapp-critical-delivery").sendCritical,
        getAdminJids: () => getAdminJids(),
        findUserById: (id) =>
            (Array.isArray(global.users) ? global.users : []).find((u) => String(u.id) === String(id)) || null,
        getConfig: () => (global.config || {}),
        logger: console
    };
}

function createPaymentProofService(overrides = {}) {
    const deps = { ...defaultDeps(), ...overrides };

    function logError(msg, err) {
        if (deps.logger && deps.logger.error) deps.logger.error(msg, err && err.message ? err.message : err);
    }
    function logWarn(msg, extra) {
        if (deps.logger && deps.logger.warn) deps.logger.warn(msg, extra);
    }

    // Snapshot tagihan periode berjalan — dipakai untuk label admin (BELUM/SUDAH LUNAS) & audit.
    async function buildBillingSnapshot(user) {
        const { periodMonth, periodYear } = deps.getCurrentBillingPeriod();
        const amountDue = deps.getEffectivePrice(user) || 0;
        let outstanding = null;
        let isFullyPaid = null;
        try {
            const position = await deps.getPaymentPositionForPeriod(user, periodMonth, periodYear, { amountDue });
            outstanding = position.outstanding;
            isFullyPaid = position.is_fully_paid;
        } catch (err) {
            logError("[PAYMENT_PROOF] Snapshot tagihan gagal:", err);
        }
        return { periodMonth, periodYear, amountDue, outstanding, isFullyPaid };
    }

    async function notifyAdminsOfProof(record, billing, buffer, fileType) {
        const admins = deps.getAdminJids();
        if (!admins || admins.length === 0) {
            logWarn("[PAYMENT_PROOF] Tak ada JID admin untuk notif bukti bayar");
            return;
        }

        const cfg = deps.getConfig();
        const adminUrl = `${cfg.site_url_bot || "http://localhost:3100"}/konfirmasi-bayar`;
        const statusLabel = billing.isFullyPaid === true
            ? "SUDAH LUNAS (mungkin bayar di muka / bukan bukti bayar)"
            : (billing.isFullyPaid === false ? "BELUM LUNAS" : "status tak diketahui");
        const tagihanNominal = billing.outstanding != null && billing.outstanding > 0
            ? billing.outstanding
            : record.amountDue;

        const caption = renderResponseTemplate("payment_proof_admin_notification", {
            id: record.id,
            nama: record.userName,
            telepon: record.phone,
            status: statusLabel,
            tagihan: formatRupiah(tagihanNominal),
            periode: padPeriod(record.periodMonth, record.periodYear),
            adminUrl
        }, `📸 *Dugaan bukti pembayaran*\n\nPelanggan: ${record.userName} (${record.phone})\nStatus: *${statusLabel}*\nTagihan ${padPeriod(record.periodMonth, record.periodYear)}: ${formatRupiah(tagihanNominal)}\nKode: *${record.id}*\n\nKonfirmasi di: ${adminUrl}`);

        const payload = fileType === "document"
            ? { document: buffer, fileName: `${record.id}.pdf`, mimetype: "application/pdf", caption }
            : { image: buffer, caption };

        const res = await deps.sendMessageToMany(admins, payload);
        if (!res || !res.sent) {
            logWarn("[PAYMENT_PROOF] Notif admin tidak terkirim", res && res.errorCode);
        }
    }

    /**
     * Fase 1: simpan bukti + snapshot tagihan + notif admin. Kembalikan ackText untuk dibalas ke
     * pelanggan oleh handler (lewat reply-runtime yang aman untuk @lid).
     */
    async function handleIncomingProof({ user, canonicalSender, pushname, messageType, buffer, caption = "" }) {
        const ext = messageType === "documentMessage" ? "pdf" : "jpg";
        const fileType = messageType === "documentMessage" ? "document" : "image";
        const billing = await buildBillingSnapshot(user);
        const displayName = pushname || user.name || (canonicalSender ? String(canonicalSender).split("@")[0] : "Pelanggan");

        const record = {
            id: generatePaymentProofId(),
            userId: canonicalSender,            // JID kanonik → target notifikasi hasil
            userDbId: user.id,
            userName: user.name || displayName,
            phone: user.phone_number || (canonicalSender ? String(canonicalSender).split("@")[0] : ""),
            periodMonth: billing.periodMonth,
            periodYear: billing.periodYear,
            amountDue: billing.amountDue,
            outstandingAtSubmit: billing.outstanding,
            wasFullyPaidAtSubmit: billing.isFullyPaid,
            fileType,
            caption: caption || "",
            submittedAt: new Date().toISOString(),
            status: "pending",
            verifiedBy: null,
            verifiedAt: null,
            notes: null
        };

        const saved = await deps.repository.create(record, buffer, ext);

        // Notif admin best-effort — kegagalan kirim TIDAK menggagalkan pencatatan bukti.
        await notifyAdminsOfProof(saved, billing, buffer, fileType).catch((err) =>
            logError("[PAYMENT_PROOF] Notif admin error:", err));

        const ackText = renderResponseTemplate("payment_proof_received", {
            nama: displayName
        }, `Foto/bukti kamu sudah kami terima ✅\n\nKalau ini *bukti pembayaran*, admin akan segera mengecek & mengonfirmasi — kami kabari setelah beres. 🙏\nKalau kamu mau *lapor gangguan*, ketik *lapor* ya.`);

        return { record: saved, billing, ackText };
    }

    // ── Fase 2/3: sisi admin ──

    function listPending() {
        return deps.repository
            .listPending()
            .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
    }

    function getById(id) {
        return deps.repository.getById(id);
    }

    function getFilePath(record) {
        return deps.repository.getFilePath(record);
    }

    async function notifyCustomerConfirmed(record, user, periodLabel) {
        const text = renderResponseTemplate("payment_proof_confirmed", {
            nama: user.name || record.userName,
            paket: user.subscription || "",
            periode: periodLabel,
            jumlah: formatRupiah(record.amountDue)
        }, `✅ *Pembayaran Terkonfirmasi*\n\nTerima kasih ${user.name || record.userName} 🙏\nPembayaran tagihan ${periodLabel} sebesar ${formatRupiah(record.amountDue)} sudah kami terima. Layananmu tetap/kembali aktif.`);
        // Kontrak sendCritical: payload WAJIB objek { text }.
        await deps.sendCritical(record.userId, { text }, { label: "payment-proof-confirmed" });
    }

    async function notifyCustomerRejected(record, reason) {
        const text = renderResponseTemplate("payment_proof_rejected", {
            nama: record.userName,
            alasan: reason || "-"
        }, `Mohon maaf ${record.userName}, bukti pembayaran yang kamu kirim belum bisa kami konfirmasi.\nAlasan: ${reason || "-"}\n\nSilakan kirim ulang bukti yang jelas atau hubungi admin ya 🙏`);
        // Kontrak sendCritical: payload WAJIB objek { text }.
        await deps.sendCritical(record.userId, { text }, { label: "payment-proof-rejected" });
    }

    /**
     * Konfirmasi bukti → catat lunas (fail-closed) + reaktivasi best-effort + struk pelanggan.
     * Idempoten: record non-pending ditolak; ledger yang sudah lunas → no_change (tanpa struk ganda).
     */
    async function confirmProof(id, { adminName = "admin", notes = "" } = {}) {
        const record = deps.repository.getById(id);
        if (!record) return { ok: false, reason: "not_found" };
        if (record.status !== "pending") return { ok: false, reason: "already_processed", status: record.status };

        const user = deps.findUserById(record.userDbId);
        if (!user) return { ok: false, reason: "user_not_found" };

        let settlement;
        try {
            settlement = await deps.billSettlement.settleTagihanPayment({
                user,
                amountPaid: record.amountDue || deps.getEffectivePrice(user),
                periodMonth: record.periodMonth,
                periodYear: record.periodYear,
                paymentMethod: "TRANSFER_BANK",
                reffId: record.id
            });
        } catch (err) {
            logError("[PAYMENT_PROOF] Gagal catat lunas:", err);
            return { ok: false, reason: "settle_failed", error: err.message };
        }

        const ledgerAction = settlement.ledger && settlement.ledger.action;
        const updated = await deps.repository.update(id, {
            status: "confirmed",
            verifiedBy: adminName,
            verifiedAt: new Date().toISOString(),
            notes: notes || null,
            ledgerAction: ledgerAction || null,
            reactivation: settlement.reactivation || null
        });

        // Struk hanya bila transaksi INI yang membuat lunas (hindari struk ganda saat double-confirm).
        if (ledgerAction === "paid") {
            await notifyCustomerConfirmed(record, user, padPeriod(record.periodMonth, record.periodYear))
                .catch((err) => logError("[PAYMENT_PROOF] Struk pelanggan gagal:", err));
        }

        return { ok: true, record: updated, settlement, alreadyPaid: ledgerAction !== "paid" };
    }

    /**
     * Tolak bukti → tandai rejected + beri tahu pelanggan (best-effort, tak melempar).
     */
    async function rejectProof(id, { adminName = "admin", reason = "" } = {}) {
        const record = deps.repository.getById(id);
        if (!record) return { ok: false, reason: "not_found" };
        if (record.status !== "pending") return { ok: false, reason: "already_processed", status: record.status };

        const updated = await deps.repository.update(id, {
            status: "rejected",
            verifiedBy: adminName,
            verifiedAt: new Date().toISOString(),
            notes: reason || null
        });

        await notifyCustomerRejected(record, reason)
            .catch((err) => logError("[PAYMENT_PROOF] Notif tolak pelanggan gagal:", err));

        return { ok: true, record: updated };
    }

    return {
        deps,
        handleIncomingProof,
        listPending,
        getById,
        getFilePath,
        confirmProof,
        rejectProof
    };
}

let _singleton = null;
function getPaymentProofService() {
    if (!_singleton) _singleton = createPaymentProofService();
    return _singleton;
}

module.exports = { createPaymentProofService, getPaymentProofService };
