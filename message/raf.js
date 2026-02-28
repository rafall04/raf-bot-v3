"use strict";

const { isProcessing, setProcessing, clearProcessing } = require('../lib/state-manager');

const fs = require("fs");
const convertRupiah = require('rupiah-format');
const axios = require('axios');
const path = require('path');
const { exec } = require('child_process');

const { color, bgcolor } = require("../lib/color");
const { getBuffer, fetchJson, fetchText, getRandom, getGroupAdmins, runtime, sleep, convert, convertGif, html2Txt } = require("../lib/myfunc");
const { wifimenu, menupaket, menubelivoucher, menupasang, menuowner, customermenu, techinisionmenu, menuvoucher } = require("./wifi");
const { setPassword, setSSIDName, getSSIDInfo, rebootRouter } = require("../lib/wifi");
const { getPppStats, getHotspotStats, statusap, getvoucher, addpppoe, addbinding, addqueue } = require("../lib/mikrotik");
const { addvoucher, checkhargavc, checkprofvc, checkhargavoucher, checknamavc, checkdurasivc, checkprofvoucher, delvoucher } = require("../lib/voucher");
const { addStatik, checkLimitAt, checkMaxLimit, checkStatik, delStatik } = require("../lib/statik")
const { addATM, addKoinUser, checkATMuser, confirmATM, checkRegisteredATM, delSaldo } = require("../lib/saldo");
const { addPayment } = require("../lib/payment");
const { getIntentFromKeywords } = require('../lib/wifi_template_handler');
const { templatesCache } = require("../lib/templating");
const { savePackageChangeRequests, saveSpeedRequests } = require("../lib/database");
const {
    handleGangguanMati,
    handleGangguanLemot,
    handleGangguanMatiOfflineResponse,
    handleGangguanMatiOnlineResponse,
    handleGangguanLemotResponse
} = require('./handlers/smart-report-handler');
const {
    handleCompletionConfirmation,
    handleRemoteRequest,
    handleRemoteResponse
} = require('./handlers/ticket-process-handler');
const { getUserState, deleteUserState } = require('./handlers/conversation-handler');
const {
    handleMulaiPerjalanan,
    handleTeknisiShareLocation,
    handleCekLokasiTeknisi,
    handleTiketSaya
} = require('./handlers/simple-location-handler');
const {
    handleListAgents,
    handleAgentByArea,
    handleAgentServices,
    handleSearchAgent,
    handleViewAgentDetail,
    handleAgentConfirmation,
    handleAgentTodayTransactions,
    handleCheckTopupStatus,
    handleAgentPinChange,
    handleAgentProfileUpdate,
    handleAgentStatusToggle,
    handleAgentSelfProfile
} = require('./handlers/agent');
const {
    handleAgentPurchaseVoucher,
    handleAgentVoucherPurchaseConversation,
    handleAgentSellVoucher,
    handleAgentVoucherSaleConversation,
    handleAgentCheckInventory,
    handleAgentPurchaseHistory,
    handleAgentSalesHistory
} = require('./handlers/agent-voucher-handler');
const qr = require('qr-image')
const pay = require("../lib/ipaymu")

const format = (key, data = {}) => {
    let template = templatesCache.responseTemplates[key]?.template || '';
    for (const placeholder in data) {
        const regex = new RegExp(`\\$\\{${placeholder}\\}`, 'g');
        template = template.replace(regex, data[placeholder]);
    }
    return template;
};

const mess = {
    get owner() { return format('mess_owner'); },
    get userNotRegister() { return format('mess_userNotRegister'); },
    get notRegister() { return format('mess_notRegister'); },
    get notProfile() { return format('mess_notProfile'); },
    get onlyMonthly() { return format('mess_onlyMonthly'); },
    get wrongFormat() { return format('mess_wrongFormat'); },
    get mustNumber() { return format('mess_mustNumber'); },
    get teknisiOrOwnerOnly() { return format('mess_teknisiOrOwnerOnly'); },
    get teknisiOnly() { return format('mess_teknisiOnly'); },
    get reportNotFound() { return format('mess_reportNotFound'); },
    get reportAlreadyDone() { return format('mess_reportAlreadyDone'); },
    get reportNotFound_detail() { return format('mess_reportNotFound_detail'); },
    get reportAlreadyDone_detail() { return format('mess_reportAlreadyDone_detail'); },
}

const reportsDbPathRaf = path.join(__dirname, '../database/reports.json');

// Handler imports - Smart Report
const { generateTicketId, saveReportsToFile, buatLaporanGangguan } = require('./handlers/ticket-creation-handler');
const { processVoucherPurchase } = require('./handlers/payment-processor-handler');
const { handleMenuSelection, handleTroubleshootResult, handleMatiConfirmation, handleMatiTroubleshootOptions, handleMatiPhotoUpload, startReportFlow } = require('./handlers/smart-report-text-menu');
const { handleDirectConfirmation, handleDirectLemotResponse } = require('./handlers/smart-report-hybrid');
const { handleCustomerPhotoUpload } = require('./handlers/customer-photo-handler');
const { handleGeneralSteps } = require('./handlers/steps/general-steps');
const { addPhotoToQueue } = require('./handlers/photo-upload-queue');

// Handler imports - Utility
const { handleCekTiket, handleBantuan, handleSapaanUmum, handleAdminContact } = require('./handlers/utility-handler');
const { handleMenuPelanggan, handleMenuUtama, handleMenuTeknisi, handleMenuOwner, handleTanyaCaraPasang, handleTanyaPaketBulanan, handleTutorialTopup } = require('./handlers/menu-handler');
const { handleStatusPpp, handleStatusHotspot, handleStatusAp, handleAllSaldo, handleAllUser, handleListProfStatik, handleListProfVoucher, handleMonitorWifi } = require('./handlers/monitoring-handler');
const { handleCekSaldo, handleTanyaHargaVoucher, handleVc123 } = require('./handlers/saldo-voucher-handler');
const { handleTransferSaldo, handleCancelTopup } = require('./handlers/saldo-handler');
const { handleTopupSaldoPayment, handleBeliVoucher } = require('./handlers/payment-processor-handler');
const { handleAccessManagement } = require('./handlers/access-management-handler');
const { handleCekTagihan } = require('./handlers/billing-management-handler');
const { handleCheckPackage, handleComplaint, handleServiceInfo } = require('./handlers/customer-handler');
const { handleUbahPaket, handleRequestSpeedBoost } = require('./handlers/package-management-handler');
const { handleGantiNamaWifi, handleGantiSandiWifi } = require('./handlers/wifi-management-handler');
const { handleGantiPowerWifi } = require('./handlers/wifi-power-handler');
const { handleRebootModem } = require('./handlers/reboot-modem-handler');
const { handleCekWifi } = require('./handlers/wifi-check-handler');
const { handleHistoryWifi } = require('./handlers/wifi-history-handler');
const { handleAddProfVoucher, handleDelProfVoucher, handleAddProfStatik, handleDelProfStatik } = require('./handlers/voucher-management-handler');
const { handleAddBinding, handleAddPPP } = require('./handlers/network-management-handler');
const { handleTopup, handleDelSaldo, handleTransfer } = require('./handlers/balance-management-handler');
const { handleProsesTicket, handleOTW, handleSampaiLokasi, handleVerifikasiOTP, handleSelesaiTicket, handleCompleteTicket, handleTeknisiPhotoUpload } = require('./handlers/teknisi-workflow-handler');

// Library imports
const { normalizeJid, normalizeJidForSaldo, findUserWithLidSupport, normalizePhoneNumber, normalizePhoneToJid, extractSenderInfo, processLidVerification } = require('../lib/jid-utils');
const saldoManager = require('../lib/saldo-manager');
const agentTransactionManager = require('../lib/agent-transaction-manager');
const agentManager = require('../lib/agent-manager');
const { getReportsUploadsPath, getTeknisiUploadsPathByTicket, getProjectRoot } = require('../lib/path-helper');
const { setUserState } = require('./handlers/conversation-handler');

let ownerNumber, nama, namabot, parentbinding, telfon;

if (global.config) {
    ({
        ownerNumber,
        nama,
        namabot,
        parentbinding,
        telfon
    } = global.config);
} else {
    ownerNumber = [];
    nama = 'Service Name';
    namabot = 'Bot Name';
    parentbinding = '';
    telfon = '';
}
let temp = {};

/**
 * Menggunakan sender (bisa berupa @lid atau @s.whatsapp.net) sebagai Primary ID
 * JID Asli (jika ada) hanya dijadikan referensi opsional tanpa menghalangi flow.
 */
function getOptionalJid(msg, sender) {
    if (!sender.endsWith('@lid')) return sender;

    if (msg.key && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
        let result = msg.key.remoteJidAlt.split(':')[0];
        return result.endsWith('@s.whatsapp.net') ? result : result + '@s.whatsapp.net';
    }
    if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
        return msg.participant;
    }
    return null;
}

module.exports = async (raf, msg, m) => {
    const { generateWAMessageFromContent, prepareWAMessageMedia, proto } = await import('@whiskeysockets/baileys');

    const users = global.users || [];
    const accounts = global.accounts || [];

    if (((msg.key.id.startsWith("BAE5") && msg.key.id.length < 32) || (msg.key.id.startsWith("3EB0") && msg.key.id.length < 32)) && msg.key?.fromMe) return;
    const from = msg.key.remoteJid
    const type = Object.keys(msg.message)[0]

    const chats = type === "conversation" && msg.message.conversation ? msg.message.conversation : type == "imageMessage" && msg.message.imageMessage.caption ? msg.message.imageMessage.caption : type == "documentMessage" && msg.message.documentMessage.caption ? msg.message.documentMessage.caption : type == "videoMessage" && msg.message.videoMessage.caption ? msg.message.videoMessage.caption : type == "extendedTextMessage" && msg.message.extendedTextMessage.text ? msg.message.extendedTextMessage.text : type == "buttonsResponseMessage" && msg.message.buttonsResponseMessage.selectedButtonId ? msg.message.buttonsResponseMessage.selectedButtonId : type == "templateButtonReplyMessage" && msg.message.templateButtonReplyMessage.selectedId ? msg.message.templateButtonReplyMessage.selectedId : type == "messageContextInfo" ? (msg.message.buttonsResponseMessage?.selectedButtonId || msg.message.listResponseMessage?.singleSelectReply.selectedRowId) : type == "listResponseMessage" && msg.message.listResponseMessage.singleSelectReply.selectedRowId ? msg.message.listResponseMessage.singleSelectReply.selectedRowId : ""

    if (chats === undefined || chats === null) {
        console.log('[WARNING] chats is undefined, skipping message processing');
        return;
    }

    if (typeof chats !== 'string') {
        chats = String(chats || '');
    }

    const args = chats.split(' ')
    const command = chats.toLowerCase().split(' ')[0] || ''
    const isGroup = msg.key.remoteJid.endsWith('@g.us')
    if (isGroup) return;
    const sender = isGroup ? msg.participant : msg.key.remoteJid
    if (!sender) return;
    const pushname = msg.pushName
    const q = chats.slice(command.length + 1, chats.length)

    const primarySenderId = sender;
    const optionalJid = getOptionalJid(msg, sender);

    // Set fallback optional phone number (hanya untuk log / backward compatibility minor yang tak critical)
    let plainSenderNumber = optionalJid ? optionalJid.split('@')[0] : sender.split('@')[0];

    // Cek user terdaftar (untuk saldo dll) menggunakan Primary ID apa adanya (@lid)
    const isSaldo = await checkATMuser(primarySenderId);

    // Check isOwner (cek primary id, atau opsional jid)
    const isOwner = ownerNumber.includes(primarySenderId) || (optionalJid ? ownerNumber.includes(optionalJid) : false) || (optionalJid ? ownerNumber.includes(plainSenderNumber) : false);

    // Check isTeknisi
    const isTeknisi = accounts.find(a => {
        if (!a) return false;
        if (a.lid && a.lid === primarySenderId) return true;
        if (a.phone_number) {
            const phone = a.phone_number;
            if (phone === primarySenderId) return true;
            if (optionalJid && (phone === optionalJid || phone === plainSenderNumber)) return true;
        }
        return false;
    });

    if (sender.endsWith('@lid')) {
        console.log(`[AUTH_DEBUG] PrimaryID: ${primarySenderId}, OpsionalJID: ${optionalJid}, isSaldo: ${isSaldo !== false && isSaldo !== null}, isOwner: ${isOwner}, isTeknisi: ${!!isTeknisi}`);
    }

    const isUrl = (uri) => {
        return uri.match(new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%.+#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%+.#?&/=]*)/, 'gi'))
    }

    const originalReply = (teks) => {
        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
            const rafToUse = global.raf || raf;
            return new Promise(resolve => {
                setTimeout(() => {
                    rafToUse.sendMessage(from, { text: teks }, { quoted: msg })
                        .then(() => resolve())
                        .catch(error => {
                            console.error('[SEND_MESSAGE_ERROR]', {
                                from,
                                error: error.message
                            });
                            resolve(); // Jangan throw - notification tidak critical
                        });
                }, 500);
            });
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', from);
            return Promise.resolve(); // Return resolved promise untuk tidak break flow
        }
    }

    const reply = async (teks, options = {}) => {
        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
            const rafToUse = global.raf || raf;

            if (options.skipDuplicateCheck) {
                return new Promise(resolve => {
                    setTimeout(() => {
                        rafToUse.sendMessage(from, { text: teks }, {
                            quoted: msg,
                            skipDuplicateCheck: true
                        })
                            .then(() => resolve())
                            .catch(error => {
                                console.error('[SEND_MESSAGE_ERROR]', {
                                    from,
                                    error: error.message
                                });
                                resolve();
                            });
                    }, 500);
                });
            } else {
                return await originalReply(teks);
            }
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', from);
            return Promise.resolve();
        }
    }

    let sendContact = (jid, numbers, name, quoted) => {
        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
            const rafToUse = global.raf || raf;
            let number = numbers.replace(/[^0-9]/g, '')
            const vcard = 'BEGIN:VCARD\n'
                + 'VERSION:3.0\n'
                + 'FN:' + name + '\n'
                + 'ORG:;\n'
                + 'TEL;type=CELL;type=VOICE;waid=' + number + ':+' + number + '\n'
                + 'END:VCARD'
            return rafToUse.sendMessage(from, { contacts: { displayName: name, contacts: [{ vcard }] } }, { quoted: quoted })
                .catch(error => {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        from,
                        type: 'contact',
                        error: error.message
                    });
                });
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send contact to', from);
            return Promise.resolve(); // Return resolved promise untuk tidak break flow
        }
    }

    if (!isSaldo) {
        try {
            // Kita sudah menggunakan primarySenderId (@lid atau nomor asli) secara murni
            if (primarySenderId) {
                await saldoManager.createUserSaldo(primarySenderId);
            }
        } catch (err) {
            console.error('[SALDO_INIT] Error creating user saldo:', err);
        }
    }

    const rupiah = await checkATMuser(primarySenderId);
    const rupiah123 = convertRupiah.convert(rupiah)

    try {
        if (isProcessing(sender)) {
            console.log(`[CONCURRENT_PREVENTED] ${sender} already being processed, skipping`);
            return;
        }

        setProcessing(sender);

        const smartReportState = getUserState(sender);

        const protectedStates = [
            'ASK_NEW_NAME_FOR_SINGLE',
            'ASK_NEW_NAME_FOR_SINGLE_BULK',
            'ASK_NEW_NAME_FOR_BULK',
            'ASK_NEW_NAME_FOR_BULK_AUTO',
            'ASK_NEW_PASSWORD',
            'ASK_NEW_PASSWORD_BULK',
            'ASK_NEW_PASSWORD_BULK_AUTO',
            'MATI_AWAITING_PHOTO',
            'GANGGUAN_MATI_AWAITING_PHOTO',
            'LEMOT_AWAITING_PHOTO',
            'AGENT_VOUCHER_PURCHASE_SELECT',
            'AGENT_VOUCHER_PURCHASE_QUANTITY',
            'AGENT_VOUCHER_PURCHASE_PAYMENT',
            'AGENT_VOUCHER_SALE_SELECT',
            'AGENT_VOUCHER_SALE_QUANTITY',
            'AGENT_VOUCHER_SALE_CUSTOMER',
            'AGENT_VOUCHER_SALE_CONFIRM'
        ];

        const conversationState = getUserState(sender);
        const isInProtectedState =
            (smartReportState && protectedStates.includes(smartReportState.step)) ||
            (conversationState && conversationState.step && protectedStates.includes(conversationState.step));

        const userState = getUserState(sender);
        if (userState && userState.step && userState.step.startsWith('AGENT_VOUCHER_PURCHASE_')) {
            const handled = await handleAgentVoucherPurchaseConversation(msg, sender, reply, chats, raf);
            if (handled) {
                clearProcessing(sender);
                return;
            }
        }

        if (userState && userState.step && userState.step.startsWith('AGENT_VOUCHER_SALE_')) {
            const handled = await handleAgentVoucherSaleConversation(msg, sender, reply, chats, raf, global);
            if (handled) {
                clearProcessing(sender);
                return;
            }
        }

        let isGlobalCommand = false;
        if (!isInProtectedState) {
            const keywordCheck = getIntentFromKeywords(chats);
            const commandCheck = chats.toLowerCase().split(' ')[0];
            const globalCommands = ['menu', 'bantuan', 'help', 'lapor', 'ceksaldo', 'saldo'];
            isGlobalCommand = globalCommands.includes(commandCheck) || keywordCheck !== null;
        }

        if (chats.toLowerCase().trim() === 'batal') {
            isGlobalCommand = true;
            if (global.teknisiStates) delete global.teknisiStates[sender];
        }

            isGlobalCommand = true;
        }

        if (smartReportState && isGlobalCommand && !isInProtectedState) {
            console.log(`[GLOBAL_COMMAND] User ${sender} broke out of state with command: "${chats}"`);
            deleteUserState(sender);
        }
        else if (smartReportState && (!isGlobalCommand || isInProtectedState)) {
            const stateStep = smartReportState.step;

            if (stateStep === 'REPORT_MENU') {
                const result = await handleMenuSelection({
                    sender,
                    choice: chats,
                    reply
                });

                if (result.message) {
                    await reply(result.message);
                }
                if (result.success && (chats.trim() === '3' || chats.includes('lain'))) {
                    deleteUserState(sender);
                }
                return;
            }

            if (stateStep === 'TROUBLESHOOT_LEMOT') {
                const result = await handleTroubleshootResult({
                    sender,
                    response: chats,
                    reply
                });

                if (result.message) {
                    await reply(result.message);
                }
                return;
            }

            if (stateStep === 'CONFIRM_MATI_REPORT') {
                const result = await handleMatiConfirmation({
                    sender,
                    response: chats,
                    reply
                });

                if (result.message) {
                    await reply(result.message);
                }
                return;
            }

            if (stateStep === 'MATI_TROUBLESHOOT_OPTIONS') {
                const result = await handleMatiTroubleshootOptions({
                    sender,
                    response: chats,
                    reply
                });

                if (result.message) {
                    await reply(result.message);
                }
                return;
            }

            if (stateStep === 'MATI_AWAITING_PHOTO') {
                if (type === 'conversation') {
                    const result = await handleMatiPhotoUpload({
                        sender,
                        response: chats,
                        photoPath: null,
                        reply
                    });

                    if (result.message) {
                        await reply(result.message);
                    }
                    return;
                }

                if (type === 'imageMessage') {
                    const { downloadMediaMessage } = await import('@whiskeysockets/baileys');

                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {});
                        const fileName = `photo_${Date.now()}.jpg`;
                        const photoPath = path.join(__dirname, '../uploads', fileName);

                        const uploadsDir = path.dirname(photoPath);
                        if (!fs.existsSync(uploadsDir)) {
                            fs.mkdirSync(uploadsDir, { recursive: true });
                        }

                        fs.writeFileSync(photoPath, buffer);

                        const result = await handleMatiPhotoUpload({
                            sender,
                            response: null,
                            photoPath: fileName,
                            photoBuffer: buffer,
                            reply
                        });

                        if (result.message) {
                            await reply(result.message);
                        }
                    } catch (error) {
                        console.error('[PHOTO_UPLOAD] Error handling image:', error);
                        await reply(format('error_photo_process_failed'));
                    }
                    return;
                }
            }

            if (stateStep === 'LEMOT_AWAITING_PHOTO') {
                if (type === 'conversation') {
                    const result = await handleLemotPhotoUpload({
                        sender,
                        response: chats,
                        photoPath: null,
                        reply
                    });

                    if (result.message) {
                        await reply(result.message);
                    }
                    return;
                }

                if (type === 'imageMessage') {
                    const { downloadMediaMessage } = await import('@whiskeysockets/baileys');

                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {});
                        const fileName = `photo_${Date.now()}.jpg`;
                        const photoPath = path.join(__dirname, '../uploads', fileName);

                        const uploadsDir = path.join(__dirname, '../uploads');
                        if (!fs.existsSync(uploadsDir)) {
                            fs.mkdirSync(uploadsDir, { recursive: true });
                        }

                        fs.writeFileSync(photoPath, buffer);
                        console.log('[PHOTO_UPLOAD] Image saved:', photoPath);

                        const result = await handleLemotPhotoUpload({
                            sender,
                            response: null,
                            photoPath: fileName,  // Keep filename only
                            photoBuffer: buffer,   // Add buffer for immediate sending
                            reply
                        });

                        if (result.message) {
                            await reply(result.message);
                        }
                    } catch (error) {
                        console.error('[PHOTO_UPLOAD_ERROR]', error);
                        await reply(format('error_photo_receive_failed'));
                    }
                    return;
                }
            }

            if (stateStep === 'CONFIRM_DIRECT_MATI') {
                const result = await handleDirectConfirmation({
                    sender,
                    response: chats,
                    reply
                });

                if (result.message) {
                    await reply(result.message);
                }
                return;
            }

            if (stateStep === 'DIRECT_LEMOT_TROUBLESHOOT') {
                const result = await handleDirectLemotResponse({
                    sender,
                    response: chats,
                    reply
                });

                if (result.message) {
                    await reply(result.message);
                }
                return;
            }

            // --- WiFi Management State Handlers (ADDED FIX) ---

            // Handle single SSID name change input
            if (stateStep === 'ASK_NEW_NAME_FOR_SINGLE') {
                const { handleSingleSSIDNameChange } = require('./handlers/wifi-management-handler');
                // Pass user input as newName
                await handleSingleSSIDNameChange(sender, userState.targetUser, chats, reply, global);
                // Clear state is handled within the function or after success
                return;
            }

            // Handle single SSID password change input
            if (stateStep === 'ASK_NEW_PASSWORD') {
                const { handleSingleSSIDPasswordChange } = require('./handlers/wifi-management-handler');
                await handleSingleSSIDPasswordChange(sender, userState.targetUser, chats, reply, global);
                return;
            }

            // Handle confirmation for name change
            if (stateStep === 'CONFIRM_GANTI_NAMA') {
                if (chats.toLowerCase() === 'ya') {
                    const { setSSIDName } = require('../lib/wifi');
                    const { logWifiNameChange } = require('./handlers/wifi-management-handler'); // Helper needs to be exported or redefined
                    // Re-importing local helper for logging if needed, strict ref requires correct path
                    // For now, executing direct logic similar to handler
                    try {
                        const user = userState.targetUser;
                        const newName = userState.nama_wifi_baru;
                        await setSSIDName(user.device_id, userState.ssid_id || '1', newName);

                        // Manually log since logWifiNameChange is not exported. 
                        // Ideally we should export it, but for quick fix:
                        console.log(`[WIFI] Name changed for ${user.name} to ${newName}`);

                        await reply(`✅ *Berhasil!*\n\nNama WiFi telah diubah menjadi: *"${newName}"*\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• Modem akan restart otomatis\n• Anda mungkin perlu menyambung ulang perangkat Anda`);
                    } catch (error) {
                        console.error(`[CONFIRM_NAME_CHANGE] Error:`, error);
                        await reply(`❌ Maaf, gagal mengubah nama WiFi. Error: ${error.message}`);
                    }
                } else {
                    await reply('❌ Perubahan nama WiFi dibatalkan.');
                }
                deleteUserState(sender);
                return;
            }

            // Handle confirmation for password change
            if (stateStep === 'CONFIRM_GANTI_SANDI') {
                if (chats.toLowerCase() === 'ya') {
                    const { setPassword } = require('../lib/wifi');
                    try {
                        const user = userState.targetUser;
                        const newPassword = userState.sandi_wifi_baru;
                        await setPassword(user.device_id, userState.ssid_id || '1', newPassword);

                        console.log(`[WIFI] Password changed for ${user.name}`);

                        await reply(`✅ *Berhasil!*\n\nKata sandi WiFi telah diubah menjadi: \`${newPassword}\`\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• Modem akan restart otomatis\n• Semua perangkat perlu login ulang dengan password baru`);
                    } catch (error) {
                        console.error(`[CONFIRM_PASSWORD_CHANGE] Error:`, error);
                        await reply(`❌ Maaf, gagal mengubah kata sandi WiFi. Error: ${error.message}`);
                    }
                } else {
                    await reply('❌ Perubahan kata sandi WiFi dibatalkan.');
                }
                deleteUserState(sender);
                return;
            }

            // Handle bulk/auto inputs (if needed based on wifi-management-handler)
            if (stateStep === 'ASK_NEW_NAME_FOR_BULK_AUTO') {
                const { handleBulkAutoNameChange } = require('./handlers/wifi-management-handler');
                await handleBulkAutoNameChange(sender, userState.targetUser, chats, reply, global);
                return;
            }

            if (stateStep === 'ASK_NEW_PASSWORD_BULK_AUTO') {
                const { handleBulkAutoPasswordChange } = require('./handlers/wifi-management-handler');
                await handleBulkAutoPasswordChange(sender, userState.targetUser, chats, reply, global);
                return;
            }

            // --- End WiFi Management State Handlers ---

            if (stateStep === 'GANGGUAN_MATI_AWAITING_PHOTO' && type === 'imageMessage') {
                const { downloadMediaMessage } = await import('@whiskeysockets/baileys');

                try {
                    if (smartReportState.uploadedPhotos && smartReportState.uploadedPhotos.length >= 3) {
                        await reply(format('error_photo_max_limit'));
                        return;
                    }

                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    const date = new Date();
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const ticketId = smartReportState.ticketData.ticketId;
                    const timestamp = Date.now();

                    const fileName = `customer_${ticketId}_${timestamp}.jpg`;

                    const uploadDir = getReportsUploadsPath(year, month, ticketId, __dirname);

                    if (!fs.existsSync(uploadDir)) {
                        fs.mkdirSync(uploadDir, { recursive: true });
                    }

                    const filePath = path.join(uploadDir, fileName);
                    fs.writeFileSync(filePath, buffer);

                    smartReportState.uploadedPhotos = smartReportState.uploadedPhotos || [];
                    smartReportState.uploadedPhotos.push({
                        fileName: fileName,
                        path: filePath,
                        uploadedAt: date.toISOString(),
                        size: buffer.length,
                        uploadedBy: 'customer'
                    });

                    smartReportState.photoBuffers = smartReportState.photoBuffers || [];
                    smartReportState.photoBuffers.push(buffer);

                    smartReportState.startTime = smartReportState.startTime || Date.now();

                    const stateToSave = { ...smartReportState };
                    delete stateToSave.photoBuffers;
                    setUserState(sender, stateToSave);

                    const photoCount = smartReportState.uploadedPhotos.length;
                    const remaining = 3 - photoCount;

                    await reply(`📸 Foto ${photoCount} berhasil diterima!

${remaining > 0 ? `• Bisa upload ${remaining} foto lagi` : '• Maksimal 3 foto tercapai'}
• Ketik *lanjut* untuk selesai
• Ketik *skip* jika cukup

_Foto akan membantu teknisi diagnosis masalah_`);

                } catch (error) {
                    console.error('[CUSTOMER_PHOTO_UPLOAD_ERROR]', error);
                    await reply(format('error_photo_upload_failed'));
                }
                return;
            }

            if ((stateStep === 'TICKET_RESOLVE_UPLOAD_PHOTOS' || stateStep === 'TICKET_VERIFIED_AWAITING_PHOTOS') && type === 'imageMessage') {
                const { downloadMediaMessage } = await import('@whiskeysockets/baileys');

                if (stateStep === 'TICKET_VERIFIED_AWAITING_PHOTOS' && !smartReportState.otpVerifiedAt) {
                    await reply(format('error_not_verified'));
                    return;
                }

                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {});
                    const ticketId = smartReportState.ticketIdToResolve || smartReportState.ticketId;
                    const teknisiName = isTeknisi ? isTeknisi.username : 'teknisi';

                    const result = await addPhotoToQueue({
                        sender,
                        buffer,
                        state: smartReportState,
                        teknisiName,
                        ticketId,
                        reply
                    });

                    if (result.queued) {
                        console.log(`[PHOTO_QUEUE] Photo ${result.count} queued for ${sender}`);
                    }

                } catch (error) {
                    console.error('[UPLOAD_PHOTO_ERROR]', error);
                }
                return;
            }

            if (stateStep === 'GANGGUAN_MATI_AWAITING_PHOTO') {
                const result = await handleCustomerPhotoUpload({
                    sender,
                    state: smartReportState,
                    chats,
                    reply
                });

                if (result.message) {
                    await reply(result.message);
                }
                return;
            }

            const resolutionStates = [
                'TICKET_VERIFIED_AWAITING_PHOTOS',
                'TICKET_RESOLVE_UPLOAD_PHOTOS',
                'TICKET_RESOLVE_ASK_NOTES',
                'TICKET_RESOLVE_CONFIRM'
            ];

            if (resolutionStates.includes(stateStep)) {
                console.log(`[${stateStep}] Handling text: "${chats}" from ${sender}`);

                const result = await handleGeneralSteps({
                    userState: smartReportState,
                    sender,
                    chats,
                    pushname,
                    reply,
                    setUserState,
                    deleteUserState
                });

                if (result.message) {
                    await reply(result.message);
                }

                return;
            }

            if ((type === 'locationMessage' || type === 'liveLocationMessage') && smartReportState) {
                if (smartReportState.step === 'AWAITING_LOCATION_FOR_JOURNEY') {
                    let locationData;
                    if (type === 'locationMessage') {
                        locationData = msg.message.locationMessage;
                    } else if (type === 'liveLocationMessage') {
                        locationData = msg.message.liveLocationMessage;
                    }

                    if (!locationData || !locationData.degreesLatitude || !locationData.degreesLongitude) {
                        console.error('[LOCATION_ERROR] Invalid location data:', locationData);
                        await reply(format('error_location_invalid'));
                        return;
                    }

                    const locationResult = await handleTeknisiShareLocation(
                        sender,
                        {
                            degreesLatitude: locationData.degreesLatitude,
                            degreesLongitude: locationData.degreesLongitude,
                            accuracyInMeters: locationData.accuracyInMeters
                        },
                        reply
                    );
                    if (locationResult && locationResult.message) {
                        await reply(locationResult.message);
                    }
                    return;
                }
            }

            if ((type === 'locationMessage' || type === 'liveLocationMessage')) {
                const reports = global.reports || [];
                const activeTicket = reports.find(r =>
                    (r.processedByTeknisiId === sender || r.teknisiId === sender) &&
                    (r.status === 'otw' || r.status === 'arrived' || r.status === 'diproses teknisi' || r.status === 'process')
                );

                if (activeTicket) {
                    let locationData;
                    if (type === 'locationMessage') {
                        locationData = msg.message.locationMessage;
                    } else if (type === 'liveLocationMessage') {
                        locationData = msg.message.liveLocationMessage;
                    }

                    if (!locationData || !locationData.degreesLatitude || !locationData.degreesLongitude) {
                        console.error('[LOCATION_ERROR] Invalid location data for active ticket:', locationData);
                        return;
                    }

                    const locationResult = await handleTeknisiShareLocation(
                        sender,
                        {
                            degreesLatitude: locationData.degreesLatitude,
                            degreesLongitude: locationData.degreesLongitude,
                            accuracyInMeters: locationData.accuracyInMeters
                        },
                        reply
                    );
                    if (locationResult && locationResult.message) {
                        await reply(locationResult.message);
                    }
                    return;
                }
            }

            if (stateStep === 'GANGGUAN_MATI_DEVICE_OFFLINE') {
                const result = await handleGangguanMatiOfflineResponse({
                    sender,
                    body: chats,
                    reply,
                    findUserByPhone: null, // Will use state to find user
                    msg,
                    raf
                });

                if (result && result.message) {
                    await reply(result.message);
                }
                return;
            }

            if (stateStep === 'GANGGUAN_MATI_DEVICE_ONLINE') {
                const result = await handleGangguanMatiOnlineResponse({
                    sender,
                    body: chats,
                    reply,
                    msg,
                    raf
                });

                if (result && result.message) {
                    await reply(result.message);
                }
                return;
            }

            if (stateStep === 'GANGGUAN_LEMOT_ANALYSIS' ||
                stateStep === 'GANGGUAN_LEMOT_AWAITING_RESPONSE' ||
                stateStep === 'GANGGUAN_LEMOT_CONFIRM_TICKET') {
                const result = await handleGangguanLemotResponse({
                    sender,
                    body: chats,
                    reply,
                    msg,
                    raf
                });

                if (result && result.message) {
                    await reply(result.message);
                }
                return;
            }
        }

        const tempWifiInputStates = [
            'ASK_NEW_NAME_FOR_SINGLE',
            'ASK_NEW_NAME_FOR_SINGLE_BULK',
            'ASK_NEW_NAME_FOR_BULK',
            'ASK_NEW_NAME_FOR_BULK_AUTO',
            'ASK_NEW_PASSWORD',
            'ASK_NEW_PASSWORD_BULK',
            'ASK_NEW_PASSWORD_BULK_AUTO'
        ];

        const isInTempWifiInputState = temp[sender] && tempWifiInputStates.includes(temp[sender].step);

        if (temp[sender] && isGlobalCommand && !isInTempWifiInputState) {
            console.log(`[GLOBAL_COMMAND] Clearing temp state for ${sender}`);
            delete temp[sender];
        }
        else if (temp[sender]) {
            if (temp[sender].step === 'AWAITING_QUESTION') {
                delete temp[sender];

                reply("Maaf, fitur tanya jawab otomatis sudah tidak tersedia.\n\nSilakan gunakan perintah berikut:\n• *menu* - Lihat menu utama\n• *bantuan* - Lihat panduan\n• Atau hubungi admin untuk bantuan lebih lanjut.");
                return;
            }
        }

        if (temp[sender]?.step === 'ASK_VOUCHER_CHOICE' && !isGlobalCommand) {
            const chosenPrice = chats.trim().replace(/\D/g, '');

            if (!chosenPrice) {
                return reply("Mohon balas dengan *harga* voucher yang ingin Anda beli (contoh: `1000`). Atau ketik *batal* untuk membatalkan.");
            }

            if (!checkhargavoucher(chosenPrice)) {
                return reply(`Maaf, voucher seharga Rp ${chosenPrice} tidak tersedia. Silakan pilih salah satu dari daftar yang ada, atau ketik *batal*.`);
            }

            delete temp[sender];

            const helpers = {
                checkhargavoucher,
                checkprofvc,
                checkdurasivc,
                checkhargavc,
                checkATMuser,
                confirmATM,
                getvoucher
            };
            await processVoucherPurchase(normalizedSenderForSaldo, pushname, chosenPrice, reply, helpers, global);

            return;
        }

        const teknisiState = global.teknisiStates && global.teknisiStates[sender];
        const isTeknisiPhotoState = teknisiState && (
            teknisiState.step === 'AWAITING_COMPLETION_PHOTOS' ||
            teknisiState.step === 'AWAITING_PHOTO_CATEGORY_1' ||
            teknisiState.step === 'AWAITING_PHOTO_CATEGORY_2' ||
            teknisiState.step === 'AWAITING_PHOTO_CATEGORY_3' ||
            teknisiState.step === 'AWAITING_PHOTO_EXTRA'
        );

        if (isTeknisiPhotoState && type === 'imageMessage') {
            const { downloadMediaMessage } = await import('@whiskeysockets/baileys');

            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                console.log('[TEKNISI_PHOTO_DEBUG] Downloaded buffer size:', buffer ? buffer.length : 'NULL');

                if (!buffer || buffer.length === 0) {
                    throw new Error('Downloaded buffer is empty or null');
                }

                const ticketId = teknisiState.ticketId;
                if (!ticketId) {
                    throw new Error('Ticket ID not found in teknisi state');
                }

                const date = new Date();
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');

                const timestamp = Date.now();
                const random = Math.random().toString(36).substring(7);
                const fileName = `photo_${timestamp}_${random}.jpg`;

                const projectRoot = getProjectRoot(__dirname);
                const uploadsDir = getTeknisiUploadsPathByTicket(year, month, ticketId, __dirname);
                const photoPath = path.join(uploadsDir, fileName);

                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }

                try {
                    fs.writeFileSync(photoPath, buffer);
                    console.log('[TEKNISI_PHOTO] Image saved successfully:', photoPath);
                    console.log('[TEKNISI_PHOTO] File exists after save:', fs.existsSync(photoPath));
                    if (fs.existsSync(photoPath)) {
                        console.log('[TEKNISI_PHOTO] File size:', fs.statSync(photoPath).size, 'bytes');
                    }
                } catch (saveError) {
                    console.error('[TEKNISI_PHOTO_SAVE_ERROR] Failed to save file:', saveError);
                    console.error('[TEKNISI_PHOTO_SAVE_ERROR] Path:', photoPath);
                    console.error('[TEKNISI_PHOTO_SAVE_ERROR] Buffer size:', buffer.length);
                    throw saveError;
                }

                const result = await handleTeknisiPhotoUpload(sender, fileName);

                if (result.message) {
                    await reply(result.message);
                }
            } catch (error) {
                console.error('[TEKNISI_PHOTO_ERROR]', error);
                await reply('❌ Gagal menerima foto. Silakan coba lagi.');
            }
            return;
        }

        if (teknisiState && teknisiState.step === 'AWAITING_PHOTO_CATEGORY_3' &&
            (chats.toLowerCase().trim() === 'skip' || chats.toLowerCase().trim() === 'lewati')) {

            teknisiState.step = 'AWAITING_PHOTO_EXTRA_CONFIRM';
            teknisiState.currentPhotoCategory = 'extra';

            await reply(`⚪ *FOTO HASIL DI-SKIP*

━━━━━━━━━━━━━━━━
📊 *STATUS DOKUMENTASI:*
━━━━━━━━━━━━━━━━

✅ 1. Foto penyebab masalah ✓
✅ 2. Screenshot speedtest ✓
⚪ 3. Foto hasil (di-skip)

━━━━━━━━━━━━━━━━
📎 *FOTO TAMBAHAN?*
━━━━━━━━━━━━━━━━

📸 Ingin tambah foto pendukung lainnya?
• Foto dari sudut berbeda
• Foto detail tertentu

Ketik:
• *YA* - untuk upload foto tambahan
• *TIDAK* - untuk selesaikan tiket

➡️ *Pilihan Anda...*`);
            return;
        }

        if (teknisiState && teknisiState.step === 'AWAITING_PHOTO_EXTRA_CONFIRM') {
            const response = chats.toLowerCase().trim();

            if (response === 'ya' || response === 'yes') {
                teknisiState.step = 'AWAITING_PHOTO_EXTRA';
                teknisiState.currentPhotoCategory = 'extra';

                await reply(`✅ *SIAP TERIMA FOTO TAMBAHAN*

━━━━━━━━━━━━━━━━
📎 *UPLOAD FOTO TAMBAHAN*
━━━━━━━━━━━━━━━━

📸 Kirim foto tambahan:
• Foto sudut berbeda
• Foto detail tertentu
• Dokumentasi lain yang relevan

💡 *Batas:*
• Maksimal ${5 - teknisiState.uploadedPhotos.length} foto lagi
• Setelah selesai ketik *DONE*

➡️ *Kirim foto sekarang...*`);
                return;

            } else if (response === 'tidak' || response === 'no') {
                teknisiState.step = 'AWAITING_COMPLETION_CONFIRMATION';

                const problemFilled = teknisiState.photoCategories.problem ? '✅' : '⚪';
                const speedtestFilled = teknisiState.photoCategories.speedtest ? '✅' : '⚪';
                const resultFilled = teknisiState.photoCategories.result ? '✅' : '⚪';

                await reply(`✅ *DOKUMENTASI LENGKAP!*

━━━━━━━━━━━━━━━━
📊 *RINGKASAN DOKUMENTASI:*
━━━━━━━━━━━━━━━━

${problemFilled} 1. Foto penyebab masalah
${speedtestFilled} 2. Screenshot speedtest
${resultFilled} 3. Foto hasil perbaikan
⚪ Tidak ada foto tambahan

━━━━━━━━━━━━━━━━
📌 *STEP TERAKHIR:*
━━━━━━━━━━━━━━━━

➡️ Ketik salah satu:
   • *done*
   • *lanjut*
   • *next*

Untuk melanjutkan input catatan perbaikan`);
                return;
            }
        }

        if (global.teknisiStates && global.teknisiStates[sender] &&
            global.teknisiStates[sender].step === 'AWAITING_RESOLUTION_NOTES') {
            const state = global.teknisiStates[sender];

            if (chats.length < 10) {
                await reply(format('error_notes_too_short'));
                return;
            }

            state.resolutionNotes = chats;
            state.step = 'AWAITING_CONFIRMATION';

            await reply(`📝 *REVIEW SEBELUM FINALISASI*
━━━━━━━━━━━━━━━━

📋 *ID Tiket:* ${state.ticketId}
📸 *Dokumentasi:* ${state.uploadedPhotos.length} foto
📝 *Catatan Resolusi:*
${chats}

━━━━━━━━━━━━━━━━
⚠️ *KONFIRMASI PENYELESAIAN*

Apakah perbaikan sudah selesai dan data di atas sudah benar?

📌 *STEP TERAKHIR:*
➡️ Ketik *ya* = Selesaikan tiket & kirim ke pelanggan
➡️ Ketik *tidak* = Edit ulang catatan`);
            return;
        }

        if (global.teknisiStates && global.teknisiStates[sender] &&
            global.teknisiStates[sender].step === 'AWAITING_CONFIRMATION') {
            const state = global.teknisiStates[sender];
            const response = chats.toLowerCase().trim();

            if (response === 'ya' || response === 'yes') {
                const result = await handleCompleteTicket(sender, state);

                if (result.message) {
                    await reply(result.message);
                }

                delete global.teknisiStates[sender];
                return;
            } else if (response === 'tidak' || response === 'no') {
                state.step = 'AWAITING_RESOLUTION_NOTES';
                await reply(format('info_notes_edit_cancelled'));
            } else {
                await reply(format('error_invalid_choice'));
            }
            return;
        }

        if (temp[sender] && !isGlobalCommand) {
            return await handleConversationState({
                sender,
                chats,
                temp,
                reply,
                global,
                isOwner,
                isTeknisi,
                users,
                args,
                entities: {}, // Will be populated if needed
                plainSenderNumber,
                pushname,
                mess,
                sleep,
                getSSIDInfo,
                namabot,
                buatLaporanGangguan
            });
        }

        let intent;
        let entities = {}; // Default entitas kosong
        let matchedKeywordLength = 0; // Menyimpan jumlah kata dari keyword yang cocok

        if (!chats || chats.trim() === '') return;

        // Check WiFi input states using getUserState (consistent with wifi-management-handler)
        const wifiState = getUserState(sender);
        if (wifiState && wifiState.step) {
            const wifiInputStates = [
                'ASK_NEW_NAME_FOR_SINGLE',
                'ASK_NEW_NAME_FOR_SINGLE_BULK',
                'ASK_NEW_NAME_FOR_BULK',
                'ASK_NEW_NAME_FOR_BULK_AUTO',
                'ASK_NEW_PASSWORD',
                'ASK_NEW_PASSWORD_BULK',
                'ASK_NEW_PASSWORD_BULK_AUTO'
            ];

            if (wifiInputStates.includes(wifiState.step)) {
                if (chats.toLowerCase().trim() === 'batal') {
                    deleteUserState(sender);
                    reply(format('success_process_cancelled'));
                    clearProcessing(sender);
                    return;
                }

                // Continue processing WiFi input (handled elsewhere)
            }
        }

        // Also check legacy temp state for backward compatibility
        if (temp[sender] && temp[sender].step) {
            const wifiInputStates = [
                'ASK_NEW_NAME_FOR_SINGLE',
                'ASK_NEW_NAME_FOR_SINGLE_BULK',
                'ASK_NEW_NAME_FOR_BULK',
                'ASK_NEW_NAME_FOR_BULK_AUTO',
                'ASK_NEW_PASSWORD',
                'ASK_NEW_PASSWORD_BULK',
                'ASK_NEW_PASSWORD_BULK_AUTO'
            ];

            if (wifiInputStates.includes(temp[sender].step)) {
                if (chats.toLowerCase().trim() === 'batal') {
                    delete temp[sender];
                    reply(format('success_process_cancelled'));
                    clearProcessing(sender);
                    return;
                }

                return;
            }
        }

        let isAgent = false;
        let agentCred = null;

        const isGroup = sender.endsWith('@g.us');

        let senderInfo = extractSenderInfo(msg, isGroup);

        if (senderInfo.isLid && !senderInfo.phoneNumber && raf && raf.signalRepository) {
            const lidJid = senderInfo.originalSender;
            try {
                if (raf.signalRepository.lidMapping && raf.signalRepository.lidMapping.getPNForLID) {
                    const phoneNumberJid = await raf.signalRepository.lidMapping.getPNForLID(lidJid);
                    if (phoneNumberJid) {
                        senderInfo.phoneNumber = phoneNumberJid.split('@')[0];
                        senderInfo.method = 'signal_repository';
                    }
                }
            } catch (error) {
            }
        }

        let phoneNumberToSearch = senderInfo.phoneNumber || sender.split('@')[0];
        phoneNumberToSearch = phoneNumberToSearch.replace(/@.*$/, '');

        agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);

        if (!agentCred && !phoneNumberToSearch.includes('@')) {
            agentCred = agentTransactionManager.getAgentByWhatsapp(`${phoneNumberToSearch}@s.whatsapp.net`);
        }

        if (!agentCred) {
            const agent = agentManager.getAgentByWhatsapp(phoneNumberToSearch);
            if (agent) {
                isAgent = true;
                agentCred = agent;
            }
        } else {
            isAgent = true;
        }

        if (!intent) {
            const keywordResult = getIntentFromKeywords(chats);
            if (keywordResult) {
                console.log(`[INTENT_DEBUG] Keyword match found: ${keywordResult.intent} for message: "${chats}"`);
                const lowerChats = chats.toLowerCase();
                if (isAgent && (lowerChats.includes('jual') || lowerChats === 'jual voucher' || lowerChats.startsWith('jual voucher'))) {
                    intent = 'AGENT_SELL_VOUCHER';
                    matchedKeywordLength = 2; // "jual voucher" is 2 words
                    console.log(`[INTENT_DEBUG] OVERRIDE: Changed intent from ${keywordResult.intent} to AGENT_SELL_VOUCHER for agent`);
                } else {
                    intent = keywordResult.intent;
                    matchedKeywordLength = keywordResult.matchedKeywordLength;
                }
            }
        }

        // Calculate qAfterKeyword - arguments after the matched keyword
        // Example: "cek wifi 10" with matchedKeywordLength=2 -> qAfterKeyword="10"
        // Example: "cari budi" with matchedKeywordLength=1 -> qAfterKeyword="budi"
        let qAfterKeyword = '';
        if (matchedKeywordLength > 0) {
            qAfterKeyword = args.slice(matchedKeywordLength).join(' ').trim();
        } else {
            qAfterKeyword = q; // Fallback to original q
        }

        if (intent === 'LAPOR_GANGGUAN_MATI' && command !== 'lapor') {
            intent = undefined;
        }

        console.log(`[INTENT_DEBUG] Final intent: ${intent} for message: "${chats}", matchedKeywordLength: ${matchedKeywordLength}, qAfterKeyword: "${qAfterKeyword}"`);

        switch (intent) {
            case 'MULAI_BERTANYA': {
                temp[sender] = {
                    step: 'AWAITING_QUESTION'
                };
                reply(format('convo_awaiting_question_prompt'));
                break;
            }
            case 'TANYA_JAWAB_UMUM': {
                reply("Maaf, fitur tanya jawab otomatis sudah tidak tersedia.\n\nSilakan gunakan perintah berikut:\n• *menu* - Lihat menu utama\n• *bantuan* - Lihat panduan\n• Atau hubungi admin untuk bantuan lebih lanjut.");
                break;
            }
            case 'LAPOR_PANDUAN': {
                const user = findUserWithLidSupport(global.users, msg, plainSenderNumber);

                if (sender.includes('@lid') && !user) {
                    console.log('[LAPOR_PANDUAN] @lid format detected, user not found');
                    console.log('[LAPOR_PANDUAN] Sender:', sender);
                }

                if (!user) {
                    return reply(mess.userNotRegister);
                }

                reply(format('panduan_laporan_cerdas', { pushname: pushname || 'Kak' }));
                break;
            }
            case 'LAPOR_GANGGUAN': {
                deleteUserState(sender);

                const result = await startReportFlow({
                    sender,
                    pushname,
                    reply,
                    msg,
                    raf: global.raf
                });

                if (result.message) {
                    await reply(result.message);
                }
                break;
            }

            case 'LAPOR_GANGGUAN_MATI': {
                deleteUserState(sender);

                await reply(`⏳ Sedang memeriksa status perangkat Anda...`);

                const result = await handleGangguanMati({
                    sender,
                    pushname,
                    userPelanggan: null, // Will be found in handler
                    reply,
                    findUserByPhone: null, // Will use global.users
                    msg, // Pass msg for LID support
                    raf  // Pass raf for LID support
                });

                if (result.message) {
                    await reply(result.message);
                }
                break;
            }

            case 'LAPOR_GANGGUAN_LEMOT': {
                deleteUserState(sender);

                const result = await handleGangguanLemot({
                    sender,
                    pushname,
                    userPelanggan: null, // Will be found in handler
                    reply,
                    findUserByPhone: null, // Will use global.users
                    msg, // Pass msg for LID support
                    raf  // Pass raf for LID support
                });

                if (result.message) {
                    await reply(result.message);
                }
                break;
            }
            case 'statusppp': {
                await handleStatusPpp(isOwner, isTeknisi, reply, mess, global.config);
                break;
            }
            case 'statushotspot': {
                await handleStatusHotspot(isOwner, isTeknisi, reply, mess, global.config);
                break;
            }
            case 'CEK_TIKET': {
                handleCekTiket(q, pushname, sender, isOwner, isTeknisi, global.config, global, reply);
                break;
            }
            case 'BATALKAN_TIKET': {
                if (isOwner || isTeknisi) {
                    return reply(`Fitur ini khusus untuk pelanggan. Admin dapat membatalkan tiket melalui antarmuka web.`);
                }

                let ticketId = '';
                const originalMessage = chats.trim();

                const cleanedMessage = originalMessage.replace(/^batalkan\s*tiket\s*/i, '').trim();

                if (cleanedMessage && cleanedMessage.length > 0) {
                    ticketId = cleanedMessage.toUpperCase();
                }

                if (!ticketId || ticketId.length < 5) {
                    const userReports = global.reports.filter(
                        r => r.pelangganId === sender && (r.status === 'baru' || r.status === 'pending')
                    );

                    if (userReports.length === 0) {
                        return reply(`Halo Kak ${pushname}, saat ini Anda tidak memiliki laporan aktif yang bisa dibatalkan.\n\nFormat: *batalkantiket [ID_TIKET]*`);
                    }

                    let listMessage = `📋 *Laporan Anda yang bisa dibatalkan:*\n\n`;
                    userReports.forEach(r => {
                        listMessage += `ID: *${r.ticketId}*\nStatus: ${r.status}\nTanggal: ${new Date(r.createdAt).toLocaleString('id-ID')}\n\n`;
                    });
                    listMessage += `Untuk membatalkan, ketik:\n*batalkantiket [ID_TIKET]*`;
                    return reply(listMessage);
                }

                const activeReport = global.reports.find(
                    r => r.ticketId === ticketId
                );

                if (!activeReport) {
                    return reply(`❌ Tiket dengan ID *${ticketId}* tidak ditemukan.\n\nSilakan cek kembali ID tiket Anda.`);
                }
                if (activeReport.pelangganId !== sender) {
                    return reply(`❌ Tiket dengan ID *${ticketId}* bukan milik Anda.`);
                }

                if (activeReport.status === 'dibatalkan' || activeReport.status === 'dibatalkan pelanggan') {
                    return reply(`ℹ️ Tiket dengan ID *${ticketId}* sudah dibatalkan sebelumnya.`);
                }

                if (activeReport.status === 'selesai') {
                    return reply(`ℹ️ Tiket dengan ID *${ticketId}* sudah selesai ditangani.`);
                }

                if (activeReport.status === 'diproses teknisi' || activeReport.status === 'otw' || activeReport.status === 'sampai lokasi') {
                    return reply(`⚠️ Maaf, laporan Anda dengan ID *${ticketId}* sudah dalam penanganan teknisi dan tidak dapat dibatalkan.\n\nStatus: *${activeReport.status}*\n\nSilakan hubungi Admin jika ada keperluan mendesak.`);
                }

                if (activeReport.status === 'baru' || activeReport.status === 'pending') {
                    const reportDetails = activeReport.laporanText ?
                        activeReport.laporanText.substring(0, 75) + (activeReport.laporanText.length > 75 ? '...' : '') :
                        'Tidak ada deskripsi';

                    temp[sender] = {
                        step: 'CONFIRM_CANCEL_TICKET',
                        ticketIdToCancel: activeReport.ticketId
                    };

                    return reply(`📋 *Konfirmasi Pembatalan Tiket*\n\nID: *${activeReport.ticketId}*\nLaporan: _"${reportDetails}"_\nStatus: ${activeReport.status}\n\nAnda yakin ingin membatalkan laporan ini?\n\nBalas *ya* untuk konfirmasi pembatalan\nBalas *tidak* untuk membatalkan`);
                }

                return reply(`⚠️ Tiket dengan ID *${ticketId}* memiliki status: *${activeReport.status}*\n\nStatus ini tidak dapat diproses untuk pembatalan. Silakan hubungi admin untuk bantuan.`);
                break;
            }

            case 'KONFIRMASI_SELESAI': {
                const args = q.split(' ');
                if (args.length < 2) {
                    const transactionId = args[0];
                    if (transactionId && transactionId.startsWith('AGT_TRX_')) {
                        return reply("Format: konfirmasi [transaction_id] [pin]");
                    }
                    return reply("Format: konfirmasi [ID_TIKET] [KODE]");
                }

                const firstArg = args[0];

                if (firstArg.startsWith('AGT_TRX_')) {
                    await handleAgentConfirmation(msg, sender, reply, args);
                } else {
                    if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

                    const ticketId = firstArg;
                    const code = args[1];

                    const result = await handleFinalConfirmation({
                        ticketId,
                        completionCode: code,
                        isFromCustomer: false,
                        sender
                    });

                    if (result.message) {
                        await reply(result.message);
                    }
                }
                break;
            }

            case 'CUSTOMER_CONFIRM_DONE': {
                if (!isOwner && !isTeknisi) {
                    const remoteResponse = await handleRemoteResponse({
                        customerId: sender,
                        response: lowerMessage,
                        reply
                    });

                    if (remoteResponse) {
                        return reply(remoteResponse.message);
                    }
                }

                const report = global.reports.find(r =>
                    r.ticketId === ticketId &&
                    r.pelangganId === sender
                );

                if (!report) {
                    return reply(format('error_ticket_not_found'));
                }

                const result = await handleFinalConfirmation({
                    ticketId,
                    completionCode: code,
                    isFromCustomer: true,
                    sender
                });

                if (result.message) {
                    await reply(result.message);
                }
                break;
            }

            case 'SELESAIKAN_TIKET': // Old flow - redirect to new flow
            case 'tiketdone': {
                if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);
                if (!q) return reply("Mohon sertakan nomor tiket yang ingin diselesaikan. Contoh: tiketdone [ID_TIKET]");

                const ticketIdToResolve = q.trim();
                const reportIndex = global.reports.findIndex(r => r.ticketId === ticketIdToResolve);

                if (reportIndex === -1) {
                    return reply(`❌ Tiket dengan ID *${ticketIdToResolve}* tidak ditemukan.\n\nPastikan ID tiket benar.`);
                }

                const report = global.reports[reportIndex];

                if (report.status === 'selesai') {
                    return reply(`⚠️ Tiket *${ticketIdToResolve}* sudah selesai sebelumnya.`);
                }

                setUserState(sender, {
                    step: 'TICKET_RESOLVE_UPLOAD_PHOTOS',
                    ticketIdToResolve: ticketIdToResolve,
                    uploadedPhotos: [],
                    uploadStartTime: Date.now()
                });

                await reply(`📸 *Dokumentasi Penyelesaian Tiket*

ID Tiket: *${ticketIdToResolve}*
Pelanggan: ${report.pelangganName || report.pelangganPushName || 'N/A'}

Silakan upload foto dokumentasi perbaikan:
• Foto ONT/Router setelah perbaikan
• Foto kabel yang sudah diperbaiki
• Screenshot speedtest (jika ada)
• Foto lainnya yang relevan

📤 *Cara Upload:*
1. Kirim foto satu per satu
2. Setelah selesai, ketik *selesai*
3. Atau ketik *skip* untuk lewati foto

⏱️ Timeout: 10 menit`);
            }
                break;
            case 'TOPUP_SALDO': // Sesuaikan dengan intent yang mungkin dari Gemini
            case 'buynow': {
                await handleTopupSaldoPayment({
                    sender: normalizedSenderForSaldo, // Gunakan normalized JID untuk operasi saldo
                    pushname,
                    command,
                    q,
                    from,
                    msg,
                    reply,
                    raf: global.raf,
                    pay,
                    checkprofvc,
                    checkhargavoucher,
                    checkhargavc,
                    addPayment
                });
            }
                break;
            case 'BELI_VOUCHER': {
                const helpers = {
                    checkhargavoucher,
                    checkprofvc,
                    checkdurasivc,
                    checkhargavc,
                    checkATMuser,
                    confirmATM,
                    getvoucher
                };
                await handleBeliVoucher({
                    sender: normalizedSenderForSaldo, // Gunakan normalized JID untuk operasi saldo
                    pushname,
                    entities,
                    q,
                    reply,
                    temp,
                    global,
                    helpers
                });
            }
                break
            case 'button': {
                await reply(`Hi Kak ${pushname}! 👋

📋 *MENU UTAMA*

Silakan pilih menu:

*1️⃣ MENU WIFI*
   List menu untuk WiFi

*2️⃣ MENU PELANGGAN*  
   List menu pelanggan

*3️⃣ INFO PASANG*
   Harga pasang WiFi

━━━━━━━━━━━━━━━━
Ketik angka pilihan Anda (1/2/3)
atau ketik:
• *menuwifi* - Menu WiFi
• *menupelanggan* - Menu Pelanggan  
• *pasang* - Info Pasang`);
            }
                break;
            case 'BANTUAN': {
                handleBantuan(pushname, global.config, reply);
                break;
            }
            case 'SAPAAN_UMUM': {
                handleSapaanUmum(pushname, reply);
                break;
            }
            case 'MENU_PELANGGAN': {
                handleMenuPelanggan(global.config, reply, pushname, sender);
                break;
            }
            case 'MENU_UTAMA':
            case 'help':
            case 'menu wifi':
            case 'menuwifi': {
                handleMenuUtama(global.config, reply, pushname, sender);
                break;
            }
            case 'MENU_TEKNISI': {
                handleMenuTeknisi(global.config, reply, pushname, sender);
                break;
            }
            case 'MENU_OWNER': {
                handleMenuOwner(global.config, isOwner, reply, pushname, sender);
                break;
            }
            case 'TANYA_CARA_PASANG': {
                handleTanyaCaraPasang(global.config, reply, pushname, sender);
                break;
            }
            case 'TANYA_PAKET_BULANAN': {
                handleTanyaPaketBulanan(global.config, reply, pushname, sender);
                break;
            }
            case 'TUTORIAL_TOPUP': {
                handleTutorialTopup(global.config, reply, pushname, sender);
                break;
            }
            case 'listprofstatik': {
                handleListProfStatik(isOwner, reply, mess, statik);
                break;
            }
            case 'listprofvoucher': {
                handleListProfVoucher(isOwner, reply, mess, voucher);
                break;
            }
            case 'CEK_SALDO': {
                // Gunakan normalizedSenderForSaldo yang sudah dinormalisasi dari @lid ke format standar
                handleCekSaldo(normalizedSenderForSaldo, pushname, global.config, format, reply);
                break;
            }
            case 'TRANSFER_SALDO': {
                let transferArgs = [];
                const transferText = chats.trim();

                if (transferText.includes('|')) {
                    const parts = transferText.split('|');
                    transferArgs = [parts[0].replace(/^transfer\s+/i, '').trim(), parts[1].trim()];
                } else {
                    const parts = transferText.replace(/^transfer\s+/i, '').split(/\s+/);
                    if (parts.length >= 2) {
                        transferArgs = [parts[0], parts[1]];
                    }
                }

                if (transferArgs.length < 2) {
                    return await reply(format('error_format_transfer'));
                }

                await handleTransferSaldo(msg, normalizedSenderForSaldo, reply, transferArgs);
                break;
            }
            case 'BATAL_TOPUP': {
                await handleCancelTopup(msg, normalizedSenderForSaldo, reply);
                break;
            }
            case 'TANYA_HARGA_VOUCHER': {
                const senderInfo = extractSenderInfo(msg, sender);
                const phoneNumberToSearch = senderInfo.phoneNumber || sender.split('@')[0];
                const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);

                if (agentCred && chats.toLowerCase().includes('jual')) {
                    await handleAgentSellVoucher(msg, sender, reply, temp, raf, users, global);
                } else {
                    handleTanyaHargaVoucher(pushname, global.config, global.voucher, format, reply);
                }
                break;
            }
            case 'ACCESS_MANAGEMENT': {
                await handleAccessManagement({
                    sender,
                    args,
                    users: global.users,
                    reply,
                    global,
                    db,
                    msg,
                    raf
                });
            }
                break;

            case 'LIST_AGENTS': {
                try {
                    if (q && q.trim()) {
                        await handleAgentByArea(msg, sender, reply, q.trim());
                    } else {
                        await handleListAgents(msg, sender, reply, pushname);
                    }
                } catch (error) {
                    console.error('[LIST_AGENTS] Error:', error);
                    await reply(format('error_agent_data_failed'));
                }
            }
                break;

            case 'AGENT_SERVICES': {
                await handleAgentServices(msg, sender, reply);
            }
                break;

            case 'SEARCH_AGENT': {
                const searchQuery = q && q.trim() ? q.trim() : '';
                await handleSearchAgent(msg, sender, reply, searchQuery);
            }
                break;

            case 'AGENT_DETAIL': {
                const agentId = q && q.trim() ? q.trim().toUpperCase() : '';
                if (!agentId) {
                    await reply('❌ Masukkan ID agent.\n\nFormat: *detail agent [ID]*\nContoh: *detail agent AGT001*\n\nKetik *agent* untuk melihat daftar agent.');
                } else {
                    await handleViewAgentDetail(msg, sender, reply, agentId);
                }
            }
                break;

            case 'AGENT_TRANSACTIONS': {
                await handleAgentTodayTransactions(msg, sender, reply, raf);
            }
                break;

            case 'CHECK_TOPUP_STATUS': {
                await handleCheckTopupStatus(msg, normalizedSenderForSaldo, reply);
            }
                break;

            case 'AGENT_SELF_PROFILE': {
                await handleAgentSelfProfile(msg, sender, reply, raf);
            }
                break;

            case 'AGENT_CHANGE_PIN': {
                await handleAgentPinChange(msg, sender, reply, args, raf);
            }
                break;

            case 'AGENT_PURCHASE_VOUCHER': {
                await handleAgentPurchaseVoucher(msg, sender, reply, temp, raf);
            }
                break;

            case 'AGENT_SELL_VOUCHER': {
                await handleAgentSellVoucher(msg, sender, reply, temp, raf, users, global);
                break;
            }

            case 'AGENT_CHECK_INVENTORY': {
                await handleAgentCheckInventory(msg, sender, reply, raf);
            }
                break;

            case 'AGENT_PURCHASE_HISTORY': {
                await handleAgentPurchaseHistory(msg, sender, reply, raf);
            }
                break;

            case 'AGENT_SALES_HISTORY': {
                await handleAgentSalesHistory(msg, sender, reply, raf);
            }
                break;

            case 'AGENT_UPDATE_ADDRESS': {
                await handleAgentProfileUpdate(msg, sender, reply, args, 'address', raf);
            }
                break;

            case 'AGENT_UPDATE_HOURS': {
                await handleAgentProfileUpdate(msg, sender, reply, args, 'hours', raf);
            }
                break;

            case 'AGENT_UPDATE_PHONE': {
                await handleAgentProfileUpdate(msg, sender, reply, args, 'phone', raf);
            }
                break;

            case 'AGENT_CLOSE_TEMPORARY': {
                await handleAgentStatusToggle(msg, sender, reply, 'close', raf);
            }
                break;

            case 'AGENT_OPEN_AGAIN': {
                await handleAgentStatusToggle(msg, sender, reply, 'open', raf);
            }
                break;
            case 'admin': {
                handleAdminContact(from, ownerNumber, global.config, msg, sendContact, reply);
                break;
            }
            case 'statusap': {
                await handleStatusAp(isOwner, reply, mess);
                break;
            }
            case 'allsaldo': {
                handleAllSaldo(isOwner, reply, mess, global.config, atm);
                break;
            }
            case 'vc123': {
                handleVc123(global.config, voucher, reply);
                break;
            }
            case 'alluser': {
                handleAllUser(reply, users);
                break;
            }
            case 'CARI_PELANGGAN': {
                if (!isOwner && !isTeknisi) {
                    return reply(mess.teknisiOrOwnerOnly);
                }

                // Use qAfterKeyword instead of q for correct argument parsing
                const searchQuery = qAfterKeyword && qAfterKeyword.trim() ? qAfterKeyword.trim() : '';
                if (!searchQuery) {
                    return reply(`🔍 *CARI PELANGGAN*\n\nFormat: *cari [nama/nomor/ID]*\n\nContoh:\n• cari Budi\n• cari 08123456789\n• cari 15`);
                }

                const { handleSearchUser } = require('./handlers/admin-handler');
                const result = handleSearchUser({ query: searchQuery });
                return reply(result.message);
            }
            case 'DAFTAR_PELANGGAN': {
                if (!isOwner && !isTeknisi) {
                    return reply(mess.teknisiOrOwnerOnly);
                }

                // Parse arguments: "daftar pelanggan [filter] [page]"
                // Examples: "daftar pelanggan", "daftar pelanggan 2", "daftar pelanggan lunas", "daftar pelanggan belum 2"
                let filter = null;
                let page = 1;

                if (qAfterKeyword) {
                    const parts = qAfterKeyword.toLowerCase().trim().split(/\s+/);

                    for (const part of parts) {
                        if (part === 'lunas') {
                            filter = 'paid';
                        } else if (part === 'belum') {
                            filter = 'unpaid';
                        } else if (!isNaN(parseInt(part, 10))) {
                            page = parseInt(part, 10);
                        }
                    }
                }

                const { handleListUsers } = require('./handlers/admin-handler');
                const result = handleListUsers({ filter, page });
                return reply(result.message);
            }
            case 'GANTI_NAMA_WIFI': {
                await handleGantiNamaWifi({
                    sender,
                    args,
                    matchedKeywordLength,
                    isOwner,
                    isTeknisi,
                    pushname,
                    users,
                    reply,
                    global,
                    mess,
                    msg,
                    raf
                });
                break;
            }
            case 'GANTI_SANDI_WIFI': {
                await handleGantiSandiWifi({
                    sender,
                    args,
                    matchedKeywordLength,
                    isOwner,
                    isTeknisi,
                    pushname,
                    users,
                    reply,
                    global,
                    mess,
                    msg,
                    raf
                });
                break;
            }
            case 'GANTI_POWER_WIFI': {
                await handleGantiPowerWifi({
                    sender,
                    args,
                    matchedKeywordLength,
                    q,
                    isOwner,
                    isTeknisi,
                    users,
                    reply,
                    global,
                    mess,
                    msg,
                    raf
                });
                break;
            }
            case 'REBOOT_MODEM': {
                handleRebootModem({
                    sender,
                    entities,
                    isOwner,
                    isTeknisi,
                    plainSenderNumber,
                    pushname,
                    users,
                    reply,
                    mess,
                    msg
                });
                break;
            }
            case 'CEK_WIFI': {
                await handleCekWifi({
                    sender,
                    args,
                    matchedKeywordLength,
                    isOwner,
                    isTeknisi,
                    pushname,
                    users,
                    reply,
                    global,
                    mess,
                    msg,
                    raf
                });
                break;
            }

            case 'HISTORY_WIFI': {
                await handleHistoryWifi(sender, reply, global, msg, raf);
                break;
            }
            case 'monitorwifi': {
                handleMonitorWifi(isOwner, isTeknisi, reply, mess);
                break;
            }
            case 'addprofvoucher': {
                await handleAddProfVoucher({ q, isOwner, reply, mess, checkprofvoucher, addvoucher });
                break;
            }
            case 'delprofvoucher': {
                await handleDelProfVoucher({ q, isOwner, reply, mess, checkprofvoucher, voucher });
                break;
            }
            case 'addprofstatik': {
                await handleAddProfStatik({ q, isOwner, reply, mess, checkStatik, addStatik });
                break;
            }
            case 'delprofstatik': {
                await handleDelProfStatik({ q, isOwner, reply, mess, checkStatik, statik });
                break;
            }
            case 'addbinding': {
                await handleAddBinding({
                    q,
                    isOwner,
                    reply,
                    mess,
                    global,
                    checkStatik,
                    checkLimitAt,
                    checkMaxLimit,
                    addbinding,
                    addqueue
                });
                break;
            }
            case 'addppp': {
                await handleAddPPP({ q, isOwner, reply, mess, addpppoe });
                break;
            }
            case '<topup': {
                await handleTopup({ q, isOwner, sender: normalizedSenderForSaldo, reply, msg, mess, raf, checkATMuser, addATM, addKoinUser });
                break;
            }
            case '<delsaldo': {
                await handleDelSaldo({ q, isOwner, reply, mess, checkATMuser, delSaldo });
                break;
            }
            case 'transfer': {
                await handleTransfer({ q, sender: normalizedSenderForSaldo, reply, msg, mess, raf, checkATMuser, addATM, addKoinUser, confirmATM, format });
                break;
            }
            case 'CEK_TAGIHAN': {
                await handleCekTagihan({
                    plainSenderNumber,
                    pushname,
                    reply,
                    mess,
                    global,
                    renderTemplate,
                    msg,  // Pass for LID support
                    raf,  // Pass for LID support
                    sender // Pass for LID detection
                });
                break;
            }
            case 'CEK_PAKET': {
                const user = findUserWithLidSupport(global.users, msg, plainSenderNumber);
                const result = handleCheckPackage({ user, pushname });
                await reply(result.message);
                break;
            }
            case 'KELUHAN_SARAN': {
                const user = findUserWithLidSupport(global.users, msg, plainSenderNumber);
                const keluhanText = chats.replace(/^(keluhan|saran|kritik|komplain)\s*/i, '').trim();
                const result = handleComplaint({ user, pushname, complaint: keluhanText });
                await reply(result.message);
                break;
            }
            case 'INFO_LAYANAN': {
                const result = handleServiceInfo();
                await reply(result.message);
                break;
            }
            case 'UBAH_PAKET': {
                await handleUbahPaket({
                    sender,
                    plainSenderNumber,
                    pushname,
                    reply,
                    mess,
                    global,
                    temp,
                    msg,  // Pass for LID support
                    raf   // Pass for LID support
                });
                break;
            }
            case 'REQUEST_SPEED_BOOST': {
                await handleRequestSpeedBoost({
                    sender,
                    plainSenderNumber,
                    pushname,
                    reply,
                    mess,
                    global,
                    temp,
                    msg,  // Pass for LID support
                    raf   // Pass for LID support
                });
                break;
            }

            case 'CEK_STATUS_SPEED': {
                const { checkSpeedBoostStatus } = require('./handlers/speed-status-handler');
                const user = findUserWithLidSupport(global.users, msg, plainSenderNumber);
                if (!user) {
                    return reply(mess.userNotRegister);
                }
                await checkSpeedBoostStatus(msg, user, sender, false);
                break;
            }

            // ===================== LOCATION TRACKING CASES =====================

            case 'CEK_LOKASI_TEKNISI': {
                // Skip matched keyword words to get the actual argument
                const commandArgs = chats.split(' ').slice(matchedKeywordLength || 1);
                const ticketIdLokasi = commandArgs[0];

                if (!ticketIdLokasi) {
                    return reply(format('error_format_lokasi'));
                }

                const lokasiResult = await handleCekLokasiTeknisi(
                    sender,
                    ticketIdLokasi,
                    reply
                );
                return reply(lokasiResult.message);
            }

            case 'TIKET_SAYA': {
                const tiketResult = await handleTiketSaya(sender, reply);
                return reply(tiketResult.message);
            }

            case 'LIST_TIKET': {
                if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

                const pendingTickets = global.reports?.filter(r =>
                    r.status === 'pending' || r.status === 'open'
                ) || [];

                if (pendingTickets.length === 0) {
                    return reply(`📋 *TIDAK ADA TIKET TERSEDIA*
━━━━━━━━━━━━━━━━

Saat ini tidak ada tiket yang perlu ditangani.

📌 *Tips:*
• Cek berkala dengan *list tiket*
• Akan ada notifikasi jika ada tiket baru
• Siap siaga untuk respons cepat

Terima kasih! 👍`);
                }

                pendingTickets.sort((a, b) => {
                    if (a.priority === 'HIGH' && b.priority !== 'HIGH') return -1;
                    if (a.priority !== 'HIGH' && b.priority === 'HIGH') return 1;
                    return new Date(a.createdAt) - new Date(b.createdAt);
                });

                let message = `📋 *DAFTAR TIKET TERSEDIA*
━━━━━━━━━━━━━━━━

*Total: ${pendingTickets.length} tiket menunggu*\n\n`;

                pendingTickets.forEach((ticket, index) => {
                    const createdTime = new Date(ticket.createdAt);
                    const waitingMinutes = Math.floor((Date.now() - createdTime) / (1000 * 60));
                    const priorityEmoji = ticket.priority === 'HIGH' ? '🔴' : '🟡';

                    message += `${index + 1}. *ID: ${ticket.ticketId}*
   ${priorityEmoji} Prioritas: ${ticket.priority}
   👤 ${ticket.pelangganName}
   📍 ${ticket.pelangganAddress || 'Alamat tidak tersedia'}
   ⏱️ Menunggu: ${waitingMinutes} menit
   📝 ${ticket.issueType || 'Gangguan'}
   
`;
                });

                message += `━━━━━━━━━━━━━━━━
📌 *STEP SELANJUTNYA:*
➡️ Ambil tiket dengan ketik:
   *proses [ID_TIKET]*

Contoh: proses ${pendingTickets[0].ticketId}

💡 *Tips:* Prioritaskan tiket 🔴 HIGH`;

                return reply(message);
            }

            case 'PROSES_TIKET': {
                if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

                const words = chats.split(' ');
                const ticketId = words[matchedKeywordLength] || words[1];
                if (!ticketId) {
                    return reply(format('error_format_proses'));
                }

                const result = await handleProsesTicket(sender, ticketId, reply);
                return reply(result.message);
            }

            case 'OTW_TIKET': {
                if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

                const words = chats.split(' ');
                const ticketId = words[matchedKeywordLength] || words[1];
                if (!ticketId) {
                    return reply(format('error_format_otw'));
                }

                const result = await handleOTW(sender, ticketId, null, reply);
                return reply(result.message);
            }

            case 'SAMPAI_LOKASI': {
                if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

                const words = chats.split(' ');
                const ticketId = words[matchedKeywordLength] || words[1];
                if (!ticketId) {
                    return reply(format('error_format_sampai'));
                }

                const result = await handleSampaiLokasi(sender, ticketId, reply);
                return reply(result.message);
            }

            case 'VERIFIKASI_OTP': {
                if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

                const args = chats.split(' ');
                const ticketId = args[matchedKeywordLength] || args[1];
                const otp = args[matchedKeywordLength + 1] || args[2];

                if (!ticketId || !otp) {
                    return reply(format('error_format_verifikasi'));
                }

                const result = await handleVerifikasiOTP(sender, ticketId, otp, reply);
                return reply(result.message);
            }

            case 'DONE_UPLOAD_PHOTOS': {
                // IMPORTANT: Only respond if there's an active workflow session
                // If no active session, silently ignore - don't respond at all
                const state = global.teknisiStates && global.teknisiStates[sender];

                // No active session = silently ignore (no response)
                if (!state) {
                    break;
                }

                // Must be teknisi/owner to use this command
                if (!isTeknisi && !isOwner) {
                    break;
                }

                if (state.guidedMode) {
                    const { problem, speedtest } = state.photoCategories;

                    if (!problem || !speedtest) {
                        let missingCategories = [];
                        if (!problem) missingCategories.push('📷 Foto penyebab masalah');
                        if (!speedtest) missingCategories.push('📊 Screenshot speedtest');

                        return reply(`❌ *KATEGORI FOTO WAJIB BELUM LENGKAP!*\n\n━━━━━━━━━━━━━━━━\n📌 *STATUS:*\n━━━━━━━━━━━━━━━━\n\n${problem ? '✅' : '❌'} 1. Foto penyebab masalah\n${speedtest ? '✅' : '❌'} 2. Screenshot speedtest\n${state.photoCategories.result ? '✅' : '⚪'} 3. Foto hasil (opsional)\n\n━━━━━━━━━━━━━━━━\n⚠️ *YANG MASIH KURANG:*\n━━━━━━━━━━━━━━━━\n\n${missingCategories.join('\n')}\n\n➡️ *Upload foto yang kurang terlebih dahulu!*`);
                    }

                } else {
                    if (state.step !== 'AWAITING_COMPLETION_PHOTOS') {
                        return reply(format('error_not_photo_upload_phase'));
                    }

                    if (!state.uploadedPhotos || state.uploadedPhotos.length < 2) {
                        return reply(`❌ *FOTO BELUM CUKUP!*\n\n📌 *STATUS:*\n• Foto terupload: ${state.uploadedPhotos?.length || 0}\n• Minimum required: 2 foto\n• Kurang: ${2 - (state.uploadedPhotos?.length || 0)} foto\n\n📌 *STEP SELANJUTNYA:*\n➡️ Upload ${2 - (state.uploadedPhotos?.length || 0)} foto lagi\n   Kemudian ketik *done*`);
                    }
                }

                state.step = 'AWAITING_RESOLUTION_NOTES';

                return reply(`✅ *DOKUMENTASI SELESAI - ${state.uploadedPhotos.length} FOTO TERSIMPAN*

📌 *STEP SELANJUTNYA:*
📝 *ISI CATATAN RESOLUSI PERBAIKAN*
━━━━━━━━━━━━━━━━

Silakan ketik catatan perbaikan Anda.

*Format Bebas (min. 10 karakter):*
🔸 "Restart modem, sudah normal"
🔸 "Ganti kabel drop, sinyal OK" 
🔸 "Setting ulang router, speed normal"

*Atau Format Detail:*
*Masalah:* [apa masalahnya]
*Solusi:* [apa yang diperbaiki]
*Status:* [hasil akhir]

➡️ Ketik catatan Anda sekarang...`);
            }

            case 'SELESAI_TIKET': {
                if (!isTeknisi && !isOwner) return reply(mess.teknisiOrOwnerOnly);

                const ticketId = chats.split(' ')[1];
                if (!ticketId) {
                    return reply(format('error_format_selesai'));
                }

                const result = await handleSelesaiTicket(sender, ticketId, reply);
                return reply(result.message);
            }

            case 'link':
            case 'LINK': {
                if (!sender.includes('@lid')) {
                    return reply('⚠️ Perintah ini hanya untuk pengguna dengan format @lid');
                }

                const lidId = sender.split('@')[0];
                const phoneNumber = args[1]; // User should type: link 6285233047094

                if (!phoneNumber) {
                    return reply(format('error_format_link'));
                }

                const result = processLidVerification(lidId, phoneNumber, users);
                return reply(result.message);
            }

            case 'verifikasi':
            case 'VERIFIKASI': {
                if (!sender.includes('@lid')) {
                    return reply('⚠️ Perintah ini hanya untuk pengguna dengan format @lid');
                }

                const lidId = sender.split('@')[0];
                const code = args[1];

                if (!code) {
                    return reply(format('error_format_verifikasi_lid'));
                }

                const result = processLidVerification(lidId, code, users);
                return reply(result.message);
            }

            default:
                if (intent === "TIDAK_DIKENALI") {
                }
                break;
        }

    } catch (err) {
        if (typeof err === "string") return reply(String(err));
        console.log(err)
    } finally {
        clearProcessing(sender);
    }
}
