/**
 * Header Doc
 * Purpose: Menyediakan delivery service WhatsApp yang kompatibel untuk satu atau banyak penerima di atas gateway runtime WA.
 * Caller: Service notifikasi, route, handler bot, dan listener domain yang membutuhkan hasil kirim terstruktur.
 * Deps: `./notification-tracker`, `./whatsapp-gateway`, dan `./whatsapp-delivery-verdict`
 *   (baca penanda gagal wrapper supaya `sent` jujur).
 * MainFuncs: `sendMessage`, `sendMessageToMany`, `ensureJid`, `maskRecipient`.
 * SideEffects: Mengirim pesan melalui gateway WA aktif dan menormalisasi recipient untuk kebutuhan delivery.
 */
"use strict";

const { deduplicatePhones, normalizePhone } = require("./notification-tracker");
const gateway = require("./whatsapp-gateway");
const { deliveryFailureReason } = require("./whatsapp-delivery-verdict");

function maskRecipient(recipient) {
    const normalized = normalizePhone(recipient || "");
    if (!normalized) return "unknown";
    if (normalized.length <= 6) return normalized;
    return `${normalized.slice(0, 4)}****${normalized.slice(-2)}`;
}

function ensureJid(recipient) {
    if (!recipient) return "";
    if (recipient.includes("@")) return recipient;
    const normalized = normalizePhone(recipient);
    return normalized ? `${normalized}@s.whatsapp.net` : "";
}

function getSendOptions(options = {}) {
    if (!options || typeof options !== "object") return {};
    const sendOptions = { ...options };
    delete sendOptions.recipients;
    return sendOptions;
}

async function sendMessage(recipient, message, options = {}) {
    const jid = ensureJid(recipient);
    if (!jid) {
        return {
            sent: false,
            successCount: 0,
            recipients: [],
            errorCode: "INVALID_RECIPIENT"
        };
    }

    if (!gateway.isReady()) {
        return {
            sent: false,
            successCount: 0,
            recipients: [],
            errorCode: "WHATSAPP_NOT_CONNECTED",
            warning: `WhatsApp connection not ready (state: ${gateway.getConnectionState()})`
        };
    }

    try {
        const result = await gateway.sendPayload(jid, message, getSendOptions(options));
        // Wrapper notifikasi (whatsapp-notification-wrapper) TAK melempar pada error koneksi/USync —
        // ia memulangkan {status:'error'}. Tanpa cek ini `sent:true` dilaporkan padahal pesan tak
        // pernah keluar → safeSendMessage/cron log "✅ Terkirim" bohong. Baca penanda gagal wrapper.
        const failReason = deliveryFailureReason(result);
        if (failReason === "error") {
            const warning = (result && result.error) || "wrapper mengembalikan status error";
            console.error("[WA_DELIVERY_ERROR]", { recipient: maskRecipient(jid), error: warning });
            return {
                sent: false,
                successCount: 0,
                recipients: [],
                errorCode: "SEND_FAILED",
                warning
            };
        }
        // 'blocked_duplicate' BUKAN gagal: pesan identik baru saja terkirim (dedup bekerja) → penerima
        // tetap menerimanya. Laporkan terkirim, tapi tandai `deduplicated` supaya pemanggil tahu.
        return {
            sent: true,
            successCount: 1,
            recipients: [jid],
            result,
            ...(failReason === "blocked_duplicate" ? { deduplicated: true } : {})
        };
    } catch (error) {
        console.error("[WA_DELIVERY_ERROR]", {
            recipient: maskRecipient(jid),
            error: error.message
        });
        return {
            sent: false,
            successCount: 0,
            recipients: [],
            errorCode: "SEND_FAILED",
            warning: error.message
        };
    }
}

async function sendMessageToMany(recipients, message, options = {}) {
    const normalizedRecipients = deduplicatePhones(Array.isArray(recipients) ? recipients.filter(Boolean) : [])
        .map(ensureJid)
        .filter(Boolean);

    if (normalizedRecipients.length === 0) {
        return {
            sent: false,
            successCount: 0,
            recipients: [],
            errorCode: "NO_RECIPIENTS"
        };
    }

    const deliveredRecipients = [];
    let firstErrorCode = null;
    let firstWarning = null;

    for (const recipient of normalizedRecipients) {
        const result = await sendMessage(recipient, message, options);
        if (result.sent) {
            deliveredRecipients.push(recipient);
        } else if (!firstErrorCode) {
            firstErrorCode = result.errorCode || "SEND_FAILED";
            firstWarning = result.warning || null;
        }
    }

    return {
        sent: deliveredRecipients.length > 0,
        successCount: deliveredRecipients.length,
        recipients: deliveredRecipients,
        errorCode: firstErrorCode,
        warning: firstWarning
    };
}

module.exports = {
    sendMessage,
    sendMessageToMany,
    ensureJid,
    maskRecipient
};
