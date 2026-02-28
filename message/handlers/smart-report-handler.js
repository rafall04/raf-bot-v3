/**
 * Smart Report Handler - Intelligent Troubleshooting with Device Detection
 * Handles LAPOR_GANGGUAN_MATI and LAPOR_GANGGUAN_LEMOT with auto-classification
 */

const { isDeviceOnline, getDeviceOfflineMessage } = require('../../lib/device-status');
const { setUserState, getUserState, deleteUserState } = require('./conversation-handler');
const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { getResponseTimeMessage, isWithinWorkingHours } = require('../../lib/working-hours-helper');
const { renderReport, errorMessage } = require('../../lib/templating');
const { saveReports } = require('../../lib/database');
const { hasActiveReport } = require('../../lib/report-helper');
const fs = require('fs');
const path = require('path');

// Generate ticket ID function (same as in raf.js)
function generateTicketId(length = 7) {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

/**
 * Handle GANGGUAN_MATI - Internet mati/putus total (HIGH Priority)
 * Auto-detect device status via GenieACS
 */
async function handleGangguanMati({ sender, pushname, userPelanggan, reply, findUserByPhone, msg, raf }) {
    try {
        const { user, plainSenderNumber } = await resolveCustomerBySender({ users: global.users, sender, msg, raf });
        console.log(`[USER_SEARCH] Sender: ${sender}, Found: ${user ? user.name : 'NOT FOUND'}`);

        // Handle @lid users - no manual verification needed
        if (!user && sender.endsWith('@lid')) {
            return {
                success: false,
                message: `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
            };
        }

        if (!user) {
            return {
                success: false,
                message: renderReport('permission_denied', {
                    reason: 'Nomor Anda belum terdaftar sebagai pelanggan',
                    admin_contact: global.config?.ownerNumber?.[0] || 'admin'
                })
            };
        }

        // Check for duplicate/active report menggunakan helper function
        const recentReport = hasActiveReport(user.id, global.reports);

        if (recentReport) {
            const statusText = recentReport.status === 'baru' ?
                'Menunggu diproses' :
                `Sedang diproses oleh ${recentReport.processedByTeknisiName || 'teknisi'}`;

            return {
                success: false,
                message: renderReport('duplicate_active', {
                    ticket_id: recentReport.ticketId,
                    status_text: statusText,
                    created_at: new Date(recentReport.createdAt).toLocaleString('id-ID', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'Asia/Jakarta'
                    }),
                    additional_info: 'Untuk cek status, ketik: *ceklaporan*'
                })
            };
        }

        // Auto-check device status
        const deviceStatus = await isDeviceOnline(user.device_id);

        console.log('[handleGangguanMati] Device status:', {
            online: deviceStatus.online,
            minutesAgo: deviceStatus.minutesAgo,
            hasError: !!deviceStatus.error
        });

        if (!deviceStatus.online) {
            // ❌ DEVICE OFFLINE - High priority, kemungkinan kabel/listrik
            const minutesAgo = deviceStatus.minutesAgo || 'lebih dari 30';

            setUserState(sender, {
                step: 'GANGGUAN_MATI_DEVICE_OFFLINE',
                targetUser: user,
                deviceStatus: deviceStatus,
                issueType: 'MATI',
                priority: 'HIGH'
            });

            // Check if outside working hours
            const workingStatus = isWithinWorkingHours();
            let outOfHoursNotice = '';

            if (!workingStatus.isWithinHours) {
                const config = global.config.teknisiWorkingHours;
                outOfHoursNotice = `\n\n⏰ *PERHATIAN:*\n${config.outOfHoursMessage || 'Laporan Anda diterima di luar jam kerja. Akan diproses pada jam kerja berikutnya.'}\n`;
                if (workingStatus.nextWorkingTime) {
                    const options = {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Jakarta'
                    };
                    const timeStr = workingStatus.nextWorkingTime.toLocaleString('id-ID', options);
                    outOfHoursNotice += `Teknisi akan tersedia: ${timeStr} WIB`;
                }
            }

            return {
                success: true,
                message: `🚨 *GANGGUAN TERDETEKSI*

Status Perangkat: *OFFLINE* ❌
Terakhir Online: ${minutesAgo} menit yang lalu

*Kemungkinan Penyebab:*
⚡ Listrik mati / modem tidak menyala
🔌 Kabel power lepas
📡 Kabel fiber optik lepas/putus/bengkok
🔥 Gangguan dari ODP/jaringan pusat
⚠️ Modem/ONT rusak atau overheating

*Langkah Troubleshooting Cepat:*
1️⃣ Cek apakah modem/ONT menyala (lihat lampu indikator)
2️⃣ Cek kabel power terpasang dengan baik
3️⃣ Cek kabel fiber optik yang masuk ke modem tidak lepas/bengkok
4️⃣ Tunggu 5 menit, lalu restart modem (cabut-pasang power)${outOfHoursNotice}

⏱️ Apakah sudah mencoba langkah di atas?

*Pilih salah satu:*
1️⃣ Sudah dicoba, masih mati
2️⃣ Belum dicoba
3️⃣ Sudah normal kembali
0️⃣ Batal

Balas dengan *angka* (1/2/3/0)`
            };

        } else {
            // ✅ DEVICE ONLINE - Tapi user report mati (WiFi issue)
            setUserState(sender, {
                step: 'GANGGUAN_MATI_DEVICE_ONLINE',
                targetUser: user,
                deviceStatus: deviceStatus,
                issueType: 'MATI_WIFI_ONLY',
                priority: 'MEDIUM'
            });

            return {
                success: true,
                message: `🤔 *ANALISIS STATUS*

Menariknya, modem Anda terdeteksi *ONLINE* ✅ di sistem kami.

Ini berarti modem hidup dan terhubung ke jaringan, kemungkinan:

📶 *Masalah WiFi (bukan kabel):*
   • WiFi disabled atau SSID disembunyikan
   • Password WiFi berubah tanpa sengaja
   • Channel WiFi bentrok dengan tetangga
   
📱 *Masalah Device User:*
   • HP/laptop bermasalah
   • Driver WiFi bermasalah
   • Airplane mode aktif

*Coba Langkah Ini Dulu:*
1️⃣ Restart HP/laptop yang digunakan
2️⃣ Lupa jaringan WiFi → Konek ulang
3️⃣ Cek apakah WiFi masih muncul di daftar
4️⃣ Coba perangkat lain (HP yang berbeda)

Sudah dicoba?

*Pilih salah satu:*
1️⃣ Tetap mati, buat tiket
2️⃣ Sudah bisa terkoneksi
0️⃣ Batal

Balas dengan *angka* (1/2/0)`
            };
        }

    } catch (error) {
        console.error('[handleGangguanMati] Error:', error);
        return {
            success: false,
            message: `❌ Maaf, terjadi kesalahan saat memeriksa status perangkat. Silakan coba lagi atau hubungi admin.`
        };
    }
}

/**
 * Handle Auto-Redirect from LEMOT to MATI when device is offline
 * This function is called automatically when user reports "lemot" but device is actually offline
 */
async function handleGangguanMatiAutoRedirect({ sender, pushname, userPelanggan, reply, findUserByPhone, deviceStatus, targetUser, originalReport, msg, raf }) {
    try {
        const user = targetUser;  // User already found and passed from lemot handler
        const minutesAgo = deviceStatus.minutesAgo || 'lebih dari 30';

        // Get dynamic estimation based on working hours
        const estimasi = getResponseTimeMessage('HIGH');

        // Check working hours status for additional context
        const workingStatus = isWithinWorkingHours();
        let outOfHoursNotice = '';
        let targetTime = '';

        if (workingStatus.isWithinHours) {
            // Calculate target time (current + 2 hours for HIGH priority)
            const now = new Date();
            const target = new Date(now.getTime() + 2 * 60 * 60 * 1000);
            targetTime = `Hari ini sebelum ${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')} WIB`;
        } else {
            // Outside working hours
            const config = global.config.teknisiWorkingHours;
            outOfHoursNotice = `\n\n⏰ *PERHATIAN:*\n${config.outOfHoursMessage || 'Laporan diterima di luar jam kerja. Akan diproses pada jam kerja berikutnya.'}\n`;

            if (workingStatus.nextWorkingTime) {
                const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                const next = workingStatus.nextWorkingTime;
                const dayName = dayNames[next.getDay()];
                targetTime = `${dayName} pukul ${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')} WIB`;

                if (outOfHoursNotice) {
                    outOfHoursNotice += `Teknisi akan mulai: ${targetTime}`;
                }
            }
        }

        // Set state for MATI flow
        setUserState(sender, {
            step: 'GANGGUAN_MATI_DEVICE_OFFLINE',
            targetUser: user,
            deviceStatus: deviceStatus,
            issueType: 'MATI_OFFLINE',
            priority: 'HIGH',
            autoRedirected: true,
            originalReport: originalReport,
            estimatedTime: estimasi,
            targetTime: targetTime
        });

        // Construct the auto-redirect message
        const message = `🔴 *GANGGUAN TERDETEKSI: DEVICE OFFLINE*

Anda melaporkan internet *lemot*, namun sistem mendeteksi perangkat Anda *OFFLINE TOTAL*.

📊 *Analisis Otomatis:*
• Status Device: *OFFLINE* ❌
• Terakhir Online: *${minutesAgo} menit yang lalu*
• Jenis Gangguan: *Internet Mati Total*
• Prioritas: *HIGH (Urgent)* 🚨
• Estimasi Penanganan: *${estimasi}*
${targetTime ? `• Target Waktu: *${targetTime}*` : ''}${outOfHoursNotice}

*Kemungkinan Penyebab:*
⚡ Listrik mati / modem tidak menyala
🔌 Kabel power lepas
📡 Kabel fiber optik lepas/putus/bengkok
⚠️ Modem/ONT rusak

*Langkah Troubleshooting:*
1️⃣ Cek lampu indikator modem/ONT
2️⃣ Cek kabel power terpasang baik
3️⃣ Cek kabel fiber tidak lepas/bengkok
4️⃣ Restart modem (cabut-pasang power)
5️⃣ Tunggu 2 menit hingga lampu stabil

Apakah sudah mencoba langkah di atas?

*Pilih salah satu:*
1️⃣ Sudah dicoba, masih mati
2️⃣ Belum dicoba
3️⃣ Sudah normal kembali
0️⃣ Batal proses

Balas dengan *angka* (1/2/3/0)`;

        return {
            success: true,
            message: message
        };

    } catch (error) {
        console.error('[handleGangguanMatiAutoRedirect] Error:', error);
        return {
            success: false,
            message: `❌ Maaf, terjadi kesalahan saat memproses laporan. Silakan coba lagi.`
        };
    }
}

/**
 * Handle GANGGUAN_LEMOT - Internet lambat (MEDIUM Priority)
 * Check device status and provide intelligent troubleshooting
 */
async function handleGangguanLemot({ sender, pushname, userPelanggan, reply, findUserByPhone, msg, raf }) {
    try {
        const { user, plainSenderNumber } = await resolveCustomerBySender({ users: global.users, sender, msg, raf });
        console.log(`[USER_SEARCH] Sender: ${sender}, Found: ${user ? user.name : 'NOT FOUND'}`);

        // Handle @lid users - no manual verification needed
        if (!user && sender.endsWith('@lid')) {
            return {
                success: false,
                message: `❌ Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.`
            };
        }

        if (!user) {
            return {
                success: false,
                message: renderReport('permission_denied', {
                    reason: 'Nomor Anda belum terdaftar sebagai pelanggan',
                    admin_contact: global.config?.ownerNumber?.[0] || 'admin'
                })
            };
        }

        // Check if user already has active report menggunakan helper function
        const laporanAktif = hasActiveReport(user.id, global.reports);

        if (laporanAktif) {
            return {
                success: false,
                message: `⚠️ *ANDA SUDAH MEMILIKI LAPORAN AKTIF*\n\n📋 ID Tiket: *${laporanAktif.ticketId}*\n\nMohon tunggu hingga laporan tersebut selesai diproses.`
            };
        }

        // Auto-check device status
        const deviceStatus = await isDeviceOnline(user.device_id);

        if (!deviceStatus.online) {
            // Device OFFLINE - AUTO-REDIRECT ke flow MATI tanpa suruh user ketik ulang
            console.log('[AUTO-REDIRECT] Lemot → Mati (device offline detected)');

            // Langsung panggil handler MATI dengan flag autoRedirected
            const result = await handleGangguanMatiAutoRedirect({
                sender,
                pushname,
                userPelanggan,
                reply,
                findUserByPhone,
                deviceStatus,  // Pass existing device status
                targetUser: user,  // Pass user yang sudah ditemukan
                originalReport: 'LEMOT',  // Track asal laporan
                msg,  // Pass msg for LID support
                raf   // Pass raf for LID support
            });

            return result;
        }

        // Device ONLINE - Continue with lemot troubleshooting (NOT photo upload first!)
        // Get dynamic estimation for MEDIUM priority
        const estimasiLemot = getResponseTimeMessage('MEDIUM');

        // Calculate target time for MEDIUM priority (24 working hours)
        const workingStatus = isWithinWorkingHours();
        let targetTimeLemot = '';

        if (workingStatus.isWithinHours) {
            // Calculate next day same time
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
            targetTimeLemot = `${dayNames[tomorrow.getDay()]} sebelum pukul ${String(tomorrow.getHours()).padStart(2, '0')}:${String(tomorrow.getMinutes()).padStart(2, '0')} WIB`;
        } else {
            // If reported outside hours, count from next working day
            if (workingStatus.nextWorkingTime) {
                const nextWork = new Date(workingStatus.nextWorkingTime);
                nextWork.setDate(nextWork.getDate() + 1);
                const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                targetTimeLemot = `${dayNames[nextWork.getDay()]} jam kerja`;
            }
        }

        // Set state for troubleshooting response (NOT photo upload)
        setUserState(sender, {
            step: 'GANGGUAN_LEMOT_AWAITING_RESPONSE',
            targetUser: user,
            deviceStatus: deviceStatus,
            issueType: 'LEMOT',
            priority: 'MEDIUM',
            estimatedTime: estimasiLemot,
            targetTime: targetTimeLemot
        });

        const paketUser = user.subscription || 'Tidak diketahui';

        return {
            success: true,
            message: `🐌 *TROUBLESHOOTING INTERNET LEMOT*

📊 *Status Sistem:*
• Device: *ONLINE* ✅
• Paket: *${paketUser}*
• Prioritas jika buat tiket: *MEDIUM*
• Estimasi penanganan: *${estimasiLemot}*
${targetTimeLemot ? `• Target selesai: *${targetTimeLemot}*` : ''}

*Langkah Diagnosa:*

1️⃣ *Cek Banyak Device Terhubung*
   Ketik: *cek wifi* untuk lihat jumlah device

2️⃣ *Matikan Aplikasi Berat:*
   • Download torrent/file besar
   • Streaming video HD/4K
   • Update Windows/Game
   
3️⃣ *Test Jarak dari Modem:*
   Coba dekat ke modem, apakah lebih cepat?

4️⃣ *Lakukan Speed Test:*
   • Buka fast.com atau speedtest.net
   • Screenshot atau catat hasilnya
   • Bandingkan dengan paket Anda

*Setelah troubleshooting, pilih:*

1️⃣ Tetap lemot → Buat tiket teknisi
2️⃣ Sudah normal kembali
3️⃣ Kirim hasil speedtest: *speedtest [hasil]*
0️⃣ Batal proses

Balas dengan angka atau contoh: *speedtest 5mbps*`
        };

    } catch (error) {
        console.error('[handleGangguanLemot] Error:', error);
        return {
            success: false,
            message: `❌ Maaf, terjadi kesalahan saat menganalisis koneksi. Silakan coba lagi atau hubungi admin.`
        };
    }
}

/**
 * Handle follow-up response for GANGGUAN_MATI (Device OFFLINE)
 */
async function handleGangguanMatiOfflineResponse({ sender, body, reply, findUserByPhone, msg, raf }) {
    const state = getUserState(sender);
    const response = body.toLowerCase().trim();

    // Check for cancel command (0 atau batal)
    if (response === '0' || response === 'batal' || response === 'cancel') {
        deleteUserState(sender);
        return {
            success: true,
            message: `❌ Proses laporan dibatalkan. Jika masih ada masalah, silakan lapor kembali.`
        };
    }

    // 3 = sudah bisa/normal kembali
    if (response === '3' || response.includes('sudah bisa') || response.includes('sudahbisa') || response.includes('normal')) {
        deleteUserState(sender);
        return {
            success: true,
            message: `🎉 Alhamdulillah! Senang mendengar internet sudah kembali normal.\n\nJika ada masalah lagi, jangan ragu untuk chat ya. Terima kasih! 🙏`
        };
    }

    // 1 = sudah dicoba masih mati
    if (response === '1' || response === 'sudah dicoba' || response.includes('sudah') && !response.includes('belum')) {
        // User sudah troubleshoot tapi masih mati - CREATE HIGH PRIORITY TICKET
        // Set state for optional photo upload
        const ticketId = generateTicketId();

        // Get estimation time from state or calculate new
        const estimasi = state.estimatedTime || getResponseTimeMessage('HIGH');
        const targetTime = state.targetTime || '';

        // Check if this is auto-redirected from LEMOT report
        const reportSource = state.autoRedirected ?
            `User lapor ${state.originalReport}, sistem deteksi device OFFLINE` :
            'User lapor internet mati';

        setUserState(sender, {
            step: 'GANGGUAN_MATI_AWAITING_PHOTO',
            targetUser: state.targetUser,
            deviceStatus: state.deviceStatus,
            startTime: Date.now(), // For timeout tracking
            ticketData: {
                ticketId,
                pelangganUserId: state.targetUser.id,
                pelangganId: sender,
                pelangganName: state.targetUser.name || state.targetUser.username,
                pelangganPhone: state.targetUser.phone_number || '',
                pelangganAddress: state.targetUser.address || '',
                pelangganSubscription: state.targetUser.subscription || 'Tidak diketahui',
                laporanText: `Internet mati total - Device OFFLINE\nTerakhir online: ${state.deviceStatus.minutesAgo || 'lebih dari 30'} menit yang lalu\nTroubleshooting sudah dilakukan.\nSumber: ${reportSource}`,
                status: 'baru',
                priority: 'HIGH',
                estimatedTime: estimasi,
                targetTime: targetTime,
                createdAt: new Date().toISOString(),
                deviceOnline: false,
                issueType: 'MATI',
                troubleshootingDone: true,
                autoRedirected: state.autoRedirected || false
            },
            uploadedPhotos: []
        });

        // Don't save yet - wait for photo upload or skip
        // Return message prompting for optional photo upload
        return {
            success: true,
            message: `📸 *UPLOAD FOTO (OPSIONAL)*

Untuk membantu teknisi mengidentifikasi masalah, Anda bisa upload foto:

📷 *Foto yang membantu:*
• Lampu indikator modem/ONT
• Kondisi kabel (jika terlihat putus/rusak)
• Pesan error di layar (jika ada)
• Kondisi fisik perangkat

*Cara Upload:*
1. Kirim foto satu per satu
2. Maksimal 3 foto
3. Setelah selesai ketik *lanjut*
4. Atau ketik *skip* jika tidak ada foto

⏱️ *Timeout: 5 menit*

_Foto akan membantu teknisi membawa spare part yang tepat_`
        };
    }

    // Dead code below - will be removed
    if (false) { // Wrap in false to indicate this is dead code to be removed
        // Send to all teknisi from accounts database
        const teknisiAccounts = global.accounts.filter(acc =>
            acc.role === 'teknisi' && acc.phone_number && acc.phone_number.trim() !== ""
        );

        // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
        for (const teknisi of teknisiAccounts) {
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    let teknisiJid = teknisi.phone_number.trim();
                    if (!teknisiJid.endsWith('@s.whatsapp.net')) {
                        if (teknisiJid.startsWith('0')) {
                            teknisiJid = `62${teknisiJid.substring(1)}@s.whatsapp.net`;
                        } else if (teknisiJid.startsWith('62')) {
                            teknisiJid = `${teknisiJid}@s.whatsapp.net`;
                        } else {
                            teknisiJid = `62${teknisiJid}@s.whatsapp.net`;
                        }
                    }
                    await global.raf.sendMessage(teknisiJid, { text: notifMessage });
                    console.log(`[REPORT] Notified teknisi: ${teknisi.username} (${teknisiJid})`);
                } catch (err) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        teknisiJid: teknisi.phone_number,
                        error: err.message
                    });
                    console.error(`Failed to notify teknisi ${teknisi.username}:`, err.message);
                    // Continue to next teknisi
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to teknisi', teknisi.username);
            }
        }

        // Also notify admins/owners
        const adminAccounts = global.accounts.filter(acc =>
            ['admin', 'owner', 'superadmin'].includes(acc.role) &&
            acc.phone_number && acc.phone_number.trim() !== ""
        );

        const adminNotifMsg = `📊 *LAPORAN URGENT BARU*\n\n${notifMessage}\n\n_Notifikasi telah dikirim ke ${teknisiAccounts.length} teknisi._`;

        // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
        for (const admin of adminAccounts) {
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    let adminJid = admin.phone_number.trim();
                    if (!adminJid.endsWith('@s.whatsapp.net')) {
                        if (adminJid.startsWith('0')) {
                            adminJid = `62${adminJid.substring(1)}@s.whatsapp.net`;
                        } else if (adminJid.startsWith('62')) {
                            adminJid = `${adminJid}@s.whatsapp.net`;
                        } else {
                            adminJid = `62${adminJid}@s.whatsapp.net`;
                        }
                    }
                    await global.raf.sendMessage(adminJid, { text: adminNotifMsg });
                } catch (err) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        adminJid: admin.phone_number,
                        error: err.message
                    });
                    console.error(`Failed to notify admin ${admin.username}:`, err.message);
                    // Continue to next admin
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to admin', admin.username);
            }
        }

        deleteUserState(sender);

        const responseTime = getResponseTimeMessage('HIGH');

        return {
            success: true,
            message: `✅ *TIKET PRIORITAS TINGGI DIBUAT*

Nomor Tiket: *${ticketId}*
Prioritas: *🔴 URGENT*

Teknisi akan segera menghubungi Anda untuk perbaikan.

⏱️ *Estimasi Waktu:* ${responseTime}

Mohon pastikan HP Anda aktif agar teknisi dapat menghubungi.

Terima kasih atas kesabarannya. 🙏`
        };
    }

    // 2 = belum dicoba - Show detailed troubleshooting guide
    if (response === '2' || response.includes('belum')) {
        // Keep state but don't create ticket yet
        return {
            success: true,
            message: `📖 *PANDUAN TROUBLESHOOTING DETAIL*

*Step 1: Cek Lampu Indikator Modem/ONT*
🟢 Power (hijau) = Normal
🔴 Power (merah/mati) = Ada masalah listrik
🟡 PON/LOS (berkedip) = Kabel fiber bermasalah
🟢 Internet (hijau) = Koneksi normal

*Step 2: Restart Modem/ONT*
1. Cabut kabel power modem
2. Tunggu 10 detik
3. Pasang kembali kabel power
4. Tunggu 2-3 menit hingga lampu stabil
5. Cek apakah internet sudah kembali

*Step 3: Cek Kabel*
• Pastikan kabel fiber tidak tertekuk/patah
• Cek kabel LAN terpasang dengan benar
• Pastikan konektor tidak longgar

*Step 4: Test dengan Kabel LAN*
• Hubungkan laptop/PC langsung ke modem pakai kabel LAN
• Jika pakai kabel bisa, berarti masalah di WiFi

Setelah mencoba langkah di atas:
1️⃣ Masih mati → Buat tiket teknisi
3️⃣ Sudah normal kembali
0️⃣ Batal

_Troubleshooting biasanya memakan waktu 5-10 menit_`
        };
    }

    // Default - remind user
    return {
        success: true,
        message: `Mohon balas dengan angka:\n*1* - Sudah dicoba, masih mati\n*2* - Belum dicoba\n*3* - Sudah normal kembali\n*0* - Batal`
    };
}

/**
 * Handle follow-up response for GANGGUAN_MATI (Device ONLINE - WiFi issue)
 */
async function handleGangguanMatiOnlineResponse({ sender, body, reply, msg, raf }) {
    const state = getUserState(sender);
    const response = body.toLowerCase().trim();

    // Check for cancel command (0 atau batal)
    if (response === '0' || response === 'batal' || response === 'cancel') {
        deleteUserState(sender);
        return {
            success: true,
            message: `❌ Proses laporan dibatalkan. Jika masih ada masalah, silakan lapor kembali.`
        };
    }

    // 2 = sudah bisa terkoneksi
    if (response === '2' || response.includes('sudah bisa') || response.includes('sudahbisa') || response.includes('terkoneksi')) {
        deleteUserState(sender);
        return {
            success: true,
            message: `🎉 Bagus! Berarti masalahnya memang di WiFi saja ya.\n\nTips: Lupa dan konek ulang WiFi biasanya membantu jika terjadi lagi.\n\nTerima kasih! 🙏`
        };
    }

    // 1 = tetap mati
    if (response === '1' || response.includes('tetap mati') || response.includes('tetapmati') || response.includes('masih mati')) {
        // CREATE MEDIUM PRIORITY TICKET (modem online, WiFi issue)
        const ticketId = generateTicketId();
        const newReport = {
            ticketId: ticketId,
            pelangganUserId: state.targetUser.id, // IMPORTANT: User ID untuk filter
            pelangganId: sender,
            pelangganName: state.targetUser.name,
            pelangganPhone: state.targetUser.phone_number,
            pelangganAddress: state.targetUser.address,
            laporanText: `Tidak bisa konek WiFi - Device ONLINE\nModem terdeteksi aktif tapi WiFi tidak bisa diakses.\nTroubleshooting sudah dilakukan.`,
            status: 'baru',
            priority: 'MEDIUM',
            createdAt: new Date().toISOString(),
            deviceOnline: true,
            issueType: 'WIFI_ISSUE',
            troubleshootingDone: true
        };

        if (!global.reports) global.reports = [];
        global.reports.push(newReport);

        // Save reports to file
        try {
            const reportsPath = path.join(__dirname, '../../database/reports.json');
            fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        } catch (error) {
            console.error('[SAVE_REPORT_ERROR]', error);
        }

        // Notify teknisi dan admin - MEDIUM priority
        const notifMessage = `📶 *TIKET GANGGUAN WiFi*

ID: *${ticketId}*
Prioritas: *⚠️ MEDIUM*

Pelanggan: ${state.targetUser.name}
Telepon: ${state.targetUser.phone_number.split('|')[0]}
Alamat: ${state.targetUser.address}
Paket: ${state.targetUser.subscription || 'N/A'}

*Masalah:* WiFi tidak bisa connect (Modem ONLINE)
*Device Status:* ONLINE ✅
*Issue:* Kemungkinan masalah WiFi/setting

*Kemungkinan solusi:*
• Setting ulang WiFi/channel
• Reset password WiFi
• Cek SSID broadcast

Untuk proses tiket, ketik:
*proses ${ticketId}*`;

        // Send to all teknisi
        const teknisiAccounts = global.accounts.filter(acc =>
            acc.role === 'teknisi' && acc.phone_number && acc.phone_number.trim() !== ""
        );

        // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
        for (const teknisi of teknisiAccounts) {
            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    let teknisiJid = teknisi.phone_number.trim();
                    if (!teknisiJid.endsWith('@s.whatsapp.net')) {
                        if (teknisiJid.startsWith('0')) {
                            teknisiJid = `62${teknisiJid.substring(1)}@s.whatsapp.net`;
                        } else if (teknisiJid.startsWith('62')) {
                            teknisiJid = `${teknisiJid}@s.whatsapp.net`;
                        } else {
                            teknisiJid = `62${teknisiJid}@s.whatsapp.net`;
                        }
                    }
                    await global.raf.sendMessage(teknisiJid, { text: notifMessage });
                } catch (err) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        teknisiJid: teknisi.phone_number,
                        error: err.message
                    });
                    console.error(`Failed to notify teknisi ${teknisi.username}:`, err.message);
                    // Continue to next teknisi
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to teknisi', teknisi.username);
            }
        }

        deleteUserState(sender);

        const responseTime = getResponseTimeMessage('MEDIUM');

        return {
            success: true,
            message: `✅ *TIKET DIBUAT*

Nomor Tiket: *${ticketId}*
Prioritas: *⚠️ MEDIUM*

Teknisi akan menghubungi untuk pengecekan lebih lanjut dalam ${responseTime}.

Kemungkinan perlu setting ulang WiFi atau ganti channel.

Terima kasih! 🙏`
        };
    }

    // Default - remind user with numbers
    return {
        success: true,
        message: `Mohon balas dengan angka:\n*1* - Tetap mati, buat tiket\n*2* - Sudah bisa terkoneksi\n*0* - Batal`
    };
}

/**
 * Notify technicians about new ticket
 */
async function notifyTechnicians(report) {
    const teknisiAccounts = global.accounts.filter(acc => acc.role === 'teknisi');

    for (let i = 0; i < teknisiAccounts.length; i++) {
        const teknisi = teknisiAccounts[i];
        if (!teknisi.phone_number) continue;

        // Add delay between notifications to prevent spam
        if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const teknisiJid = teknisi.phone_number.includes('@') ?
            teknisi.phone_number :
            `${teknisi.phone_number}@s.whatsapp.net`;

        let message = `🚨 *TIKET BARU - ${report.priority === 'HIGH' ? 'URGENT!' : 'Normal'}*

━━━━━━━━━━━━━━━━
📋 ID: *${report.ticketId}*
👤 Pelanggan: ${report.pelangganName}
📱 No: ${report.pelangganPhone}
📍 Alamat: ${report.pelangganAddress || 'Tidak ada'}
━━━━━━━━━━━━━━━━

*Masalah:* ${report.laporanText}
*Device:* ${report.deviceOnline ? '🟢 Online' : '🔴 Offline'}
*Troubleshoot:* ${report.troubleshootingDone ? '✅ Sudah' : '❌ Belum'}`;

        // Add photo info if available
        if (report.photoCount > 0) {
            message += `\n*Foto Pelanggan:* 📸 ${report.photoCount} foto tersedia`;

            // Send text message first
            await global.raf.sendMessage(teknisiJid, { text: message });

            // Send photos if available
            if (report.photoBuffers && report.photoBuffers.length > 0) {
                for (let j = 0; j < report.photoBuffers.length; j++) {
                    await global.raf.sendMessage(teknisiJid, {
                        image: report.photoBuffers[j],
                        caption: `📸 Foto ${j + 1} dari ${report.photoCount} - Tiket ${report.ticketId}`
                    });
                    // Small delay between photos
                    if (j < report.photoBuffers.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
        } else {
            // Send without photos
            await global.raf.sendMessage(teknisiJid, { text: message });
        }
    }
}

/**
 * Helper function to create LEMOT ticket after photo upload
 */
async function createLemotTicket(sender, state, reply) {
    const ticketId = generateTicketId();
    const speedInfo = state.speedTest ? `Speed test: ${state.speedTest} Mbps` : 'Belum speed test';

    // Get estimation time
    const estimasi = state.estimatedTime || getResponseTimeMessage('MEDIUM');
    const targetTime = state.targetTime || '';

    const newReport = {
        ticketId: ticketId,
        pelangganUserId: state.targetUser.id,
        pelangganId: sender,
        pelangganName: state.targetUser.name || 'Customer',
        pelangganPhone: state.targetUser.phone_number,
        pelangganAddress: state.targetUser.address || '',
        pelangganSubscription: state.targetUser.subscription || 'Tidak terinfo',
        laporanText: `Internet lemot/lambat - Device ONLINE\n${speedInfo}\nTroubleshooting sudah dilakukan.`,
        status: 'baru',
        priority: 'MEDIUM',
        estimatedTime: estimasi,
        targetTime: targetTime,
        createdAt: new Date().toISOString(),
        deviceOnline: true,
        deviceStatus: state.deviceStatus || {},
        issueType: 'LEMOT',
        troubleshootingDone: true,
        photoCount: state.uploadedPhotos ? state.uploadedPhotos.length : 0,
        photos: state.uploadedPhotos ? state.uploadedPhotos.map(p => p.fileName) : [],
        photoBuffers: state.photoBuffers || [] // Use separate buffer array
    };

    // Ensure global.reports is initialized (should be loaded from database.js)
    if (!global.reports) {
        console.error('[REPORT_CREATE] ERROR: global.reports not initialized! Loading from file...');
        try {
            const reportsPath = path.join(__dirname, '../../database/reports.json');
            if (fs.existsSync(reportsPath)) {
                const data = fs.readFileSync(reportsPath, 'utf8');
                global.reports = JSON.parse(data) || [];
            } else {
                global.reports = [];
            }
        } catch (err) {
            console.error('[REPORT_CREATE] Failed to load reports:', err);
            global.reports = [];
        }
    }

    // Add new report
    global.reports.push(newReport);

    // Save using proper function
    saveReports();
    console.log(`[REPORT_CREATE] Ticket ${ticketId} created for ${state.targetUser.name}`);

    // Clear state BEFORE notifying (important!)
    deleteUserState(sender);

    // NOTIFY TECHNICIANS - THIS WAS MISSING!
    await notifyTechnicians(newReport);
    console.log(`[REPORT_CREATE] Technicians notified for ticket ${ticketId}`);

    // Clear photo buffers from saved data to prevent huge JSON files
    // (buffers were only needed for sending to technicians)
    const savedReportIndex = global.reports.length - 1;
    if (global.reports[savedReportIndex]) {
        delete global.reports[savedReportIndex].photoBuffers;
        saveReports(); // Save again without buffers
    }

    return {
        success: true,
        message: `✅ *TIKET SPEED ISSUE DIBUAT*

📑 Nomor Tiket: *${ticketId}*
⚠️ Prioritas: *MEDIUM*
📉 Speed Test: *${speedInfo}*
📷 Foto: *${state.uploadedPhotos ? state.uploadedPhotos.length : 0} file dilampirkan*
⏰ Estimasi: *${estimasi}*
${targetTime ? `📅 Target: *${targetTime}*` : ''}

Teknisi akan menganalisis penyebab speed rendah.

Terima kasih! 🙏`
    };
}

/**
 * Handle Photo Upload for LEMOT Report (After choosing "tetap lemot")
 */
async function handleLemotPhotoUpload({ sender, response, photoPath, photoBuffer, reply }) {
    const state = getUserState(sender);
    if (!state || state.step !== 'LEMOT_AWAITING_PHOTO') {
        return { success: false };
    }

    // Check if this is for ticket creation
    const isForTicketCreation = state.wantToCreateTicket === true;

    // Handle text response (SKIP or LANJUT)
    if (response) {
        const lowerResponse = response.toLowerCase().trim();

        // Handle SKIP
        if (lowerResponse === 'skip') {
            console.log('[LEMOT_PHOTO] User skipped photo upload');
            state.photoSkipped = true;
            state.uploadedPhotos = [];

            // If for ticket creation, create ticket now
            if (isForTicketCreation) {
                return await createLemotTicket(sender, state, reply);
            }

            // Otherwise go back to troubleshooting (shouldn't happen)
            const stateToSave = { ...state };
            delete stateToSave.photoBuffers; // Don't save buffers
            setUserState(sender, {
                ...stateToSave,
                step: 'GANGGUAN_LEMOT_AWAITING_RESPONSE'
            });

            return {
                success: true,
                message: `⏩ Upload foto dilewati.`
            };
        }

        // Handle LANJUT with photos
        if (lowerResponse === 'lanjut' && state.uploadedPhotos && state.uploadedPhotos.length > 0) {
            console.log(`[LEMOT_PHOTO] Processing ${state.uploadedPhotos.length} photos`);

            // If for ticket creation, create ticket now with photos
            if (isForTicketCreation) {
                return await createLemotTicket(sender, state, reply);
            }

            // Otherwise shouldn't happen
            const stateToSave = { ...state };
            delete stateToSave.photoBuffers; // Don't save buffers
            setUserState(sender, {
                ...stateToSave,
                step: 'GANGGUAN_LEMOT_AWAITING_RESPONSE'
            });

            return {
                success: true,
                message: `✅ ${state.uploadedPhotos.length} foto berhasil diterima!`
            };
        }
    }

    // Handle photo upload
    if (photoPath) {
        console.log('[LEMOT_PHOTO] Photo received:', photoPath);

        // Initialize photo array if not exists
        if (!state.uploadedPhotos) {
            state.uploadedPhotos = [];
        }

        // Store photo info (fileName only, buffer kept separate)
        state.uploadedPhotos.push({
            fileName: photoPath
            // DO NOT store buffer here to avoid huge JSON files!
        });

        // Keep buffers in separate temporary array (not saved to JSON)
        if (!state.photoBuffers) {
            state.photoBuffers = [];
        }
        state.photoBuffers.push(photoBuffer);

        // Check if max photos reached
        if (state.uploadedPhotos.length >= 3) {
            // If for ticket creation, create ticket now with photos
            if (isForTicketCreation) {
                return await createLemotTicket(sender, state, reply);
            }

            // Otherwise shouldn't happen
            const stateToSave = { ...state };
            delete stateToSave.photoBuffers; // Don't save buffers
            setUserState(sender, {
                ...stateToSave,
                step: 'GANGGUAN_LEMOT_AWAITING_RESPONSE'
            });

            return {
                success: true,
                message: `✅ 3 foto berhasil diterima (maksimal).`
            };
        } else {
            // Update state and ask for more (but don't save buffers)
            const stateToSave = { ...state };
            delete stateToSave.photoBuffers; // Don't save buffers to state
            setUserState(sender, stateToSave);

            return {
                success: true,
                message: `✅ Foto ${state.uploadedPhotos.length} berhasil diterima!

📸 Anda bisa kirim foto lagi (maks 3 foto)
⏩ Atau ketik *LANJUT* untuk melanjutkan troubleshooting`
            };
        }
    }

    return {
        success: false,
        message: `⚠️ Silakan:
• Kirim foto/screenshot bukti lemot
• Ketik *SKIP* untuk lewati
• Ketik *LANJUT* jika sudah kirim foto`
    };
}

/**
 * Handle follow-up response for GANGGUAN_LEMOT
 */
async function handleGangguanLemotResponse({ sender, body, reply, msg, raf }) {
    const state = getUserState(sender);
    const response = body.toLowerCase().trim();

    // Check for cancel command (0 atau batal)
    if (response === '0' || response === 'batal' || response === 'cancel') {
        deleteUserState(sender);
        return {
            success: true,
            message: `❌ Proses laporan dibatalkan. Jika masih ada masalah, silakan lapor kembali.`
        };
    }

    // 2 = sudah cepat kembali
    if (response === '2' || response.includes('sudah cepat') || response.includes('sudahcepat')) {
        deleteUserState(sender);
        return {
            success: true,
            message: `🎉 Alhamdulillah, senang mendengarnya!\n\nJika ada masalah lagi, jangan ragu untuk chat ya. Terima kasih! 🙏`
        };
    }

    // Parse speed test result
    if (response.includes('speedtest') || response.match(/\d+(\.\d+)?\s*(mbps|mb)/i)) {
        const speedMatch = response.match(/(\d+(\.\d+)?)\s*(mbps|mb)?/i);
        if (speedMatch) {
            const speed = parseFloat(speedMatch[1]);
            const userPackage = state.targetUser.subscription || '';

            // Extract speed from package name (e.g., "Paket-10Mbps" -> 10)
            const packageSpeedMatch = userPackage.match(/(\d+)\s*mbps/i);
            const packageSpeed = packageSpeedMatch ? parseInt(packageSpeedMatch[1]) : null;

            if (packageSpeed && speed < packageSpeed * 0.5) {
                // Speed < 50% dari paket - perlu pengecekan
                setUserState(sender, {
                    ...state,
                    step: 'GANGGUAN_LEMOT_CONFIRM_TICKET',
                    speedTest: speed,
                    packageSpeed: packageSpeed
                });

                return {
                    success: true,
                    message: `📊 *Hasil Speed Test*

Hasil Anda: *${speed} Mbps*
Paket Anda: *${packageSpeed} Mbps*

⚠️ Speed Anda hanya *${Math.round(speed / packageSpeed * 100)}%* dari paket yang seharusnya.

Ini perlu pengecekan oleh teknisi.

*Pilih salah satu:*
1️⃣ Buat tiket teknisi
2️⃣ Coba lagi nanti
0️⃣ Batal

Balas dengan *angka* (1/2/0)`
                };
            } else if (packageSpeed) {
                return {
                    success: true,
                    message: `📊 *Hasil Speed Test*

Hasil: *${speed} Mbps*
Paket: *${packageSpeed} Mbps*

Speed Anda *${Math.round(speed / packageSpeed * 100)}%* dari paket, masih dalam range normal.

Jika masih terasa lemot, kemungkinan:
• Situs/server tujuan yang lemot
• Terlalu banyak device konek bersamaan
• Jam sibuk (peak hours)
• Aplikasi background makan bandwidth

Coba lagi nanti atau test dengan server lain.

*Pilih salah satu:*
1️⃣ Tetap lemot, buat tiket
2️⃣ Sudah cepat kembali
0️⃣ Batal

Balas dengan *angka* (1/2/0)`
                };
            } else {
                return {
                    success: true,
                    message: `Speed test: *${speed} Mbps*\n\n*Pilih salah satu:*
1️⃣ Tetap lemot, buat tiket
2️⃣ Sudah cepat kembali
0️⃣ Batal

Balas dengan *angka* (1/2/0)`
                };
            }
        }
    }

    // 1 = tetap lemot, ask for optional photo before creating ticket
    if (response === '1' || response.includes('tetap lemot') || response.includes('tetaplemot') || response.includes('masih lemot')) {
        // Change state to photo upload before creating ticket
        const stateToSave = { ...state };
        delete stateToSave.photoBuffers; // Don't save buffers if any
        setUserState(sender, {
            ...stateToSave,
            step: 'LEMOT_AWAITING_PHOTO',
            wantToCreateTicket: true  // Flag to create ticket after photo
        });

        return {
            success: true,
            message: `📸 *UPLOAD BUKTI (OPSIONAL)*

Untuk mempercepat penanganan teknisi, Anda bisa kirim foto/screenshot:

✅ *Yang bisa difoto:*
• Screenshot hasil speedtest
• Foto lampu indikator modem
• Screenshot error/loading
• Video buffering

📌 *Cara:*
• Kirim foto (maks 3) atau
• Ketik *SKIP* untuk lewati
• Ketik *LANJUT* jika sudah kirim foto

⏳ Menunggu foto atau ketik SKIP...`
        };
    }

    // This code will be moved to photo upload handler
    const OLD_TICKET_CREATION_DISABLED = false;
    if (OLD_TICKET_CREATION_DISABLED) {
        const ticketId = generateTicketId();
        const speedInfo = state.speedTest ? `Speed test: ${state.speedTest} Mbps` : 'Belum speed test';

        // Get estimation time for MEDIUM priority
        const estimasi = state.estimatedTime || getResponseTimeMessage('MEDIUM');
        const targetTime = state.targetTime || '';

        const newReport = {
            ticketId: ticketId,
            pelangganUserId: state.targetUser.id, // IMPORTANT: User ID untuk filter
            pelangganId: sender,
            pelangganName: state.targetUser.name || 'Customer',
            pelangganPhone: state.targetUser.phone_number,
            pelangganAddress: state.targetUser.address || '',
            pelangganSubscription: state.targetUser.subscription || 'Tidak terinfo', // ADD SUBSCRIPTION
            laporanText: `Internet lemot/lambat - Device ONLINE\n${speedInfo}\nTroubleshooting sudah dilakukan.`,
            status: 'baru',  // Standardized status for teknisi dashboard
            priority: 'MEDIUM',
            estimatedTime: estimasi,  // Add estimation time
            targetTime: targetTime,    // Add target completion time
            createdAt: new Date().toISOString(),
            deviceOnline: true,
            deviceStatus: state.deviceStatus || {},  // Include full device status
            issueType: 'LEMOT',
            troubleshootingDone: true,
            uploadedPhotos: state.uploadedPhotos || []  // Include uploaded photos
        };

        if (!global.reports) global.reports = [];
        global.reports.push(newReport);

        // Save reports to file
        try {
            const reportsPath = path.join(__dirname, '../../database/reports.json');
            fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        } catch (error) {
            console.error('[SAVE_REPORT_ERROR]', error);
        }

        // Notify teknisi untuk tiket LEMOT
        const notifMessage = `🐌 *TIKET INTERNET LEMOT*

ID: *${ticketId}*
Prioritas: *⚠️ MEDIUM*

Pelanggan: ${state.targetUser.name}
Telepon: ${state.targetUser.phone_number.split('|')[0]}
Alamat: ${state.targetUser.address}
Paket: ${state.targetUser.subscription || 'N/A'}

*Masalah:* Internet lambat/lemot
*Device Status:* ONLINE ✅
*Speed Test:* ${speedInfo}

*Kemungkinan penyebab:*
• Bandwidth penuh/overload
• Interference WiFi
• Kualitas sinyal menurun
• Peak hour traffic

Untuk proses tiket, ketik:
*proses ${ticketId}*`;

        // Send to teknisi with delay to prevent spam
        const teknisiAccounts = global.accounts.filter(acc =>
            acc.role === 'teknisi' && acc.phone_number && acc.phone_number.trim() !== ""
        );

        // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
        for (let i = 0; i < teknisiAccounts.length; i++) {
            const teknisi = teknisiAccounts[i];

            // Add delay between notifications (2 seconds between each)
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            if (global.whatsappConnectionState === 'open' && global.raf && global.raf.sendMessage) {
                try {
                    let teknisiJid = teknisi.phone_number.trim();
                    if (!teknisiJid.endsWith('@s.whatsapp.net')) {
                        if (teknisiJid.startsWith('0')) {
                            teknisiJid = `62${teknisiJid.substring(1)}@s.whatsapp.net`;
                        } else if (teknisiJid.startsWith('62')) {
                            teknisiJid = `${teknisiJid}@s.whatsapp.net`;
                        } else {
                            teknisiJid = `62${teknisiJid}@s.whatsapp.net`;
                        }
                    }
                    await global.raf.sendMessage(teknisiJid, { text: notifMessage });
                } catch (err) {
                    console.error('[SEND_MESSAGE_ERROR]', {
                        teknisiJid: teknisi.phone_number,
                        error: err.message
                    });
                    console.error(`Failed to notify teknisi ${teknisi.username}:`, err.message);
                    // Continue to next teknisi
                }
            } else {
                console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to teknisi', teknisi.username);
            }
        }

        deleteUserState(sender);

        return {
            success: true,
            message: `✅ *TIKET INTERNET LEMOT DIBUAT*

📋 Nomor Tiket: *${ticketId}*
⚠️ Prioritas: *MEDIUM*
⏰ Estimasi Penanganan: *${estimasi}*
${targetTime ? `📅 Target Selesai: *${targetTime}*` : ''}

Teknisi akan menganalisis dan menghubungi Anda untuk pengecekan lebih lanjut.

Mohon pastikan HP aktif untuk koordinasi dengan teknisi.

Terima kasih atas kesabarannya! 🙏`
        };
    }

    // Handle "buat tiket" response after speed test (also accept "1")
    if (state.step === 'GANGGUAN_LEMOT_CONFIRM_TICKET' && (response === '1' || response.includes('buat tiket') || response.includes('buattiket'))) {
        // User confirm create ticket after speed test
        const ticketId = generateTicketId();
        const speedInfo = state.speedTest ? `Speed test: ${state.speedTest} Mbps (seharusnya ${state.packageSpeed} Mbps)` : '';

        // Get estimation time for MEDIUM priority
        const estimasi = state.estimatedTime || getResponseTimeMessage('MEDIUM');
        const targetTime = state.targetTime || '';

        const newReport = {
            ticketId: ticketId,
            pelangganUserId: state.targetUser.id, // IMPORTANT: User ID untuk filter
            pelangganId: sender,
            pelangganName: state.targetUser.name || 'Customer',
            pelangganPhone: state.targetUser.phone_number,
            pelangganAddress: state.targetUser.address || '',
            pelangganSubscription: state.targetUser.subscription || 'Tidak terinfo', // ADD SUBSCRIPTION
            laporanText: `Internet lemot - Speed di bawah 50% paket\n${speedInfo}`,
            status: 'baru',  // Standardized status for teknisi dashboard
            priority: 'MEDIUM',
            estimatedTime: estimasi,  // Add estimation time
            targetTime: targetTime,    // Add target completion time
            createdAt: new Date().toISOString(),
            deviceOnline: true,
            deviceStatus: state.deviceStatus || {},  // Include full device status
            issueType: 'LEMOT',
            troubleshootingDone: true
        };

        if (!global.reports) global.reports = [];
        global.reports.push(newReport);

        // Save reports to file
        try {
            const reportsPath = path.join(__dirname, '../../database/reports.json');
            fs.writeFileSync(reportsPath, JSON.stringify(global.reports, null, 2));
        } catch (error) {
            console.error('[SAVE_REPORT_ERROR]', error);
        }

        deleteUserState(sender);

        return {
            success: true,
            message: `✅ *TIKET SPEED ISSUE DIBUAT*

📋 Nomor Tiket: *${ticketId}*
⚠️ Prioritas: *MEDIUM*
📉 Speed Test: *${state.speedTest || 'N/A'} Mbps*
📦 Paket: *${state.packageSpeed || 'N/A'} Mbps*
⏰ Estimasi: *${estimasi}*
${targetTime ? `📅 Target: *${targetTime}*` : ''}

Teknisi akan menganalisis penyebab speed rendah.

Terima kasih! 🙏`
        };
    }

    // Handle "nanti dulu" or "2" (coba lagi nanti)
    if (response === '2' || response.includes('nanti') || response.includes('coba lagi')) {
        deleteUserState(sender);
        return {
            success: true,
            message: `Baik, silakan coba lagi nanti ya Kak.\n\nJika masih lemot, jangan ragu untuk lapor kembali. Semoga segera membaik! 🙏`
        };
    }

    // Default - remind user with numbers
    return {
        success: true,
        message: `Mohon balas dengan angka:\n*1* - Tetap lemot, buat tiket\n*2* - Sudah cepat kembali\n*0* - Batal\n\nAtau kirim hasil speedtest:\n*speedtest [mbps]* - Contoh: speedtest 20`
    };
}

module.exports = {
    handleGangguanMati,
    handleGangguanMatiAutoRedirect,
    handleGangguanLemot,
    handleGangguanMatiOfflineResponse,
    handleGangguanMatiOnlineResponse,
    handleLemotPhotoUpload,
    handleGangguanLemotResponse
};
