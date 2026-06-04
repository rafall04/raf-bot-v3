/**
 * Header Doc
 * Purpose: Repository WiFi untuk membungkus concern log/history perubahan WiFi pada flow bot/admin Wave 2.
 * Caller: `services/wifi-management.service.js` dan consumer WiFi lain yang butuh write-path log perubahan.
 * Deps: `lib/wifi-logger`.
 * MainFuncs: `createWifiRepository`, `saveWifiNameChange`, `saveWifiPasswordChange`, `saveWebWifiChange`, dan `saveWebWifiChangeByDevice`.
 * SideEffects: Menulis entri log perubahan WiFi melalui adapter logger yang ada.
 */
"use strict";

function sanitizePhone(identifier = "") {
    return String(identifier || "")
        .replace("@s.whatsapp.net", "")
        .replace("@lid", "");
}

/**
 * Ambil nomor utama pelanggan (primary di kolom phone_number, dipisah `|`).
 * Fallback ke sanitized sender hanya kalau user benar-benar tidak punya phone_number.
 */
function pickCustomerPrimaryPhone(user, fallbackSender) {
    if (user?.phone_number) {
        const primary = String(user.phone_number).split("|")[0].trim();
        if (primary) return sanitizePhone(primary);
    }
    return sanitizePhone(fallbackSender || "");
}

/**
 * Normalisasi actor argument jadi shape { role, identifier, phone, displayName }.
 * Default `customer` saat tidak provided supaya backward-compat dengan caller lama.
 */
function normalizeActor(actor, fallbackSender) {
    const role = actor?.role || "customer";
    const phone = actor?.phone || sanitizePhone(fallbackSender || "");
    const displayName = actor?.displayName || null;
    const identifier = actor?.identifier || (role === "customer" ? "customer" : displayName || phone || role);
    return { role, identifier, phone, displayName };
}

function buildChangedByLabel(actor) {
    if (!actor || actor.role === "customer") return "customer";
    // teknisi / admin / owner → nama display + role suffix supaya audit jelas.
    const label = actor.displayName || actor.identifier || actor.phone || actor.role;
    return `${actor.role}:${label}`;
}

function createWifiRepository(options = {}) {
    const logWifiChange = options.logWifiChange || require("../lib/wifi-logger").logWifiChange;
    const buildWebWifiLogPayload = options.buildWebWifiLogPayload || require("../lib/wifi-logger").buildWebWifiLogPayload;

    return {
        async saveWifiNameChange(user, newName, sender, type, actor = null, oldName = null) {
            const actorCtx = normalizeActor(actor, sender);
            return logWifiChange({
                userId: user.id,
                deviceId: user.device_id,
                changeType: "name",
                changes: {
                    oldName: oldName || "(tidak dicatat)",
                    newName
                },
                changedBy: buildChangedByLabel(actorCtx),
                changeSource: "wa_bot",
                customerName: user.name,
                customerPhone: pickCustomerPrimaryPhone(user, sender),
                actorRole: actorCtx.role,
                actorIdentifier: actorCtx.identifier,
                actorPhone: actorCtx.phone,
                reason: `Perubahan nama WiFi melalui WhatsApp Bot (${type})`,
                notes: type === "bulk_auto" ? `Mengubah nama untuk ${user.bulk.length} SSID` : null
            });
        },

        async saveWifiPasswordChange(user, newPassword, sender, type, actor = null) {
            const actorCtx = normalizeActor(actor, sender);
            return logWifiChange({
                userId: user.id,
                deviceId: user.device_id,
                changeType: "password",
                changes: {
                    newPassword
                },
                changedBy: buildChangedByLabel(actorCtx),
                changeSource: "wa_bot",
                customerName: user.name,
                customerPhone: pickCustomerPrimaryPhone(user, sender),
                actorRole: actorCtx.role,
                actorIdentifier: actorCtx.identifier,
                actorPhone: actorCtx.phone,
                reason: `Perubahan password WiFi melalui WhatsApp Bot (${type})`,
                notes: type === "bulk_auto" ? `Mengubah password untuk ${user.bulk.length} SSID` : null
            });
        },

        async saveWebWifiChange({ customer, deviceId, payload, currentWifiInfo, staffUser, req, fallbackReason }) {
            const loggingPlan = buildWebWifiLogPayload({
                customer,
                deviceId,
                payload,
                currentWifiInfo,
                staffUser,
                req,
                fallbackReason
            });

            if (loggingPlan.shouldLog) {
                await logWifiChange(loggingPlan.logData);
            }

            return loggingPlan;
        },

        async saveWebWifiChangeByDevice({ userRepository, deviceId, payload, currentWifiInfo, staffUser, req }) {
            const customer = userRepository.findByDeviceId(deviceId);
            const fallbackReason = customer ? "" : `Customer not found for device ${deviceId}`;

            return this.saveWebWifiChange({
                customer,
                deviceId,
                payload,
                currentWifiInfo,
                staffUser,
                req,
                fallbackReason
            });
        }
    };
}

module.exports = {
    createWifiRepository
};
