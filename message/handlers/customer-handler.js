"use strict";

/**
 * Customer Handler
 * Menangani fitur-fitur untuk pelanggan
 */

const convertRupiah = require('rupiah-format');
const { getUserState: _getUserState, setUserState, deleteUserState: _deleteUserState, mess } = require('./conversation-handler');

/**
 * Handle check bill request
 * @param {Object} params - Parameters
 * @returns {Object} Response object
 */
function handleCheckBill({ user, pushname }) {
    try {
        if (!user) {
            return {
                success: false,
                message: mess.userNotRegister
            };
        }

        const packageName = user.subscription || user.package || 'N/A';
        
        // Get package info and check if whitelist
        let packagePrice = 'N/A';
        let isWhitelistUser = false;
        if (global.packages && Array.isArray(global.packages)) {
            const packageData = global.packages.find(p => p.name === packageName);
            if (packageData) {
                if (packageData.price) {
                    packagePrice = convertRupiah.convert(packageData.price);
                }
                isWhitelistUser = packageData.whitelist === true;
            }
        }
        
        // For whitelist users, always show as "Gratis" (free)
        const paymentStatus = isWhitelistUser ? '🆓 Gratis' : (user.paid ? '✅ Sudah Bayar' : '❌ Belum Bayar');

        let message = `📋 *Informasi Tagihan Anda*\n\n`;
        message += `Halo *${pushname}*,\n\n`;
        message += `👤 *Nama:* ${user.name}\n`;
        message += `📦 *Paket:* ${packageName}\n`;
        message += `💰 *Biaya:* ${isWhitelistUser ? 'Gratis' : packagePrice}\n`;
        message += `📅 *Status Pembayaran:* ${paymentStatus}\n`;

        // Skip payment warning for whitelist users (they are free)
        if (!isWhitelistUser && !user.paid) {
            message += `\n⚠️ *Perhatian:*\n`;
            message += `Tagihan Anda belum dibayar. Mohon segera melakukan pembayaran untuk menghindari pemutusan layanan.\n\n`;
            message += `💳 *Cara Pembayaran:*\n`;
            message += `• Transfer Bank\n`;
            message += `• E-Wallet (Dana/OVO/GoPay)\n`;
            message += `• Datang langsung ke kantor\n\n`;
            message += `Hubungi admin jika sudah melakukan pembayaran.`;
        } else if (isWhitelistUser) {
            message += `\n🎁 Anda menggunakan paket gratis. Terima kasih telah menggunakan layanan kami!`;
        } else {
            message += `\n✅ Tagihan Anda sudah lunas. Terima kasih atas pembayarannya!`;
        }

        message += `\n\n_Update: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}_`;

        return {
            success: true,
            message: message
        };
    } catch (error) {
        console.error('[CHECK_BILL_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal mengecek tagihan. Silakan coba lagi atau hubungi admin.'
        };
    }
}

/**
 * Handle check package info
 * @param {Object} params - Parameters
 * @returns {Object} Response object
 */
function handleCheckPackage({ user, pushname }) {
    try {
        if (!user) {
            return {
                success: false,
                message: mess.userNotRegister
            };
        }

        const packageName = user.subscription || user.package || 'N/A';
        
        // Get package details
        let packageDetails = null;
        if (global.packages && Array.isArray(global.packages)) {
            packageDetails = global.packages.find(p => p.name === packageName);
        }

        let message = `📦 *Informasi Paket Anda*\n\n`;
        message += `Halo *${pushname}*,\n\n`;
        message += `👤 *Nama:* ${user.name}\n`;
        message += `📦 *Paket Saat Ini:* ${packageName}\n`;

        if (packageDetails) {
            message += `💰 *Harga:* ${convertRupiah.convert(packageDetails.price)}\n`;
            if (packageDetails.profile) {
                message += `⚡ *Kecepatan:* ${packageDetails.profile}\n`;
            }
            if (packageDetails.description) {
                message += `📝 *Deskripsi:* ${packageDetails.description}\n`;
            }
        }

        if (user.device_id) {
            message += `🔧 *Device ID:* ${user.device_id}\n`;
        }

        message += `\n📞 *Butuh upgrade atau downgrade paket?*\n`;
        message += `Silakan hubungi admin untuk perubahan paket.\n`;

        message += `\n_Update: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}_`;

        return {
            success: true,
            message: message
        };
    } catch (error) {
        console.error('[CHECK_PACKAGE_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal mengecek informasi paket. Silakan coba lagi atau hubungi admin.'
        };
    }
}

/**
 * Handle payment confirmation
 * @param {Object} params - Parameters
 * @returns {Object} Response object
 */
function handlePaymentConfirmation({ sender, user, pushname, paymentMethod, amount }) {
    try {
        if (!user) {
            return {
                success: false,
                message: mess.userNotRegister
            };
        }

        // Set conversation state for payment confirmation
        setUserState(sender, {
            step: 'PAYMENT_CONFIRMATION',
            flow: 'customer',
            user: user,
            paymentMethod: paymentMethod,
            amount: amount,
            context: {
                userId: user.id
            }
        });

        let message = `💳 *Konfirmasi Pembayaran*\n\n`;
        message += `Halo *${pushname}*,\n\n`;
        message += `Terima kasih telah melakukan pembayaran. Untuk mempercepat proses verifikasi, mohon kirimkan bukti pembayaran Anda.\n\n`;
        message += `📸 *Cara mengirim bukti:*\n`;
        message += `1. Screenshot atau foto bukti transfer\n`;
        message += `2. Kirim gambar ke chat ini\n`;
        message += `3. Tunggu konfirmasi dari admin\n\n`;
        message += `⏰ Proses verifikasi maksimal 1x24 jam pada hari kerja.\n\n`;
        message += `Atau ketik *batal* untuk membatalkan.`;

        return {
            success: true,
            message: message
        };
    } catch (error) {
        console.error('[PAYMENT_CONFIRMATION_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal memproses konfirmasi pembayaran. Silakan coba lagi atau hubungi admin.'
        };
    }
}

/**
 * Handle complaint/feedback
 * @param {Object} params - Parameters
 * @returns {Object} Response object
 */
function handleComplaint({ sender, stateSender, user, pushname, complaint }) {
    try {
        if (!user) {
            return {
                success: false,
                message: mess.userNotRegister
            };
        }

        if (!complaint || complaint.trim() === '') {
            // Ask for complaint details.
            // State di-key dengan JID kanonik (stateSender) agar router menemukan state ini
            // saat pelanggan mengirim isi keluhan (anti-mati untuk pengirim @lid).
            setUserState(stateSender || sender, {
                step: 'AWAITING_COMPLAINT',
                flow: 'customer',
                user: user,
                context: {
                    userId: user.id
                }
            });

            return {
                success: true,
                message: `📝 *Sampaikan Keluhan/Saran*\n\nHalo *${pushname}*,\n\nSilakan sampaikan keluhan atau saran Anda. Tim kami akan segera menindaklanjuti.\n\nKetik pesan Anda di bawah ini:`
            };
        }

        // Save complaint (you might want to save this to a database)
        const complaintData = {
            id: Date.now().toString(),
            userId: user.id,
            userName: user.name,
            userPhone: user.phone_number,
            complaint: complaint,
            createdAt: new Date().toISOString(),
            status: 'new'
        };

        // Here you would typically save to database
        // For now, just log it
        console.log('[NEW_COMPLAINT]', complaintData);

        let message = `✅ *Keluhan/Saran Diterima*\n\n`;
        message += `Terima kasih *${pushname}* atas masukan Anda.\n\n`;
        message += `📋 *Detail:*\n`;
        message += `ID: #${complaintData.id}\n`;
        message += `Pesan: ${complaint}\n\n`;
        message += `Tim kami akan segera menindaklanjuti keluhan/saran Anda.\n`;
        message += `Anda akan menerima notifikasi untuk update selanjutnya.\n\n`;
        message += `_Diterima pada: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}_`;

        return {
            success: true,
            message: message
        };
    } catch (error) {
        console.error('[COMPLAINT_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal menyampaikan keluhan/saran. Silakan coba lagi atau hubungi admin.'
        };
    }
}

/**
 * Handle service info request
 * @param {Object} params - Parameters
 * @returns {Object} Response object
 */
function handleServiceInfo() {
    try {
        const companyName = global.config.nama || 'Layanan Kami';
        const botName = global.config.namabot || 'Bot Layanan';
        
        let message = `ℹ️ *Informasi Layanan ${companyName}*\n\n`;
        message += `🏢 *Tentang Kami:*\n`;
        message += `${companyName} adalah penyedia layanan internet terpercaya dengan komitmen memberikan koneksi stabil dan cepat.\n\n`;
        
        message += `📞 *Kontak:*\n`;
        if (global.config.ownerNumber) {
            message += `• WhatsApp: ${global.config.ownerNumber}\n`;
        }
        message += `• Bot Layanan: ${botName}\n\n`;
        
        message += `⏰ *Jam Operasional:*\n`;
        message += `• Senin - Jumat: 08:00 - 17:00\n`;
        message += `• Sabtu: 08:00 - 12:00\n`;
        message += `• Minggu & Hari Libur: Tutup\n\n`;
        
        message += `🔧 *Layanan Kami:*\n`;
        message += `• Internet Fiber Optic\n`;
        message += `• Internet Wireless\n`;
        message += `• Hotspot/WiFi\n`;
        message += `• Technical Support 24/7\n\n`;
        
        message += `💡 *Tips:*\n`;
        message += `• Gunakan menu untuk akses cepat fitur\n`;
        message += `• Laporkan gangguan segera untuk penanganan cepat\n`;
        message += `• Bayar tagihan tepat waktu untuk layanan tanpa gangguan\n\n`;
        
        message += `_${botName} - Siap melayani Anda 24/7_ 🤖`;
        
        return {
            success: true,
            message: message
        };
    } catch (error) {
        console.error('[SERVICE_INFO_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal mengambil informasi layanan. Silakan coba lagi.'
        };
    }
}

module.exports = {
    handleCheckBill,
    handleCheckPackage,
    handlePaymentConfirmation,
    handleComplaint,
    handleServiceInfo
};
