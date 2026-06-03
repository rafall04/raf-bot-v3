"use strict";

/**
 * Header Doc
 * Purpose: Menjalankan step percakapan WiFi bulk SSID dengan teks user-facing dari responseTemplates admin.
 * Caller: state WiFi managed (`conversation-state-handler.js`) untuk mode kustom/bulk WiFi.
 * Deps: `lib/wifi`, `lib/genieacs`, `lib/device-status`, `lib/template-service`.
 * MainFuncs: getSafeErrorMessage, submitWifiChange, handleWifiPasswordSteps, handleWifiNameSteps.
 * SideEffects: Mengecek status perangkat, mengirim task perubahan WiFi, mengubah state percakapan.
 */

const { setSSIDName, setPassword } = require("../../../lib/wifi");
const { setBulkWifiPasswords, setBulkWifiNames } = require("../../../lib/genieacs");
const { isDeviceOnline, getDeviceOfflineMessage } = require('../../../lib/device-status');
const { renderCategoryTemplate } = require("../../../lib/template-service");

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate("responseTemplates", key, data);
}

function buildSsidList(ssids) {
    return ssids.map((ssidId, index) => `${index + 1}. SSID ${ssidId}`).join("\n");
}

/**
 * Safe error message handler - hides sensitive information
 * @param {Error} error - The error object
 * @returns {string} Safe error message for user
 */
function getSafeErrorMessage(error) {
    // Log full error for debugging (admin can see in console/logs)
    console.error('[WIFI_ERROR_DETAILS]', error);
    
    // Return safe message to user (no IP, no technical details)
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return renderResponseTemplate("wifi_bulk_safe_error_timeout");
    } else if (error.response && error.response.status >= 500) {
        return renderResponseTemplate("wifi_bulk_safe_error_server");
    } else if (error.response && error.response.status >= 400) {
        return renderResponseTemplate("wifi_bulk_safe_error_request");
    } else if (error.message && error.message.includes('network')) {
        return renderResponseTemplate("wifi_bulk_safe_error_network");
    } else {
        return renderResponseTemplate("wifi_bulk_safe_error_generic");
    }
}

async function submitWifiChange(resultPromise) {
    const result = await resultPromise;
    if (!result.ok || !result.accepted) {
        const error = new Error(result.message || 'Task perubahan WiFi gagal dikirim');
        error.code = result.errorCode;
        error.details = result.details;
        throw error;
    }

    return result;
}

/**
 * Handle WiFi password change conversation steps
 */
async function handleWifiPasswordSteps({ userState, sender, chats, pushname, reply, setUserState, deleteUserState }) {
    const userReply = chats.toLowerCase().trim();
    
    switch (userState.step) {
        // Step 1: Pilih mode perubahan (dengan password)
        case 'SELECT_CHANGE_PASSWORD_MODE': {
            const choice = chats.trim();
            
            if (choice === '1') {
                // Pilih satu SSID
                userState.step = 'SELECT_SSID_PASSWORD';
                setUserState(sender, userState);
                
                const message = renderResponseTemplate("wifi_steps_select_ssid_name", { ssidList: buildSsidList(userState.bulk_ssids), totalSsids: userState.bulk_ssids.length });
                
                return { success: true, message };
                
            } else if (choice === '2') {
                // Ubah semua SSID
                const { targetUser, sandi_wifi_baru, bulk_ssids } = userState;
                
                reply(renderResponseTemplate("wifi_bulk_checking_device"));
                
                // Check if device is online
                const deviceStatus = await isDeviceOnline(targetUser.device_id);
                
                if (!deviceStatus.online) {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: getDeviceOfflineMessage(targetUser.name, deviceStatus.minutesAgo)
                    };
                }
                
                reply(renderResponseTemplate("wifi_bulk_password_all_processing"));
                
                try {
                    await submitWifiChange(setBulkWifiPasswords(targetUser.device_id, bulk_ssids, sandi_wifi_baru, {
                        operation: 'wa.bulkWifiPassword.allSsids',
                        context: { caller: 'wa.bulkWifiPassword.allSsids', deviceId: targetUser.device_id },
                    }));
                    
                    {
                        deleteUserState(sender);
                        return {
                            success: true,
                            message: renderResponseTemplate("wifi_bulk_password_request_all", { newPassword: sandi_wifi_baru })
                        };
                    }
                } catch (error) {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: getSafeErrorMessage(error)
                    };
                }
            }
            
            return {
                success: false,
                message: renderResponseTemplate("wifi_steps_invalid_mode")
            };
        }
        
        // Step 1 Alternative: Pilih mode dulu (tanpa password)
        case 'SELECT_CHANGE_PASSWORD_MODE_FIRST': {
            const choice = chats.trim();
            
            if (choice === '1') {
                userState.step = 'SELECT_SSID_PASSWORD_FIRST';
                setUserState(sender, userState);
                
                const message = renderResponseTemplate("wifi_steps_select_ssid_name", { ssidList: buildSsidList(userState.bulk_ssids), totalSsids: userState.bulk_ssids.length });
                
                return { success: true, message };
                
            } else if (choice === '2') {
                userState.step = 'ASK_NEW_PASSWORD_FOR_BULK';
                setUserState(sender, userState);
                
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_ask_bulk_password")
                };
            }
            
            return {
                success: false,
                message: renderResponseTemplate("wifi_steps_invalid_mode")
            };
        }
        
        // Step 2: Pilih SSID spesifik (dengan password)
        case 'SELECT_SSID_PASSWORD': {
            const choiceIndex = parseInt(chats, 10) - 1;
            
            if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= userState.bulk_ssids.length) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_invalid_ssid")
                };
            }
            
            const selectedSsidId = userState.bulk_ssids[choiceIndex];
            const { targetUser, sandi_wifi_baru } = userState;
            
            reply(renderResponseTemplate("wifi_bulk_checking_device"));
            
            // Check if device is online
            const deviceStatus = await isDeviceOnline(targetUser.device_id);
            
            if (!deviceStatus.online) {
                deleteUserState(sender);
                return {
                    success: false,
                    message: getDeviceOfflineMessage(targetUser.name, deviceStatus.minutesAgo)
                };
            }
            
            reply(renderResponseTemplate("wifi_bulk_password_single_processing", { ssidId: selectedSsidId }));
            
            try {
                await setPassword(targetUser.device_id, selectedSsidId, sandi_wifi_baru, {
                    operation: 'wa.bulkWifiPassword.singleSsid',
                    verifyApplied: false,
                });
                
                {
                    deleteUserState(sender);
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_bulk_password_request_single", { ssidId: selectedSsidId, newPassword: sandi_wifi_baru })
                    };
                }
            } catch (error) {
                console.error('[SINGLE_PASSWORD_CHANGE_ERROR]', error);
                deleteUserState(sender);
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_password_failed", { errorMessage: error.message })
                };
            }
        }
        
        // Step 2 Alternative: Pilih SSID dulu baru minta password
        case 'SELECT_SSID_PASSWORD_FIRST': {
            const choiceIndex = parseInt(chats, 10) - 1;
            
            if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= userState.bulk_ssids.length) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_invalid_ssid")
                };
            }
            
            userState.selected_ssid = userState.bulk_ssids[choiceIndex];
            userState.step = 'ASK_NEW_PASSWORD_FOR_SINGLE';
            setUserState(sender, userState);
            
            return {
                success: true,
                message: renderResponseTemplate("wifi_steps_ask_single_password")
            };
        }
        
        // Step 3: Input password untuk single SSID
        case 'ASK_NEW_PASSWORD_FOR_SINGLE': {
            if (userReply === 'batal') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_password_cancelled")
                };
            }
            
            const newPassword = chats.trim();
            if (newPassword.length < 8) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_password_too_short")
                };
            }
            
            const { targetUser, selected_ssid } = userState;
            
            reply(renderResponseTemplate("wifi_bulk_checking_device"));
            
            // Check if device is online
            const deviceStatus = await isDeviceOnline(targetUser.device_id);
            
            if (!deviceStatus.online) {
                deleteUserState(sender);
                return {
                    success: false,
                    message: getDeviceOfflineMessage(targetUser.name, deviceStatus.minutesAgo)
                };
            }
            
            reply(renderResponseTemplate("wifi_bulk_password_single_processing", { ssidId: selected_ssid }));
            
            try {
                await setPassword(targetUser.device_id, selected_ssid, newPassword, {
                    operation: 'wa.askNewPassword.singleSsid',
                    verifyApplied: false,
                });
                
                {
                    deleteUserState(sender);
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_bulk_password_success_single", { ssidId: selected_ssid, newPassword })
                    };
                }
            } catch (error) {
                console.error('[SINGLE_PASSWORD_CHANGE_ERROR]', error);
                deleteUserState(sender);
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_password_failed", { errorMessage: error.message })
                };
            }
        }
        
        // Step 3: Input password untuk bulk
        case 'ASK_NEW_PASSWORD_FOR_BULK': {
            if (userReply === 'batal') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_password_cancelled")
                };
            }
            
            const newPassword = chats.trim();
            if (newPassword.length < 8) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_password_too_short")
                };
            }
            
            const { targetUser, bulk_ssids } = userState;
            
            reply(renderResponseTemplate("wifi_bulk_checking_device"));
            
            // Check if device is online
            const deviceStatus = await isDeviceOnline(targetUser.device_id);
            
            if (!deviceStatus.online) {
                deleteUserState(sender);
                return {
                    success: false,
                    message: getDeviceOfflineMessage(targetUser.name, deviceStatus.minutesAgo)
                };
            }
            
            reply(renderResponseTemplate("wifi_bulk_password_all_processing"));
            
            try {
                await submitWifiChange(setBulkWifiPasswords(targetUser.device_id, bulk_ssids, newPassword, {
                    operation: 'wa.askNewPassword.allSsids',
                    context: { caller: 'wa.askNewPassword.allSsids', deviceId: targetUser.device_id },
                }));
                
                {
                    deleteUserState(sender);
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_bulk_password_request_all", { newPassword })
                    };
                }
            } catch (error) {
                console.error('[BULK_PASSWORD_CHANGE_ERROR]', error);
                deleteUserState(sender);
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_password_failed", { errorMessage: error.message })
                };
            }
        }
        
        // Fallback untuk step ASK_NEW_PASSWORD (single mode tanpa bulk)
        case 'ASK_NEW_PASSWORD': {
            if (userReply === 'batal') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_password_cancelled")
                };
            }
            
            const newPassword = chats.trim();
            if (newPassword.length < 8) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_password_too_short")
                };
            }
            
            const { targetUser } = userState;
            
            reply(renderResponseTemplate("wifi_bulk_checking_device"));
            
            // Check if device is online
            const deviceStatus2 = await isDeviceOnline(targetUser.device_id);
            
            if (!deviceStatus2.online) {
                deleteUserState(sender);
                return {
                    success: false,
                    message: getDeviceOfflineMessage(targetUser.name, deviceStatus2.minutesAgo)
                };
            }
            
            reply(renderResponseTemplate("wifi_steps_password_processing", { customerName: targetUser.name }));
            
            try {
                await setPassword(targetUser.device_id, '1', newPassword, {
                    operation: 'wa.askNewPassword.defaultSsid',
                    verifyApplied: false,
                });
                
                {
                    deleteUserState(sender);
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_bulk_password_success_default", { newPassword })
                    };
                }
            } catch (error) {
                console.error('[PASSWORD_CHANGE_ERROR]', error);
                deleteUserState(sender);
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_password_failed", { errorMessage: error.message })
                };
            }
        }
    }
    
    return {
        success: false,
        message: renderResponseTemplate("wifi_bulk_state_unknown")
    };
}

/**
 * Handle WiFi name change conversation steps
 */
async function handleWifiNameSteps({ userState, sender, chats, pushname, reply, setUserState, deleteUserState }) {
    const userReply = chats.toLowerCase().trim();
    
    switch (userState.step) {
        // Step 1: Pilih mode perubahan (dengan nama)
        case 'SELECT_CHANGE_MODE': {
            const choice = chats.trim();
            
            if (choice === '1') {
                // Pilih satu SSID
                userState.step = 'SELECT_SSID_TO_CHANGE';
                setUserState(sender, userState);
                
                const message = renderResponseTemplate("wifi_steps_select_ssid_name", { ssidList: buildSsidList(userState.bulk_ssids), totalSsids: userState.bulk_ssids.length });
                
                return { success: true, message };
                
            } else if (choice === '2') {
                // Ubah semua SSID
                const { targetUser, nama_wifi_baru, bulk_ssids } = userState;
                
                reply(renderResponseTemplate("wifi_bulk_checking_device"));
                
                // Check if device is online
                const deviceStatus3 = await isDeviceOnline(targetUser.device_id);
                
                if (!deviceStatus3.online) {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: getDeviceOfflineMessage(targetUser.name, deviceStatus3.minutesAgo)
                    };
                }
                
                reply(renderResponseTemplate("wifi_bulk_name_all_processing"));
                
                try {
                    await submitWifiChange(setBulkWifiNames(targetUser.device_id, bulk_ssids, nama_wifi_baru, {
                        operation: 'wa.bulkWifiName.allSsids',
                        context: { caller: 'wa.bulkWifiName.allSsids', deviceId: targetUser.device_id },
                    }));
                    
                    {
                        deleteUserState(sender);
                        return {
                            success: true,
                            message: renderResponseTemplate("wifi_bulk_name_request_all", { newName: nama_wifi_baru })
                        };
                    }
                } catch (error) {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: getSafeErrorMessage(error)
                    };
                }
            }
            
            return {
                success: false,
                message: renderResponseTemplate("wifi_steps_invalid_mode")
            };
        }
        
        // Step 1 Alternative: Pilih mode dulu (tanpa nama)
        case 'SELECT_CHANGE_MODE_FIRST': {
            const choice = chats.trim();
            
            if (choice === '1') {
                userState.step = 'SELECT_SSID_TO_CHANGE_FIRST';
                setUserState(sender, userState);
                
                const message = renderResponseTemplate("wifi_steps_select_ssid_name", { ssidList: buildSsidList(userState.bulk_ssids), totalSsids: userState.bulk_ssids.length });
                
                return { success: true, message };
                
            } else if (choice === '2') {
                userState.step = 'ASK_NEW_NAME_FOR_BULK';
                setUserState(sender, userState);
                
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_ask_bulk_name")
                };
            }
            
            return {
                success: false,
                message: renderResponseTemplate("wifi_steps_invalid_mode")
            };
        }
        
        // Step 2: Pilih SSID spesifik (dengan nama)
        case 'SELECT_SSID_TO_CHANGE': {
            const choiceIndex = parseInt(chats, 10) - 1;
            
            if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= userState.bulk_ssids.length) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_invalid_ssid")
                };
            }
            
            const selectedSsidId = userState.bulk_ssids[choiceIndex];
            const { targetUser, nama_wifi_baru } = userState;
            
            reply(renderResponseTemplate("wifi_bulk_checking_device"));
            
            // Check if device is online
            const deviceStatus4 = await isDeviceOnline(targetUser.device_id);
            
            if (!deviceStatus4.online) {
                deleteUserState(sender);
                return {
                    success: false,
                    message: getDeviceOfflineMessage(targetUser.name, deviceStatus4.minutesAgo)
                };
            }
            
            reply(renderResponseTemplate("wifi_bulk_name_single_processing", { ssidId: selectedSsidId }));
            
            try {
                await setSSIDName(targetUser.device_id, selectedSsidId, nama_wifi_baru, {
                    operation: 'wa.bulkWifiName.singleSsid',
                });
                
                {
                    deleteUserState(sender);
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_bulk_name_request_single", { ssidId: selectedSsidId, newName: nama_wifi_baru })
                    };
                }
            } catch (error) {
                console.error('[SINGLE_NAME_CHANGE_ERROR]', error);
                deleteUserState(sender);
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_name_failed", { errorMessage: error.message })
                };
            }
        }
        
        // Similar steps for name change...
        // (implementasi mirip dengan password change)
        
        // Fallback untuk step ASK_NEW_NAME (single mode tanpa bulk)
        case 'ASK_NEW_NAME': {
            if (userReply === 'batal') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_name_cancelled")
                };
            }
            
            const newName = chats.trim();
            if (newName.length > 32) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_name_too_long")
                };
            }
            
            const { targetUser } = userState;
            
            reply(renderResponseTemplate("wifi_bulk_checking_device"));
            
            // Check if device is online
            const deviceStatus5 = await isDeviceOnline(targetUser.device_id);
            
            if (!deviceStatus5.online) {
                deleteUserState(sender);
                return {
                    success: false,
                    message: getDeviceOfflineMessage(targetUser.name, deviceStatus5.minutesAgo)
                };
            }
            
            reply(renderResponseTemplate("wifi_steps_name_processing", { customerName: targetUser.name }));
            
            try {
                await setSSIDName(targetUser.device_id, '1', newName, {
                    operation: 'wa.askNewName.defaultSsid',
                });
                
                {
                    deleteUserState(sender);
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_bulk_name_success_default", { newName })
                    };
                }
            } catch (error) {
                console.error('[NAME_CHANGE_ERROR]', error);
                deleteUserState(sender);
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_name_failed", { errorMessage: error.message })
                };
            }
        }
    }
    
    return {
        success: false,
        message: renderResponseTemplate("wifi_bulk_state_unknown")
    };
}

module.exports = {
    handleWifiNameSteps,
    handleWifiPasswordSteps
};
