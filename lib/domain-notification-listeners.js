/**
 * Header Doc
 * Purpose: Mendaftarkan listener notifikasi domain awal agar event bisnis dapat diterjemahkan ke delivery WA terpusat.
 * Caller: Route/controller/service yang memerlukan listener event notifikasi aktif.
 * Deps: `./domain-events` dan `./whatsapp-delivery-service`.
 * MainFuncs: `initializeDomainNotificationListeners`.
 * SideEffects: Mendaftarkan listener singleton dan mengirim pesan WhatsApp melalui delivery service.
 */
"use strict";

const { DOMAIN_EVENTS, onAsync } = require("./domain-events");
const { sendMessage } = require("./whatsapp-delivery-service");

let initialized = false;

async function deliverPayload(recipient, message, options = {}) {
    const delivery = await sendMessage(recipient, message, options);
    if (!delivery.sent) {
        console.error("[DOMAIN_NOTIFICATION_SEND_ERROR]", {
            recipient,
            error: delivery.warning || delivery.errorCode || "SEND_FAILED"
        });
    }
    return {
        recipient,
        sent: delivery.sent,
        errorCode: delivery.errorCode || null,
        warning: delivery.warning || null,
        result: delivery.result || null
    };
}

async function deliverToRecipients(recipients, message, options = {}) {
    const targets = Array.isArray(recipients) ? recipients.filter(Boolean) : [recipients].filter(Boolean);
    const results = [];
    for (const recipient of targets) {
        results.push(await deliverPayload(recipient, message, options));
    }
    return results;
}

function initializeDomainNotificationListeners() {
    if (initialized) {
        return;
    }

    onAsync(DOMAIN_EVENTS.PACKAGE_CHANGE_APPROVED, async ({ recipient, message, options }) => {
        return deliverPayload(recipient, message, options);
    });

    onAsync(DOMAIN_EVENTS.DISCOUNT_APPLIED, async ({ recipient, message, options }) => {
        return deliverPayload(recipient, message, options);
    });

    onAsync(DOMAIN_EVENTS.PARTIAL_PAYMENT_REQUESTED, async ({ recipients, message, options }) => {
        return deliverToRecipients(recipients, message, options);
    });

    onAsync(DOMAIN_EVENTS.TICKET_CUSTOMER_UPDATE_REQUESTED, async ({ recipients, payloads, options }) => {
        const targets = Array.isArray(recipients) ? recipients.filter(Boolean) : [recipients].filter(Boolean);
        const messages = Array.isArray(payloads) ? payloads.filter(Boolean) : [];
        const results = [];

        for (const recipient of targets) {
            for (const payload of messages) {
                results.push(await deliverPayload(recipient, payload, options));
            }
        }

        return results;
    });

    initialized = true;
}

module.exports = {
    initializeDomainNotificationListeners
};
