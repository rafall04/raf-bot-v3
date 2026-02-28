"use strict";

/**
 * Agent Voucher Handler
 * Handles agent voucher purchase and sales via WhatsApp bot
 */

const agentVoucherManager = require('../../lib/agent-voucher-manager');
const agentManager = require('../../lib/agent-manager');
const agentTransactionManager = require('../../lib/agent-transaction-manager');
const { getVoucherProfiles } = require('../../lib/voucher-manager');
const { logger } = require('../../lib/logger');
const { extractSenderInfo } = require('../../lib/jid-utils');
const { getUserState, setUserState, deleteUserState } = require('./conversation-handler');

/**

/**
 * Format currency
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

/**
 * Handle agent purchase voucher - Initial command
 */
async function handleAgentPurchaseVoucher(msg, sender, reply, temp, raf = null) {
    try {
        // Use extractSenderInfo to get canonical JID/phone
        const senderInfo = extractSenderInfo(msg);
        const phoneNumberToSearch = senderInfo.jid; // extractSenderInfo already tries to resolve PN for LID
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(
                '❌ *Anda bukan agent terdaftar.*\n\n' +
                'Untuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n' +
                '📞 Hubungi admin untuk registrasi.'
            );
        }
        
        // Get agent info
        const agent = agentManager.getAgentById(agentCred.agentId);
        if (!agent) {
            return await reply('❌ Data agent tidak ditemukan.');
        }
        
        // Get voucher profiles
        const profiles = getVoucherProfiles();
        
        if (profiles.length === 0) {
            return await reply('❌ Maaf, tidak ada voucher yang tersedia saat ini.');
        }
        
        // Get agent inventory to show current stock
        const inventory = agentVoucherManager.getAgentInventory(agentCred.agentId);
        
        // Build message with numbered list
        let message = `📦 *BELI VOUCHER RESELLER*\n\n`;
        message += `Agent: ${agent.name}\n\n`;
        message += `Pilih voucher yang ingin dibeli:\n\n`;
        
        profiles.forEach((profile, index) => {
            const hargaReseller = parseInt(profile.hargaReseller || profile.hargavc);
            const hargaJual = parseInt(profile.hargavc);
            const margin = parseInt(profile.margin || (hargaJual - hargaReseller));
            
            // Find current stock for this voucher
            const inventoryItem = inventory.inventory.find(item => item.voucherProfileId === profile.prof);
            const currentStok = inventoryItem ? inventoryItem.stok : 0;
            
            message += `${index + 1}. *${profile.namavc}*\n`;
            message += `   • Harga Reseller: ${formatCurrency(hargaReseller)}\n`;
            message += `   • Harga Jual: ${formatCurrency(hargaJual)}\n`;
            message += `   • Margin: ${formatCurrency(margin)}\n`;
            message += `   • Stok: ${currentStok}\n\n`;
        });
        
        message += `Ketik *nomor* untuk memilih (contoh: 1)\n`;
        message += `Ketik *batal* untuk membatalkan`;
        
        // Set state
        setUserState(sender, {
            step: 'AGENT_VOUCHER_PURCHASE_SELECT',
            agentId: agentCred.agentId,
            agentName: agent.name,
            profiles: profiles
        });
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleAgentPurchaseVoucher:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle state: AGENT_VOUCHER_PURCHASE_SELECT - Agent selects voucher by number
 */
async function handlePurchaseSelect(msg, sender, reply, chats) {
    try {
        const userState = getUserState(sender);
        const selectedNumber = parseInt(chats.trim());
        
        if (isNaN(selectedNumber) || selectedNumber < 1 || selectedNumber > userState.profiles.length) {
            return await reply(
                `⚠️ *Nomor tidak valid!*\n\n` +
                `Silakan pilih nomor antara 1-${userState.profiles.length}\n` +
                `Atau ketik *batal* untuk membatalkan`
            );
        }
        
        const selectedProfile = userState.profiles[selectedNumber - 1];
        const hargaReseller = parseInt(selectedProfile.hargaReseller || selectedProfile.hargavc);
        const hargaJual = parseInt(selectedProfile.hargavc);
        const margin = parseInt(selectedProfile.margin || (hargaJual - hargaReseller));
        
        // Get current stock
        const inventory = agentVoucherManager.getAgentInventory(userState.agentId);
        const inventoryItem = inventory.inventory.find(item => item.voucherProfileId === selectedProfile.prof);
        const currentStok = inventoryItem ? inventoryItem.stok : 0;
        
        let message = `✅ *${selectedProfile.namavc} Dipilih*\n\n`;
        message += `• Harga Reseller: ${formatCurrency(hargaReseller)}\n`;
        message += `• Harga Jual: ${formatCurrency(hargaJual)}\n`;
        message += `• Margin: ${formatCurrency(margin)}\n`;
        message += `• Stok Saat Ini: ${currentStok}\n\n`;
        message += `Berapa jumlah voucher yang ingin dibeli?\n`;
        message += `(Min: 1, Max: 100)\n\n`;
        message += `Ketik *batal* untuk membatalkan`;
        
        // Update state
        setUserState(sender, {
            step: 'AGENT_VOUCHER_PURCHASE_QUANTITY',
            agentId: userState.agentId,
            agentName: userState.agentName,
            selectedProfile: selectedProfile,
            hargaReseller: hargaReseller,
            hargaJual: hargaJual,
            margin: margin
        });
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handlePurchaseSelect:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle state: AGENT_VOUCHER_PURCHASE_QUANTITY - Agent inputs quantity
 */
async function handlePurchaseQuantity(msg, sender, reply, chats) {
    try {
        const userState = getUserState(sender);
        const quantity = parseInt(chats.trim());
        
        if (isNaN(quantity) || quantity < 1 || quantity > 100) {
            return await reply(
                `⚠️ *Jumlah tidak valid!*\n\n` +
                `Jumlah voucher harus antara 1-100\n` +
                `Atau ketik *batal* untuk membatalkan`
            );
        }
        
        const totalHarga = userState.hargaReseller * quantity;
        
        let message = `📊 *RINGKASAN PEMBELIAN*\n\n`;
        message += `Voucher: ${userState.selectedProfile.namavc}\n`;
        message += `Quantity: ${quantity} voucher\n`;
        message += `Harga Reseller: ${formatCurrency(userState.hargaReseller)}/voucher\n`;
        message += `Total Harga: ${formatCurrency(totalHarga)}\n\n`;
        
        // Get current stock
        const inventory = agentVoucherManager.getAgentInventory(userState.agentId);
        const inventoryItem = inventory.inventory.find(item => item.voucherProfileId === userState.selectedProfile.prof);
        const currentStok = inventoryItem ? inventoryItem.stok : 0;
        const newStok = currentStok + quantity;
        
        message += `Stok Setelah Pembelian: ${newStok}\n\n`;
        message += `Pilih metode pembayaran:\n`;
        message += `1. Saldo Agent\n`;
        message += `2. Cash (via agent transaction)\n`;
        message += `3. Transfer (via agent transaction)\n\n`;
        message += `Ketik *nomor* untuk memilih\n`;
        message += `Ketik *batal* untuk membatalkan`;
        
        // Update state
        setUserState(sender, {
            step: 'AGENT_VOUCHER_PURCHASE_PAYMENT',
            agentId: userState.agentId,
            agentName: userState.agentName,
            selectedProfile: userState.selectedProfile,
            hargaReseller: userState.hargaReseller,
            hargaJual: userState.hargaJual,
            margin: userState.margin,
            quantity: quantity,
            totalHarga: totalHarga
        });
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handlePurchaseQuantity:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle state: AGENT_VOUCHER_PURCHASE_PAYMENT - Agent selects payment method
 */
async function handlePurchasePayment(msg, sender, reply, chats, raf = null) {
    try {
        const userState = getUserState(sender);
        const paymentChoice = parseInt(chats.trim());
        
        if (isNaN(paymentChoice) || paymentChoice < 1 || paymentChoice > 3) {
            return await reply(
                `⚠️ *Pilihan tidak valid!*\n\n` +
                `Silakan pilih nomor 1-3\n` +
                `Atau ketik *batal* untuk membatalkan`
            );
        }
        
        const paymentMethods = ['saldo', 'cash', 'transfer'];
        const paymentMethod = paymentMethods[paymentChoice - 1];
        const paymentMethodNames = {
            'saldo': 'Saldo Agent',
            'cash': 'Cash',
            'transfer': 'Transfer'
        };
        
        // Process purchase
        const result = await agentVoucherManager.purchaseVoucherAsReseller(
            userState.agentId,
            userState.selectedProfile.prof,
            userState.quantity,
            paymentMethod,
            userState.agentName
        );
        
        if (!result.success) {
            return await reply(`❌ *GAGAL MEMBELI VOUCHER*\n\n${result.message}`);
        }
        
        // Clear state
        deleteUserState(sender);
        
        let message = `✅ *VOUCHER BERHASIL DIBELI!*\n\n`;
        message += `Voucher: ${userState.selectedProfile.namavc}\n`;
        message += `Quantity: ${userState.quantity} voucher\n`;
        message += `Total Harga: ${formatCurrency(userState.totalHarga)}\n`;
        message += `Metode Pembayaran: ${paymentMethodNames[paymentMethod]}\n\n`;
        
        if (paymentMethod === 'saldo') {
            message += `Voucher sudah ditambahkan ke inventory Anda.\n`;
            message += `Stok saat ini: ${result.inventory.totalStok} voucher\n\n`;
            message += `Ketik *stok voucher* untuk melihat inventory lengkap.`;
        } else {
            message += `⚠️ *MENUNGGU VERIFIKASI ADMIN*\n\n`;
            message += `Transaksi Anda sedang menunggu verifikasi admin.\n`;
            message += `Voucher akan ditambahkan ke inventory setelah pembayaran diverifikasi.\n\n`;
            message += `Transaction ID: ${result.purchase.agentTransactionId || result.purchase.id}\n`;
            message += `Ketik *transaksi* untuk melihat status transaksi.`;
        }
        
        await reply(message);
        
        logger.info(`[AGENT_VOUCHER] Purchase completed`, {
            agentId: userState.agentId,
            voucherProfileId: userState.selectedProfile.prof,
            quantity: userState.quantity,
            paymentMethod: paymentMethod
        });
        
    } catch (error) {
        logger.error('Error in handlePurchasePayment:', error);
        await reply('❌ Terjadi kesalahan saat memproses pembelian. Silakan coba lagi.');
    }
}

/**
 * Main handler for agent voucher purchase conversation
 */
async function handleAgentVoucherPurchaseConversation(msg, sender, reply, chats, raf = null) {
    try {
        const userState = getUserState(sender);
        
        if (!userState || !userState.step) {
            return false;
        }
        
        // Handle cancel
        const userReply = chats.toLowerCase().trim();
        if (['batal', 'cancel', 'ga jadi', 'gak jadi'].includes(userReply)) {
            deleteUserState(sender);
            return await reply('✅ Permintaan dibatalkan. Ada lagi yang bisa saya bantu?');
        }
        
        // Route to appropriate handler based on step
        switch (userState.step) {
            case 'AGENT_VOUCHER_PURCHASE_SELECT':
                await handlePurchaseSelect(msg, sender, reply, chats);
                return true;
                
            case 'AGENT_VOUCHER_PURCHASE_QUANTITY':
                await handlePurchaseQuantity(msg, sender, reply, chats);
                return true;
                
            case 'AGENT_VOUCHER_PURCHASE_PAYMENT':
                await handlePurchasePayment(msg, sender, reply, chats, raf);
                return true;
                
            default:
                return false;
        }
        
    } catch (error) {
        logger.error('Error in handleAgentVoucherPurchaseConversation:', error);
        return false;
    }
}

/**
 * Handle agent sell voucher - Initial command
 */
async function handleAgentSellVoucher(msg, sender, reply, temp, raf = null, users = [], global = null) {
    try {
        // Use extractSenderInfo to get canonical JID/phone
        const senderInfo = extractSenderInfo(msg);
        const phoneNumberToSearch = senderInfo.jid; 
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(
                '❌ *Anda bukan agent terdaftar.*\n\n' +
                'Untuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n' +
                '📞 Hubungi admin untuk registrasi.'
            );
        }
        
        // Get agent info
        const agent = agentManager.getAgentById(agentCred.agentId);
        if (!agent) {
            return await reply('❌ Data agent tidak ditemukan.');
        }
        
        // Get agent inventory
        const inventory = agentVoucherManager.getAgentInventory(agentCred.agentId);
        
        // Filter inventory items that have stock
        const availableVouchers = inventory.inventory.filter(item => item.stok > 0);
        
        if (availableVouchers.length === 0) {
            return await reply(
                '❌ *Stok Voucher Kosong*\n\n' +
                'Anda tidak memiliki stok voucher yang tersedia.\n\n' +
                'Ketik *beli voucher reseller* untuk membeli voucher terlebih dahulu.'
            );
        }
        
        // Build message with numbered list
        let message = `📦 *STOK VOUCHER TERSEDIA*\n\n`;
        message += `Agent: ${agent.name}\n\n`;
        message += `Pilih voucher yang ingin dijual:\n\n`;
        
        availableVouchers.forEach((item, index) => {
            message += `${index + 1}. *${item.voucherProfileName}*\n`;
            message += `   • Stok: ${item.stok}\n`;
            message += `   • Harga Jual: ${formatCurrency(item.hargaJual)}\n`;
            message += `   • Profit: ${formatCurrency(item.hargaJual - item.hargaReseller)}/voucher\n\n`;
        });
        
        message += `Ketik *nomor* untuk memilih (contoh: 1)\n`;
        message += `Ketik *batal* untuk membatalkan`;
        
        // Check if message is a reply (for auto-detect customer)
        let customerId = null;
        let customerName = 'Customer';
        
        if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            // This is a reply message, extract customer from reply
            customerId = msg.message.extendedTextMessage.contextInfo.participant;
            
            // Try to find customer name from users database
            const customerPhone = customerId.split('@')[0];
            const customer = users.find(u => {
                if (!u.phone_number) return false;
                const phoneNumbers = u.phone_number.split('|').map(p => p.trim());
                return phoneNumbers.some(p => {
                    const normalized = p.replace(/[^0-9]/g, '');
                    return normalized === customerPhone || normalized.endsWith(customerPhone) || customerPhone.endsWith(normalized);
                });
            });
            
            if (customer) {
                customerName = customer.name || 'Customer';
            }
        }
        
        // Set state
        setUserState(sender, {
            step: 'AGENT_VOUCHER_SALE_SELECT',
            agentId: agentCred.agentId,
            agentName: agent.name,
            availableVouchers: availableVouchers,
            customerId: customerId, // Auto-detected from reply
            customerName: customerName,
            users: users // Store users for later lookup
        });
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleAgentSellVoucher:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle state: AGENT_VOUCHER_SALE_SELECT - Agent selects voucher by number
 */
async function handleSaleSelect(msg, sender, reply, chats) {
    try {
        const userState = getUserState(sender);
        const selectedNumber = parseInt(chats.trim());
        
        if (isNaN(selectedNumber) || selectedNumber < 1 || selectedNumber > userState.availableVouchers.length) {
            return await reply(
                `⚠️ *Nomor tidak valid!*\n\n` +
                `Silakan pilih nomor antara 1-${userState.availableVouchers.length}\n` +
                `Atau ketik *batal* untuk membatalkan`
            );
        }
        
        const selectedVoucher = userState.availableVouchers[selectedNumber - 1];
        
        let message = `✅ *${selectedVoucher.voucherProfileName} Dipilih*\n\n`;
        message += `• Harga Jual: ${formatCurrency(selectedVoucher.hargaJual)}\n`;
        message += `• Stok Tersedia: ${selectedVoucher.stok}\n`;
        message += `• Profit: ${formatCurrency(selectedVoucher.hargaJual - selectedVoucher.hargaReseller)}/voucher\n\n`;
        
        // Simplified: Always ask for quantity first, then handle customer
        message += `Berapa voucher yang ingin dijual?\n`;
        message += `(Maksimal: ${selectedVoucher.stok} voucher)\n\n`;
        message += `Ketik *batal* untuk membatalkan`;
        
        // Update state to input quantity
        setUserState(sender, {
            step: 'AGENT_VOUCHER_SALE_QUANTITY',
            agentId: userState.agentId,
            agentName: userState.agentName,
            selectedVoucher: selectedVoucher,
            customerId: userState.customerId, // Keep if auto-detected
            customerName: userState.customerName,
            users: userState.users
        });
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleSaleSelect:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle state: AGENT_VOUCHER_SALE_QUANTITY - Agent inputs quantity
 */
async function handleSaleQuantity(msg, sender, reply, chats) {
    try {
        const userState = getUserState(sender);
        const quantity = parseInt(chats.trim());
        
        if (isNaN(quantity) || quantity < 1) {
            return await reply(
                `⚠️ *Jumlah tidak valid!*\n\n` +
                `Silakan masukkan jumlah voucher yang ingin dijual (minimal 1)\n` +
                `Atau ketik *batal* untuk membatalkan`
            );
        }
        
        if (quantity > userState.selectedVoucher.stok) {
            return await reply(
                `⚠️ *Stok tidak mencukupi!*\n\n` +
                `Stok tersedia: ${userState.selectedVoucher.stok} voucher\n` +
                `Anda meminta: ${quantity} voucher\n\n` +
                `Silakan masukkan jumlah yang lebih kecil atau ketik *batal* untuk membatalkan`
            );
        }
        
        // If customer already detected from reply, go straight to confirm
        if (userState.customerId) {
            let message = `📋 *RINGKASAN PENJUALAN*\n\n`;
            message += `Voucher: ${userState.selectedVoucher.voucherProfileName}\n`;
            message += `Jumlah: ${quantity} voucher\n`;
            message += `Harga Jual: ${formatCurrency(userState.selectedVoucher.hargaJual)}/voucher\n`;
            message += `Total: ${formatCurrency(userState.selectedVoucher.hargaJual * quantity)}\n\n`;
            message += `Customer: ${userState.customerName}\n`;
            message += `Nomor: ${userState.customerId.split('@')[0]}\n\n`;
            message += `Konfirmasi penjualan? (ketik: ya)\n`;
            message += `Atau ketik *batal* untuk membatalkan`;
            
            // Update state to confirm with quantity
            setUserState(sender, {
                step: 'AGENT_VOUCHER_SALE_CONFIRM',
                agentId: userState.agentId,
                agentName: userState.agentName,
                selectedVoucher: userState.selectedVoucher,
                quantity: quantity,
                customerId: userState.customerId,
                customerName: userState.customerName,
                users: userState.users
            });
            
            await reply(message);
        } else {
            // Ask for customer number
            let message = `✅ *Jumlah: ${quantity} voucher*\n\n`;
            message += `Masukkan nomor WhatsApp customer:\n`;
            message += `(Contoh: 6285233047094 atau reply pesan customer)\n\n`;
            message += `Ketik *batal* untuk membatalkan`;
            
            // Update state to input customer with quantity
            setUserState(sender, {
                step: 'AGENT_VOUCHER_SALE_CUSTOMER',
                agentId: userState.agentId,
                agentName: userState.agentName,
                selectedVoucher: userState.selectedVoucher,
                quantity: quantity,
                users: userState.users
            });
            
            await reply(message);
        }
        
    } catch (error) {
        logger.error('Error in handleSaleQuantity:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle state: AGENT_VOUCHER_SALE_CUSTOMER - Agent inputs customer number
 */
async function handleSaleCustomer(msg, sender, reply, chats) {
    try {
        const userState = getUserState(sender);
        const customerInput = chats.trim();
        
        // Check if it's a phone number format
        const phoneRegex = /^(\+?62|0)?[0-9]{9,12}$/;
        const cleanPhone = customerInput.replace(/[^0-9+]/g, '');
        
        if (!phoneRegex.test(cleanPhone)) {
            return await reply(
                `⚠️ *Format nomor tidak valid!*\n\n` +
                `Silakan masukkan nomor WhatsApp yang valid\n` +
                `(Contoh: 6285233047094 atau 085233047094)\n` +
                `Atau ketik *batal* untuk membatalkan`
            );
        }
        
        // Normalize phone number
        let normalizedPhone = cleanPhone;
        if (normalizedPhone.startsWith('+62')) {
            normalizedPhone = normalizedPhone.substring(1);
        } else if (normalizedPhone.startsWith('0')) {
            normalizedPhone = '62' + normalizedPhone.substring(1);
        } else if (!normalizedPhone.startsWith('62')) {
            normalizedPhone = '62' + normalizedPhone;
        }
        
        const customerId = `${normalizedPhone}@s.whatsapp.net`;
        
        // Try to find customer name from users database
        let customerName = 'Customer';
        const customer = userState.users.find(u => {
            if (!u.phone_number) return false;
            const phoneNumbers = u.phone_number.split('|').map(p => p.trim());
            return phoneNumbers.some(p => {
                const normalized = p.replace(/[^0-9]/g, '');
                return normalized === normalizedPhone || normalized.endsWith(normalizedPhone) || normalizedPhone.endsWith(normalized);
            });
        });
        
        if (customer) {
            customerName = customer.name || 'Customer';
        }
        
        const quantity = userState.quantity || 1;
        let message = `📋 *RINGKASAN PENJUALAN*\n\n`;
        message += `Voucher: ${userState.selectedVoucher.voucherProfileName}\n`;
        message += `Jumlah: ${quantity} voucher\n`;
        message += `Harga Jual: ${formatCurrency(userState.selectedVoucher.hargaJual)}/voucher\n`;
        message += `Total: ${formatCurrency(userState.selectedVoucher.hargaJual * quantity)}\n\n`;
        message += `Customer: ${customerName}\n`;
        message += `Nomor: ${normalizedPhone}\n\n`;
        message += `Konfirmasi penjualan? (ketik: ya)\n`;
        message += `Atau ketik *batal* untuk membatalkan`;
        
        // Update state to confirm with quantity
        setUserState(sender, {
            step: 'AGENT_VOUCHER_SALE_CONFIRM',
            agentId: userState.agentId,
            agentName: userState.agentName,
            selectedVoucher: userState.selectedVoucher,
            quantity: quantity,
            customerId: customerId,
            customerName: customerName,
            users: userState.users
        });
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleSaleCustomer:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle state: AGENT_VOUCHER_SALE_CONFIRM - Agent confirms sale
 */
async function handleSaleConfirm(msg, sender, reply, chats, raf = null, global = null) {
    try {
        const userState = getUserState(sender);
        const userReply = chats.toLowerCase().trim();
        
        if (userReply !== 'ya' && userReply !== 'y' && userReply !== 'yes' && userReply !== 'ok' && userReply !== 'oke') {
            return await reply(
                `⚠️ *Konfirmasi tidak valid!*\n\n` +
                `Ketik *ya* untuk konfirmasi penjualan\n` +
                `Atau ketik *batal* untuk membatalkan`
            );
        }
        
        // Process sale with quantity
        const quantity = userState.quantity || 1;
        const result = await agentVoucherManager.sellVoucherToCustomer(
            userState.agentId,
            userState.customerId,
            userState.selectedVoucher.voucherProfileId,
            'cash', // Default payment method, can be enhanced later
            userState.customerName,
            userState.agentName,
            quantity
        );
        
        if (!result.success) {
            return await reply(`❌ *GAGAL MENJUAL VOUCHER*\n\n${result.message}`);
        }
        
        // Clear state
        deleteUserState(sender);
        
        // Get WiFi name from global config if available
        const wifiName = (global && global.config && global.config.wifi_name) ? global.config.wifi_name : 'RAF NET';
        
        // Send all vouchers to customer
        const voucherCodes = result.voucherCodes || [result.voucherCode];
        const quantitySold = result.quantity || quantity;
        
        let customerMessage = `🎫 *VOUCHER DARI ${userState.agentName.toUpperCase()}*\n\n`;
        customerMessage += `Terima kasih telah membeli voucher!\n\n`;
        customerMessage += `📋 *Detail Pembelian:*\n`;
        customerMessage += `• Voucher: ${userState.selectedVoucher.voucherProfileName}\n`;
        customerMessage += `• Durasi: ${userState.selectedVoucher.duration}\n`;
        customerMessage += `• Jumlah: ${quantitySold} voucher\n`;
        customerMessage += `• Harga: ${formatCurrency(userState.selectedVoucher.hargaJual)}/voucher\n`;
        customerMessage += `• Total: ${formatCurrency(userState.selectedVoucher.hargaJual * quantitySold)}\n\n`;
        
        if (quantitySold === 1) {
            // Single voucher format
            customerMessage += `🔑 *Kredensial WiFi:*\n`;
            customerMessage += `Username: \`${voucherCodes[0].username}\`\n`;
            customerMessage += `Password: \`${voucherCodes[0].password}\`\n\n`;
        } else {
            // Multiple vouchers format
            customerMessage += `🔑 *Kredensial WiFi (${quantitySold} voucher):*\n\n`;
            voucherCodes.forEach((code, index) => {
                customerMessage += `*Voucher ${index + 1}:*\n`;
                customerMessage += `Username: \`${code.username}\`\n`;
                customerMessage += `Password: \`${code.password}\`\n\n`;
            });
        }
        
        customerMessage += `💡 *Cara Pakai:*\n`;
        customerMessage += `1. Hubungkan ke WiFi ${wifiName}\n`;
        customerMessage += `2. Masukkan username dan password di atas\n`;
        customerMessage += `3. Nikmati internet Anda!\n\n`;
        customerMessage += `_Selamat menggunakan!_`;
        
        // Send to customer via WhatsApp
        // PENTING: Cek connection state dan gunakan error handling sesuai rules
        const rafToUse = raf || global.raf;
        if (global.whatsappConnectionState === 'open' && rafToUse && rafToUse.sendMessage) {
            try {
                await rafToUse.sendMessage(userState.customerId, { text: customerMessage });
                logger.info('Voucher message sent to customer successfully', {
                    customerId: userState.customerId,
                    quantity: quantitySold
                });
            } catch (error) {
                console.error('[SEND_MESSAGE_ERROR]', {
                    customerId: userState.customerId,
                    error: error.message
                });
                logger.error('Error sending voucher to customer:', error);
                logger.error('Error details:', {
                    message: error.message,
                    stack: error.stack,
                    customerId: userState.customerId,
                    rafAvailable: !!(raf || global.raf),
                    connectionState: global.whatsappConnectionState
                });
                // Continue even if notification fails - sale is already completed
            }
        } else {
            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to', userState.customerId);
            logger.warn('Cannot send voucher to customer - WhatsApp not connected', {
                customerId: userState.customerId,
                connectionState: global.whatsappConnectionState
            });
        }
        
        // Send confirmation to agent
        let agentMessage = `✅ *VOUCHER BERHASIL DIJUAL!*\n\n`;
        agentMessage += `Customer: ${userState.customerName}\n`;
        agentMessage += `Voucher: ${userState.selectedVoucher.voucherProfileName}\n`;
        agentMessage += `Jumlah: ${quantitySold} voucher\n`;
        agentMessage += `Harga Jual: ${formatCurrency(userState.selectedVoucher.hargaJual)}/voucher\n`;
        agentMessage += `Total: ${formatCurrency(userState.selectedVoucher.hargaJual * quantitySold)}\n`;
        agentMessage += `Profit: ${formatCurrency(result.totalProfit || (result.sale.profit * quantitySold))}\n\n`;
        agentMessage += `Voucher sudah dikirim ke customer.\n`;
        agentMessage += `Stok saat ini: ${result.inventory.totalStok} voucher\n\n`;
        agentMessage += `Ketik *stok voucher* untuk melihat inventory lengkap.`;
        
        await reply(agentMessage);
        
        logger.info(`[AGENT_VOUCHER] Sale completed`, {
            agentId: userState.agentId,
            customerId: userState.customerId,
            voucherProfileId: userState.selectedVoucher.voucherProfileId,
            quantity: quantitySold,
            totalProfit: result.totalProfit || (result.sale.profit * quantitySold)
        });
        
    } catch (error) {
        logger.error('Error in handleSaleConfirm:', error);
        logger.error('Error details:', {
            message: error.message,
            stack: error.stack,
            userState: userState ? {
                agentId: userState.agentId,
                customerId: userState.customerId,
                quantity: userState.quantity,
                selectedVoucher: userState.selectedVoucher ? userState.selectedVoucher.voucherProfileId : null
            } : null
        });
        await reply(`❌ Terjadi kesalahan saat memproses penjualan: ${error.message}\n\nSilakan coba lagi atau hubungi admin.`);
    }
}

/**
 * Main handler for agent voucher sale conversation
 */
async function handleAgentVoucherSaleConversation(msg, sender, reply, chats, raf = null, global = null) {
    try {
        const userState = getUserState(sender);
        
        if (!userState || !userState.step) {
            return false;
        }
        
        // Handle cancel
        const userReply = chats.toLowerCase().trim();
        if (['batal', 'cancel', 'ga jadi', 'gak jadi'].includes(userReply)) {
            deleteUserState(sender);
            return await reply('✅ Permintaan dibatalkan. Ada lagi yang bisa saya bantu?');
        }
        
        // Route to appropriate handler based on step
        switch (userState.step) {
            case 'AGENT_VOUCHER_SALE_SELECT':
                await handleSaleSelect(msg, sender, reply, chats);
                return true;
                
            case 'AGENT_VOUCHER_SALE_QUANTITY':
                await handleSaleQuantity(msg, sender, reply, chats);
                return true;
                
            case 'AGENT_VOUCHER_SALE_CUSTOMER':
                await handleSaleCustomer(msg, sender, reply, chats);
                return true;
                
            case 'AGENT_VOUCHER_SALE_CONFIRM':
                await handleSaleConfirm(msg, sender, reply, chats, raf, global);
                return true;
                
            default:
                return false;
        }
        
    } catch (error) {
        logger.error('Error in handleAgentVoucherSaleConversation:', error);
        return false;
    }
}

/**
 * Handle agent check inventory
 */
async function handleAgentCheckInventory(msg, sender, reply, raf = null) {
    try {
        // Use extractSenderInfo to get canonical JID/phone
        const senderInfo = extractSenderInfo(msg);
        const phoneNumberToSearch = senderInfo.jid; 
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(
                '❌ *Anda bukan agent terdaftar.*\n\n' +
                'Untuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n' +
                '📞 Hubungi admin untuk registrasi.'
            );
        }
        
        // Get agent inventory
        const inventory = agentVoucherManager.getAgentInventory(agentCred.agentId);
        const stats = agentVoucherManager.getAgentVoucherStats(agentCred.agentId);
        
        // Build message
        let message = `📦 *INVENTORY VOUCHER AGENT*\n\n`;
        message += `Agent: ${inventory.agentName || 'N/A'}\n\n`;
        message += `📊 *SUMMARY:*\n`;
        message += `• Total Stok: ${inventory.totalStok} voucher\n`;
        message += `• Total Terjual: ${inventory.totalTerjual} voucher\n`;
        message += `• Total Profit: ${formatCurrency(inventory.totalProfit)}\n\n`;
        
        if (inventory.inventory.length === 0) {
            message += `❌ Belum ada voucher di inventory.\n\n`;
            message += `Ketik *beli voucher reseller* untuk membeli voucher.`;
        } else {
            message += `📋 *DETAIL VOUCHER:*\n\n`;
            
            inventory.inventory.forEach((item, index) => {
                message += `${index + 1}. *${item.voucherProfileName}*\n`;
                message += `   • Stok: ${item.stok}\n`;
                message += `   • Terjual: ${item.terjual}\n`;
                message += `   • Profit: ${formatCurrency(item.totalProfit)}\n`;
                message += `   • Harga Reseller: ${formatCurrency(item.hargaReseller)}\n`;
                message += `   • Harga Jual: ${formatCurrency(item.hargaJual)}\n\n`;
            });
        }
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleAgentCheckInventory:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle agent purchase history
 */
async function handleAgentPurchaseHistory(msg, sender, reply, raf = null) {
    try {
        // Use extractSenderInfo to get canonical JID/phone
        const senderInfo = extractSenderInfo(msg);
        const phoneNumberToSearch = senderInfo.jid; 
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(
                '❌ *Anda bukan agent terdaftar.*\n\n' +
                'Untuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n' +
                '📞 Hubungi admin untuk registrasi.'
            );
        }
        
        // Get purchase history (last 10)
        const purchases = agentVoucherManager.getPurchaseHistory(agentCred.agentId, 10);
        
        if (purchases.length === 0) {
            return await reply(
                '📋 *RIWAYAT PEMBELIAN VOUCHER*\n\n' +
                'Belum ada riwayat pembelian voucher.\n\n' +
                'Ketik *beli voucher reseller* untuk membeli voucher.'
            );
        }
        
        // Build message
        let message = `📋 *RIWAYAT PEMBELIAN VOUCHER*\n\n`;
        message += `Total: ${purchases.length} pembelian terakhir\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        purchases.forEach((purchase, index) => {
            const date = new Date(purchase.created_at).toLocaleString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const statusIcon = purchase.status === 'completed' ? '✅' : 
                              purchase.status === 'pending' ? '⏳' : 
                              purchase.status === 'cancelled' ? '❌' : '❓';
            
            message += `${index + 1}. ${statusIcon} *${purchase.voucherProfileName}*\n`;
            message += `   • Quantity: ${purchase.quantity} voucher\n`;
            message += `   • Harga: ${formatCurrency(purchase.totalHarga)}\n`;
            message += `   • Payment: ${purchase.paymentMethod}\n`;
            message += `   • Status: ${purchase.status}\n`;
            message += `   • Tanggal: ${date}\n\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `Ketik *beli voucher reseller* untuk membeli voucher baru.`;
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleAgentPurchaseHistory:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

/**
 * Handle agent sales history
 */
async function handleAgentSalesHistory(msg, sender, reply, raf = null) {
    try {
        // Use extractSenderInfo to get canonical JID/phone
        const senderInfo = extractSenderInfo(msg);
        const phoneNumberToSearch = senderInfo.jid; 
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(
                '❌ *Anda bukan agent terdaftar.*\n\n' +
                'Untuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n' +
                '📞 Hubungi admin untuk registrasi.'
            );
        }
        
        // Get sales history (last 10)
        const sales = agentVoucherManager.getSalesHistory(agentCred.agentId, 10);
        
        if (sales.length === 0) {
            return await reply(
                '📋 *RIWAYAT PENJUALAN VOUCHER*\n\n' +
                'Belum ada riwayat penjualan voucher.\n\n' +
                'Ketik *jual voucher* untuk menjual voucher ke customer.'
            );
        }
        
        // Calculate totals
        const totalSales = sales.length;
        const totalRevenue = sales.reduce((sum, s) => sum + s.hargaJual, 0);
        const totalProfit = sales.reduce((sum, s) => sum + s.profit, 0);
        
        // Build message
        let message = `📋 *RIWAYAT PENJUALAN VOUCHER*\n\n`;
        message += `Total: ${totalSales} penjualan terakhir\n`;
        message += `Total Revenue: ${formatCurrency(totalRevenue)}\n`;
        message += `Total Profit: ${formatCurrency(totalProfit)}\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        sales.forEach((sale, index) => {
            const date = new Date(sale.created_at).toLocaleString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const statusIcon = sale.status === 'completed' ? '✅' : 
                              sale.status === 'pending' ? '⏳' : 
                              sale.status === 'cancelled' ? '❌' : '❓';
            
            message += `${index + 1}. ${statusIcon} *${sale.voucherProfileName}*\n`;
            message += `   • Customer: ${sale.customerName}\n`;
            message += `   • Harga Jual: ${formatCurrency(sale.hargaJual)}\n`;
            message += `   • Profit: ${formatCurrency(sale.profit)}\n`;
            message += `   • Payment: ${sale.paymentMethod}\n`;
            message += `   • Tanggal: ${date}\n\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `Ketik *jual voucher* untuk menjual voucher ke customer.`;
        
        await reply(message);
        
    } catch (error) {
        logger.error('Error in handleAgentSalesHistory:', error);
        await reply('❌ Terjadi kesalahan. Silakan coba lagi.');
    }
}

module.exports = {
    handleAgentPurchaseVoucher,
    handleAgentVoucherPurchaseConversation,
    handleAgentSellVoucher,
    handleAgentVoucherSaleConversation,
    handleAgentCheckInventory,
    handleAgentPurchaseHistory,
    handleAgentSalesHistory
};

