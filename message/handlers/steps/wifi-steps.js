"use strict";

/**
 * Header Doc
 * Purpose: Menjalankan step percakapan perubahan nama/sandi WiFi legacy dengan teks user-facing dari responseTemplates.
 * Caller: state WiFi managed (`conversation-state-handler.js`).
 * Deps: `lib/wifi`, `message/handlers/wifi-logger`, `lib/template-service`.
 * MainFuncs: handleWifiNameSteps, handleWifiPasswordSteps, renderResponseTemplate, buildSsidList.
 * SideEffects: Mengubah state percakapan, memanggil adapter WiFi, menulis log perubahan WiFi pada flow konfirmasi legacy.
 */

const { setSSIDName, setPassword } = require("../../../lib/wifi");
const { saveWifiChangeLog } = require('../wifi-logger');
const { renderCategoryTemplate } = require("../../../lib/template-service");

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate("responseTemplates", key, data);
}

function buildSsidList(ssids, lineBuilder) {
    return ssids.map(lineBuilder).join("\n");
}

/**
 * Handle WiFi name change conversation steps
 */
async function handleWifiNameSteps({ userState, sender, chats, pushname, reply, setUserState, deleteUserState }) {
    const userReply = chats.toLowerCase().trim();
    
    switch (userState.step) {
        case 'SELECT_CHANGE_MODE_FIRST':
        case 'SELECT_CHANGE_MODE': {
            const choice = chats.trim();
            if (choice === '1') {
                userState.step = 'SELECT_SSID_TO_CHANGE';
                setUserState(sender, userState);
                
                const message = renderResponseTemplate("wifi_steps_select_ssid_name", {
                    ssidList: buildSsidList(userState.bulk_ssids, (ssid) => `${ssid.id}. SSID ${ssid.id}: ${ssid.name}`),
                    totalSsids: userState.bulk_ssids.length
                });
                
                return { success: true, message };
            } else if (choice === '2') {
                if (userState.nama_wifi_baru) {
                    userState.step = 'ASK_NEW_NAME_FOR_BULK_AUTO';
                    setUserState(sender, userState);
                    
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_steps_confirm_all_name", { newName: userState.nama_wifi_baru })
                    };
                } else {
                    userState.step = 'ASK_NEW_NAME_FOR_BULK';
                    setUserState(sender, userState);
                    
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_steps_ask_bulk_name")
                    };
                }
            }
            return {
                success: false,
                message: renderResponseTemplate("wifi_steps_invalid_mode")
            };
        }
        
        case 'SELECT_SSID_TO_CHANGE': {
            const choiceIndex = parseInt(chats, 10) - 1;
            if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= userState.bulk_ssids.length) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_invalid_ssid")
                };
            }
            
            userState.selected_ssid_indices = [choiceIndex];
            
            if (userState.nama_wifi_baru) {
                const selectedSsidId = userState.bulk_ssids[choiceIndex].id;
                userState.step = 'CONFIRM_GANTI_NAMA_BULK';
                setUserState(sender, userState);
                
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_confirm_single_name", {
                        ssidId: selectedSsidId,
                        newName: userState.nama_wifi_baru
                    })
                };
            } else {
                userState.step = 'ASK_NEW_NAME_FOR_SINGLE_BULK';
                setUserState(sender, userState);
                
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_ask_single_name")
                };
            }
        }
        
        case 'ASK_NEW_NAME':
        case 'ASK_NEW_NAME_FOR_SINGLE_BULK':
        case 'ASK_NEW_NAME_FOR_BULK':
        case 'ASK_NEW_NAME_FOR_BULK_AUTO': {
            const newName = chats.trim();
            
            if (userState.step === 'ASK_NEW_NAME_FOR_BULK_AUTO') {
                // Already have name, just confirming
                if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                    userState.step = 'CONFIRM_GANTI_NAMA_BULK';
                    // Continue to confirmation
                } else {
                    deleteUserState(sender);
                    return {
                        success: true,
                            message: renderResponseTemplate("wifi_steps_name_cancelled")
                    };
                }
            } else {
                // Getting new name
                if (newName.length === 0) {
                    return {
                        success: false,
                            message: renderResponseTemplate("wifi_steps_name_empty")
                    };
                }
                if (newName.length > 32) {
                    return {
                        success: false,
                            message: renderResponseTemplate("wifi_steps_name_too_long")
                    };
                }
                
                userState.nama_wifi_baru = newName;
                userState.step = 'CONFIRM_GANTI_NAMA_BULK';
                setUserState(sender, userState);
                
                const targetText = userState.selected_ssid_indices ? 
                    `SSID ${userState.bulk_ssids[userState.selected_ssid_indices[0]].id}` : 
                    'semua SSID';
                
                return {
                    success: true,
                        message: renderResponseTemplate("wifi_steps_confirm_name", { targetText, newName })
                };
            }
        }
        
        // SKIP - Konfirmasi sudah dihapus, langsung eksekusi di handler utama
        /*
        case 'CONFIRM_GANTI_NAMA':
        case 'CONFIRM_GANTI_NAMA_BULK': {
            if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                const { targetUser, nama_wifi_baru, bulk_ssids, selected_ssid_indices } = userState;
                
                await reply(`⏳ Sedang mengubah nama WiFi untuk *${targetUser.name}*...`);
                
                try {
                    let changeResults = [];
                    
                    if (bulk_ssids && selected_ssid_indices) {
                        // Change specific SSIDs
                        for (const index of selected_ssid_indices) {
                            const ssidId = bulk_ssids[index].id;
                            const result = await setSSIDName(targetUser.device_id, nama_wifi_baru, ssidId);
                            changeResults.push({ ssidId, success: result.success, message: result.message });
                        }
                    } else if (bulk_ssids) {
                        // Change all SSIDs
                        for (const ssid of bulk_ssids) {
                            const result = await setSSIDName(targetUser.device_id, nama_wifi_baru, ssid.id);
                            changeResults.push({ ssidId: ssid.id, success: result.success, message: result.message });
                        }
                    } else {
                        // Single change
                        const result = await setSSIDName(targetUser.device_id, nama_wifi_baru);
                        changeResults.push({ ssidId: 1, success: result.success, message: result.message });
                    }
                    
                    const allSuccess = changeResults.every(r => r.success);
                    
                    if (allSuccess) {
                        // Prepare changes info
                        const changesInfo = {
                            oldSsidName: bulk_ssids ? bulk_ssids.map(s => s.name).join(', ') : 'N/A',
                            newSsidName: nama_wifi_baru
                        };
                        
                        // Prepare notes
                        let notes = '';
                        if (bulk_ssids && selected_ssid_indices) {
                            notes = `Mengubah nama WiFi untuk SSID: ${selected_ssid_indices.map(i => bulk_ssids[i].id).join(', ')}`;
                        } else if (bulk_ssids) {
                            notes = `Mengubah nama WiFi untuk ${bulk_ssids.length} SSID`;
                        } else {
                            notes = 'Mengubah nama WiFi (single SSID)';
                        }
                        
                        saveWifiChangeLog({
                            type: 'name_change',
                            userId: targetUser.id,
                            userName: targetUser.name,
                            userPhone: targetUser.phone_number || targetUser.phone,
                            deviceId: targetUser.device_id,
                            changes: changesInfo,
                            changedBy: pushname,
                            changedBySender: sender,
                            notes: notes,
                            timestamp: new Date().toISOString()
                        });
                        
                        deleteUserState(sender);
                        
                        return {
                            success: true,
                            message: `✅ *Berhasil!*\n\nNama WiFi untuk *${targetUser.name}* telah diubah menjadi *${nama_wifi_baru}*.\n\n📱 Silakan reconnect perangkat Anda dengan nama WiFi yang baru.`
                        };
                    } else {
                        const failedSsids = changeResults.filter(r => !r.success);
                        return {
                            success: false,
                            message: `❌ Gagal mengubah nama WiFi untuk beberapa SSID:\n${failedSsids.map(f => `• SSID ${f.ssidId}: ${f.message}`).join('\n')}`
                        };
                    }
                } catch (error) {
                    console.error('[CHANGE_WIFI_NAME_ERROR]', error);
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: `❌ Gagal mengubah nama WiFi: ${error.message}`
                    };
                }
            } else if (['tidak', 'no', 'n', 'gak'].includes(userReply)) {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Perubahan nama WiFi dibatalkan.'
                };
            }
            return {
                success: false,
                message: "Mohon balas dengan *'ya'* untuk melanjutkan atau *'tidak'* untuk membatalkan."
            };
        }
        */
    }
}

/**
 * Handle WiFi password change conversation steps
 */
async function handleWifiPasswordSteps({ userState, sender, chats, pushname, reply, setUserState, deleteUserState }) {
    const userReply = chats.toLowerCase().trim();
    
    switch (userState.step) {
        case 'SELECT_CHANGE_PASSWORD_MODE_FIRST':
        case 'SELECT_CHANGE_PASSWORD_MODE': {
            const choice = chats.trim();
            if (choice === '1') {
                userState.step = 'SELECT_SSID_PASSWORD';
                setUserState(sender, userState);
                
                const message = renderResponseTemplate("wifi_steps_select_ssid_password", {
                    ssidList: buildSsidList(userState.bulk_ssids, (ssid) => `${ssid.id}. SSID ${ssid.id}: ${ssid.name}`),
                    totalSsids: userState.bulk_ssids.length
                });
                
                return { success: true, message };
            } else if (choice === '2') {
                if (userState.sandi_wifi_baru) {
                    userState.step = 'CONFIRM_GANTI_SANDI_BULK';
                    setUserState(sender, userState);
                    
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_steps_confirm_all_password", { newPassword: userState.sandi_wifi_baru })
                    };
                } else {
                    userState.step = 'ASK_NEW_PASSWORD_BULK';
                    setUserState(sender, userState);
                    
                    return {
                        success: true,
                        message: renderResponseTemplate("wifi_steps_ask_bulk_password")
                    };
                }
            }
            return {
                success: false,
                message: renderResponseTemplate("wifi_steps_invalid_mode")
            };
        }
        
        case 'SELECT_SSID_PASSWORD':
        case 'SELECT_SSID_PASSWORD_FIRST': {
            const choiceIndex = parseInt(chats, 10) - 1;
            if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= userState.bulk_ssids.length) {
                return {
                    success: false,
                    message: renderResponseTemplate("wifi_steps_invalid_ssid")
                };
            }
            
            userState.selected_ssid_indices = [choiceIndex];
            
            if (userState.sandi_wifi_baru) {
                const selectedSsidId = userState.bulk_ssids[choiceIndex].id;
                userState.step = 'CONFIRM_GANTI_SANDI_BULK';
                setUserState(sender, userState);
                
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_confirm_single_password", {
                        ssidId: selectedSsidId,
                        newPassword: userState.sandi_wifi_baru
                    })
                };
            } else {
                userState.step = 'ASK_NEW_PASSWORD';
                setUserState(sender, userState);
                
                return {
                    success: true,
                    message: renderResponseTemplate("wifi_steps_ask_single_password")
                };
            }
        }
        
        case 'ASK_NEW_PASSWORD':
        case 'ASK_NEW_PASSWORD_BULK':
        case 'ASK_NEW_PASSWORD_BULK_AUTO': {
            const newPassword = chats.trim();
            
            if (userState.step === 'ASK_NEW_PASSWORD_BULK_AUTO') {
                // Already have password, just confirming
                if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                    userState.step = 'CONFIRM_GANTI_SANDI_BULK';
                    // Continue to confirmation
                } else {
                    deleteUserState(sender);
                    return {
                        success: true,
                            message: renderResponseTemplate("wifi_steps_password_cancelled")
                    };
                }
            } else {
                // Getting new password
                if (newPassword.length < 8) {
                    return {
                        success: false,
                            message: renderResponseTemplate("wifi_steps_password_too_short")
                    };
                }
                
                userState.sandi_wifi_baru = newPassword;
                userState.step = 'CONFIRM_GANTI_SANDI_BULK';
                setUserState(sender, userState);
                
                return {
                    success: true,
                        message: renderResponseTemplate("wifi_steps_confirm_password", { newPassword })
                };
            }
        }
        
        // SKIP - Konfirmasi sudah dihapus untuk sandi juga
        /*
        case 'CONFIRM_GANTI_SANDI':
        case 'CONFIRM_GANTI_SANDI_BULK': {
            if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                const { targetUser, sandi_wifi_baru, bulk_ssids, selected_ssid_indices } = userState;
                
                await reply(`⏳ Sedang mengubah sandi WiFi untuk *${targetUser.name}*...`);
                
                try {
                    let changeResults = [];
                    
                    if (bulk_ssids && selected_ssid_indices) {
                        // Change specific SSIDs
                        for (const index of selected_ssid_indices) {
                            const ssidId = bulk_ssids[index].id;
                            const result = await setPassword(targetUser.device_id, sandi_wifi_baru, ssidId);
                            changeResults.push({ ssidId, success: result.success, message: result.message });
                        }
                    } else if (bulk_ssids) {
                        // Change all SSIDs
                        for (const ssid of bulk_ssids) {
                            const result = await setPassword(targetUser.device_id, sandi_wifi_baru, ssid.id);
                            changeResults.push({ ssidId: ssid.id, success: result.success, message: result.message });
                        }
                    } else {
                        // Single change
                        const result = await setPassword(targetUser.device_id, sandi_wifi_baru);
                        changeResults.push({ ssidId: 1, success: result.success, message: result.message });
                    }
                    
                    const allSuccess = changeResults.every(r => r.success);
                    
                    if (allSuccess) {
                        // Prepare notes (don't include actual password!)
                        let notes = '';
                        if (bulk_ssids && selected_ssid_indices) {
                            notes = `Mengubah password WiFi untuk SSID: ${selected_ssid_indices.map(i => bulk_ssids[i].id).join(', ')}`;
                        } else if (bulk_ssids) {
                            notes = `Mengubah password WiFi untuk ${bulk_ssids.length} SSID`;
                        } else {
                            notes = 'Mengubah password WiFi (single SSID)';
                        }
                        
                        saveWifiChangeLog({
                            type: 'password_change',
                            userId: targetUser.id,
                            userName: targetUser.name,
                            userPhone: targetUser.phone_number || targetUser.phone,
                            deviceId: targetUser.device_id,
                            newPassword: sandi_wifi_baru, // Simpan password untuk referensi admin
                            changedBy: pushname,
                            changedBySender: sender,
                            notes: notes,
                            timestamp: new Date().toISOString()
                        });
                        
                        deleteUserState(sender);
                        
                        return {
                            success: true,
                            message: `✅ *Berhasil!*\n\nSandi WiFi untuk *${targetUser.name}* telah diubah menjadi *${sandi_wifi_baru}*.\n\n📱 Silakan reconnect perangkat Anda dengan sandi WiFi yang baru.`
                        };
                    } else {
                        const failedSsids = changeResults.filter(r => !r.success);
                        return {
                            success: false,
                            message: `❌ Gagal mengubah sandi WiFi untuk beberapa SSID:\n${failedSsids.map(f => `• SSID ${f.ssidId}: ${f.message}`).join('\n')}`
                        };
                    }
                } catch (error) {
                    console.error('[CHANGE_WIFI_PASSWORD_ERROR]', error);
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: `❌ Gagal mengubah sandi WiFi: ${error.message}`
                    };
                }
            } else if (['tidak', 'no', 'n', 'gak'].includes(userReply)) {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Perubahan sandi WiFi dibatalkan.'
                };
            }
            return {
                success: false,
                message: "Mohon balas dengan *'ya'* untuk melanjutkan atau *'tidak'* untuk membatalkan."
            };
        }
        */
    }
}

module.exports = {
    handleWifiNameSteps,
    handleWifiPasswordSteps
};
