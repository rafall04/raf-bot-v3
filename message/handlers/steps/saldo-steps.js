"use strict";

/**
 * Header Doc
 * Purpose: Menangani langkah percakapan topup saldo termasuk notifikasi agent dan admin.
 * Caller: Router state conversation bot.
 * Deps: `../../../lib/saldo-manager`, `../../../lib/whatsapp-delivery-service`, dan `../../../lib/whatsapp-gateway`.
 * MainFuncs: `handleSaldoSteps`.
 * SideEffects: Mengubah state topup, membuat request topup, dan mengirim notifikasi WA ke agent/admin.
 */

const saldoManager = require('../../../lib/saldo-manager');
const { sendMessage } = require('../../../lib/whatsapp-delivery-service');
const { hasAuthenticatedSession, isReady } = require('../../../lib/whatsapp-gateway');

/**
 * Handle topup conversation steps
 */
async function handleSaldoSteps({ userState, sender, chats, pushname, reply, setUserState, deleteUserState }) {
    const userReply = chats.toLowerCase().trim();
    
    switch (userState.step) {
        case 'TOPUP_SELECT_METHOD': {
            let paymentMethod;
            
            if (userReply === '1') {
                paymentMethod = 'transfer';
            } else if (userReply === '2') {
                paymentMethod = 'cash';
            } else if (userReply === 'batal' || userReply === 'cancel') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Proses topup dibatalkan.'
                };
            } else {
                return {
                    success: false,
                    message: '❌ Pilihan tidak valid. Silakan pilih:\n\n1️⃣ untuk Transfer Bank\n2️⃣ untuk Cash\n\nKetik *batal* untuk membatalkan.'
                };
            }
            
            userState.step = 'TOPUP_INPUT_AMOUNT';
            userState.paymentMethod = paymentMethod;
            setUserState(sender, userState);
            
            return {
                success: true,
                message: `💰 *MASUKKAN JUMLAH TOPUP*\n\n` +
                        `Minimal: Rp 10.000\n` +
                        `Maksimal: Rp 1.000.000\n\n` +
                        `Contoh: 50000\n\n` +
                        `Ketik *batal* untuk membatalkan`
            };
        }
        
        case 'TOPUP_INPUT_AMOUNT': {
            if (userReply === 'batal' || userReply === 'cancel') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Proses topup dibatalkan.'
                };
            }
            
            const amount = parseInt(chats.replace(/\D/g, ''));
            
            if (isNaN(amount) || amount < 10000 || amount > 1000000) {
                return {
                    success: false,
                    message: '❌ Jumlah tidak valid.\n\n' +
                            'Minimal: Rp 10.000\n' +
                            'Maksimal: Rp 1.000.000\n\n' +
                            'Silakan masukkan jumlah yang benar.\n' +
                            'Ketik *batal* untuk membatalkan'
                };
            }
            
            userState.amount = amount;
            
            // Check payment method - if cash, show agent selection
            if (userState.paymentMethod === 'cash') {
                // Get available agents
                const agentManager = require('../../../lib/agent-manager');
                const availableAgents = agentManager.getAgentsByService('topup');
                
                if (!availableAgents || availableAgents.length === 0) {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: '❌ Maaf, tidak ada agent yang tersedia saat ini.\n\n' +
                                'Silakan pilih metode Transfer Bank atau hubungi admin.\n\n' +
                                'Admin: wa.me/6289685645956'
                    };
                }
                
                // Move to agent selection step
                userState.step = 'TOPUP_SELECT_AGENT';
                userState.availableAgents = availableAgents.map(a => ({
                    id: a.id,
                    name: a.name,
                    area: a.area,
                    phone: a.phone,
                    address: a.address,
                    operational_hours: a.operational_hours,
                    location: a.location
                }));
                setUserState(sender, userState);
                
                // Format agent selection message
                const agentMessage = agentManager.formatAgentForSelection(availableAgents);
                
                return {
                    success: true,
                    message: agentMessage
                };
            }
            
            // For transfer method, go directly to confirm
            userState.step = 'TOPUP_CONFIRM';
            setUserState(sender, userState);
            
            let confirmMsg = `📋 *KONFIRMASI TOPUP*\n\n`;
            confirmMsg += `Metode: *Transfer Bank*\n`;
            confirmMsg += `Jumlah: *Rp ${amount.toLocaleString('id-ID')}*\n\n`;
            
            confirmMsg += `💳 *Rekening Tujuan:*\n`;
            // Use bank accounts from config if available
            if (global.config && global.config.bankAccounts && global.config.bankAccounts.length > 0) {
                global.config.bankAccounts.forEach(account => {
                    confirmMsg += `🏦 ${account.bank}: ${account.number}\n`;
                });
                confirmMsg += `a.n ${global.config.bankAccounts[0].name || 'PT ISP NUSANTARA'}\n\n`;
            } else {
                // Fallback to default
                confirmMsg += `🏦 BCA: 1234567890\n`;
                confirmMsg += `🏦 Mandiri: 0987654321\n`;
                confirmMsg += `a.n PT ISP NUSANTARA\n\n`;
            }
            
            confirmMsg += `Ketik *ya* untuk konfirmasi\n`;
            confirmMsg += `Ketik *batal* untuk membatalkan`;
            
            return {
                success: true,
                message: confirmMsg
            };
        }
        
        case 'TOPUP_SELECT_AGENT': {
            if (userReply === 'batal' || userReply === 'cancel') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Proses topup dibatalkan.'
                };
            }
            
            // Parse selection (expecting number 1, 2, 3, etc)
            const selectedIndex = parseInt(chats.trim()) - 1;
            
            if (isNaN(selectedIndex) || 
                selectedIndex < 0 || 
                !userState.availableAgents || 
                selectedIndex >= userState.availableAgents.length) {
                return {
                    success: false,
                    message: '❌ Pilihan tidak valid.\n\n' +
                            `Silakan pilih nomor 1-${userState.availableAgents?.length || 0}\n` +
                            'Ketik *batal* untuk membatalkan'
                };
            }
            
            // Get selected agent from available list
            const selectedAgentData = userState.availableAgents[selectedIndex];
            
            // Save selected agent to state
            userState.selectedAgent = selectedAgentData;
            userState.step = 'TOPUP_CONFIRM';
            setUserState(sender, userState);
            
            // Create confirmation message with agent details
            let confirmMsg = `📋 *KONFIRMASI TOPUP VIA AGENT*\n\n`;
            confirmMsg += `💰 Jumlah: *Rp ${userState.amount.toLocaleString('id-ID')}*\n\n`;
            confirmMsg += `📍 *Agent Terpilih:*\n`;
            confirmMsg += `   ${selectedAgentData.name}\n`;
            confirmMsg += `   📱 ${selectedAgentData.phone}\n`;
            confirmMsg += `   🏠 ${selectedAgentData.address}\n`;
            confirmMsg += `   📍 ${selectedAgentData.area}\n`;
            confirmMsg += `   ⏰ ${selectedAgentData.operational_hours}\n\n`;
            
            confirmMsg += `💡 *PETUNJUK:*\n`;
            confirmMsg += `1. Hubungi agent via WhatsApp\n`;
            confirmMsg += `   👉 https://wa.me/${selectedAgentData.phone.replace(/^0/, '62').replace(/[^0-9]/g, '')}\n\n`;
            confirmMsg += `2. Datang ke lokasi agent\n`;
            if (selectedAgentData.location) {
                confirmMsg += `   🗺️ https://maps.google.com/?q=${selectedAgentData.location.lat},${selectedAgentData.location.lng}\n\n`;
            } else {
                confirmMsg += `\n`;
            }
            confirmMsg += `3. Bayar tunai sejumlah *Rp ${userState.amount.toLocaleString('id-ID')}*\n\n`;
            confirmMsg += `4. Agent akan konfirmasi pembayaran\n\n`;
            confirmMsg += `5. Saldo otomatis masuk ke akun Anda ✅\n\n`;
            confirmMsg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            confirmMsg += `Ketik *ya* untuk konfirmasi\n`;
            confirmMsg += `Ketik *batal* untuk membatalkan`;
            
            return {
                success: true,
                message: confirmMsg
            };
        }
        
        case 'TOPUP_CONFIRM': {
            if (userReply === 'batal' || userReply === 'cancel') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Proses topup dibatalkan.'
                };
            }
            
            if (userReply !== 'ya' && userReply !== 'yes' && userReply !== 'y') {
                return {
                    success: false,
                    message: 'Ketik *ya* untuk konfirmasi atau *batal* untuk membatalkan.'
                };
            }
            
            // Create topup request with agent info if applicable
            const agentId = userState.selectedAgent?.id || null;
            const customerName = pushname || 'Customer';
            
            const request = saldoManager.createTopupRequest(
                userState.paymentSender || sender,
                userState.amount,
                userState.paymentMethod,
                agentId,
                customerName
            );
            
            // Prepare success message
            let successMsg = `✅ *REQUEST TOPUP BERHASIL*\n\n`;
            successMsg += `🆔 ID Request: *${request.id}*\n`;
            successMsg += `💰 Jumlah: *Rp ${userState.amount.toLocaleString('id-ID')}*\n`;
            successMsg += `🏦 Metode: *${userState.paymentMethod === 'transfer' ? 'Transfer Bank' : 'Bayar ke Agent'}*\n`;
            
            if (userState.selectedAgent) {
                successMsg += `📍 Agent: ${userState.selectedAgent.name}\n`;
            }
            successMsg += `\n`;
            successMsg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            if (userState.paymentMethod === 'transfer') {
                successMsg += `📸 *LANGKAH SELANJUTNYA:*\n\n`;
                successMsg += `1️⃣ *Transfer ke rekening berikut:*\n`;
                // Use bank accounts from config if available
                if (global.config && global.config.bankAccounts && global.config.bankAccounts.length > 0) {
                    global.config.bankAccounts.forEach(account => {
                        successMsg += `   🏦 ${account.bank}: ${account.number}\n`;
                    });
                    successMsg += `   a.n ${global.config.bankAccounts[0].name || 'PT ISP NUSANTARA'}\n\n`;
                } else {
                    // Fallback to default
                    successMsg += `   🏦 BCA: 1234567890\n`;
                    successMsg += `   🏦 Mandiri: 0987654321\n`;
                    successMsg += `   a.n PT ISP NUSANTARA\n\n`;
                }
                successMsg += `2️⃣ *Kirim bukti transfer (foto/screenshot) ke chat ini*\n\n`;
                successMsg += `⚠️ *PENTING:*\n`;
                successMsg += `• Pastikan nominal transfer sesuai: *Rp ${userState.amount.toLocaleString('id-ID')}*\n`;
                successMsg += `• Bukti transfer harus jelas dan terbaca\n`;
                successMsg += `• Kirim dalam format gambar (JPG/PNG)\n\n`;
            } else if (userState.selectedAgent) {
                // Cash payment via agent
                successMsg += `📱 *HUBUNGI AGENT:*\n`;
                successMsg += `👉 https://wa.me/${userState.selectedAgent.phone.replace(/^0/, '62').replace(/[^0-9]/g, '')}\n\n`;
                
                if (userState.selectedAgent.location) {
                    successMsg += `🗺️ *LOKASI AGENT:*\n`;
                    successMsg += `👉 https://maps.google.com/?q=${userState.selectedAgent.location.lat},${userState.selectedAgent.location.lng}\n\n`;
                }
                
                successMsg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                successMsg += `⏰ *LANGKAH SELANJUTNYA:*\n`;
                successMsg += `1️⃣ Hubungi agent untuk atur waktu pertemuan\n`;
                successMsg += `2️⃣ Datang ke lokasi agent\n`;
                successMsg += `3️⃣ Bayar tunai Rp ${userState.amount.toLocaleString('id-ID')}\n`;
                successMsg += `4️⃣ Agent akan konfirmasi pembayaran\n`;
                successMsg += `5️⃣ Saldo Anda otomatis bertambah ✅\n`;
                successMsg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            } else {
                successMsg += `💵 *LANGKAH SELANJUTNYA:*\n`;
                successMsg += `Agent kami akan menghubungi Anda untuk pengambilan pembayaran.\n`;
                successMsg += `Atau Anda bisa datang langsung ke kantor kami.\n`;
            }
            
            successMsg += `_Agent akan mengkonfirmasi dalam 1x24 jam._\n`;
            successMsg += `_Anda akan menerima notifikasi setelah pembayaran dikonfirmasi._\n`;
            successMsg += `💡 Ketik *cek topup ${request.id}* untuk cek status`;
            
            // Notify agent if cash payment
            if (userState.selectedAgent && request.agentTransactionId && hasAuthenticatedSession()) {
                try {
                    const agentPhone = userState.selectedAgent.phone.replace(/^0/, '62') + '@s.whatsapp.net';
                    
                    let agentNotif = `🔔 *REQUEST TOPUP BARU*\n`;
                    agentNotif += `👤 Customer: ${customerName}\n`;
                    agentNotif += `📱 Nomor: ${sender.replace('@s.whatsapp.net', '')}\n`;
                    agentNotif += `💰 Jumlah: *Rp ${userState.amount.toLocaleString('id-ID')}*\n`;
                    agentNotif += `🆔 Transaction ID:\n`;
                    agentNotif += `${request.agentTransactionId}\n`;
                    agentNotif += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    agentNotif += `📍 Customer akan menghubungi Anda untuk bayar tunai.\n`;
                    agentNotif += `✅ *CARA KONFIRMASI:*\n`;
                    agentNotif += `Setelah menerima uang, ketik:\n`;
                    agentNotif += `*konfirmasi ${request.agentTransactionId} [PIN]*\n`;
                    agentNotif += `Contoh:\n`;
                    agentNotif += `konfirmasi ${request.agentTransactionId} 1234\n`;
                    agentNotif += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    agentNotif += `⚠️ *PENTING:*\n`;
                    agentNotif += `• Pastikan terima uang CASH sejumlah Rp ${userState.amount.toLocaleString('id-ID')}\n`;
                    agentNotif += `• Jangan konfirmasi sebelum terima uang\n`;
                    agentNotif += `• Gunakan PIN yang sudah terdaftar`;
                    
                    // PENTING: Cek connection state dan gunakan error handling sesuai rules
                    if (isReady()) {
                        try {
                            const delivery = await sendMessage(agentPhone, { text: agentNotif });
                            if (!delivery.sent) {
                                throw new Error(delivery.warning || delivery.errorCode || 'SEND_FAILED');
                            }
                            console.log('[TOPUP] Agent notified:', agentPhone);
                        } catch (error) {
                            console.error('[SEND_MESSAGE_ERROR]', {
                                agentPhone,
                                error: error.message
                            });
                            console.error('[TOPUP] Failed to notify agent:', error);
                        }
                    } else {
                        console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to agent', agentPhone);
                    }
                } catch (error) {
                    console.error('[TOPUP] Failed to prepare or notify agent:', error);
                }
            }
            
            // Clear conversation state after notifications
            deleteUserState(sender);
            
            // Notify admins about new topup request
            try {
                const { getAdminRecipients } = require('../topup-handler');
                const adminRecipients = await getAdminRecipients();
                
                if (isReady() && adminRecipients.length > 0) {
                    const adminMessage = `📢 *REQUEST TOPUP BARU*\n\n` +
                        `👤 User: ${pushname || 'Pelanggan'}\n` +
                        `📱 Nomor: ${sender.replace('@s.whatsapp.net', '')}\n` +
                        `💰 Jumlah: *Rp ${userState.amount.toLocaleString('id-ID')}*\n` +
                        `🏦 Metode: *${userState.paymentMethod === 'transfer' ? 'Transfer Bank' : 'Bayar ke Agent'}*\n` +
                        `📄 ID Request: *${request.id}*\n` +
                        `⏰ Waktu: ${new Date().toLocaleString('id-ID')}\n\n` +
                        `${userState.paymentMethod === 'transfer' ? '⏳ Menunggu bukti transfer...' : '💵 Menunggu pembayaran ke agent...'}\n\n` +
                        `🔗 *Cek di Panel Admin:*\n` +
                        `${global.config.site_url_bot || 'http://localhost:3100'}/saldo-management`;
                    
                    // Send to all admins
                    // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
                    for (const adminJid of adminRecipients) {
                        if (isReady()) {
                            try {
                                const delivery = await sendMessage(adminJid, { text: adminMessage });
                                if (!delivery.sent) {
                                    throw new Error(delivery.warning || delivery.errorCode || 'SEND_FAILED');
                                }
                                console.log('[TOPUP] Admin notified:', adminJid);
                            } catch (error) {
                                console.error('[SEND_MESSAGE_ERROR]', {
                                    adminJid,
                                    error: error.message
                                });
                                console.error('[TOPUP] Failed to notify admin:', adminJid, error);
                                // Continue to next admin
                            }
                        } else {
                            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to admin', adminJid);
                        }
                    }
                }
            } catch (error) {
                console.error('[TOPUP] Failed to send admin notifications:', error);
                // Don't let notification failure break the flow
            }
            
            return {
                success: true,
                message: successMsg
            };
        }
        
        default:
            return {
                success: false,
                message: '❌ Terjadi kesalahan. Silakan coba lagi dengan mengetik *topup*.'
            };
    }
}

module.exports = {
    handleSaldoSteps
};
