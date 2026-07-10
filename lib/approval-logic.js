/**
 * Header Doc
 * Purpose: Menjalankan approval pembayaran dan sinkronisasi notifikasi pelanggan/teknisi setelah status paid berubah.
 * Caller: Route/admin payment flow dan service approval terkait.
 * Deps: Helper MikroTik, templating, util nomor telepon, delivery service WhatsApp, gateway runtime WA, dan helper timing WA.
 * MainFuncs: `sendTechnicianNotification`, `sendPaymentConfirmationToTeknisi`, `handlePaidStatusChange`.
 * SideEffects: Mengubah profil pelanggan, membuat invoice PDF, dan mengirim notifikasi WhatsApp.
 */
const fs = require('fs');
const { getProfileBySubscription } = require('./myfunc');
const { updatePPPoEProfile, deleteActivePPPoEUser, assertMikrotikResult } = require('./mikrotik');
const { rebootRouter } = require("./wifi");
const { renderTemplate } = require('./templating');
const { normalizePhoneNumber } = require('./utils');
const { sendMessage } = require('./whatsapp-delivery-service');
const { isReady, getSocketDiagnostics } = require('./whatsapp-gateway');
const { renderResponseTemplate } = require('./response-template-helper');
const { waitForWhatsAppDelay } = require('./wa-timing');

async function deliverWhatsAppMessage(recipient, payload) {
    const delivery = await sendMessage(recipient, payload);
    if (!delivery.sent) {
        throw new Error(delivery.warning || delivery.errorCode || 'WHATSAPP_DELIVERY_FAILED');
    }
    return delivery;
}

function sendTechnicianNotification(isApproved, requestToUpdate, userToUpdate) {
    if (isReady() && requestToUpdate.requested_by_teknisi_id) {
        const teknisiAccount = global.accounts.find(acc => String(acc.id) === String(requestToUpdate.requested_by_teknisi_id));
        if (teknisiAccount && teknisiAccount.phone_number) {
            const statusText = isApproved ? "DISETUJUI" : "DITOLAK";
            const userName = userToUpdate ? userToUpdate.name : `ID ${requestToUpdate.userId}`;
            const notifMessage = renderResponseTemplate(
                'approval_teknisi_status_notification',
                `🔔 *Info Pengajuan Pembayaran* 🔔\n\nPengajuan Anda untuk pelanggan *${userName}* telah di-*${statusText}* oleh admin.`,
                { user_name: userName, status_text: statusText }
            );

            let targetPhoneNumber = teknisiAccount.phone_number.trim();
            if (targetPhoneNumber.startsWith("0")) targetPhoneNumber = "62" + targetPhoneNumber.substring(1);
            if (!targetPhoneNumber.endsWith("@s.whatsapp.net")) targetPhoneNumber += "@s.whatsapp.net";

            if (targetPhoneNumber.length > 8) {
                deliverWhatsAppMessage(targetPhoneNumber, { text: notifMessage }).catch(e => console.error(`[APPROVE_PAID_NOTIF_ERROR] Failed to send notification to technician ${targetPhoneNumber}:`, e.message));
            }
        }
    }
}

/**
 * Send payment confirmation notification to technician
 * Called when payment status changes to paid (lunas)
 */
async function sendPaymentConfirmationToTeknisi(user, paymentDetails = {}) {
    if (!isReady()) {
        console.log('[TEKNISI_NOTIF] WhatsApp not connected, skipping notification');
        return;
    }
    
    const { requestedByTeknisiId, method, approvedBy, amountPaid, isPartial, amountRemaining } = paymentDetails;
    
    if (!requestedByTeknisiId) {
        console.log('[TEKNISI_NOTIF] No teknisi ID provided, skipping notification');
        return;
    }
    
    const teknisiAccount = global.accounts.find(acc => String(acc.id) === String(requestedByTeknisiId));
    if (!teknisiAccount || !teknisiAccount.phone_number) {
        console.log('[TEKNISI_NOTIF] Teknisi account or phone not found');
        return;
    }
    
    // Get package info
    const packageInfo = global.packages?.find(p => p.name === user.subscription);
    const packagePrice = packageInfo?.price || 0;
    const formattedPrice = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(packagePrice);
    
    // Convert payment method to Indonesian
    let metodePembayaran = 'Tunai';
    if (method === 'TRANSFER_BANK') {
        metodePembayaran = 'Transfer Bank';
    }
    
    // Build partial_section placeholder
    let partialSection = '';
    if (isPartial && amountPaid) {
        const formattedPaid = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amountPaid);
        const formattedRemaining = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amountRemaining || 0);
        partialSection = `✅ *Dibayar:* ${formattedPaid}\n`;
        if (amountRemaining > 0) {
            partialSection += `⏳ *Sisa:* ${formattedRemaining}\n`;
        }
    }

    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
    const approvedByName = approvedBy || 'Admin';

    // Build fallback hardcoded literal (untuk saat responseTemplates belum di-customize admin)
    let fallback = `✅ *PEMBAYARAN BERHASIL DIPROSES* ✅\n\n`;
    fallback += `Pengajuan pembayaran Anda telah disetujui!\n\n`;
    fallback += `� *Pelanggan:* ${user.name}\n`;
    fallback += `📦 *Paket:* ${user.subscription || '-'}\n`;
    fallback += `💰 *Tagihan:* ${formattedPrice}\n`;
    fallback += partialSection;
    fallback += `�💳 *Metode:* ${metodePembayaran}\n`;
    fallback += `👨‍💼 *Disetujui oleh:* ${approvedByName}\n`;
    fallback += `⏰ *Waktu:* ${timestamp}\n\n`;
    fallback += `Terima kasih atas kerja kerasnya! 🙏`;

    const message = renderResponseTemplate(
        'approval_teknisi_payment_confirmation',
        fallback,
        {
            user_name: user.name,
            subscription: user.subscription || '-',
            formatted_price: formattedPrice,
            partial_section: partialSection,
            metode_pembayaran: metodePembayaran,
            approved_by: approvedByName,
            timestamp
        }
    );
    
    try {
        let targetPhoneNumber = teknisiAccount.phone_number.trim();
        if (targetPhoneNumber.startsWith("0")) {
            targetPhoneNumber = "62" + targetPhoneNumber.substring(1);
        }
        if (!targetPhoneNumber.endsWith("@s.whatsapp.net")) {
            targetPhoneNumber += "@s.whatsapp.net";
        }
        
        if (targetPhoneNumber.length > 15) {
            await deliverWhatsAppMessage(targetPhoneNumber, { text: message });
            console.log(`[TEKNISI_NOTIF] Payment confirmation sent to teknisi ${teknisiAccount.name || teknisiAccount.username}`);
        }
    } catch (error) {
        console.error(`[TEKNISI_NOTIF_ERROR] Failed to send notification:`, error.message);
    }
}

async function handlePaidStatusChange(user, paymentDetails = {}) {
    if (!user) {
        console.error("[PAID_STATUS_CHANGE_ERROR] User object provided is null or undefined.");
        return;
    }

    console.log(`[PAID_STATUS_CHANGE] Starting paid status change process for user: ${user.name} (ID: ${user.id})`);

    // Load config to check isolation date
    // Use global.config which is already loaded and available application-wide
    const config = global.config; 
    if (!config) {
        console.error("[PAID_STATUS_CHANGE_ERROR] global.config is not available.");
        // Fallback or throw an error if config is critical
        return;
    }

    const tanggalIsolir = parseInt(config.tanggal_isolir, 10);
    const currentDate = new Date().getDate();

    // Dilacak agar struk hanya mengatakan "layanan aktif kembali" bila profil BENAR-BENAR dipulihkan
    // (bukan sekadar karena tanggalnya sudah lewat tanggal isolir).
    let profileReactivated = false;

    // --- 1. Revert Profile from Isolation (Conditional) ---
    // Check if sync to MikroTik is enabled
    const syncToMikrotik = config.sync_to_mikrotik !== false; // Default to true if not set

    if (currentDate >= tanggalIsolir) {
        console.log(`[PAID_STATUS_CHANGE] Current date (${currentDate}) is on or after isolation date (${tanggalIsolir}). Proceeding with profile restoration for ${user.name}.`);
        
        if (syncToMikrotik) {
            try {
                const targetProfile = getProfileBySubscription(user.subscription);
                if (!targetProfile) {
                    throw new Error(`Could not find a valid PPPoE profile for subscription package: "${user.subscription}"`);
                }

                if (user.pppoe_username) {
                    console.log(`[PAID_STATUS_CHANGE] Reverting profile for ${user.pppoe_username} to "${targetProfile}"`);
                    assertMikrotikResult(
                        await updatePPPoEProfile(user.pppoe_username, targetProfile, { caller: 'approval-logic' })
                    );
                    console.log(`[PAID_STATUS_CHANGE] Successfully updated profile for ${user.pppoe_username}.`);
                    profileReactivated = true;

                    const disconnectResult = await deleteActivePPPoEUser(user.pppoe_username, { caller: 'approval-logic' });
                    if (!disconnectResult.ok) {
                        console.warn(`[PAID_STATUS_CHANGE_WARN] Could not disconnect session for ${user.pppoe_username}: ${disconnectResult.message}`);
                    } else {
                        console.log(`[PAID_STATUS_CHANGE] Successfully disconnected active session for ${user.pppoe_username}.`);
                    }

                    if (user.device_id) {
                        console.log(`[PAID_STATUS_CHANGE] Attempting to reboot router for ${user.name}.`);
                        const rebootResult = await rebootRouter(user.device_id, {
                            context: { caller: 'approval-logic', deviceId: user.device_id },
                        });
                        if (!rebootResult.success) {
                            throw new Error(rebootResult.message);
                        }
                        console.log(`[PAID_STATUS_CHANGE] Reboot command sent for ${user.name}.`);
                    }
                } else {
                     console.warn(`[PAID_STATUS_CHANGE_WARN] User ${user.name} has no PPPoE username. Skipping profile revert.`);
                }

            } catch (error) {
                console.error(`[PAID_STATUS_CHANGE_ERROR] Failed to revert profile for user ${user.name}:`, error.message);
            }
        } else {
            console.log(`[PAID_STATUS_CHANGE] Sync to MikroTik is DISABLED - skipping profile restoration for ${user.name}.`);
        }
    } else {
        console.log(`[PAID_STATUS_CHANGE] Current date (${currentDate}) is before isolation date (${tanggalIsolir}). Skipping profile restoration for ${user.name}.`);
    }

    // --- 2. Send notification to technician who requested the payment ---
    if (paymentDetails.requestedByTeknisiId) {
        try {
            await sendPaymentConfirmationToTeknisi(user, paymentDetails);
        } catch (teknisiNotifError) {
            console.error(`[PAID_STATUS_CHANGE_TEKNISI_NOTIF_ERROR] Failed to notify technician:`, teknisiNotifError.message);
        }
    }

    // --- 3. Send "Sudah Bayar" Notification and Invoice PDF ---
    try {
        const isNotifEnabled = global.cronConfig?.status_message_paid_notification === true;
        console.log(`[PAID_STATUS_CHANGE_NOTIF] Checking notification status for ${user.name}. Notif enabled: ${isNotifEnabled}, send_invoice: ${user.send_invoice}`);

        if (isReady() && isNotifEnabled) {
            if (user.phone_number) {
                const packageInfo = global.packages.find(p => p.name === user.subscription);

                // Convert payment method to Indonesian
                let metodePembayaran = 'Tunai'; // Default
                if (paymentDetails.method === 'TRANSFER_BANK') {
                    metodePembayaran = 'Transfer Bank';
                } else if (paymentDetails.method === 'CASH') {
                    metodePembayaran = 'Tunai';
                }

                // Struk kanonik yang SAMA dengan jalur bayar-online & konfirmasi bukti foto
                // (lib/services/paid-receipt). Dulu jalur ini punya template sendiri
                // (`sudah_bayar_notification`) sehingga pelanggan menerima dua bentuk struk berbeda
                // tergantung tombol mana yang ditekan admin.
                const { buildPaidReceiptText } = require('./services/paid-receipt');
                const messageText = buildPaidReceiptText({
                    user,
                    amount: paymentDetails.amountPaid || (packageInfo ? packageInfo.price : 0),
                    periodMonth: paymentDetails.periodMonth,
                    periodYear: paymentDetails.periodYear,
                    method: metodePembayaran,
                    paidAt: paymentDetails.paidDate,
                    refId: paymentDetails.paymentHistoryId,
                    reactivation: profileReactivated
                });

                // Check if we need to send invoice PDF
                if (user.send_invoice === true || user.send_invoice === 1) {
                    console.log(`[PAID_STATUS_CHANGE] User ${user.name} has send_invoice enabled. Generating invoice PDF...`);
                    
                    try {
                        const { createInvoice, generateInvoiceText: _generateInvoiceText } = require('./invoice-generator');
                        const { createInvoicePDF } = require('./pdf-invoice-generator');
                        
                        // Create invoice data
                        const invoiceData = createInvoice(user, {
                            paidDate: paymentDetails.paidDate || new Date().toISOString(),
                            method: paymentDetails.method || 'CASH',
                            approvedBy: paymentDetails.approvedBy || 'Admin',
                            notes: paymentDetails.notes || 'Pembayaran telah disetujui dan diverifikasi.'
                        });
                        
                        if (invoiceData) {
                            // Retry mechanism for PDF generation
                            let pdfResult = null;
                            let retryCount = 0;
                            const maxRetries = 3;
                            
                            while (retryCount < maxRetries && !pdfResult) {
                                try {
                                    if (retryCount > 0) {
                                        console.log(`[PDF_RETRY] Attempt ${retryCount + 1} of ${maxRetries} for ${user.name}`);
                                        await waitForWhatsAppDelay(2000);
                                    }
                                    
                                    // Get customization settings from config
                                    const customization = {
                                        theme: config.pdfCustomization?.theme || 'blue',
                                        headerText: config.pdfCustomization?.headerText || 'INVOICE',
                                        footerText: config.pdfCustomization?.footerText || 'Terima kasih atas kepercayaan Anda.',
                                        billingTitle: config.pdfCustomization?.billingTitle || 'TAGIHAN KEPADA:',
                                        serviceTitle: config.pdfCustomization?.serviceTitle || 'DETAIL LAYANAN:',
                                        showCustomerID: config.pdfCustomization?.showCustomerID !== false,
                                        showCustomerPhone: config.pdfCustomization?.showCustomerPhone !== false,
                                        showServiceSpeed: config.pdfCustomization?.showServiceSpeed !== false,
                                        showServiceDescription: config.pdfCustomization?.showServiceDescription !== false,
                                        showNPWP: config.pdfCustomization?.showNPWP !== false,
                                        paymentMethods: config.pdfCustomization?.paymentMethods || 'cash_transfer',
                                        showNotes: config.pdfCustomization?.showNotes !== false,
                                        additionalNotes: config.pdfCustomization?.additionalNotes || ''
                                    };
                                    
                                    // Generate PDF with customization
                                    pdfResult = await createInvoicePDF(invoiceData, customization);
                                    console.log(`[PAID_STATUS_CHANGE] Invoice PDF generated for ${user.name}: ${invoiceData.invoiceNumber}`);
                                } catch (pdfError) {
                                    retryCount++;
                                    console.error(`[PDF_GENERATION_ERROR] Attempt ${retryCount} failed:`, pdfError.message);
                                    
                                    if (retryCount >= maxRetries) {
                                        throw pdfError; // Throw error after max retries
                                    }
                                }
                            }
                            
                            // Send to all phone numbers
                            const phoneNumbers = user.phone_number.split('|');
                            for (const number of phoneNumbers) {
                                if (!number || number.trim() === "") continue;
                                const normalizedNumber = normalizePhoneNumber(number);
                                
                                if (normalizedNumber && normalizedNumber.length > 8) {
                                    console.log(`[PAID_STATUS_CHANGE] Sending invoice PDF to ${user.name} at ${normalizedNumber}`);
                                    await waitForWhatsAppDelay(1000);
                                    
                                    // Send PDF with caption - add WhatsApp suffix
                                    const whatsappId = normalizedNumber + '@s.whatsapp.net';
                                    await deliverWhatsAppMessage(whatsappId, {
                                        document: pdfResult.buffer,
                                        fileName: `Invoice_${invoiceData.invoiceNumber}.pdf`,
                                        mimetype: 'application/pdf',
                                        caption: messageText
                                    });
                                    
                                    console.log(`[PDF_INVOICE_SENT] PDF Invoice ${invoiceData.invoiceNumber} sent to ${normalizedNumber}`);
                                }
                            }
                            
                            // Clean up PDF file after sending
                            if (fs.existsSync(pdfResult.path)) {
                                fs.unlinkSync(pdfResult.path);
                            }
                        }
                    } catch (invoiceError) {
                        console.error(`[PAID_STATUS_CHANGE_INVOICE_ERROR] Failed to generate/send invoice for ${user.name}:`, invoiceError.message);
                        
                        // Log error to file for tracking
                        const errorLog = {
                            timestamp: new Date().toISOString(),
                            userId: user.id,
                            userName: user.name,
                            error: invoiceError.message,
                            type: 'PDF_GENERATION_FAILED'
                        };
                        
                        try {
                            const fs = require('fs');
                            const path = require('path');
                            const errorLogPath = path.join(__dirname, '..', 'database', 'invoice_errors.json');
                            let errors = [];
                            
                            if (fs.existsSync(errorLogPath)) {
                                errors = JSON.parse(fs.readFileSync(errorLogPath, 'utf8'));
                            }
                            errors.push(errorLog);
                            fs.writeFileSync(errorLogPath, JSON.stringify(errors, null, 2));
                        } catch (logError) {
                            console.error('[ERROR_LOG_FAILED]', logError.message);
                        }
                        
                        // Send notification with error info and fallback invoice details
                        const fallbackMessage = renderTemplate('invoice_fallback', {
                            nama_pelanggan: user.name,
                            nama_paket: user.subscription || 'N/A',
                            tanggal: new Date().toLocaleDateString('id-ID')
                        });
                        const combinedMessage = `${messageText}\n\n${fallbackMessage}`;
                        
                        const phoneNumbers = user.phone_number.split('|');
                        for (const number of phoneNumbers) {
                            if (!number || number.trim() === "") continue;
                            const normalizedNumber = normalizePhoneNumber(number);
                            
                            if (normalizedNumber && normalizedNumber.length > 8) {
                                console.log(`[PAID_STATUS_CHANGE_NOTIF] Sending fallback notification to ${user.name} at ${normalizedNumber}`);
                                await waitForWhatsAppDelay(1000);
                                const whatsappId = normalizedNumber + '@s.whatsapp.net';
                                await deliverWhatsAppMessage(whatsappId, { text: combinedMessage });
                            }
                        }
                    }
                } else {
                    // Send regular text notification only
                    console.log(`[PAID_STATUS_CHANGE] User ${user.name} has send_invoice disabled. Sending text notification only.`);
                    const phoneNumbers = user.phone_number.split('|');
                    for (const number of phoneNumbers) {
                        if (!number || number.trim() === "") continue;
                        const normalizedNumber = normalizePhoneNumber(number);
                        
                        if (normalizedNumber && normalizedNumber.length > 8) {
                            console.log(`[PAID_STATUS_CHANGE_NOTIF] Sending text notification to ${user.name} at ${normalizedNumber}`);
                            await waitForWhatsAppDelay(1000);
                            const whatsappId = normalizedNumber + '@s.whatsapp.net';
                            await deliverWhatsAppMessage(whatsappId, { text: messageText });
                        }
                    }
                }
            } else {
                console.warn(`[PAID_STATUS_CHANGE_NOTIF_WARN] User ${user.name} has no phone number.`);
            }
        } else {
            const diagnostics = getSocketDiagnostics();
            console.warn(`[PAID_STATUS_CHANGE_NOTIF_WARN] Skipping notification for ${user.name}. Conditions: WhatsApp connected=${diagnostics.hasSocket}, State=${diagnostics.connectionState}, Notif Enabled=${isNotifEnabled}`);
        }
    } catch (error) {
        console.error(`[PAID_STATUS_CHANGE_NOTIF_ERROR] Failed to send notification for user ${user.name}:`, error.message);
    }
}

module.exports = {
    handlePaidStatusChange,
    sendTechnicianNotification,
    sendPaymentConfirmationToTeknisi
};
