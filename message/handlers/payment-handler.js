"use strict";

/**
 * Payment Request Handler
 * Menangani request perubahan status pembayaran
 */

const axios = require('axios');
const { getUserState: _getUserState, setUserState: _setUserState, deleteUserState: _deleteUserState } = require('./conversation-handler');

/**
 * Handle payment status change request
 * @param {Object} params - Parameters for payment request
 * @returns {Promise<Object>} Response object
 */
async function handlePaymentRequest({ sender: _sender, userTeknisi, targetUser, newStatus, reply: _reply }) {
    try {
        // Validate teknisi permissions
        if (!userTeknisi || userTeknisi.role !== 'teknisi') {
            return {
                success: false,
                message: '❌ Maaf, fitur ini hanya untuk teknisi yang terdaftar.'
            };
        }

        // Validate target user
        if (!targetUser) {
            return {
                success: false,
                message: '❌ Pelanggan tidak ditemukan dalam database.'
            };
        }

        // Check current payment status
        const currentStatus = targetUser.paid ? 'Sudah Bayar' : 'Belum Bayar';
        const requestedStatus = newStatus === 'sudah' ? 'Sudah Bayar' : 'Belum Bayar';

        if (currentStatus === requestedStatus) {
            return {
                success: false,
                message: `⚠️ Status pembayaran pelanggan *${targetUser.name}* sudah *${currentStatus}*. Tidak perlu diubah.`
            };
        }

        // Create payment request
        const requestData = {
            teknisi_id: userTeknisi.id,
            teknisi_name: userTeknisi.name,
            user_id: targetUser.id,
            user_name: targetUser.name,
            user_phone: targetUser.phone_number,
            package_name: targetUser.subscription || targetUser.package,
            current_paid_status: targetUser.paid,
            requested_paid_status: newStatus === 'sudah',
            device_id: targetUser.device_id || null
        };

        // Send request to API
        const response = await axios.post(`http://localhost:${global.config.port || 3100}/api/requests`, requestData);

        if (response.data.success) {
            const message = `✅ *Request Berhasil Dibuat*

📋 *Detail Request:*
• ID Request: ${response.data.requestId}
• Pelanggan: ${targetUser.name}
• Status Saat Ini: ${currentStatus}
• Status Yang Diajukan: ${requestedStatus}

⏳ Request Anda akan diproses oleh admin. Anda akan menerima notifikasi setelah request disetujui atau ditolak.

⚠️ *Penting:* Request akan otomatis dibatalkan jika tidak diproses dalam 7 hari.`;

            return {
                success: true,
                message: message
            };
        } else {
            return {
                success: false,
                message: response.data.message || '❌ Gagal membuat request. Silakan coba lagi.'
            };
        }
    } catch (error) {
        console.error('[PAYMENT_REQUEST_ERROR]', error);
        
        // Handle specific error cases
        if (error.response?.status === 409) {
            const existingRequest = error.response.data.existingRequest;
            if (existingRequest) {
                const createdAt = new Date(existingRequest.created_at).toLocaleString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                return {
                    success: false,
                    message: `⚠️ *Request Sudah Ada*

Anda sudah memiliki request pending untuk pelanggan ini:
• ID Request: ${existingRequest.id}
• Dibuat pada: ${createdAt}
• Status: ${existingRequest.status}

Harap tunggu hingga request sebelumnya diproses atau hubungi admin untuk pembatalan.`
                };
            }
        }

        return {
            success: false,
            message: '❌ Terjadi kesalahan saat membuat request. Silakan coba lagi atau hubungi admin.'
        };
    }
}

/**
 * Check payment request status
 * @param {Object} params - Parameters for checking request
 * @returns {Promise<Object>} Response object
 */
async function checkPaymentRequestStatus({ requestId, teknisiId }) {
    try {
        const response = await axios.get(`http://localhost:${global.config.port || 3100}/api/requests`);
        
        const requests = response.data.filter(r => 
            (!requestId || r.id === requestId) &&
            (!teknisiId || r.teknisi_id === teknisiId)
        );

        if (requests.length === 0) {
            return {
                success: false,
                message: '❌ Tidak ada request yang ditemukan.'
            };
        }

        let message = `📋 *Status Request Pembayaran*\n\n`;
        
        requests.forEach((req, index) => {
            const statusEmoji = req.status === 'pending' ? '⏳' : 
                              req.status === 'approved' ? '✅' : 
                              req.status === 'rejected' ? '❌' : '❓';
            
            const createdAt = new Date(req.created_at).toLocaleString('id-ID', {
                timeZone: 'Asia/Jakarta',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            });

            message += `${index + 1}. ${statusEmoji} *${req.user_name}*\n`;
            message += `   • ID: ${req.id}\n`;
            message += `   • Status: ${req.status}\n`;
            message += `   • Dibuat: ${createdAt}\n`;
            
            if (req.processed_at) {
                const processedAt = new Date(req.processed_at).toLocaleString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                message += `   • Diproses: ${processedAt}\n`;
            }
            
            if (req.processed_by_name) {
                message += `   • Oleh: ${req.processed_by_name}\n`;
            }
            
            message += '\n';
        });

        return {
            success: true,
            message: message
        };
    } catch (error) {
        console.error('[CHECK_REQUEST_STATUS_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal mengambil status request. Silakan coba lagi.'
        };
    }
}

module.exports = {
    handlePaymentRequest,
    checkPaymentRequestStatus
};
