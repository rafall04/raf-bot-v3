"use strict";

/**
 * Report/Ticket Conversation Steps
 * Menangani percakapan multi-step untuk laporan gangguan
 */

const { setUserState, deleteUserState } = require('../conversation-handler');
const fs = require('fs');
const path = require('path');

/**
 * Handle report/ticket conversation steps
 */
async function handleReportSteps({ userState, sender, chats, pushname, reply, setUserState, deleteUserState }) {
    const userReply = chats.toLowerCase().trim();
    
    switch (userState.step) {
        case 'CONFIRM_CANCEL_TICKET': {
            if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                const { ticketIdToCancel } = userState;
                const reportIndex = global.reports.findIndex(r => r.ticketId === ticketIdToCancel);
                
                if (reportIndex !== -1) {
                    global.reports[reportIndex].status = 'dibatalkan';
                    global.reports[reportIndex].cancelledAt = new Date().toISOString();
                    global.reports[reportIndex].cancelledBy = pushname;
                    
                    // Save to file
                    try {
                        const reportsPath = path.join(__dirname, '../../../database/reports.json');
                        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
                    } catch (error) {
                        console.error('[SAVE_REPORT_ERROR]', error);
                    }
                    
                    deleteUserState(sender);
                    
                    return {
                        success: true,
                        message: `✅ Tiket dengan ID *${ticketIdToCancel}* telah dibatalkan.`
                    };
                } else {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: `❌ Tiket dengan ID *${ticketIdToCancel}* tidak ditemukan.`
                    };
                }
            } else if (['tidak', 'no', 'n', 'gak'].includes(userReply)) {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Pembatalan tiket dibatalkan. Tiket tetap aktif.'
                };
            } else {
                return {
                    success: false,
                    message: "Mohon balas dengan *'ya'* untuk membatalkan tiket atau *'tidak'* untuk membatalkan aksi ini."
                };
            }
        }
    }
    
    return {
        success: false,
        message: 'Step tidak dikenali.'
    };
}

module.exports = {
    handleReportSteps
};
                return {
                    success: false,
                    message: "Mohon sebutkan lampu apa saja yang menyala. Contoh: 'Power hijau, PON hijau'"
                };
            }
            
            userState.detail_lampu = lampuResponse;
            
            // Analisis lampu untuk indikasi masalah
            const lampuLower = lampuResponse.toLowerCase();
            if (!userState.indikasi_masalah) {
                if (lampuLower.includes('pon') && lampuLower.includes('merah')) {
                    userState.indikasi_masalah = "🟡 Kemungkinan: Kabel fiber tidak terpasang dengan baik";
                } else if (!lampuLower.includes('wifi') && !lampuLower.includes('wlan')) {
                    userState.indikasi_masalah = "🟡 Kemungkinan: WiFi mati atau tidak aktif";
                } else if (lampuLower.includes('semua hijau')) {
                    userState.indikasi_masalah = "🟢 Lampu normal, kemungkinan masalah di pengaturan atau router";
                }
            }
            
            userState.step = 'LAPOR_GANGGUAN_ASK_DETAIL_TAMBAHAN';
            setUserState(sender, userState);
            
            return {
                success: true,
                message: `📋 *Langkah 5 dari 6*\n━━━━━━━━━━━━━━━\n\n*INFORMASI TAMBAHAN*\n\nApakah ada informasi tambahan yang perlu kami ketahui?\n\n💡 *Contoh info yang membantu:*\n├ Kapan masalah mulai terjadi\n├ Apa yang sedang dilakukan saat error\n├ Pesan error yang muncul\n├ Sudah coba apa saja\n└ Perangkat yang bermasalah\n\n📝 Ketik informasi tambahan atau balas *"tidak"* jika tidak ada.`
            };
        }
        
        case 'LAPOR_GANGGUAN_ASK_DETAIL_TAMBAHAN': {
            const detailTambahan = chats.trim();
            const { keluhan, sudah_reboot, lampu_los, detail_lampu, indikasi_masalah, targetUser } = userState;
            
            if (detailTambahan.toLowerCase() === 'tidak' || detailTambahan.toLowerCase() === 'gak' || detailTambahan.toLowerCase() === 'no') {
                userState.info_tambahan = "Tidak ada informasi tambahan";
            } else {
                userState.info_tambahan = detailTambahan;
            }
            
            userState.step = 'LAPOR_GANGGUAN_CONFIRM';
            setUserState(sender, userState);
            
            const urgencyBadge = lampu_los ? "🔴 *[URGENT]*" : "🟡 *[NORMAL]*";
            const priority = lampu_los ? 'HIGH' : 'MEDIUM';
            const estimasiWaktu = getResponseTimeMessage(priority);
            
            const ringkasan = `📋 *Langkah 6 dari 6*\n━━━━━━━━━━━━━━━\n\n*KONFIRMASI LAPORAN*\n\n${urgencyBadge}\n\n📝 *Ringkasan Laporan:*\n├ *Keluhan:* ${keluhan}\n├ *Sudah Reboot:* ${sudah_reboot ? 'Ya ✅' : 'Belum ❌'}\n├ *Lampu LOS:* ${lampu_los ? 'Merah Menyala 🔴' : 'Tidak Ada ✅'}\n├ *Detail Lampu:* ${detail_lampu}\n└ *Info Tambahan:* ${userState.info_tambahan}\n\n🔍 *Diagnosis Sistem:*\n${indikasi_masalah || '⚪ Perlu pemeriksaan lebih lanjut'}\n\n⏱️ *Estimasi Penanganan:* ${estimasiWaktu}\n\n✅ Kirim laporan ini ke tim teknisi?\n\nBalas:\n→ *Ya* untuk mengirim\n→ *Tidak* untuk membatalkan`;
            
            return {
                success: true,
                message: ringkasan
            };
        }
        
        case 'LAPOR_GANGGUAN_CONFIRM': {
            if (userReply === 'ya' || userReply === 'yes' || userReply === 'y' || userReply === 'iya') {
                const { keluhan, sudah_reboot, lampu_los, detail_lampu, indikasi_masalah, info_tambahan, targetUser } = userState;
                
                // Generate ticket ID
                const ticketId = generateTicketId();
                
                // Create report object
                const newReport = {
                    ticketId: ticketId,
                    pelangganUserId: targetUser.id, // IMPORTANT: User ID untuk filter by user
                    pelangganId: sender, // WhatsApp JID untuk kirim message
                    pelangganName: targetUser.name,
                    pelangganPhone: targetUser.phone_number,
                    pelangganAddress: targetUser.address || 'N/A',
                    pelangganPackage: targetUser.subscription || targetUser.package || 'N/A',
                    laporanText: keluhan,
                    sudah_reboot: sudah_reboot,
                    lampu_los: lampu_los,
                    detail_lampu: detail_lampu,
                    info_tambahan: info_tambahan,
                    indikasi_masalah: indikasi_masalah,
                    status: 'baru',
                    createdAt: new Date().toISOString(),
                    notes: indikasi_masalah || null
                };
                
                // Add to global reports
                if (!global.reports) global.reports = [];
                global.reports.push(newReport);
                
                // Save to file (you might want to implement this)
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const reportsPath = path.join(__dirname, '../../../../database/reports.json');
                    fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
                } catch (error) {
                    console.error('[SAVE_REPORT_ERROR]', error);
                }
                
                // ✅ FIX #1: Notify teknisi via WhatsApp
                console.log('[TICKET_NOTIF] ===== START TEKNISI NOTIFICATION =====');
                console.log('[TICKET_NOTIF] Ticket ID:', ticketId);
                console.log('[TICKET_NOTIF] Customer:', targetUser.name);
                
                const priority = lampu_los ? 'HIGH' : 'MEDIUM';
                const priorityEmoji = lampu_los ? '🔴' : '🟡';
                const priorityText = lampu_los ? 'HIGH (URGENT)' : 'MEDIUM';
                const estimasiWaktu = getResponseTimeMessage(priority);
                
                // Get teknisi numbers from accounts
                console.log('[TICKET_NOTIF] Checking global.accounts:', !!global.accounts);
                console.log('[TICKET_NOTIF] Total accounts:', global.accounts?.length || 0);
                
                const teknisiAccounts = global.accounts?.filter(acc => acc.role === 'teknisi' && acc.phone_number) || [];
                console.log('[TICKET_NOTIF] Teknisi accounts found:', teknisiAccounts.length);
                console.log('[TICKET_NOTIF] Teknisi details:', teknisiAccounts.map(t => ({ name: t.name, phone: t.phone_number })));
                
                const teknisiNumbers = teknisiAccounts.map(acc => {
                    const phoneNumber = acc.phone_number.replace(/[^0-9]/g, '');
                    return phoneNumber.includes('@s.whatsapp.net') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
                });
                
                // Also check global.teknisiList if exists
                console.log('[TICKET_NOTIF] Checking global.teknisiList:', !!global.teknisiList);
                if (global.teknisiList && Array.isArray(global.teknisiList)) {
                    console.log('[TICKET_NOTIF] teknisiList entries:', global.teknisiList.length);
                    global.teknisiList.forEach(num => {
                        if (!teknisiNumbers.includes(num)) {
                            teknisiNumbers.push(num);
                            console.log('[TICKET_NOTIF] Added from teknisiList:', num);
                        }
                    });
                }
                
                // Build notification message with safe fallbacks
                const customerName = targetUser.name || 'N/A';
                const customerPhone = targetUser.phone_number || 'N/A';
                const customerAddress = targetUser.address || 'N/A';
                const customerPackage = targetUser.subscription || targetUser.package || 'N/A';
                
                const notifMessage = `${priorityEmoji} *TIKET BARU*

ID: *${ticketId}*
Priority: *${priorityText}*

*Pelanggan:*
├ Nama: ${customerName}
├ Telepon: ${customerPhone}
├ Alamat: ${customerAddress}
└ Paket: ${customerPackage}

*Keluhan:*
${keluhan}

*Detail Teknis:*
├ Sudah Reboot: ${sudah_reboot ? 'Ya ✅' : 'Belum ❌'}
├ Lampu LOS: ${lampu_los ? 'Merah 🔴' : 'Normal ✅'}
└ Detail Lampu: ${detail_lampu}

${indikasi_masalah || ''}

⏱️ *Target Response:* ${estimasiWaktu}

Ketik: *prosestiket ${ticketId}* untuk ambil tiket ini.`;
                
                console.log('[TICKET_NOTIF] Message built successfully, length:', notifMessage.length);

                // Broadcast to all teknisi
                console.log(`[TICKET_NOTIF] ===== SENDING NOTIFICATIONS =====`);
                console.log(`[TICKET_NOTIF] Total teknisi to notify: ${teknisiNumbers.length}`);
                console.log(`[TICKET_NOTIF] Teknisi numbers:`, teknisiNumbers);
                console.log(`[TICKET_NOTIF] WhatsApp (global.raf) available: ${!!global.raf}`);
                console.log(`[TICKET_NOTIF] sendMessage function available: ${!!(global.raf && global.raf.sendMessage)}`);
                
                if (teknisiNumbers.length === 0) {
                    console.error('[TICKET_NOTIF] ❌ NO TEKNISI FOUND!');
                    console.error('[TICKET_NOTIF] Please check:');
                    console.error('[TICKET_NOTIF] 1. database/accounts.json has users with role="teknisi"');
                    console.error('[TICKET_NOTIF] 2. Those users have valid phone_number field');
                    console.error('[TICKET_NOTIF] 3. OR global.teknisiList is configured');
                }
                
                if (!global.raf || !global.raf.sendMessage) {
                    console.error('[TICKET_NOTIF] ❌ WHATSAPP NOT AVAILABLE!');
                    console.error('[TICKET_NOTIF] global.raf is:', global.raf ? 'defined' : 'undefined');
                    console.error('[TICKET_NOTIF] Cannot send notifications to teknisi');
                } else {
                    console.log('[TICKET_NOTIF] ✅ Starting to send messages...');
                    let successCount = 0;
                    let failCount = 0;
                    
                    // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
                    for (const teknisi of teknisiNumbers) {
                        if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                            try {
                                console.log(`[TICKET_NOTIF] Attempting to send to: ${teknisi}`);
                                await global.raf.sendMessage(teknisi, { text: notifMessage });
                                successCount++;
                                console.log(`[TICKET_NOTIF] ✅ SUCCESS - Sent to teknisi: ${teknisi}`);
                            } catch (err) {
                                failCount++;
                                console.error('[SEND_MESSAGE_ERROR]', {
                                    teknisi,
                                    error: err.message
                                });
                                console.error(`[TICKET_NOTIF_ERROR] ❌ FAILED - Could not notify ${teknisi}`);
                                console.error(`[TICKET_NOTIF_ERROR] Error:`, err);
                                // Continue to next teknisi
                            }
                        } else {
                            console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to teknisi', teknisi);
                            failCount++;
                        }
                    }
                    
                    console.log(`[TICKET_NOTIF] ===== NOTIFICATION SUMMARY =====`);
                    console.log(`[TICKET_NOTIF] Total: ${teknisiNumbers.length}`);
                    console.log(`[TICKET_NOTIF] Success: ${successCount}`);
                    console.log(`[TICKET_NOTIF] Failed: ${failCount}`);
                    console.log(`[TICKET_NOTIF] ===================================`);
                }
                
                deleteUserState(sender);
                
                const urgencyText = lampu_los ? 
                    `\n\n🔴 *URGENT: LOS merah terdeteksi!*\nTim teknisi akan menangani dalam ${estimasiWaktu}.` : 
                    `\n\n🟡 Laporan Anda akan ditangani dalam ${estimasiWaktu}.`;
                
                return {
                    success: true,
                    message: `✅ *Laporan Berhasil Dibuat!*\n\n📋 *Detail Tiket:*\n├ *ID Tiket:* \`${ticketId}\`\n├ *Nama:* ${targetUser.name}\n├ *Paket:* ${targetUser.subscription || targetUser.package}\n├ *Status:* Menunggu Diproses\n└ *Waktu:* ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}${urgencyText}\n\n📱 Anda akan menerima notifikasi WhatsApp untuk setiap update status.\n\n💡 *Tips:* Gunakan perintah *cektiket ${ticketId}* untuk melihat status terkini.\n\n☎️ Untuk kasus urgent, hubungi: ${global.config.ownerNumber || 'Admin'}\n\nTerima kasih atas kesabaran Anda! 🙏`
                };
            } else if (userReply === 'tidak' || userReply === 'no' || userReply === 'n' || userReply === 'gak') {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Pembuatan laporan dibatalkan. Jika Anda mengalami gangguan, silakan buat laporan kembali dengan mengetik *lapor*.'
                };
            } else {
                return {
                    success: false,
                    message: "Mohon balas dengan *'ya'* untuk mengirim laporan atau *'tidak'* untuk membatalkan."
                };
            }
        }
        
        case 'CONFIRM_CANCEL_TICKET': {
            if (['ya', 'ok', 'lanjut', 'iya', 'y'].includes(userReply)) {
                const { ticketIdToCancel } = userState;
                const reportIndex = global.reports.findIndex(r => r.ticketId === ticketIdToCancel);
                
                if (reportIndex !== -1) {
                    global.reports[reportIndex].status = 'dibatalkan';
                    global.reports[reportIndex].cancelledAt = new Date().toISOString();
                    global.reports[reportIndex].cancelledBy = pushname;
                    
                    // Save to file
                    try {
                        const fs = require('fs');
                        const path = require('path');
                        const reportsPath = path.join(__dirname, '../../../database/reports.json');
                        fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
                    } catch (error) {
                        console.error('[SAVE_REPORT_ERROR]', error);
                    }
                    
                    deleteUserState(sender);
                    
                    return {
                        success: true,
                        message: `✅ Tiket dengan ID *${ticketIdToCancel}* telah dibatalkan.`
                    };
                } else {
                    deleteUserState(sender);
                    return {
                        success: false,
                        message: `❌ Tiket dengan ID *${ticketIdToCancel}* tidak ditemukan.`
                    };
                }
            } else if (['tidak', 'no', 'n', 'gak'].includes(userReply)) {
                deleteUserState(sender);
                return {
                    success: true,
                    message: '❌ Pembatalan tiket dibatalkan. Tiket tetap aktif.'
                };
            } else {
                return {
                    success: false,
                    message: "Mohon balas dengan *'ya'* untuk membatalkan tiket atau *'tidak'* untuk membatalkan aksi ini."
                };
            }
        }
    }
    
    return {
        success: false,
        message: 'Step tidak dikenali.'
    };
}

module.exports = {
    handleReportSteps
};
