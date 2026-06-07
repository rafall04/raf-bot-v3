"use strict";

/**
 * Header Doc
 * Purpose: Menangani pembelian, penjualan, dan histori voucher agent lewat bot WhatsApp.
 * Caller: Dispatcher intent bot dan flow percakapan agent voucher.
 * Deps: Manager voucher/agent/transaksi, `../../lib/logger`, `../../lib/jid-utils`, `../../lib/whatsapp-gateway`, dan `../../lib/whatsapp-delivery-service`.
 * MainFuncs: `handleAgentPurchaseVoucher`, `handleAgentVoucherPurchaseConversation`, `handleAgentSellVoucher`, `handleAgentVoucherSaleConversation`, `handleAgentCheckInventory`, `handleAgentPurchaseHistory`, `handleAgentSalesHistory`.
 * SideEffects: Membaca/mengubah state percakapan, transaksi voucher, dan mengirim hasil voucher ke customer/agent.
 */

const agentVoucherManager = require('../../lib/agent-voucher-manager');
const agentManager = require('../../lib/agent-manager');
const agentTransactionManager = require('../../lib/agent-transaction-manager');
const { getVoucherProfiles } = require('../../lib/voucher-manager');
const { logger } = require('../../lib/logger');
const { extractSenderInfo } = require('../../lib/jid-utils');
const { getSocket } = require('../../lib/whatsapp-gateway');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
const { getUserState, setUserState, deleteUserState, format } = require('./conversation-handler');

function renderResponseTemplate(key, fallback, data = {}) {
    const rendered = format(key, data);
    return rendered && rendered.trim() ? rendered : fallback;
}

/**
 * Helper function to extract real phone number from @lid format
 */
async function extractPhoneFromLid(sender, msg, raf = null) {
    if (!sender || !sender.endsWith('@lid')) {
        return sender;
    }
    
    if (msg) {
        const senderInfo = extractSenderInfo(msg, false);
        if (senderInfo.phoneNumber) {
            return `${senderInfo.phoneNumber}@s.whatsapp.net`;
        }
    }
    
    const socket = raf || getSocket();
    if (socket && socket.signalRepository) {
        try {
            if (socket.signalRepository.lidMapping && socket.signalRepository.lidMapping.getPNForLID) {
                const phoneNumber = await socket.signalRepository.lidMapping.getPNForLID(sender);
                if (phoneNumber) {
                    return phoneNumber;
                }
            }
        } catch (_error) {
            // Silent fail
        }
    }
    
    return sender;
}

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
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(renderResponseTemplate(
                'agent_voucher_agent_not_registered',
                '❌ *Anda bukan agent terdaftar.*\n\nUntuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n📞 Hubungi admin untuk registrasi.'
            ));
        }
        
        // Get agent info
        const agent = agentManager.getAgentById(agentCred.agentId);
        if (!agent) {
            return await reply(renderResponseTemplate(
                'agent_voucher_agent_not_found',
                '❌ Data agent tidak ditemukan.'
            ));
        }
        
        // Get voucher profiles
        const profiles = getVoucherProfiles();
        
        if (profiles.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_voucher_empty_stock',
                '❌ Maaf, tidak ada voucher yang tersedia saat ini.'
            ));
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
        
        message += renderResponseTemplate(
            'agent_voucher_purchase_prompt',
            `Ketik *nomor* untuk memilih (contoh: 1)\nKetik *batal* untuk membatalkan`
        );
        
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_invalid_choice',
                `⚠️ *Nomor tidak valid!*\n\nSilakan pilih nomor antara 1-${userState.profiles.length}\nAtau ketik *batal* untuk membatalkan`,
                { maxChoice: userState.profiles.length }
            ));
        }
        
        const selectedProfile = userState.profiles[selectedNumber - 1];
        const hargaReseller = parseInt(selectedProfile.hargaReseller || selectedProfile.hargavc);
        const hargaJual = parseInt(selectedProfile.hargavc);
        const margin = parseInt(selectedProfile.margin || (hargaJual - hargaReseller));
        
        // Get current stock
        const inventory = agentVoucherManager.getAgentInventory(userState.agentId);
        const inventoryItem = inventory.inventory.find(item => item.voucherProfileId === selectedProfile.prof);
        const currentStok = inventoryItem ? inventoryItem.stok : 0;
        
        const message = renderResponseTemplate(
            'agent_voucher_purchase_quantity_prompt',
            `✅ *${selectedProfile.namavc} Dipilih*\n\n• Harga Reseller: ${formatCurrency(hargaReseller)}\n• Harga Jual: ${formatCurrency(hargaJual)}\n• Margin: ${formatCurrency(margin)}\n• Stok Saat Ini: ${currentStok}\n\nBerapa jumlah voucher yang ingin dibeli?\n(Min: 1, Max: 100)\n\nKetik *batal* untuk membatalkan`,
            {
                voucherName: selectedProfile.namavc,
                hargaReseller: formatCurrency(hargaReseller),
                hargaJual: formatCurrency(hargaJual),
                margin: formatCurrency(margin),
                currentStock: currentStok,
                maxQuantity: 100
            }
        );
        
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_invalid_quantity_purchase',
                `⚠️ *Jumlah tidak valid!*\n\nJumlah voucher harus antara 1-100\nAtau ketik *batal* untuk membatalkan`,
                { maxQuantity: 100 }
            ));
        }
        
        const totalHarga = userState.hargaReseller * quantity;
        
        // Get current stock
        const inventory = agentVoucherManager.getAgentInventory(userState.agentId);
        const inventoryItem = inventory.inventory.find(item => item.voucherProfileId === userState.selectedProfile.prof);
        const currentStok = inventoryItem ? inventoryItem.stok : 0;
        const newStok = currentStok + quantity;
        const message = renderResponseTemplate(
            'agent_voucher_purchase_payment_prompt',
            `📊 *RINGKASAN PEMBELIAN*\n\nVoucher: ${userState.selectedProfile.namavc}\nQuantity: ${quantity} voucher\nHarga Reseller: ${formatCurrency(userState.hargaReseller)}/voucher\nTotal Harga: ${formatCurrency(totalHarga)}\n\nStok Setelah Pembelian: ${newStok}\n\nPilih metode pembayaran:\n1. Saldo Agent\n2. Cash (via agent transaction)\n3. Transfer (via agent transaction)\n\nKetik *nomor* untuk memilih\nKetik *batal* untuk membatalkan`,
            {
                voucherName: userState.selectedProfile.namavc,
                quantity,
                hargaReseller: formatCurrency(userState.hargaReseller),
                totalHarga: formatCurrency(totalHarga),
                newStock: newStok
            }
        );
        
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
    }
}

/**
 * Handle state: AGENT_VOUCHER_PURCHASE_PAYMENT - Agent selects payment method
 */
async function handlePurchasePayment(msg, sender, reply, chats, _raf = null) {
    try {
        const userState = getUserState(sender);
        const paymentChoice = parseInt(chats.trim());
        
        if (isNaN(paymentChoice) || paymentChoice < 1 || paymentChoice > 3) {
            return await reply(renderResponseTemplate(
                'agent_voucher_invalid_payment_choice',
                `⚠️ *Pilihan tidak valid!*\n\nSilakan pilih nomor 1-3\nAtau ketik *batal* untuk membatalkan`
            ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_purchase_failed',
                `❌ *GAGAL MEMBELI VOUCHER*\n\n${result.message}`,
                { reason: result.message }
            ));
        }
        
        // Clear state
        deleteUserState(sender);
        
        let message;
        if (paymentMethod === 'saldo') {
            message = renderResponseTemplate(
                'agent_voucher_purchase_success_saldo',
                `✅ *VOUCHER BERHASIL DIBELI!*\n\nVoucher: ${userState.selectedProfile.namavc}\nQuantity: ${userState.quantity} voucher\nTotal Harga: ${formatCurrency(userState.totalHarga)}\nMetode Pembayaran: ${paymentMethodNames[paymentMethod]}\n\nVoucher sudah ditambahkan ke inventory Anda.\nStok saat ini: ${result.inventory.totalStok} voucher\n\nKetik *stok voucher* untuk melihat inventory lengkap.`,
                {
                    voucherName: userState.selectedProfile.namavc,
                    quantity: userState.quantity,
                    totalHarga: formatCurrency(userState.totalHarga),
                    paymentMethodName: paymentMethodNames[paymentMethod],
                    currentStock: result.inventory.totalStok
                }
            );
        } else {
            message = renderResponseTemplate(
                'agent_voucher_purchase_success_pending',
                `✅ *VOUCHER BERHASIL DIBELI!*\n\nVoucher: ${userState.selectedProfile.namavc}\nQuantity: ${userState.quantity} voucher\nTotal Harga: ${formatCurrency(userState.totalHarga)}\nMetode Pembayaran: ${paymentMethodNames[paymentMethod]}\n\n⚠️ *MENUNGGU VERIFIKASI ADMIN*\n\nTransaksi Anda sedang menunggu verifikasi admin.\nVoucher akan ditambahkan ke inventory setelah pembayaran diverifikasi.\n\nTransaction ID: ${result.purchase.agentTransactionId || result.purchase.id}\nKetik *transaksi* untuk melihat status transaksi.`,
                {
                    voucherName: userState.selectedProfile.namavc,
                    quantity: userState.quantity,
                    totalHarga: formatCurrency(userState.totalHarga),
                    paymentMethodName: paymentMethodNames[paymentMethod],
                    transactionId: result.purchase.agentTransactionId || result.purchase.id
                }
            );
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
        await reply(renderResponseTemplate(
            'agent_voucher_purchase_process_error',
            '❌ Terjadi kesalahan saat memproses pembelian. Silakan coba lagi.'
        ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_cancelled',
                '✅ Permintaan dibatalkan. Ada lagi yang bisa saya bantu?'
            ));
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
async function handleAgentSellVoucher(msg, sender, reply, temp, raf = null, users = [], _global = null) {
    try {
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(renderResponseTemplate(
                'agent_voucher_agent_not_registered',
                '❌ *Anda bukan agent terdaftar.*\n\nUntuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n📞 Hubungi admin untuk registrasi.'
            ));
        }
        
        // Get agent info
        const agent = agentManager.getAgentById(agentCred.agentId);
        if (!agent) {
            return await reply(renderResponseTemplate(
                'agent_voucher_agent_not_found',
                '❌ Data agent tidak ditemukan.'
            ));
        }
        
        // Get agent inventory
        const inventory = agentVoucherManager.getAgentInventory(agentCred.agentId);
        
        // Filter inventory items that have stock
        const availableVouchers = inventory.inventory.filter(item => item.stok > 0);
        
        if (availableVouchers.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_voucher_empty_stock',
                '❌ *Stok Voucher Kosong*\n\nAnda tidak memiliki stok voucher yang tersedia.\n\nKetik *beli voucher reseller* untuk membeli voucher terlebih dahulu.'
            ));
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
        
        message += renderResponseTemplate(
            'agent_voucher_sale_prompt',
            `Ketik *nomor* untuk memilih (contoh: 1)\nKetik *batal* untuk membatalkan`
        );
        
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_invalid_choice',
                `⚠️ *Nomor tidak valid!*\n\nSilakan pilih nomor antara 1-${userState.availableVouchers.length}\nAtau ketik *batal* untuk membatalkan`,
                { maxChoice: userState.availableVouchers.length }
            ));
        }
        
        const selectedVoucher = userState.availableVouchers[selectedNumber - 1];
        
        const message = renderResponseTemplate(
            'agent_voucher_sale_quantity_prompt',
            `✅ *${selectedVoucher.voucherProfileName} Dipilih*\n\n• Harga Jual: ${formatCurrency(selectedVoucher.hargaJual)}\n• Stok Tersedia: ${selectedVoucher.stok}\n• Profit: ${formatCurrency(selectedVoucher.hargaJual - selectedVoucher.hargaReseller)}/voucher\n\nBerapa voucher yang ingin dijual?\n(Maksimal: ${selectedVoucher.stok} voucher)\n\nKetik *batal* untuk membatalkan`,
            {
                voucherName: selectedVoucher.voucherProfileName,
                hargaJual: formatCurrency(selectedVoucher.hargaJual),
                currentStock: selectedVoucher.stok,
                profit: formatCurrency(selectedVoucher.hargaJual - selectedVoucher.hargaReseller)
            }
        );
        
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_invalid_quantity_sale',
                `⚠️ *Jumlah tidak valid!*\n\nSilakan masukkan jumlah voucher yang ingin dijual (minimal 1)\nAtau ketik *batal* untuk membatalkan`
            ));
        }
        
        if (quantity > userState.selectedVoucher.stok) {
            return await reply(renderResponseTemplate(
                'agent_voucher_insufficient_stock',
                `⚠️ *Stok tidak mencukupi!*\n\nStok tersedia: ${userState.selectedVoucher.stok} voucher\nAnda meminta: ${quantity} voucher\n\nSilakan masukkan jumlah yang lebih kecil atau ketik *batal* untuk membatalkan`,
                { currentStock: userState.selectedVoucher.stok, requestedQuantity: quantity }
            ));
        }
        
        // If customer already detected from reply, go straight to confirm
        if (userState.customerId) {
            const message = renderResponseTemplate(
                'agent_voucher_sale_summary_confirm',
                `📋 *RINGKASAN PENJUALAN*\n\nVoucher: ${userState.selectedVoucher.voucherProfileName}\nJumlah: ${quantity} voucher\nHarga Jual: ${formatCurrency(userState.selectedVoucher.hargaJual)}/voucher\nTotal: ${formatCurrency(userState.selectedVoucher.hargaJual * quantity)}\n\nCustomer: ${userState.customerName}\nNomor: ${userState.customerId.split('@')[0]}\n\nKonfirmasi penjualan? (ketik: ya)\nAtau ketik *batal* untuk membatalkan`,
                {
                    voucherName: userState.selectedVoucher.voucherProfileName,
                    quantity,
                    hargaJual: formatCurrency(userState.selectedVoucher.hargaJual),
                    totalHarga: formatCurrency(userState.selectedVoucher.hargaJual * quantity),
                    customerName: userState.customerName,
                    customerPhone: userState.customerId.split('@')[0]
                }
            );
            
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
            const message = renderResponseTemplate(
                'agent_voucher_customer_phone_prompt',
                `✅ *Jumlah: ${quantity} voucher*\n\nMasukkan nomor WhatsApp customer:\n(Contoh: 6285233047094 atau reply pesan customer)\n\nKetik *batal* untuk membatalkan`,
                { quantity }
            );
            
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_invalid_phone',
                `⚠️ *Format nomor tidak valid!*\n\nSilakan masukkan nomor WhatsApp yang valid\n(Contoh: 6285233047094 atau 085233047094)\nAtau ketik *batal* untuk membatalkan`
            ));
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
        const message = renderResponseTemplate(
            'agent_voucher_sale_summary_confirm',
            `📋 *RINGKASAN PENJUALAN*\n\nVoucher: ${userState.selectedVoucher.voucherProfileName}\nJumlah: ${quantity} voucher\nHarga Jual: ${formatCurrency(userState.selectedVoucher.hargaJual)}/voucher\nTotal: ${formatCurrency(userState.selectedVoucher.hargaJual * quantity)}\n\nCustomer: ${customerName}\nNomor: ${normalizedPhone}\n\nKonfirmasi penjualan? (ketik: ya)\nAtau ketik *batal* untuk membatalkan`,
            {
                voucherName: userState.selectedVoucher.voucherProfileName,
                quantity,
                hargaJual: formatCurrency(userState.selectedVoucher.hargaJual),
                totalHarga: formatCurrency(userState.selectedVoucher.hargaJual * quantity),
                customerName,
                customerPhone: normalizedPhone
            }
        );
        
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
    }
}

/**
 * Handle state: AGENT_VOUCHER_SALE_CONFIRM - Agent confirms sale
 */
async function handleSaleConfirm(msg, sender, reply, chats, _raf = null, global = null) {
    let userState;
    try {
        userState = getUserState(sender);
        const userReply = chats.toLowerCase().trim();
        
        if (userReply !== 'ya' && userReply !== 'y' && userReply !== 'yes' && userReply !== 'ok' && userReply !== 'oke') {
            return await reply(renderResponseTemplate(
                'agent_voucher_invalid_confirmation',
                `⚠️ *Konfirmasi tidak valid!*\n\nKetik *ya* untuk konfirmasi penjualan\nAtau ketik *batal* untuk membatalkan`
            ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_sale_failed',
                `❌ *GAGAL MENJUAL VOUCHER*\n\n${result.message}`,
                { reason: result.message }
            ));
        }
        
        // Clear state
        deleteUserState(sender);
        
        // Get WiFi name from global config if available
        const wifiName = (global && global.config && global.config.wifi_name) ? global.config.wifi_name : 'RAF NET';
        
        // Send all vouchers to customer
        const voucherCodes = result.voucherCodes || [result.voucherCode];
        const quantitySold = result.quantity || quantity;
        
        let voucherCredentials = '';
        if (quantitySold === 1) {
            // Single voucher format
            voucherCredentials += `🔑 *Kredensial WiFi:*\n`;
            voucherCredentials += `Username: \`${voucherCodes[0].username}\`\n`;
            voucherCredentials += `Password: \`${voucherCodes[0].password}\`\n\n`;
        } else {
            // Multiple vouchers format
            voucherCredentials += `🔑 *Kredensial WiFi (${quantitySold} voucher):*\n\n`;
            voucherCodes.forEach((code, index) => {
                voucherCredentials += `*Voucher ${index + 1}:*\n`;
                voucherCredentials += `Username: \`${code.username}\`\n`;
                voucherCredentials += `Password: \`${code.password}\`\n\n`;
            });
        }
        const customerMessage = renderResponseTemplate(
            'agent_voucher_customer_delivery_message',
            `🎫 *VOUCHER DARI ${userState.agentName.toUpperCase()}*\n\nTerima kasih telah membeli voucher!\n\n📋 *Detail Pembelian:*\n• Voucher: ${userState.selectedVoucher.voucherProfileName}\n• Durasi: ${userState.selectedVoucher.duration}\n• Jumlah: ${quantitySold} voucher\n• Harga: ${formatCurrency(userState.selectedVoucher.hargaJual)}/voucher\n• Total: ${formatCurrency(userState.selectedVoucher.hargaJual * quantitySold)}\n\n${voucherCredentials}💡 *Cara Pakai:*\n1. Hubungkan ke WiFi ${wifiName}\n2. Masukkan username dan password di atas\n3. Nikmati internet Anda!\n\n_Selamat menggunakan!_`,
            {
                agentName: userState.agentName.toUpperCase(),
                voucherName: userState.selectedVoucher.voucherProfileName,
                duration: userState.selectedVoucher.duration,
                quantity: quantitySold,
                hargaJual: formatCurrency(userState.selectedVoucher.hargaJual),
                totalHarga: formatCurrency(userState.selectedVoucher.hargaJual * quantitySold),
                voucherCredentials,
                wifiName
            }
        );
        
        // Send to customer via WhatsApp
        try {
            const delivery = await sendMessage(userState.customerId, { text: customerMessage });
            if (!delivery.sent) {
                logger.warn('Cannot send voucher to customer - delivery not sent', {
                    customerId: userState.customerId,
                    errorCode: delivery.errorCode,
                    warning: delivery.warning || null
                });
            } else {
                logger.info('Voucher message sent to customer successfully', {
                    customerId: userState.customerId,
                    quantity: quantitySold
                });
            }
        } catch (error) {
            console.error('[SEND_MESSAGE_ERROR]', {
                customerId: userState.customerId,
                error: error.message
            });
            logger.error('Error sending voucher to customer:', error);
            logger.error('Error details:', {
                message: error.message,
                stack: error.stack,
                customerId: userState.customerId
            });
            // Continue even if notification fails - sale is already completed
        }
        
        // Send confirmation to agent
        const agentMessage = renderResponseTemplate(
            'agent_voucher_sale_success_agent',
            `✅ *VOUCHER BERHASIL DIJUAL!*\n\nCustomer: ${userState.customerName}\nVoucher: ${userState.selectedVoucher.voucherProfileName}\nJumlah: ${quantitySold} voucher\nHarga Jual: ${formatCurrency(userState.selectedVoucher.hargaJual)}/voucher\nTotal: ${formatCurrency(userState.selectedVoucher.hargaJual * quantitySold)}\nProfit: ${formatCurrency(result.totalProfit || (result.sale.profit * quantitySold))}\n\nVoucher sudah dikirim ke customer.\nStok saat ini: ${result.inventory.totalStok} voucher\n\nKetik *stok voucher* untuk melihat inventory lengkap.`,
            {
                customerName: userState.customerName,
                voucherName: userState.selectedVoucher.voucherProfileName,
                quantity: quantitySold,
                hargaJual: formatCurrency(userState.selectedVoucher.hargaJual),
                totalHarga: formatCurrency(userState.selectedVoucher.hargaJual * quantitySold),
                profit: formatCurrency(result.totalProfit || (result.sale.profit * quantitySold)),
                currentStock: result.inventory.totalStok
            }
        );
        
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
        await reply(renderResponseTemplate(
            'agent_voucher_sale_process_error',
            `❌ Terjadi kesalahan saat memproses penjualan: ${error.message}\n\nSilakan coba lagi atau hubungi admin.`,
            { errorMessage: error.message }
        ));
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
            return await reply(renderResponseTemplate(
                'agent_voucher_cancelled',
                '✅ Permintaan dibatalkan. Ada lagi yang bisa saya bantu?'
            ));
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
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(renderResponseTemplate(
                'agent_voucher_agent_not_registered',
                '❌ *Anda bukan agent terdaftar.*\n\nUntuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n📞 Hubungi admin untuk registrasi.'
            ));
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
            message += renderResponseTemplate(
                'agent_voucher_inventory_empty',
                `❌ Belum ada voucher di inventory.\n\nKetik *beli voucher reseller* untuk membeli voucher.`
            );
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
    }
}

/**
 * Handle agent purchase history
 */
async function handleAgentPurchaseHistory(msg, sender, reply, raf = null) {
    try {
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(renderResponseTemplate(
                'agent_voucher_agent_not_registered',
                '❌ *Anda bukan agent terdaftar.*\n\nUntuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n📞 Hubungi admin untuk registrasi.'
            ));
        }
        
        // Get purchase history (last 10)
        const purchases = agentVoucherManager.getPurchaseHistory(agentCred.agentId, 10);
        
        if (purchases.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_voucher_purchase_history_empty',
                '📋 *RIWAYAT PEMBELIAN VOUCHER*\n\nBelum ada riwayat pembelian voucher.\n\nKetik *beli voucher reseller* untuk membeli voucher.'
            ));
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
    }
}

/**
 * Handle agent sales history
 */
async function handleAgentSalesHistory(msg, sender, reply, raf = null) {
    try {
        // Extract real phone number from @lid if needed
        const phoneNumberToSearch = await extractPhoneFromLid(sender, msg, raf);
        
        // Get agent by WhatsApp number
        const agentCred = agentTransactionManager.getAgentByWhatsapp(phoneNumberToSearch);
        
        if (!agentCred) {
            return await reply(renderResponseTemplate(
                'agent_voucher_agent_not_registered',
                '❌ *Anda bukan agent terdaftar.*\n\nUntuk menggunakan fitur ini, nomor WhatsApp Anda harus terdaftar sebagai agent.\n\n📞 Hubungi admin untuk registrasi.'
            ));
        }
        
        // Get sales history (last 10)
        const sales = agentVoucherManager.getSalesHistory(agentCred.agentId, 10);
        
        if (sales.length === 0) {
            return await reply(renderResponseTemplate(
                'agent_voucher_sales_history_empty',
                '📋 *RIWAYAT PENJUALAN VOUCHER*\n\nBelum ada riwayat penjualan voucher.\n\nKetik *jual voucher* untuk menjual voucher ke customer.'
            ));
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
        await reply(renderResponseTemplate(
            'agent_voucher_generic_error',
            '❌ Terjadi kesalahan. Silakan coba lagi.'
        ));
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

