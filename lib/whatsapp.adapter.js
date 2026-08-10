/**
 * Header Doc
 * Purpose: Adapter kompatibilitas untuk call-site legacy dengan delegasi ke delivery boundary WhatsApp terpusat.
 * Caller: Service/lib dan route legacy yang masih memakai pola adapter lama.
 * Deps: `./whatsapp-gateway` dan `./whatsapp-delivery-service`.
 * MainFuncs: `isWhatsAppReady`, `sendPayload`, `sendText`, `sendMedia`, `downloadMedia`, `getGroups`,
 *            `getGroupParticipants`.
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
    },
    // Daftar grup tempat bot jadi member (untuk pemilih grup PSB di halaman Config).
    async getGroups() {
        const conn = global.conn || global.raf;
        if (!conn || typeof conn.groupFetchAllParticipating !== "function") {
            throw new Error("WhatsApp belum terkoneksi");
        }
        const map = await conn.groupFetchAllParticipating();
        return Object.values(map || {})
            .map((g) => ({ id: g.id, subject: g.subject || "(tanpa nama)", size: Array.isArray(g.participants) ? g.participants.length : 0 }))
            .sort((a, b) => a.subject.localeCompare(b.subject));
    },
    // Anggota satu grup — dipakai halaman kas usaha supaya pemilik dipilih dari DAFTAR, bukan
    // diketik manual. Mengetik nomor sendiri gampang salah satu digit, dan gerbang pemilik
    // bersifat gagal-tertutup: satu digit meleset = perintah `kas` diabaikan diam-diam.
    // ID dikembalikan APA ADANYA (termasuk `@lid`) — pemanggil yang memilah, karena
    // `@lid` BUKAN nomor telepon dan tak boleh dikarang jadi `62<lid>`.
    async getGroupParticipants(groupId) {
        const conn = global.conn || global.raf;
        if (!conn || typeof conn.groupFetchAllParticipating !== "function") {
            throw new Error("WhatsApp belum terkoneksi");
        }
        const map = await conn.groupFetchAllParticipating();
        const grup = (map || {})[groupId];
        if (!grup) return [];

        // `label` = nama yang layak dibaca MANUSIA. `@lid` TIDAK BOLEH ditampilkan apa adanya
        // (CLAUDE.md): angkanya bukan nomor telepon, tak berarti apa-apa bagi pembacanya, dan
        // memilih pemilik kas dari deretan angka acak nyaris pasti salah pilih.
        // Urutan: nama kontak/pushname > nomor hasil pemetaan @lid > nomor biasa > penanda jujur.
        const { getStoredMappingByLid } = require("./jid-utils");
        return (grup.participants || [])
            .map((p) => {
                const id = String(p.id || p.jid || "");
                if (!id) return null;

                let label = String(p.name || p.notify || p.verifiedName || "").trim();
                if (!label && id.endsWith("@lid")) {
                    let nomor = null;
                    try {
                        const petaan = getStoredMappingByLid(id);
                        nomor = petaan && petaan.phoneNumber;
                    } catch (_e) { nomor = null; }
                    // Belum terpetakan = katakan begitu, jangan mengarang nomor dari angka @lid.
                    label = nomor || "anggota grup (nomor belum dikenali)";
                }
                if (!label) label = id.split("@")[0];

                return { id, label, admin: !!p.admin, lid: id.endsWith("@lid") };
            })
            .filter(Boolean);
    }
};
