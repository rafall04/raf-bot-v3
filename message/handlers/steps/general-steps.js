"use strict";

/**
 * Header Doc
 * Purpose: Menangani langkah percakapan umum (konfirmasi proses tiket, resolusi/foto tiket, komplain, tanya) untuk workflow tiket legacy.
 * Caller: Router state conversation bot.
 * Deps: `../../../lib/whatsapp-delivery-service`, `../../../lib/whatsapp-gateway`, `../../../lib/template-service`,
 *   dan `../ticket-creation-handler` (pemilik `saveReportsToFile` — persistensi tiket ke `database/reports.json`).
 * MainFuncs: `handleGeneralSteps`.
 * SideEffects: Mengubah state percakapan, memicu aksi device, dan mengirim update tiket ke pelanggan.
 */

const { sendMessage } = require("../../../lib/whatsapp-delivery-service");
const { isReady } = require("../../../lib/whatsapp-gateway");
const { renderCategoryTemplate } = require("../../../lib/template-service");
const { getUserState } = require("../conversation-handler");

function renderResponseTemplate(key, fallbackOrData, maybeData) {
    // Dukung dua signature:
    //   renderResponseTemplate(key, data)         -> return key sebagai fallback (legacy)
    //   renderResponseTemplate(key, fallback, data) -> return fallback string saat key tidak ada
    let data = {};
    let fallback = null;
    if (typeof fallbackOrData === 'string') {
        fallback = fallbackOrData;
        data = maybeData || {};
    } else if (fallbackOrData && typeof fallbackOrData === 'object') {
        data = fallbackOrData;
    }
    const result = renderCategoryTemplate("responseTemplates", key, data);
    if (result && result.found && typeof result.text === 'string' && result.text.trim()) {
        return result.text;
    }
    if (fallback !== null) return fallback;
    return key;
}

/**
 * Handle general conversation steps
 */
async function handleGeneralSteps({ userState, sender, chats, pushname, setUserState, deleteUserState }) {
    const userReply = chats.toLowerCase().trim();
    
    switch (userState.step) {
        // Payment Confirmation Steps
        case 'PAYMENT_CONFIRMATION': {
            // Handle payment confirmation with image
            // This would typically be handled in the main raf.js when receiving image message
            return {
                success: true,
                message: renderResponseTemplate("general_payment_proof_prompt")
            };
        }
        
        // Complaint/Feedback Steps
        case 'AWAITING_COMPLAINT': {
            const complaint = chats.trim();
            
            if (!complaint || complaint === '') {
                return {
                    success: false,
                    message: renderResponseTemplate("general_complaint_empty")
                };
            }
            
            // Save complaint
            const complaintData = {
                id: Date.now().toString(),
                userId: userState.user.id,
                userName: userState.user.name,
                userPhone: userState.user.phone_number,
                complaint: complaint,
                createdAt: new Date().toISOString(),
                status: 'new'
            };
            
            // Log complaint (you might want to save to database)
            console.log('[NEW_COMPLAINT]', complaintData);
            
            deleteUserState(sender);
            
            return {
                success: true,
                message: renderResponseTemplate("general_complaint_received", { pushname, complaintId: complaintData.id, complaint, receivedAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) })
            };
        }
        
        // Ticket Processing Confirmation
        case 'CONFIRM_PROCESS_TICKET': {
            if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                const { ticketIdToProcess, reportData: _reportData } = userState;
                const reportIndex = global.reports.findIndex(r => r.ticketId === ticketIdToProcess);
                
                if (reportIndex !== -1) {
                    const report = global.reports[reportIndex];
                    
                    // Get teknisi info from accounts
                    const senderNumber = sender.replace('@s.whatsapp.net', '');
                    let phoneToMatch = senderNumber;
                    if (senderNumber.startsWith('62')) {
                        phoneToMatch = senderNumber.substring(2);
                    }
                    
                    const teknisiAccount = global.accounts.find(acc => {
                        if (acc.role !== 'teknisi') return false;
                        return acc.phone_number === phoneToMatch || 
                               acc.phone_number === senderNumber ||
                               `62${acc.phone_number}` === senderNumber;
                    });
                    
                    const teknisiName = teknisiAccount ? (teknisiAccount.name || teknisiAccount.username) : pushname;
                    
                    // Update report status - set all possible field names for compatibility
                    global.reports[reportIndex].status = 'diproses teknisi';
                    global.reports[reportIndex].processedAt = new Date().toISOString();
                    global.reports[reportIndex].processedByTeknisi = sender;
                    global.reports[reportIndex].processedByTeknisiId = sender;  // For old workflow compatibility
                    global.reports[reportIndex].teknisiId = sender;              // For new workflow compatibility
                    global.reports[reportIndex].processedByTeknisiName = teknisiName;
                    global.reports[reportIndex].teknisiName = teknisiName;          // For new workflow
                    
                    // Save to file
                    const { saveReportsToFile } = require('../ticket-creation-handler');
                    saveReportsToFile(global.reports);
                    
                    // Notify customer
                    // PENTING: Cek connection state dan gunakan error handling sesuai rules
                    if (isReady()) {
                        try {
                            const delivery = await sendMessage(report.pelangganId, {
                                text: renderResponseTemplate("general_ticket_process_customer_update", { ticketId: ticketIdToProcess, technicianName: teknisiName })
                            });
                            if (!delivery.sent) {
                                throw new Error(delivery.warning || delivery.errorCode || 'SEND_FAILED');
                            }
                            console.log(`[PROCESS_TICKET] ✅ Notified customer: ${report.pelangganId}`);
                        } catch (err) {
                            console.error('[SEND_MESSAGE_ERROR]', {
                                pelangganId: report.pelangganId,
                                error: err.message
                            });
                            console.error('[NOTIFY_CUSTOMER_ERROR] ❌', err);
                        }
                    } else {
                        console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', report.pelangganId);
                        console.warn('[PROCESS_TICKET] Cannot notify customer - WhatsApp not connected');
                    }
                    
                    deleteUserState(sender);
                    
                    return {
                        success: true,
                        message: renderResponseTemplate("general_ticket_process_success", { ticketId: ticketIdToProcess, customerName: report.pelangganName, customerPhone: report.pelangganPhone, customerAddress: report.pelangganAddress || "N/A", complaint: report.laporanText })
                    };
                } else {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: renderResponseTemplate("general_ticket_not_found", { ticketId: ticketIdToProcess })
                    };
                }
            } else if (['tidak', 'no', 'n', 'gak'].includes(userReply)) {
                deleteUserState(sender);
                return {
                    success: true,
                    message: renderResponseTemplate("general_ticket_process_cancelled")
                };
            } else {
                return {
                    success: false,
                    message: renderResponseTemplate("general_ticket_process_confirm_invalid")
                };
            }
        }
        
        // Ticket Resolution - Photo Upload (Both old and new flow)
        case 'TICKET_RESOLVE_UPLOAD_PHOTOS': 
        case 'TICKET_VERIFIED_AWAITING_PHOTOS': {
            const userReply = chats.toLowerCase().trim();
            
            // Check timeout (30 minutes for verified flow)
            const timeoutDuration = userState.step === 'TICKET_VERIFIED_AWAITING_PHOTOS' ? 1800000 : 600000;
            const elapsed = Date.now() - (userState.uploadStartTime || userState.otpVerifiedAt || Date.now());
            if (elapsed > timeoutDuration) {
                deleteUserState(sender);
                return {
                    success: false,
                    message: renderResponseTemplate("general_ticket_photo_timeout")
                };
            }
            
            // Handle teknisi completing photo upload
            if (userReply === 'done' || userReply === 'lanjut' || userReply === 'next') {
                // Force process any pending photos in queue first
                const { getQueueStatus, forceProcessQueue, getSessionInfo } = require('../photo-upload-queue');
                
                const queueStatus = getQueueStatus(sender);
                const sessionInfo = getSessionInfo(sender);
                
                console.log(`[DONE_HANDLER] Queue status:`, queueStatus);
                console.log(`[DONE_HANDLER] Session info:`, sessionInfo);
                
                if (queueStatus && queueStatus.photoCount > 0) {
                    // Photos still in queue, process them first
                    console.log(`[DONE_HANDLER] Processing ${queueStatus.photoCount} pending photos before done`);
                    await forceProcessQueue(sender, false); // false = don't clear session yet
                    
                    // Wait a bit longer for queue processing
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Reload state after queue processing
                    userState = getUserState(sender);
                    if (!userState) {
                        console.error('[DONE_HANDLER] State lost after queue processing');
                        return {
                            success: false,
                            message: renderResponseTemplate("general_ticket_state_lost")
                        };
                    }
                }
                
                // Check minimum photos for verified flow
                const minPhotos = userState.step === 'TICKET_VERIFIED_AWAITING_PHOTOS' ? 2 : 0;
                
                if (userState.uploadedPhotos && userState.uploadedPhotos.length < minPhotos) {
                    return {
                        success: false,
                        message: renderResponseTemplate("general_ticket_minimum_photo_required", { minPhotos, uploadedPhotos: userState.uploadedPhotos.length, remainingPhotos: minPhotos - userState.uploadedPhotos.length })
                    };
                }
                
                // Save metadata
                const ticketId = userState.ticketIdToResolve || userState.ticketId;
                
                if (!ticketId) {
                    console.error('[DONE_HANDLER] No ticketId found in state:', userState);
                    return {
                        success: false,
                        message: renderResponseTemplate("general_ticket_id_missing")
                    };
                }
                
                const date = new Date();
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const uploadDir = require('path').join(__dirname, '../../../uploads/tickets', String(year), month, ticketId);
                
                // Create directory if not exists
                const fs = require('fs');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                
                const metadata = {
                    ticketId: ticketId,
                    uploadedBy: pushname || 'teknisi',
                    uploadedByPhone: sender,
                    uploadedAt: date.toISOString(),
                    images: userState.uploadedPhotos || [],
                    totalImages: (userState.uploadedPhotos || []).length,
                    totalSize: (userState.uploadedPhotos || []).reduce((sum, p) => sum + (p.size || 0), 0)
                };
                
                try {
                    fs.writeFileSync(
                        require('path').join(uploadDir, 'metadata.json'),
                        JSON.stringify(metadata, null, 2)
                    );
                } catch (err) {
                    console.error('[METADATA_SAVE_ERROR]', err);
                }
                
                // Clear photo upload session since we're done with photos
                const { clearUploadQueue } = require('../photo-upload-queue');
                clearUploadQueue(sender);
                console.log(`[DONE_HANDLER] Photo session cleared for ${sender}`);
                
                // Continue to resolution notes
                userState.step = 'TICKET_RESOLVE_ASK_NOTES';
                userState.photoMetadata = metadata;
                setUserState(sender, userState);
                
                return {
                    success: true,
                    message: renderResponseTemplate("general_ticket_photo_saved_prompt", { photoCount: userState.uploadedPhotos.length, folderPath: `tickets/${year}/${month}/${ticketId}/`, totalSizeMb: (metadata.totalSize / 1024 / 1024).toFixed(2) })
                };
                
            } else if (userReply === 'skip') {
                // Skip photo upload
                userState.step = 'TICKET_RESOLVE_ASK_NOTES';
                userState.uploadedPhotos = [];
                setUserState(sender, userState);
                
                return {
                    success: true,
                    message: renderResponseTemplate("general_ticket_photo_skipped_prompt")
                };
                
            } else if (userReply === 'batal') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: renderResponseTemplate("general_ticket_resolution_cancelled")
                };
                
            } else {
                // Remind user
                return {
                    success: true,
                    message: renderResponseTemplate("general_ticket_photo_reminder", { photoCount: userState.uploadedPhotos.length })
                };
            }
        }
        
        // Ticket Resolution - Ask Notes
        case 'TICKET_RESOLVE_ASK_NOTES': {
            const resolutionNotes = chats.trim();
            
            if (!resolutionNotes || resolutionNotes.length < 10) {
                return {
                    success: false,
                    message: renderResponseTemplate("general_resolution_notes_too_short")
                };
            }
            
            userState.resolutionNotes = resolutionNotes;
            userState.step = 'TICKET_RESOLVE_CONFIRM';
            setUserState(sender, userState);
            
            const photoInfo = userState.uploadedPhotos && userState.uploadedPhotos.length > 0
                ? `\n\n📸 *Foto Dokumentasi:* ${userState.uploadedPhotos.length} foto`
                : '\n\n📸 *Foto Dokumentasi:* Tidak ada';
            
            return {
                success: true,
                message: renderResponseTemplate("general_ticket_resolution_confirm", { ticketId: userState.ticketIdToResolve, resolutionNotes, photoInfo })
            };
        }
        
        // Ticket Resolution - Confirmation
        case 'TICKET_RESOLVE_CONFIRM': {
            if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                const { ticketIdToResolve, resolutionNotes, uploadedPhotos, photoMetadata } = userState;
                const reportIndex = global.reports.findIndex(r => r.ticketId === ticketIdToResolve);
                
                if (reportIndex !== -1) {
                    // Get the actual report
                    const ticketData = global.reports[reportIndex];
                    
                    // Update report
                    // Standardisasi status ke 'completed'
                    ticketData.status = 'completed';
                    ticketData.resolvedAt = new Date().toISOString();
                    ticketData.resolvedBy = pushname;
                    ticketData.resolutionNotes = resolutionNotes;
                    
                    // Add photo metadata to report
                    if (photoMetadata) {
                        ticketData.photoDocumentation = photoMetadata;
                    }
                    
                    // Save to file
                    const { saveReportsToFile } = require('../ticket-creation-handler');
                    saveReportsToFile(global.reports);
                    
                    // Build customer notification
                    let customerPhotoInfo = "";
                    let customerMessage = renderResponseTemplate("general_ticket_resolved_customer_message", {
                        ticketId: ticketIdToResolve,
                        resolutionNotes,
                        photoInfo: customerPhotoInfo,
                        technicianName: pushname,
                        resolvedAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
                    });

                    // Send notification to customer if we have their ID
                    // PENTING: Cek connection state dan gunakan error handling sesuai rules
                    if (isReady() && ticketData.pelangganId) {
                        if (uploadedPhotos && uploadedPhotos.length > 0) {
                            customerPhotoInfo = renderResponseTemplate("general_ticket_photo_info", { photoCount: uploadedPhotos.length });
                            customerMessage = renderResponseTemplate("general_ticket_resolved_customer_message", {
                                ticketId: ticketIdToResolve,
                                resolutionNotes,
                                photoInfo: customerPhotoInfo,
                                technicianName: pushname,
                                resolvedAt: new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
                            });
                            
                            for (const photo of uploadedPhotos) {
                                // PENTING: Cek connection state untuk setiap foto
                                if (isReady()) {
                                    try {
                                        // Check if photo file exists before trying to read
                                        const fs = require('fs');
                                        if (photo.path && fs.existsSync(photo.path)) {
                                            const photoBuffer = fs.readFileSync(photo.path);
                                            const delivery = await sendMessage(ticketData.pelangganId, {
                                                image: photoBuffer,
                                                caption: renderResponseTemplate("general_ticket_photo_caption", { fileName: photo.fileName || "Foto" })
                                            });
                                            if (!delivery.sent) {
                                                throw new Error(delivery.warning || delivery.errorCode || 'SEND_FAILED');
                                            }
                                            console.log(`[TICKET_RESOLVED] ✅ Sent photo ${photo.fileName} to customer`);
                                        } else {
                                            console.error(`[SEND_PHOTO_ERROR] Photo file not found: ${photo.path}`);
                                        }
                                    } catch (err) {
                                        console.error('[SEND_MESSAGE_ERROR]', {
                                            pelangganId: ticketData.pelangganId,
                                            type: 'image',
                                            photoFileName: photo.fileName,
                                            error: err.message
                                        });
                                        console.error('[SEND_PHOTO_ERROR] ❌', err);
                                        // Continue to next photo
                                    }
                                }
                            }
                        }

                        // Send text notification
                        if (isReady()) {
                            try {
                                const delivery = await sendMessage(ticketData.pelangganId, {
                                    text: customerMessage
                                });
                                if (!delivery.sent) {
                                    throw new Error(delivery.warning || delivery.errorCode || 'SEND_FAILED');
                                }
                                console.log(`[TICKET_RESOLVED] ✅ Notified customer: ${ticketData.pelangganId}`);
                            } catch (err) {
                                console.error('[SEND_MESSAGE_ERROR]', {
                                    pelangganId: ticketData.pelangganId,
                                    error: err.message
                                });
                                console.error('[NOTIFY_CUSTOMER_ERROR] ❌', err);
                            }
                        } else {
                            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', ticketData.pelangganId);
                        }
                    } else {
                        if (!ticketData.pelangganId) {
                            console.error('[NOTIFY_CUSTOMER_ERROR] No pelangganId found for ticket:', ticketIdToResolve);
                        } else {
                            console.warn('[TICKET_RESOLVED] Cannot notify customer - WhatsApp runtime not ready');
                        }
                    }
                    
                    deleteUserState(sender);
                    
                    const date = new Date();
                    return {
                        success: true,
                        message: renderResponseTemplate("general_ticket_resolved_success", { ticketId: ticketIdToResolve, photoCount: uploadedPhotos ? uploadedPhotos.length : 0, folderPath: `tickets/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${ticketIdToResolve}/` })
                    };
                } else {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: `❌ Tiket dengan ID *${ticketIdToResolve}* tidak ditemukan.`
                    };
                }
            } else if (userReply === 'edit') {
                userState.step = 'TICKET_RESOLVE_ASK_NOTES';
                setUserState(sender, userState);
                return {
                    success: true,
                    message: renderResponseTemplate("general_ticket_resolution_edit_prompt")
                };
            } else {
                return {
                    success: false,
                    message: renderResponseTemplate("general_ticket_resolution_confirm_invalid")
                };
            }
        }
        
        // Generic question answering
        case 'AWAITING_QUESTION': {
            const question = chats.trim();
            
            if (!question || question === '') {
                return {
                    success: false,
                    message: renderResponseTemplate("general_question_empty")
                };
            }
            
            deleteUserState(sender);
            
            // Here you might want to integrate with AI or FAQ system
            return {
                success: true,
                message: renderResponseTemplate("general_question_forwarded", { question, ownerNumber: global.config.ownerNumber || "nomor admin" })
            };
        }
    }
    
    return {
        success: false,
        message: renderResponseTemplate("general_step_unknown")
    };
}

module.exports = {
    handleGeneralSteps
};
