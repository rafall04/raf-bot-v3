/**
 * Header Doc
 * Purpose: Memusatkan business logic broadcast admin agar route tidak memegang placeholder formatting dan pengiriman WA langsung.
 * Caller: `routes/admin-content-routes.js`.
 * Deps: `lib/whatsapp-gateway`, `lib/whatsapp-delivery-service`, `lib/utils`, dan `lib/error-handler`.
 * MainFuncs: `createAdminBroadcastService`, `queueBroadcast`.
 * SideEffects: Mengirim pesan WhatsApp broadcast ke banyak pelanggan secara asynchronous.
 */
"use strict";

const { createError, ErrorTypes } = require("../lib/error-handler");

function defaultDeps() {
    return {
        hasAuthenticatedSession: require("../lib/whatsapp-gateway").hasAuthenticatedSession,
        sendMessageToMany: require("../lib/whatsapp-delivery-service").sendMessageToMany,
        normalizePhoneNumber: require("../lib/utils").normalizePhoneNumber
    };
}

function formatBroadcastMessage(template, user) {
    let message = String(template || "");
    const placeholders = {
        nama: user.name || "",
        paket: user.subscription || "",
        alamat: user.address || "",
        username_pppoe: user.pppoe_username || ""
    };

    for (const [key, value] of Object.entries(placeholders)) {
        const regex = new RegExp(`\\$\\{${key}\\}`, "g");
        message = message.replace(regex, value);
    }

    return message;
}

function createAdminBroadcastService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    async function sendBroadcast(text, targetUsers = []) {
        for (const user of targetUsers) {
            if (!user?.phone_number) {
                continue;
            }

            const personalizedText = formatBroadcastMessage(text, user);
            const numbers = String(user.phone_number)
                .split("|")
                .map((number) => deps.normalizePhoneNumber(number))
                .filter(Boolean);

            if (numbers.length === 0) {
                continue;
            }

            await deps.sendMessageToMany(numbers, { text: personalizedText });
        }
    }

    return {
        async queueBroadcast(input = {}) {
            if (!deps.hasAuthenticatedSession()) {
                throw createError(ErrorTypes.WHATSAPP_ERROR, "The server is not connected to WhatsApp.", 500);
            }

            const text = String(input.text || "");
            const allUsers = Array.isArray(input.allUsers) ? input.allUsers : [];
            const selectedUsers = Array.isArray(input.selectedUsers) ? input.selectedUsers : [];
            const targetUsers = input.sendToAll ? allUsers : selectedUsers;

            if (targetUsers.length === 0) {
                throw createError(ErrorTypes.VALIDATION_ERROR, "No valid users selected for broadcast.", 400);
            }

            Promise.resolve(sendBroadcast(text, targetUsers)).catch((error) => {
                console.error("[BROADCAST_ERROR]", error);
            });

            return {
                status: 202,
                message: `Broadcast has been initiated for ${targetUsers.length} user(s).`,
                data: {
                    totalTargets: targetUsers.length
                }
            };
        }
    };
}

module.exports = {
    createAdminBroadcastService
};
