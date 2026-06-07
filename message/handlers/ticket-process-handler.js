/**
 * Header Doc
 * Purpose: Compatibility workflow proses tiket teknisi via WhatsApp dengan OTP, customer confirmation, dan final confirmation legacy.
 * Caller: Dispatcher bot legacy dan fallback flow final confirmation.
 * Deps: conversation-handler, ticket-workflow, whatsapp-delivery-service, whatsapp-gateway.
 * MainFuncs: handleProsesTicket, handleVerifikasiOTP, handleCompleteTicket, handleFinalConfirmation.
 * SideEffects: Menulis state percakapan, update workflow tiket, dan mengirim notifikasi WhatsApp ke pelanggan/admin.
 *
 * DEPRECATED: Handler ini sebagian besar sudah tidak digunakan.
 * - handleProsesTicket, handleVerifikasiOTP, handleCompleteTicket sudah diganti dengan teknisi-workflow-handler.js
 * - handleRemoteResponse masih digunakan untuk CUSTOMER_CONFIRM_DONE
 * - handleFinalConfirmation masih digunakan untuk final confirmation flow
 * 
 * TODO: Migrate handleRemoteResponse dan handleFinalConfirmation ke teknisi-workflow-handler.js
 * TODO: Hapus handler yang tidak digunakan setelah migration selesai.
 */

const { setUserState, getUserState, deleteUserState, format } = require('./conversation-handler');
const {
    markWaitingCustomerConfirmation,
    finalizeCustomerConfirmation,
    processTicket
} = require('../../lib/ticket-workflow');
const { sendMessage, sendMessageToMany } = require('../../lib/whatsapp-delivery-service');
const { hasAuthenticatedSession } = require('../../lib/whatsapp-gateway');

function renderResponseTemplate(key, fallback, data = {}) {
    const rendered = format(key, data);
    return rendered && rendered.trim() ? rendered : fallback;
}

/**
 * Format phone number to WhatsApp format
 */
function formatPhoneNumber(phone) {
    if (!phone) return '';
    phone = phone.trim();
    if (phone.endsWith('@s.whatsapp.net')) {
        return phone;
    }
    if (phone.startsWith('0')) {
        phone = `62${phone.substring(1)}`;
    } else if (!phone.startsWith('62')) {
        phone = `62${phone}`;
    }
    return `${phone}@s.whatsapp.net`;
}

/**
 * Handle PROSES command from teknisi
 * 
 * @deprecated Handler ini sudah diganti dengan handleProsesTicket dari teknisi-workflow-handler.js
 * Handler ini tidak digunakan di routing message/raf.js
 * TODO: Hapus handler ini setelah memastikan tidak ada dependencies
 */
async function handleProsesTicket(sender, ticketId, teknisiInfo, _reply) {
    try {
        console.warn('[legacyTicketProcessAdapterUsed]', {
            action: 'handleProsesTicket',
            ticketId,
            sender
        });
        // Check teknisi workload (max 3 active tickets)
        const activeTickets = global.reports.filter(r => 
            r.processedByTeknisiId === sender && 
            ['process', 'diproses teknisi'].includes(r.status)
        );
        
        if (activeTickets.length >= 3) {
            const ticketList = activeTickets.map(t => `• ${t.ticketId} - ${t.pelangganName}`).join('\n');
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_max_active',
                    'Maksimal tiket aktif tercapai. Selesaikan salah satu tiket terlebih dahulu.',
                    { ticketList }
                )
            };
        }
        
        // Find the ticket
        const report = global.reports.find(r => r.ticketId === ticketId);
        
        if (!report) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_not_found',
                    `Tiket ${ticketId} tidak ditemukan.`,
                    { ticketId }
                )
            };
        }
        
        // Check if already being processed
        if (report.status === 'diproses teknisi') {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_already_processed',
                    `Tiket ${ticketId} sudah diproses teknisi lain.`,
                    {
                        ticketId,
                        teknisiName: report.processedByTeknisiName || 'Teknisi lain'
                    }
                )
            };
        }
        
        // Check for completed status (support both 'completed' and 'selesai' for backward compatibility)
        if (report.status === 'completed' || report.status === 'selesai') {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_already_completed',
                    `Tiket ${ticketId} sudah selesai ditangani.`,
                    { ticketId }
                )
            };
        }
        
        const { ticket: processedTicket, otp } = processTicket({
            ticketId,
            actor: {
                sender,
                id: sender,
                username: teknisiInfo?.username || sender,
                name: teknisiInfo ? (teknisiInfo.name || teknisiInfo.username) : 'Teknisi',
                phoneNumber: teknisiInfo?.phone_number || teknisiInfo?.phone || '',
                channel: 'wa'
            }
        });
        const latestReport = global.reports.find((item) => item.ticketId === ticketId) || processedTicket;
        
        // Store OTP in state
        setUserState(sender, {
            step: 'TICKET_PROCESSING',
            ticketId: ticketId,
            otp: otp,
            otpCreatedAt: Date.now(),
            reportData: latestReport
        });
        
        // Get teknisi info
        const teknisiAccount = global.accounts.find(acc => 
            acc.phone_number && formatPhoneNumber(acc.phone_number) === sender
        );
        
        const teknisiName = teknisiAccount?.name || teknisiAccount?.username || latestReport.processedByTeknisiName || 'Teknisi Kami';
        const teknisiPhone = teknisiAccount?.phone_number || sender.replace('@s.whatsapp.net', '');
        
        // Format teknisi phone for display
        let teknisiPhoneDisplay = teknisiPhone;
        if (teknisiPhoneDisplay.startsWith('62')) {
            teknisiPhoneDisplay = `0${teknisiPhoneDisplay.substring(2)}`;
        }
        
        // Get full laporan text without truncation
        const masalahText = latestReport.laporanText.replace(/\n/g, '\n  ');
        
        // Send notification to customer with OTP (to all registered numbers)
        const customerMessage = renderResponseTemplate(
            'ticket_process_customer_otp_notification',
            `Teknisi ${teknisiName} akan menangani tiket ${ticketId}. Kode verifikasi: ${otp}`,
            {
                customerName: report.pelangganName || 'Pelanggan',
                teknisiName,
                teknisiPhone: teknisiPhoneDisplay,
                ticketId,
                masalahText,
                otp
            }
        );
        
        const customerRecipients = [];
        if (latestReport.pelangganId) customerRecipients.push(latestReport.pelangganId);
        if (latestReport.pelangganPhone) {
            customerRecipients.push(...latestReport.pelangganPhone.split('|').map(p => p.trim()).filter(Boolean));
        }
        const customerDelivery = await sendMessageToMany(customerRecipients, { text: customerMessage });
        if (customerDelivery.sent) {
            console.log(`[TICKET_PROCESS] OTP sent to ${customerDelivery.successCount} customer recipient(s)`);
        }
        
        // Notify admins
            const adminNotif = renderResponseTemplate(
                'ticket_process_admin_processed_notification',
                `Tiket ${ticketId} diproses oleh ${latestReport.processedByTeknisiName}.`,
                {
                    ticketId,
                    teknisiName: latestReport.processedByTeknisiName,
                    customerName: latestReport.pelangganName,
                    priority: latestReport.priority
                }
            );
        
        // Send to admins
        const adminAccounts = global.accounts.filter(acc => 
            ['admin', 'owner', 'superadmin'].includes(acc.role) && 
            acc.phone_number && acc.phone_number.trim() !== ""
        );
        
        await sendMessageToMany(adminAccounts.map((admin) => admin.phone_number), { text: adminNotif });
        
        // Format multiple phone numbers nicely
        let phoneDisplay = 'N/A';
        if (latestReport.pelangganPhone) {
            const phones = latestReport.pelangganPhone.split('|').map(p => p.trim()).filter(p => p);
            if (phones.length > 1) {
                phoneDisplay = phones.map((phone, idx) => `${idx + 1}. ${phone}`).join('\n');
            } else if (phones.length === 1) {
                phoneDisplay = phones[0];
            }
        }
        
        return {
            success: true,
            message: renderResponseTemplate(
                'ticket_process_taken_success',
                `Tiket ${ticketId} berhasil diambil.`,
                {
                    ticketId,
                    customerName: latestReport.pelangganName,
                    customerAddress: latestReport.pelangganAddress || 'N/A',
                    phoneDisplay,
                    reportText: latestReport.laporanText
                }
            )
        };
        
    } catch (error) {
        console.error('[PROSES_TICKET_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate(
                'ticket_process_error',
                'Terjadi kesalahan saat memproses tiket. Silakan coba lagi.'
            )
        };
    }
}

/**
 * Handle OTP verification from teknisi
 * 
 * @deprecated Handler ini sudah diganti dengan handleVerifikasiOTP dari teknisi-workflow-handler.js
 * Handler ini tidak digunakan di routing message/raf.js
 * TODO: Hapus handler ini setelah memastikan tidak ada dependencies
 */
async function handleVerifikasiOTP(sender, ticketId, otp, _reply) {
    try {
        const state = getUserState(sender);
        
        // Check if user has state with OTP data (multiple valid steps)
        if (!state || !state.otp) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_no_active_ticket',
                    'Anda tidak sedang memproses tiket. Gunakan proses [ID_TIKET] terlebih dahulu.'
                )
            };
        }
        
        // Normalize ticket IDs for comparison
        const stateTicketId = state.ticketId?.toUpperCase();
        const inputTicketId = ticketId?.toUpperCase();
        
        if (stateTicketId !== inputTicketId) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_ticket_mismatch',
                    `ID tiket tidak sesuai. Anda sedang memproses tiket ${stateTicketId}.`,
                    { stateTicketId }
                )
            };
        }
        
        // Check OTP expiry (4 hours)
        const otpAge = Date.now() - state.otpCreatedAt;
        if (otpAge > 4 * 60 * 60 * 1000) {
            deleteUserState(sender);
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_otp_expired',
                    'Kode OTP sudah expired. Silakan proses ulang tiket.'
                )
            };
        }
        
        // Verify OTP
        if (state.otp !== otp) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_otp_invalid',
                    'Kode verifikasi tidak sesuai. Pastikan kode dari pelanggan benar.'
                )
            };
        }
        
        // OTP verified! Update state for photo upload
        state.step = 'TICKET_VERIFIED_AWAITING_PHOTOS';
        state.otpVerifiedAt = Date.now();
        state.uploadedPhotos = [];
        // IMPORTANT: Preserve ticketId and set ticketIdToResolve
        state.ticketIdToResolve = state.ticketId; // Add this to ensure ticketId is available later
        setUserState(sender, state);
        
        // Notify customer that teknisi is verified
        const report = state.reportData;
        if (report.pelangganId) {
            const customerMessage = renderResponseTemplate(
                'ticket_process_customer_verified_notification',
                'Teknisi telah tiba di lokasi dan terverifikasi. Perbaikan sedang dilakukan.'
            );
            await sendMessage(report.pelangganId, { text: customerMessage });
        }
        
        return {
            success: true,
            message: renderResponseTemplate(
                'ticket_process_otp_verified_success',
                `Verifikasi berhasil untuk tiket ${ticketId}. Silakan upload minimal 2 foto dokumentasi.`,
                { ticketId }
            )
        };
        
    } catch (error) {
        console.error('[VERIFY_OTP_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate(
                'ticket_process_verify_error',
                'Terjadi kesalahan saat verifikasi. Silakan coba lagi.'
            )
        };
    }
}

/**
 * Handle ticket completion with customer confirmation
 * 
 * @deprecated Handler ini sudah diganti dengan handleCompleteTicket dari teknisi-workflow-handler.js
 * Handler ini tidak digunakan di routing message/raf.js
 * TODO: Hapus handler ini setelah memastikan tidak ada dependencies
 */
async function handleCompleteTicket({ sender, ticketId, resolutionNotes, uploadedPhotos, reply: _reply }) {
    try {
        console.warn('[legacyTicketProcessAdapterUsed]', {
            action: 'handleCompleteTicket',
            ticketId,
            sender
        });
        const state = getUserState(sender);
        
        if (!state || !state.otpVerifiedAt) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_completion_not_verified',
                    'Tiket belum diverifikasi pelanggan. Pastikan Anda sudah mendapat OTP.'
                )
            };
        }
        
        const report = global.reports.find(r => r.ticketId === ticketId);
        if (!report) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_not_found',
                    `Tiket ${ticketId} tidak ditemukan.`,
                    { ticketId }
                )
            };
        }
        
        // Check minimum photos (2)
        if (!uploadedPhotos || uploadedPhotos.length < 2) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'ticket_process_minimum_photo_required',
                    `Dokumentasi belum cukup. Anda baru upload ${uploadedPhotos ? uploadedPhotos.length : 0} foto.`,
                    { photoCount: uploadedPhotos ? uploadedPhotos.length : 0 }
                )
            };
        }
        
        const completionCode = Math.floor(1000 + Math.random() * 9000).toString();
        const actorName = state.reportData?.teknisiName || state.reportData?.processedByTeknisiName || 'Teknisi';
        const { ticket: waitingConfirmationTicket } = markWaitingCustomerConfirmation({
            ticketId,
            actor: {
                sender,
                id: sender,
                name: actorName,
                username: actorName,
                channel: 'wa'
            },
            resolutionNotes,
            completionCode
        });
        
        // Send completion code to customer
        if (waitingConfirmationTicket.pelangganId && hasAuthenticatedSession()) {
            const customerMessage = renderResponseTemplate(
                'ticket_process_completion_customer_code',
                `Perbaikan tiket ${ticketId} selesai. Kode konfirmasi: ${completionCode}`,
                {
                    customerName: waitingConfirmationTicket.pelangganName || 'Pelanggan',
                    ticketId,
                    resolutionNotes,
                    completionCode
                }
            );
            
            await sendMessage(waitingConfirmationTicket.pelangganId, { text: customerMessage });
        }
        
        setUserState(sender, {
            ...state,
            step: 'AWAITING_CUSTOMER_CONFIRMATION',
            completionCode,
            reportData: waitingConfirmationTicket
        });
        
        return {
            success: true,
            message: renderResponseTemplate(
                'ticket_process_waiting_customer_confirmation',
                `Kode konfirmasi ${completionCode} telah dikirim ke pelanggan.`,
                { ticketId, completionCode }
            )
        };
        
    } catch (error) {
        console.error('[COMPLETE_TICKET_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate(
                'ticket_process_complete_error',
                'Terjadi kesalahan saat menyelesaikan tiket. Silakan coba lagi.'
            )
        };
    }
}

/**
 * Handle final confirmation from customer
 */
async function handleFinalConfirmation({ ticketId, completionCode, isFromCustomer = false, sender }) {
    try {
        console.warn('[legacyTicketProcessAdapterUsed]', {
            action: 'handleFinalConfirmation',
            ticketId,
            sender
        });
        const { ticket: _report, durationMinutes } = finalizeCustomerConfirmation({
            ticketId,
            completionCode,
            isFromCustomer
        });
        
        const successMessage = renderResponseTemplate(
            'ticket_process_final_success',
            `Tiket ${ticketId} selesai. Durasi: ${durationMinutes} menit.`,
            { ticketId, durationMinutes }
        );
        
        // Clear teknisi state
        const teknisiState = global.accounts.find(acc => 
            acc.phone_number && sender.includes(acc.phone_number.replace(/^0/, '62'))
        );
        if (teknisiState) {
            deleteUserState(sender);
        }
        
        return {
            success: true,
            message: successMessage
        };
        
    } catch (error) {
        console.error('[FINAL_CONFIRMATION_ERROR]', error);
        return {
            success: false,
            message: error.message || renderResponseTemplate(
                'ticket_process_final_error',
                'Terjadi kesalahan saat konfirmasi.'
            )
        };
    }
}

module.exports = {
    handleProsesTicket,
    handleVerifikasiOTP,
    handleCompleteTicket,
    handleFinalConfirmation
};
