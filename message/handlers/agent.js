"use strict";

/**
 * ==============================================
 * UNIFIED AGENT HANDLER
 * ==============================================
 * 
 * Consolidates all agent-related functionality from:
 * - agent-handler.js (Customer commands)
 * - agent-transaction-handler.js (Transaction management)
 * - agent-self-service-handler.js (Agent self-service)
 * 
 * ORGANIZATION:
 * 1. CUSTOMER COMMANDS - Commands available to all users
 * 2. AGENT TRANSACTIONS - Transaction confirmations & tracking
 * 3. AGENT SELF-SERVICE - Profile & settings management for agents
 * 
 * Created: 2025-10-20
 * Purpose: Better organization, fix naming conflicts, easier maintenance
 * ==============================================
 */

const agentManager = require('../../lib/agent-manager');
const agentTransactionManager = require('../../lib/agent-transaction-manager');
const saldoManager = require('../../lib/saldo-manager');
const { logger } = require('../../lib/logger');
const { extractSenderInfo } = require('../../lib/jid-utils');
const { sendMessage, sendMessageToMany } = require('../../lib/whatsapp-delivery-service');
const { format } = require('./conversation-handler');

function renderResponseTemplate(key, fallback, data = {}) {
    const rendered = format(key, data);
    return rendered && rendered.trim() ? rendered : fallback;
}

/**
 * Helper function to extract real phone number from @lid format
 * Uses Baileys v7 features (remoteJidAlt, signalRepository) to get actual phone number
 */
async function extractPhoneFromLid(sender, msg, raf = null) {
    if (!sender || !sender.endsWith('@lid')) {
        return sender; // Not @lid format, return as-is
    }
    
    // Method 1: Extract from message metadata (Baileys v7)
    if (msg) {
        const senderInfo = extractSenderInfo(msg, false);
        if (senderInfo.phoneNumber) {
            // Only log if extraction method is interesting (not remoteJidAlt which is common)
            if (senderInfo.method !== 'remoteJidAlt') {
                logger.debug(`[LID_EXTRACT] ${sender} → ${senderInfo.phoneNumber} (${senderInfo.method})`);
            }
            return `${senderInfo.phoneNumber}@s.whatsapp.net`;
        }
    }
    
    // Method 2: Try Baileys v7 signal repository
    if (raf && raf.signalRepository) {
        try {
            if (raf.signalRepository.lidMapping && raf.signalRepository.lidMapping.getPNForLID) {
                const phoneNumber = await raf.signalRepository.lidMapping.getPNForLID(sender);
                if (phoneNumber) {
                    logger.debug(`[LID_EXTRACT] ${sender} → ${phoneNumber} (signal_repository)`);
                    return phoneNumber;
                }
            }
        } catch (_error) {
            // Only log actual errors, not warnings
            logger.debug(`[LID_EXTRACT] Signal repository unavailable for ${sender}`);
        }
    }
    
    // No phone number found, return original @lid
    return sender;
}

// ==============================================
// SECTION 1: CUSTOMER COMMANDS
// Available to all users to find/view agents
// ==============================================

/**
 * Handle list agents command
 * Shows all available agents/outlets
 * Command: agent, agen, outlet, list agent
 */
async function handleListAgents(msg, sender, reply, _pushname) {
    try {
        const agents = agentManager.getAllAgents(true);
        
        if (agents.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_general_empty',
                '❌ Maaf, belum ada agent yang terdaftar.'
            ));
        }
        
        const message = agentManager.formatAgentList(agents, 'DAFTAR AGENT RAF NET');
        // Skip duplicate check for command response - user may intentionally request same info
        await reply(message, { skipDuplicateCheck: true });
        
    } catch (error) {
        logger.error('Error in handleListAgents:', error);
        await reply(renderResponseTemplate(
            'agent_general_fetch_error',
            '❌ Terjadi kesalahan saat mengambil data agent.'
        ));
    }
}

/**
 * Handle agent by area
 * Shows agents in specific area
 * Command: agent [area]
 */
async function handleAgentByArea(msg, sender, reply, area) {
    try {
        if (!area || area.trim() === '') {
            // Show all areas
            const agents = agentManager.getAllAgents(true);
            const areas = [...new Set(agents.map(a => a.area))].filter(Boolean);
            
            let areaList = '';
            areas.forEach(a => {
                const count = agents.filter(ag => ag.area === a).length;
                areaList += `• ${a} (${count} agent)\n`;
            });
            const message = renderResponseTemplate(
                'agent_general_area_empty',
                `📍 *PILIH AREA AGENT*\n\nKetik: *agent [nama area]*\n\nArea yang tersedia:\n${areaList}\n\nContoh: *agent tanjung*`,
                { areaList }
            );
            
            return await reply(message);
        }
        
        const agents = agentManager.getAgentsByArea(area);
        
        if (agents.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_general_area_not_found',
                `❌ Tidak ada agent di area "${area}".\n\nKetik *agent* untuk melihat semua area.`,
                { area }
            ));
        }
        
        const message = agentManager.formatAgentList(agents, `AGENT DI AREA ${area.toUpperCase()}`);
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleAgentByArea:', error);
        await reply(renderResponseTemplate(
            'agent_general_fetch_error',
            '❌ Terjadi kesalahan saat mengambil data agent.'
        ));
    }
}

/**
 * Handle agent services
 * Shows what services are available at agents
 * Command: layanan agent, agent service
 */
async function handleAgentServices(msg, sender, reply) {
    try {
        let message = `🛍️ *LAYANAN AGENT RAF NET*\n\n`;
        
        // Get agents by service
        const topupAgents = agentManager.getAgentsByService('topup');
        const voucherAgents = agentManager.getAgentsByService('voucher');
        const paymentAgents = agentManager.getAgentsByService('pembayaran');
        
        message += `💰 *Topup Saldo* (${topupAgents.length} agent)\n`;
        message += `   Anda bisa topup saldo langsung di agent\n\n`;
        
        message += `🎫 *Beli Voucher* (${voucherAgents.length} agent)\n`;
        message += `   Tersedia voucher WiFi berbagai paket\n\n`;
        
        message += `💳 *Pembayaran* (${paymentAgents.length} agent)\n`;
        message += `   Bayar tagihan internet bulanan\n\n`;
        
        message += `📱 Ketik *agent* untuk melihat daftar lengkap\n`;
        message += `📍 Ketik *agent [area]* untuk agent di area tertentu`;
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleAgentServices:', error);
        await reply(renderResponseTemplate(
            'agent_general_services_error',
            '❌ Terjadi kesalahan saat mengambil data layanan.'
        ));
    }
}

/**
 * Handle search agent
 * Search agents by name, area, or address
 * Command: cari agent [query], search agent [query]
 */
async function handleSearchAgent(msg, sender, reply, query) {
    try {
        if (!query || query.trim() === '') {
            return await reply(renderResponseTemplate(
                'agent_general_search_empty',
                '❌ Masukkan kata kunci pencarian.\n\nContoh: *cari agent tanjung*'
            ));
        }
        
        const agents = agentManager.searchAgents(query);
        
        if (agents.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_general_search_not_found',
                `❌ Tidak ada agent yang cocok dengan "${query}".\n\nCoba kata kunci lain atau ketik *agent* untuk melihat semua.`,
                { query }
            ));
        }
        
        const message = agentManager.formatAgentList(agents, `HASIL PENCARIAN: ${query.toUpperCase()}`);
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleSearchAgent:', error);
        await reply(renderResponseTemplate(
            'agent_general_search_error',
            '❌ Terjadi kesalahan saat mencari agent.'
        ));
    }
}

/**
 * Handle view agent detail
 * Shows detailed info about specific agent (for customers)
 * Command: agent detail [id]
 * RENAMED FROM: handleAgentInfo (was conflicting with self-service)
 */
async function handleViewAgentDetail(msg, sender, reply, agentId) {
    try {
        const agent = agentManager.getAgentById(agentId);
        
        if (!agent) {
            return await reply(renderResponseTemplate(
                'agent_general_detail_not_found',
                '❌ Agent tidak ditemukan.\n\nKetik *agent* untuk melihat daftar agent beserta ID-nya.'
            ));
        }
        
        let message = `📋 *INFORMASI AGENT*\n\n`;
        message += `🆔 ID: ${agent.id}\n`;
        message += agentManager.formatAgentInfo(agent, true, false);
        
        // Add Google Maps link if location available
        if (agent.location) {
            message += `\n\n📍 *Lokasi di Google Maps:*\n`;
            message += `https://maps.google.com/?q=${agent.location.lat},${agent.location.lng}`;
        }
        
        message += `\n\n💬 Hubungi via WhatsApp:\n`;
        message += `wa.me/${agent.phone.replace(/[^0-9]/g, '')}`;
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleViewAgentDetail:', error);
        await reply(renderResponseTemplate(
            'agent_general_detail_error',
            '❌ Terjadi kesalahan saat mengambil info agent.'
        ));
    }
}

// ==============================================
// SECTION 2: AGENT TRANSACTIONS
// Transaction confirmations & tracking for agents
// ==============================================

/**
 * Handle agent confirmation command
 * Format: konfirmasi [transaction_id] [pin]
 * Example: konfirmasi AGT_TRX_123456 1234
 * Command: konfirmasi, confirm, konfirmasi topup
 */
async function handleAgentConfirmation(msg, sender, reply, args) {
    try {
        // Validate format
        if (args.length < 2) {
            return await reply(renderResponseTemplate(
                'agent_transaction_confirm_format',
                '❌ *Format salah!*\n\n' +
                '*Format:* konfirmasi [transaction_id] [pin]\n' +
                '*Contoh:* konfirmasi AGT_TRX_123456 1234\n\n' +
                '💡 Transaction ID ada di notifikasi yang Anda terima'
            ));
        }
        
        const transactionId = args[0];
        const pin = args[1];
        
        // Get transaction
        const transaction = agentTransactionManager.getTransactionById(transactionId);
        
        if (!transaction) {
            return await reply(renderResponseTemplate(
                'agent_transaction_not_found',
                '❌ *Transaction tidak ditemukan.*\n\n' +
                'Pastikan ID transaction benar.\n' +
                'Ketik *transaksi hari ini* untuk melihat list transaction.'
            ));
        }
        
        if (transaction.status !== 'pending') {
            let statusText = transaction.status;
            if (transaction.status === 'confirmed') statusText = 'sudah dikonfirmasi';
            if (transaction.status === 'completed') statusText = 'sudah selesai';
            if (transaction.status === 'cancelled') statusText = 'dibatalkan';
            
            const confirmedAtText = transaction.confirmedAt
                ? `\nDikonfirmasi pada: ${new Date(transaction.confirmedAt).toLocaleString('id-ID')}`
                : '';

            return await reply(renderResponseTemplate(
                'agent_transaction_status_not_pending',
                `❌ *Transaction ${statusText}.*\n\n` +
                'Hanya transaction dengan status "pending" yang bisa dikonfirmasi.\n\n' +
                `Status saat ini: *${transaction.status}*${confirmedAtText}`,
                {
                    statusText,
                    status: transaction.status,
                    confirmedAtText
                }
            ));
        }
        
        // Confirm transaction (this will verify PIN internally)
        const result = await agentTransactionManager.confirmTransaction(
            transactionId,
            sender,
            pin
        );
        
        if (!result.success) {
            // Check if it's a PIN error
            if (result.message.includes('PIN')) {
                return await reply(renderResponseTemplate(
                    'agent_transaction_pin_invalid',
                    `❌ *PIN salah.*\n\n` +
                    'Silakan coba lagi dengan PIN yang benar.\n\n' +
                    '💡 Lupa PIN? Hubungi admin untuk reset PIN.'
                ));
            }
            
            return await reply(renderResponseTemplate(
                'agent_transaction_confirm_error',
                `❌ ${result.message}`,
                { resultMessage: result.message }
            ));
        }
        
        logger.info(`[AGENT_CONFIRM] Transaction ${transactionId} confirmed`);

        // Pembelian voucher reseller (cash/transfer): stok agent SUDAH diaktifkan di dalam
        // confirmTransaction(). Tidak ada penambahan saldo topup di sini, jadi JANGAN panggil
        // processAgentConfirmation (akan gagal "Topup request not found" → pesan "Gagal
        // memproses saldo" yang menyesatkan) dan jangan kirim notifikasi "TOPUP BERHASIL".
        if (transaction.transactionType === 'voucher_purchase') {
            let voucherMsg = `✅ *KONFIRMASI BERHASIL*\n\n`;
            voucherMsg += `🆔 Transaction: ${transactionId}\n`;
            voucherMsg += `💰 Jumlah: Rp ${Number(transaction.amount || 0).toLocaleString('id-ID')}\n`;
            voucherMsg += `✅ Status: Confirmed\n\n`;
            voucherMsg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            voucherMsg += `Stok voucher Anda sudah diaktifkan.\n`;
            voucherMsg += `Ketik *stok voucher* untuk melihat inventory lengkap.\n\n`;
            voucherMsg += `Terima kasih! 🙏`;
            await reply(voucherMsg);
            return;
        }

        // Process saldo addition (khusus transaksi topup)
        const saldoResult = saldoManager.processAgentConfirmation(transactionId);
        
        if (!saldoResult.success) {
            logger.error('Failed to process saldo after agent confirmation', {
                transactionId: transactionId,
                error: saldoResult.message
            });
            
            return await reply(renderResponseTemplate(
                'agent_transaction_saldo_failed',
                '❌ *Gagal memproses saldo.*\n\n' +
                'Transaction sudah dikonfirmasi tapi saldo belum bertambah.\n' +
                'Hubungi admin segera.'
            ));
        }
        
        // Success notification to agent
        let agentMsg = `✅ *KONFIRMASI BERHASIL*\n\n`;
        agentMsg += `🆔 Transaction: ${transactionId}\n`;
        agentMsg += `👤 Customer: ${transaction.customerName}\n`;
        agentMsg += `📱 Nomor: ${transaction.customerId.replace('@s.whatsapp.net', '')}\n`;
        agentMsg += `💰 Jumlah: Rp ${transaction.amount.toLocaleString('id-ID')}\n`;
        agentMsg += `✅ Status: Confirmed\n\n`;
        agentMsg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        agentMsg += `Saldo customer telah ditambahkan.\n\n`;
        agentMsg += `Terima kasih! 🙏`;
        
        await reply(agentMsg);
        
        // Notify customer
        // PENTING: Cek connection state dan gunakan error handling sesuai rules
        try {
            const customerMsg = `✅ *TOPUP BERHASIL*\n\n` +
                `💰 Jumlah: Rp ${transaction.amount.toLocaleString('id-ID')}\n` +
                `📍 Agent: ${transaction.agentName}\n` +
                `💳 Saldo baru: Rp ${saldoResult.newSaldo.toLocaleString('id-ID')}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `Terima kasih telah menggunakan layanan kami! 🙏\n\n` +
                `💡 Ketik *ceksaldo* untuk melihat saldo Anda`;

            const delivery = await sendMessage(transaction.customerId, { text: customerMsg });
            if (delivery.sent) {
                logger.info('Customer notified of successful topup', {
                    customerId: transaction.customerId
                });
            }
        } catch (error) {
            logger.error('Failed to notify customer:', error);
        }
        
        // Notify admin
        // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
        if (global.config?.adminNumbers) {
            try {
                const adminMsg = `✅ *TOPUP DIKONFIRMASI*\n\n` +
                    `📄 ID: ${saldoResult.topupRequest.id}\n` +
                    `🆔 Transaction: ${transactionId}\n` +
                    `👤 Customer: ${transaction.customerName} (${transaction.customerId.replace('@s.whatsapp.net', '')})\n` +
                    `💰 Jumlah: Rp ${transaction.amount.toLocaleString('id-ID')}\n` +
                    `📍 Agent: ${transaction.agentName}\n` +
                    `✅ Status: Verified\n` +
                    `⏰ Waktu konfirmasi: ${new Date().toLocaleString('id-ID')}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `Saldo customer telah ditambahkan otomatis.`;
                
                await sendMessageToMany(global.config.adminNumbers, { text: adminMsg });
            } catch (error) {
                logger.error('Failed to send admin notifications:', error);
            }
        } else {
            logger.warn('Cannot notify admins - admin numbers not configured');
        }
        
    } catch (error) {
        logger.error('Error in handleAgentConfirmation:', error);
        await reply(renderResponseTemplate(
            'agent_transaction_confirm_error',
            '❌ Terjadi kesalahan. Silakan coba lagi atau hubungi admin.',
            { resultMessage: 'Terjadi kesalahan. Silakan coba lagi atau hubungi admin.' }
        ));
    }
}

/**
 * Handle agent today transactions
 * Shows all transactions for the agent today
 * Command: transaksi hari ini, transaksi, my transactions
 */
async function handleAgentTodayTransactions(msg, sender, reply, raf = null) {
    try {
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agent = agentManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agent) {
            return await reply(renderResponseTemplate(
                'agent_transaction_not_registered',
                '❌ *Nomor Anda tidak terdaftar sebagai agent.*\n\n' +
                'Untuk menggunakan command ini, nomor WhatsApp Anda harus:\n' +
                '1. Terdaftar sebagai agent di sistem\n' +
                '2. Nomor telepon Anda harus sesuai dengan yang terdaftar di admin\n\n' +
                '📞 Hubungi admin untuk verifikasi:\n' +
                'wa.me/6289685645956\n\n' +
                '💡 *Tips:* Pastikan nomor WhatsApp Anda sama dengan nomor yang terdaftar di sistem'
            ));
        }
        
        // Log only essential info
        logger.info(`[AGENT_TRANSACTIONS] ${agent.name} (${agent.id}) checking transactions`);
        
        // Get today's transactions
        const transactions = agentTransactionManager.getTodayTransactions(agent.id);
        
        if (transactions.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_transaction_today_empty',
                `ℹ️ *TRANSAKSI HARI INI*\n\n` +
                `Agent: ${agent.name}\n\n` +
                `Belum ada transaksi hari ini.`,
                { agentName: agent.name }
            ));
        }
        
        // Calculate statistics
        let totalAmount = 0;
        let pendingCount = 0;
        let confirmedCount = 0;
        let completedCount = 0;
        
        // Format message
        let message = `📊 *TRANSAKSI HARI INI*\n\n`;
        message += `Agent: ${agent.name}\n`;
        message += `Total: ${transactions.length} transaksi\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        transactions.forEach((trx) => {
            const time = new Date(trx.created_at).toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit'
            });
            
            let icon = '⏳';
            let statusText = 'Pending';
            
            if (trx.status === 'completed') {
                icon = '✅';
                statusText = 'Selesai';
                totalAmount += trx.amount;
                completedCount++;
            } else if (trx.status === 'confirmed') {
                icon = '🔄';
                statusText = 'Dikonfirmasi';
                confirmedCount++;
            } else if (trx.status === 'pending') {
                icon = '⏳';
                statusText = 'Menunggu';
                pendingCount++;
            } else if (trx.status === 'cancelled') {
                icon = '❌';
                statusText = 'Batal';
            }
            
            message += `${icon} ${time} - Rp ${trx.amount.toLocaleString('id-ID')}\n`;
            message += `   ${trx.customerName} - ${statusText}\n`;
            
            if (trx.status === 'pending') {
                message += `   ID: ${trx.id}\n`;
                message += `   💡 Ketik: konfirmasi ${trx.id} [PIN]\n`;
            }
            
            message += `\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `💰 Total Selesai: Rp ${totalAmount.toLocaleString('id-ID')}\n`;
        message += `✅ Selesai: ${completedCount}\n`;
        message += `🔄 Dikonfirmasi: ${confirmedCount}\n`;
        message += `⏳ Pending: ${pendingCount}`;
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleAgentTodayTransactions:', {
            error: error.message,
            stack: error.stack,
            sender: sender
        });
        
        // Always try to send a reply even if there's an error
        try {
            await reply(renderResponseTemplate(
                'agent_transaction_today_error',
                '❌ *Terjadi kesalahan sistem.*\n\n' +
                'Error: ' + error.message + '\n\n' +
                'Silakan coba lagi atau hubungi admin jika masalah berlanjut.',
                { errorMessage: error.message }
            ));
        } catch (replyError) {
            logger.error('Failed to send error message:', {
                error: replyError.message
            });
        }
    }
}

/**
 * Handle check topup status
 * Auto-detect pending topup by user number (no ID needed)
 * Command: cek topup, check topup, status topup
 */
async function handleCheckTopupStatus(msg, sender, reply) {
    try {
        // Get all topup requests for this user that are still pending/processing
        const allRequests = saldoManager.getAllTopupRequests();
        const userRequests = allRequests.filter(r => 
            r.userId === sender && 
            (r.status === 'pending' || r.status === 'waiting_verification')
        );
        
        // If no pending requests found
        if (!userRequests || userRequests.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_topup_status_empty',
                '📋 *STATUS TOPUP*\n\n' +
                '✅ Tidak ada proses topup yang sedang berjalan.\n\n' +
                '💡 Ketik *topup* untuk melakukan topup saldo\n' +
                '💡 Ketik *ceksaldo* untuk melihat saldo Anda'
            ));
        }
        
        // Get the most recent pending request
        const topupRequest = userRequests.sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
        )[0];
        
        // If multiple pending requests, inform user
        let multipleNote = '';
        if (userRequests.length > 1) {
            multipleNote = `\n\n⚠️ Anda memiliki ${userRequests.length} request topup pending. Menampilkan yang terbaru.`;
        }
        
        // Format status message
        let statusIcon = '⏳';
        let statusText = 'Menunggu';
        let statusDetail = '';
        
        if (topupRequest.status === 'verified') {
            statusIcon = '✅';
            statusText = 'Verified';
            statusDetail = `Dikonfirmasi pada: ${new Date(topupRequest.verifiedAt).toLocaleString('id-ID')}\n`;
            statusDetail += `Saldo telah ditambahkan! ✅`;
        } else if (topupRequest.status === 'pending') {
            if (topupRequest.paymentMethod === 'transfer') {
                if (topupRequest.paymentProof) {
                    statusText = 'Menunggu verifikasi admin';
                    statusDetail = 'Bukti transfer sudah diterima.\nAdmin akan memverifikasi dalam 1x24 jam.';
                } else {
                    statusText = 'Menunggu bukti transfer';
                    statusDetail = 'Silakan kirim bukti transfer ke chat ini.';
                }
            } else if (topupRequest.paymentMethod === 'cash' && topupRequest.agentId) {
                const agent = agentManager.getAgentById(topupRequest.agentId);
                statusText = 'Menunggu konfirmasi agent';
                statusDetail = `Agent: ${agent?.name || 'Unknown'}\n`;
                statusDetail += `Hubungi agent untuk bayar tunai.`;
            }
        } else if (topupRequest.status === 'rejected') {
            statusIcon = '❌';
            statusText = 'Ditolak';
            statusDetail = topupRequest.notes || 'Hubungi admin untuk informasi lebih lanjut.';
        } else if (topupRequest.status === 'cancelled') {
            statusIcon = '❌';
            statusText = 'Dibatalkan';
            statusDetail = 'Request ini telah dibatalkan.';
        }
        
        let message = `📋 *STATUS TOPUP*\n\n`;
        message += `🆔 ID: ${topupRequest.id}\n`;
        message += `💰 Jumlah: Rp ${topupRequest.amount.toLocaleString('id-ID')}\n`;
        message += `🏦 Metode: ${topupRequest.paymentMethod === 'transfer' ? 'Transfer Bank' : 'Bayar ke Agent'}\n`;
        
        if (topupRequest.agentId) {
            const agent = agentManager.getAgentById(topupRequest.agentId);
            if (agent) {
                message += `📍 Agent: ${agent.name}\n`;
            }
        }
        
        message += `${statusIcon} Status: *${statusText}*\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `${statusDetail}\n\n`;
        message += `Dibuat: ${new Date(topupRequest.created_at).toLocaleString('id-ID')}`;
        
        // Add multiple request note if applicable
        if (multipleNote) {
            message += multipleNote;
        }
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleCheckTopupStatus:', error);
        await reply(renderResponseTemplate(
            'agent_topup_status_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
    }
}

// ==============================================
// SECTION 3: AGENT SELF-SERVICE
// Profile & settings management for agents
// ==============================================

/**
 * Handle agent PIN change
 * Format: ganti pin [old_pin] [new_pin]
 * Command: ganti pin
 */
async function handleAgentPinChange(msg, sender, reply, args, raf = null) {
    try {
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return reply(renderResponseTemplate(
                'agent_pin_not_registered',
                '❌ Anda bukan agent terdaftar atau belum memiliki credential.\n\nHubungi admin untuk registrasi.'
            ));
        }
        
        // Parse arguments: ganti pin [old] [new]
        const oldPin = args[2] ? args[2].trim() : null; // Skip "ganti" and "pin", trim whitespace
        const newPin = args[3] ? args[3].trim() : null;
        
        if (!oldPin || !newPin) {
            return reply(renderResponseTemplate(
                'agent_pin_format',
                '⚠️ *Format salah!*\n\n' +
                        'Format yang benar:\n' +
                        '`ganti pin [PIN_LAMA] [PIN_BARU]`\n\n' +
                        'Contoh:\n' +
                        '`ganti pin 1234 5678`\n\n' +
                        'PIN minimal 4 digit'
            ));
        }
        
        // Validate PIN format (only digits)
        if (!/^[0-9]+$/.test(oldPin) || !/^[0-9]+$/.test(newPin)) {
            return reply(renderResponseTemplate(
                'agent_pin_digits_only',
                '❌ PIN hanya boleh berisi angka!'
            ));
        }
        
        if (newPin.length < 4 || newPin.length > 6) {
            return reply(renderResponseTemplate(
                'agent_pin_length',
                '❌ PIN baru harus 4-6 digit!'
            ));
        }
        
        if (oldPin === newPin) {
            return reply(renderResponseTemplate(
                'agent_pin_same',
                '❌ PIN baru harus berbeda dengan PIN lama!'
            ));
        }
        
        // Use the WhatsApp number from credentials (which was used during registration/reset)
        // This ensures we use the same format that was stored
        const whatsappNumForVerification = agentCred.whatsappNumber || phoneNumberToSearch;
        
        logger.info(`[AGENT_PIN] Attempting PIN change for ${agentCred.agentId}`, {
            storedWhatsapp: agentCred.whatsappNumber,
            senderWhatsapp: phoneNumberToSearch,
            usingWhatsapp: whatsappNumForVerification
        });
        
        // Update PIN
        const result = await agentTransactionManager.updateAgentPin(
            agentCred.agentId,
            whatsappNumForVerification,
            oldPin,
            newPin
        );
        
        if (result.success) {
            reply(renderResponseTemplate(
                'agent_pin_success',
                '✅ *PIN BERHASIL DIUBAH!*\n\n' +
                  '🔐 PIN baru Anda telah aktif\n' +
                  '⚠️ Gunakan PIN baru untuk konfirmasi transaksi berikutnya\n\n' +
                  '_Jangan bagikan PIN Anda ke siapapun!_'
            ));
            
            logger.info(`[AGENT_PIN] PIN changed for agent ${agentCred.agentId}`);
        } else {
            reply(renderResponseTemplate(
                'agent_pin_failed',
                `❌ *GAGAL UBAH PIN*\n\n${result.message}\n\n` +
                  'Pastikan PIN lama Anda benar.',
                { resultMessage: result.message }
            ));
        }
        
    } catch (error) {
        logger.error('Error handling agent PIN change', {
            error: error.message,
            sender: sender
        });
        
        reply(renderResponseTemplate(
            'agent_pin_error',
            '❌ Terjadi kesalahan saat mengubah PIN.\n\nSilakan coba lagi atau hubungi admin.'
        ));
    }
}

/**
 * Handle agent profile update
 * Updates agent address, hours, or phone
 * Command: update alamat, update jam, update phone
 */
async function handleAgentProfileUpdate(msg, sender, reply, args, updateType, raf = null) {
    try {
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return reply(renderResponseTemplate(
                'agent_profile_not_registered',
                '❌ Anda bukan agent terdaftar.\n\nHubungi admin untuk registrasi.'
            ));
        }
        
        // Get full agent data
        const agent = agentManager.getAgentById(agentCred.agentId);
        
        if (!agent) {
            return reply(renderResponseTemplate(
                'agent_profile_data_missing',
                '❌ Data agent tidak ditemukan.\n\nHubungi admin.'
            ));
        }
        
        // Handle different update types
        let updateData = {};
        let successMessage = '';
        
        switch (updateType) {
            case 'address':
                // Format: update alamat [alamat baru]
                const newAddress = args.slice(2).join(' '); // Skip "update" and "alamat"
                
                if (!newAddress || newAddress.length < 10) {
                    return reply(renderResponseTemplate(
                        'agent_profile_address_format',
                        '⚠️ *Format salah!*\n\n' +
                                'Format: `update alamat [alamat lengkap]`\n\n' +
                                'Contoh:\n' +
                                '`update alamat Jl. Raya Tanjung No. 123, RT 01/02`\n\n' +
                                'Alamat minimal 10 karakter'
                    ));
                }
                
                updateData.address = newAddress;
                successMessage = renderResponseTemplate(
                    'agent_profile_address_success',
                    `✅ *ALAMAT BERHASIL DIUBAH!*\n\n📍 Alamat baru:\n${newAddress}\n\n_Alamat akan tampil di list agent untuk customer_`,
                    { newAddress }
                );
                break;
                
            case 'hours':
                // Format: update jam [08:00]-[21:00] or [08:00] - [21:00]
                const hoursText = args.slice(2).join(' ');
                const hoursMatch = hoursText.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
                
                if (!hoursMatch) {
                    return reply(renderResponseTemplate(
                        'agent_profile_hours_format',
                        '⚠️ *Format salah!*\n\n' +
                                'Format: `update jam [BUKA]-[TUTUP]`\n\n' +
                                'Contoh:\n' +
                                '`update jam 08:00-21:00`\n' +
                                '`update jam 09:00 - 20:00`\n\n' +
                                'Format waktu: HH:MM (24 jam)'
                    ));
                }
                
                const openTime = hoursMatch[1];
                const closeTime = hoursMatch[2];
                updateData.operational_hours = `${openTime} - ${closeTime}`;
                successMessage = renderResponseTemplate(
                    'agent_profile_hours_success',
                    `✅ *JAM OPERASIONAL BERHASIL DIUBAH!*\n\n🕐 Jam baru:\n${openTime} - ${closeTime}\n\n_Jam operasional akan tampil di list agent_`,
                    { openTime, closeTime }
                );
                break;
                
            case 'phone':
                // Format: update phone [nomor]
                const newPhone = args[2];
                
                if (!newPhone || !/^(0|62|628)\d{8,12}$/.test(newPhone.replace(/\D/g, ''))) {
                    return reply(renderResponseTemplate(
                        'agent_profile_phone_format',
                        '⚠️ *Format salah!*\n\n' +
                                'Format: `update phone [nomor]`\n\n' +
                                'Contoh:\n' +
                                '`update phone 085233047094`\n' +
                                '`update phone 6285233047094`\n\n' +
                                'Nomor minimal 10 digit'
                    ));
                }
                
                updateData.phone = newPhone;
                successMessage = renderResponseTemplate(
                    'agent_profile_phone_success',
                    `✅ *NOMOR TELEPON BERHASIL DIUBAH!*\n\n📱 Nomor baru:\n${newPhone}\n\n_Nomor akan tampil di list agent untuk customer_`,
                    { newPhone }
                );
                break;
                
            default:
                return reply(renderResponseTemplate(
                    'agent_profile_invalid_type',
                    '❌ Tipe update tidak valid'
                ));
        }
        
        // Update agent data
        const result = agentManager.updateAgent(agent.id, updateData);
        
        if (result.success) {
            reply(successMessage);
            
            logger.info(`[AGENT_UPDATE] ${agent.name} (${agent.id}) updated ${updateType}`);
        } else {
            reply(renderResponseTemplate(
                'agent_profile_update_failed',
                `❌ *GAGAL UPDATE PROFIL*\n\n${result.message}`,
                { resultMessage: result.message }
            ));
        }
        
    } catch (error) {
        logger.error('Error updating agent profile', {
            error: error.message,
            sender: sender,
            updateType: updateType
        });
        
        reply(renderResponseTemplate(
            'agent_profile_update_error',
            '❌ Terjadi kesalahan saat update profil.\n\nSilakan coba lagi atau hubungi admin.'
        ));
    }
}

/**
 * Handle agent status toggle
 * Opens or temporarily closes the agent outlet
 * Command: tutup sementara, buka kembali
 */
async function handleAgentStatusToggle(msg, sender, reply, status, raf = null) {
    try {
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return reply(renderResponseTemplate(
                'agent_profile_not_registered',
                '❌ Anda bukan agent terdaftar.\n\nHubungi admin untuk registrasi.'
            ));
        }
        
        // Get full agent data
        const agent = agentManager.getAgentById(agentCred.agentId);
        
        if (!agent) {
            return reply(renderResponseTemplate(
                'agent_profile_data_missing',
                '❌ Data agent tidak ditemukan.\n\nHubungi admin.'
            ));
        }
        
        const newStatus = (status === 'open');
        
        // Update agent status
        const result = agentManager.updateAgent(agent.id, {
            active: newStatus
        });
        
        if (result.success) {
            if (newStatus) {
                reply(renderResponseTemplate(
                    'agent_status_open_success',
                    '✅ *OUTLET DIBUKA*\n\n' +
                      '🟢 Status: *BUKA*\n\n' +
                      'Outlet Anda sekarang muncul di list agent untuk customer.\n\n' +
                      '_Ketik "tutup sementara" untuk menonaktifkan_'
                ));
            } else {
                reply(renderResponseTemplate(
                    'agent_status_close_success',
                    '✅ *OUTLET DITUTUP SEMENTARA*\n\n' +
                      '🔴 Status: *TUTUP*\n\n' +
                      'Outlet Anda tidak akan muncul di list agent untuk customer.\n\n' +
                      '_Ketik "buka kembali" untuk mengaktifkan kembali_'
                ));
            }
            
            logger.info(`[AGENT_STATUS] ${agent.name} (${agent.id}) ${newStatus ? 'opened' : 'closed'}`);
        } else {
            reply(renderResponseTemplate(
                'agent_status_update_failed',
                `❌ *GAGAL UPDATE STATUS*\n\n${result.message}`,
                { resultMessage: result.message }
            ));
        }
        
    } catch (error) {
        logger.error('Error toggling agent status', {
            error: error.message,
            sender: sender
        });
        
        reply(renderResponseTemplate(
            'agent_status_update_error',
            '❌ Terjadi kesalahan saat update status.\n\nSilakan coba lagi atau hubungi admin.'
        ));
    }
}

/**
 * Handle agent self profile view
 * Shows agent's own profile and statistics
 * Command: profil agent, info agent (when sender is agent)
 * RENAMED FROM: handleAgentInfo to avoid conflict with handleViewAgentDetail
 */
async function handleAgentSelfProfile(msg, sender, reply, raf = null) {
    try {
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number (now supports fallback to agents.json)
        const agent = agentManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agent) {
            return reply(renderResponseTemplate(
                'agent_self_not_registered',
                '❌ Anda bukan agent terdaftar.\n\nHubungi admin untuk registrasi.'
            ));
        }
        
        // Get credentials if available
        const agentCred = agent.hasCredentials ? 
            agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch) : null;
        
        // Get transaction statistics
        const stats = agentTransactionManager.getAgentStatistics(agent.id, 'month');
        
        let message = `👤 *PROFIL AGENT*\n\n`;
        message += `📋 *DATA OUTLET:*\n`;
        message += `• Nama: ${agent.name}\n`;
        message += `• ID: ${agent.id}\n`;
        message += `• Area: ${agent.area}\n`;
        message += `• Status: ${agent.active ? '🟢 BUKA' : '🔴 TUTUP'}\n\n`;
        
        message += `📍 *INFORMASI KONTAK:*\n`;
        message += `• Alamat: ${agent.address}\n`;
        message += `• Telepon: ${agent.phone}\n`;
        message += `• WhatsApp: ${agent.whatsappNumber || sender}\n\n`;
        
        message += `🕐 *JAM OPERASIONAL:*\n`;
        message += `${agent.operational_hours}\n\n`;
        
        message += `💼 *LAYANAN:*\n`;
        if (agent.services && agent.services.length > 0) {
            agent.services.forEach(service => {
                message += `• ${service.charAt(0).toUpperCase() + service.slice(1)}\n`;
            });
        } else {
            message += `Belum ada layanan terdaftar\n`;
        }
        message += `\n`;
        
        message += `📊 *STATISTIK BULAN INI:*\n`;
        message += `• Total Transaksi: ${stats.total}\n`;
        message += `• Completed: ${stats.completed}\n`;
        message += `• Pending: ${stats.pending}\n`;
        message += `• Total Amount: Rp ${stats.totalAmount.toLocaleString('id-ID')}\n\n`;
        
        message += `🔐 *SECURITY:*\n`;
        if (agent.hasCredentials && agentCred) {
            message += `• PIN: ✅ Terdaftar\n`;
            message += `• Last Login: ${agentCred.lastLogin ? new Date(agentCred.lastLogin).toLocaleString('id-ID') : 'Belum pernah'}\n\n`;
        } else {
            message += `• PIN: ❌ Belum terdaftar\n`;
            message += `• Status: Agent terdaftar tapi belum memiliki PIN\n`;
            message += `• 💡 Hubungi admin untuk membuat PIN\n\n`;
        }
        
        message += `💡 *COMMAND TERSEDIA:*\n`;
        message += `• \`ganti pin [lama] [baru]\`\n`;
        message += `• \`update alamat [alamat]\`\n`;
        message += `• \`update jam [buka]-[tutup]\`\n`;
        message += `• \`tutup sementara\`\n`;
        message += `• \`buka kembali\`\n`;
        message += `• \`transaksi hari ini\`\n`;
        message += `• \`konfirmasi [ID] [PIN]\``;
        
        reply(message);
        
    } catch (error) {
        logger.error('Error getting agent self profile', {
            error: error.message,
            sender: sender
        });
        
        reply(renderResponseTemplate(
            'agent_self_profile_error',
            '❌ Terjadi kesalahan saat mengambil data.\n\nSilakan coba lagi atau hubungi admin.'
        ));
    }
}

// ==============================================
// MODULE EXPORTS
// ==============================================

module.exports = {
    // SECTION 1: Customer Commands
    handleListAgents,
    handleAgentByArea,
    handleAgentServices,
    handleSearchAgent,
    handleViewAgentDetail,
    
    // SECTION 2: Agent Transactions
    handleAgentConfirmation,
    handleAgentTodayTransactions,
    handleCheckTopupStatus,
    
    // SECTION 3: Agent Self-Service
    handleAgentPinChange,
    handleAgentProfileUpdate,
    handleAgentStatusToggle,
    handleAgentSelfProfile
};
