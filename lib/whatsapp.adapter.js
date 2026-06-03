/**
 * Header Doc
 * Purpose: Adapter kompatibilitas untuk call-site legacy dengan delegasi ke delivery boundary WhatsApp terpusat.
 * Caller: Service/lib dan route legacy yang masih memakai pola adapter lama.
 * Deps: `./whatsapp-gateway` dan `./whatsapp-delivery-service`.
 * MainFuncs: `isWhatsAppReady`, `sendPayload`, `sendText`, `sendMedia`, `downloadMedia`.
 * SideEffects: Mengirim payload WhatsApp melalui delivery service/gateway runtime aktif.
 */
"use strict";

const gateway = require("./whatsapp-gateway");
const delivery = require("./whatsapp-delivery-service");

module.exports = {
    isWhatsAppReady: gateway.isReady,
    async sendPayload(recipient, payload, options = {}) {
        const result = await delivery.sendMessage(recipient, payload, options);
        if (!result.sent) {
            throw new Error(result.warning || result.errorCode || "WHATSAPP_DELIVERY_FAILED");
        }
        return result.result || result;
    },
    async sendText(recipient, text, options = {}) {
        const result = await delivery.sendMessage(recipient, { text }, options);
        if (!result.sent) {
            throw new Error(result.warning || result.errorCode || "WHATSAPP_DELIVERY_FAILED");
        }
        return result.result || result;
    },
    async sendMedia(recipient, mediaPayload, options = {}) {
        const result = await delivery.sendMessage(recipient, mediaPayload, options);
        if (!result.sent) {
            throw new Error(result.warning || result.errorCode || "WHATSAPP_DELIVERY_FAILED");
        }
        return result.result || result;
    },
    async downloadMedia(message, outputType = "buffer", options = {}) {
        const baileys = await import("@whiskeysockets/baileys");
        return baileys.downloadMediaMessage(message, outputType, options);
    }
};
