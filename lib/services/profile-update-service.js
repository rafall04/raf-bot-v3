/**
 * Header Doc
 * Purpose: Menangani perubahan profil jaringan pelanggan dan notifikasi hasil update profil.
 * Caller: Service compensation, speed-on-demand, dan workflow admin yang mengubah profil PPPoE.
 * Deps: `../mikrotik`, `../wifi`, `../templating`, `../template-service`, `../whatsapp-delivery-service`, dan `../whatsapp-gateway`.
 * MainFuncs: `applyProfileUpdate`, `applyProfileUpdateBatch`, `_sendNotification`.
 * SideEffects: Mengubah profil PPPoE, memutus sesi aktif, reboot router opsional, dan mengirim notifikasi pelanggan.
 */

const { updatePPPoEProfile, deleteActivePPPoEUser, assertMikrotikResult } = require('../mikrotik');
const { rebootRouter } = require('../wifi');
const { renderTemplate, templatesCache } = require('../templating');
const { renderResponseTemplateSafe } = require('../template-service');
const { sendMessageToMany } = require('../whatsapp-delivery-service');
const { hasAuthenticatedSession } = require('../whatsapp-gateway');

function renderResponseTemplate(key, data = {}) {
    // Jaring pengaman terpusat (#b302): buang ${slot} tak terisi + peringatkan, jangan bocor mentah.
    return renderResponseTemplateSafe(key, data);
}

class ProfileUpdateService {
    /**
     * Apply profile update untuk single user
     * 
     * @param {Object} user - User object dengan pppoe_username, device_id, phone_number, name
     * @param {string} newProfile - New profile name (Mikrotik profile)
     * @param {Object} options - Options untuk customize behavior
     * @param {boolean} options.rebootRouter - Reboot router setelah update (default: true)
     * @param {boolean} options.disconnectSession - Disconnect session setelah update (default: true)
     * @param {boolean} options.skipOnError - Skip user jika error (default: false)
     * @param {Object} options.notification - Notification config
     * @param {boolean} options.notification.enabled - Enable notification (default: false)
     * @param {string} options.notification.template - Template name (optional)
     * @param {Object} options.notification.data - Template data (optional)
     * @param {string} options.notification.message - Custom message (optional, jika tidak pakai template)
     * @param {string} options.context - Context untuk logging (default: 'PROFILE_UPDATE')
     * @returns {Promise<Object>} Result object dengan success, details, warnings, errors
     */
    static async applyProfileUpdate(user, newProfile, options = {}) {
        const {
            rebootRouter: shouldReboot = true,
            disconnectSession: shouldDisconnect = true,
            skipOnError = false,
            notification = {},
            context = 'PROFILE_UPDATE'
        } = options;

        const result = {
            success: false,
            details: [],
            warnings: [],
            errors: []
        };

        // Validate input
        if (!user) {
            result.errors.push('User object tidak ditemukan.');
            return result;
        }

        // Jika newProfile null/undefined, hanya kirim notification (untuk reject case)
        if (!newProfile) {
            // Hanya kirim notification jika enabled, tidak ada profile update
            if (notification.enabled && user.phone_number && user.phone_number.trim() !== '') {
                try {
                    await this._sendNotification(user, notification);
                    result.details.push('Notifikasi berhasil dikirim.');
                    result.success = true;
                } catch (notifError) {
                    const errMsg = `Gagal mengirim notifikasi: ${notifError.message || notifError}`;
                    console.warn(`[${context}_WARN] [User: ${user.name || user.pppoe_username}] ${errMsg}`);
                    result.warnings.push(errMsg);
                }
            }
            return result;
        }

        if (!user.pppoe_username) {
            result.errors.push(`User ${user.name || user.id} tidak memiliki username PPPoE.`);
            return result;
        }

        try {
            // 1. Update PPPoE profile
            console.log(`[${context}] Updating profile untuk ${user.pppoe_username} ke ${newProfile}`);
            await assertMikrotikResult(
                await updatePPPoEProfile(user.pppoe_username, newProfile, { caller: `profile-update-service.${context}` })
            );
            result.details.push(`Profil PPPoE berhasil diubah ke ${newProfile}.`);
            result.success = true;

            // 2. Disconnect active session (if enabled)
            if (shouldDisconnect) {
                try {
                    const disconnectResult = await deleteActivePPPoEUser(user.pppoe_username, {
                        caller: `profile-update-service.${context}`,
                    });
                    if (disconnectResult.ok) {
                        result.details.push(`Sesi aktif PPPoE berhasil dihapus.`);
                    } else {
                        const errMsg = `Gagal menghapus sesi aktif PPPoE: ${disconnectResult.message}`;
                        console.warn(`[${context}_WARN] [User: ${user.name || user.pppoe_username}] ${errMsg}`);
                        result.warnings.push(errMsg);
                    }
                } catch (disconnectError) {
                    const errMsg = `Gagal menghapus sesi aktif PPPoE: ${disconnectError.message || disconnectError}`;
                    console.warn(`[${context}_WARN] [User: ${user.name || user.pppoe_username}] ${errMsg}`);
                    result.warnings.push(errMsg);
                }
            }

            // 3. Reboot router (if enabled and device_id exists)
            if (shouldReboot && user.device_id) {
                try {
                    const rebootResult = await rebootRouter(user.device_id, {
                        context: { caller: `profile-update-service.${context}`, deviceId: user.device_id },
                    });
                    if (!rebootResult.success) {
                        throw new Error(rebootResult.message);
                    }
                    result.details.push(`Perintah reboot untuk router ${user.device_id} berhasil dikirim.`);
                } catch (rebootError) {
                    const errMsg = `Gagal me-reboot router ${user.device_id}: ${rebootError.message || rebootError}`;
                    console.warn(`[${context}_WARN] [User: ${user.name || user.pppoe_username}] ${errMsg}`);
                    result.warnings.push(errMsg);
                }
            } else if (shouldReboot && !user.device_id) {
                result.details.push(`Reboot router dilewati (tidak ada Device ID).`);
            }

            // 4. Send notification (if enabled)
            if (notification.enabled && user.phone_number && user.phone_number.trim() !== '') {
                try {
                    await this._sendNotification(user, notification);
                    result.details.push(`Notifikasi berhasil dikirim.`);
                } catch (notifError) {
                    const errMsg = `Gagal mengirim notifikasi: ${notifError.message || notifError}`;
                    console.warn(`[${context}_WARN] [User: ${user.name || user.pppoe_username}] ${errMsg}`);
                    result.warnings.push(errMsg);
                }
            }

        } catch (mikrotikError) {
            const errMsg = `Gagal mengubah profil Mikrotik: ${mikrotikError.message || mikrotikError}`;
            console.error(`[${context}_ERROR] [User: ${user.name || user.pppoe_username}] ${errMsg}`);
            result.errors.push(errMsg);
            result.success = false;

            if (skipOnError) {
                // Return result dengan error, tidak throw
                return result;
            } else {
                // Throw error untuk single user operations
                throw mikrotikError;
            }
        }

        return result;
    }

    /**
     * Apply profile update untuk multiple users (batch processing)
     * 
     * @param {Array<Object>} users - Array of user objects
     * @param {string} newProfile - New profile name
     * @param {Object} options - Options (same as applyProfileUpdate)
     * @returns {Promise<Array<Object>>} Array of result objects (one per user)
     */
    static async applyProfileUpdateBatch(users, newProfile, options = {}) {
        if (!Array.isArray(users) || users.length === 0) {
            return [];
        }

        // Set skipOnError to true untuk batch processing
        const batchOptions = {
            ...options,
            skipOnError: true
        };

        const results = [];

        for (const user of users) {
            try {
                const result = await this.applyProfileUpdate(user, newProfile, batchOptions);
                results.push({
                    userId: user.id,
                    userName: user.name,
                    pppoeUsername: user.pppoe_username,
                    ...result
                });
            } catch (error) {
                // Should not happen karena skipOnError = true, tapi handle just in case
                results.push({
                    userId: user.id,
                    userName: user.name,
                    pppoeUsername: user.pppoe_username,
                    success: false,
                    details: [],
                    warnings: [],
                    errors: [`Unexpected error: ${error.message || error}`]
                });
            }
        }

        return results;
    }

    /**
     * Send notification to user
     * @private
     * @param {Object} user - User object
     * @param {Object} notification - Notification config
     */
    static async _sendNotification(user, notification) {
        if (!hasAuthenticatedSession()) {
            throw new Error('WhatsApp tidak terhubung, notifikasi tidak dapat dikirim');
        }

        let messageToSend = '';

        // Use template if provided
        if (notification.template && templatesCache.notificationTemplates[notification.template]) {
            messageToSend = renderTemplate(notification.template, notification.data || {});
        } else if (notification.message) {
            // Use custom message
            messageToSend = notification.message;
        } else {
            // Default message
            messageToSend = renderResponseTemplate('profile_update_default_notification');
        }

        const phoneNumbers = user.phone_number.split('|').map((number) => number.trim()).filter(Boolean);
        const delivery = await sendMessageToMany(phoneNumbers, { text: messageToSend });
        if (!delivery.sent) {
            throw new Error(delivery.warning || 'WhatsApp tidak terhubung, notifikasi tidak dapat dikirim');
        }
    }
}

module.exports = { ProfileUpdateService };

