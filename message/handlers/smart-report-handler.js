/**
 * Header Doc
 * Purpose: Workflow laporan gangguan cerdas WhatsApp berbasis deteksi status perangkat, troubleshooting, upload bukti, dan pembuatan tiket.
 * Caller: `message/handlers/domains/reporting.domain.js`, `message/raf.js`, dan state reporting legacy.
 * Deps: device-status, conversation-handler, jid-utils, working-hours-helper, templating, report helper/orchestration/notification, WhatsApp delivery service.
 * MainFuncs: handleGangguanMati, handleGangguanMatiAutoRedirect, handleGangguanLemot, handleGangguanMatiOfflineResponse, handleGangguanMatiOnlineResponse, handleLemotPhotoUpload, handleGangguanLemotResponse.
 * SideEffects: Membaca global users/reports/accounts/config, menulis state percakapan, membuat tiket laporan, dan mengirim notifikasi WhatsApp teknisi.
 */

const { isDeviceOnline } = require('../../lib/device-status');
const { setUserState, getUserState, deleteUserState, format } = require('./conversation-handler');
const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { getResponseTimeMessage, isWithinWorkingHours } = require('../../lib/working-hours-helper');
const { renderReport } = require('../../lib/templating');
const { hasActiveReport } = require('../../lib/report-helper');
const { createCustomerReportTicket } = require('../../lib/report-orchestration-service');
const { notifyNewReport } = require('../../lib/report-notification-service');
const { sendMessageToMany } = require('../../lib/whatsapp-delivery-service');

function renderResponseTemplate(key, fallback, data = {}) {
    const rendered = format(key, data);
    return rendered && rendered.trim() ? rendered : fallback;
}

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
                message: renderResponseTemplate(
                    'smart_report_handler_lid_not_registered',
                    'Nomor belum terdaftar. Silakan hubungi admin.'
                )
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
                message: renderResponseTemplate(
                    'smart_report_handler_mati_offline_menu',
                    'Perangkat terdeteksi offline. Balas 1, 2, 3, atau 0.',
                    { minutesAgo, outOfHoursNotice }
                )
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
                message: renderResponseTemplate(
                    'smart_report_handler_mati_online_menu',
                    'Perangkat online. Balas 1, 2, atau 0.'
                )
            };
        }

    } catch (error) {
        console.error('[handleGangguanMati] Error:', error);
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_handler_device_check_error',
                'Status perangkat belum bisa dicek. Silakan coba lagi atau hubungi admin.'
            )
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

        const message = renderResponseTemplate(
            'smart_report_handler_lemot_auto_redirect_menu',
            'Perangkat terdeteksi offline. Balas 1, 2, 3, atau 0.',
            {
                minutesAgo,
                estimasi,
                targetTimeLine: targetTime ? `• Target Waktu: *${targetTime}*` : '',
                outOfHoursNotice
            }
        );

        return {
            success: true,
            message: message
        };

    } catch (error) {
        console.error('[handleGangguanMatiAutoRedirect] Error:', error);
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_handler_lemot_error',
                'Laporan belum bisa diproses. Silakan coba lagi.'
            )
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
                message: renderResponseTemplate(
                    'smart_report_handler_lid_not_registered',
                    'Nomor belum terdaftar. Silakan hubungi admin.'
                )
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
                message: renderResponseTemplate(
                    'smart_report_handler_lemot_active_report',
                    'Masih ada laporan aktif. Mohon tunggu hingga selesai diproses.',
                    { ticketId: laporanAktif.ticketId }
                )
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
            message: renderResponseTemplate(
                'smart_report_handler_lemot_menu',
                'Koneksi lambat terdeteksi. Balas 1, 2, 3, atau 0.',
                {
                    paketUser,
                    estimasiLemot,
                    targetTimeLine: targetTimeLemot ? `• Target selesai: *${targetTimeLemot}*` : ''
                }
            )
        };

    } catch (error) {
        console.error('[handleGangguanLemot] Error:', error);
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_handler_lemot_error',
                'Koneksi belum bisa dianalisis. Silakan coba lagi atau hubungi admin.'
            )
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
            message: renderResponseTemplate(
                'smart_report_handler_report_cancelled',
                'Laporan dibatalkan. Silakan lapor kembali jika masih ada masalah.'
            )
        };
    }

    // 3 = sudah bisa/normal kembali (cek dulu — masalah selesai punya prioritas)
    const solvedKeywords = [
        'sudah bisa', 'sudahbisa', 'udah bisa', 'udahbisa',
        'sudah normal', 'udah normal', 'normal',
        'sudah ok', 'udah ok', 'sudah oke', 'udah oke',
        'sudah selesai', 'udah selesai',
        'sudah jalan', 'udah jalan',
        'sudah aktif', 'udah aktif',
        'sudah nyala', 'udah nyala'
    ];
    if (response === '3' || solvedKeywords.some(kw => response.includes(kw))) {
        deleteUserState(sender);
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_handler_problem_solved',
                'Terima kasih. Silakan hubungi kami kembali jika masalah muncul lagi.'
            )
        };
    }

    // 1 = sudah dicoba masih mati — whitelist eksplisit, hindari fallthrough generik "sudah"
    const stillDownKeywords = [
        'sudah dicoba', 'udah dicoba',
        'sudah coba', 'udah coba',
        'tetap mati', 'tetapmati',
        'masih mati', 'masihmati',
        'belum bisa', 'belumbisa',
        'belum nyala', 'belumnyala'
    ];
    if (response === '1' || stillDownKeywords.some(kw => response.includes(kw))) {
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
            message: renderResponseTemplate(
                'smart_report_handler_mati_photo_prompt',
                'Silakan kirim foto bukti atau ketik skip.'
            )
        };
    }

    // 2 = belum dicoba - Show detailed troubleshooting guide
    if (response === '2' || response.includes('belum')) {
        // Keep state but don't create ticket yet
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_handler_mati_restart_guide',
                'Coba restart modem dan cek kabel. Setelah itu balas 1, 3, atau 0.'
            )
        };
    }

    // Default - remind user
    return {
        success: true,
        message: renderResponseTemplate(
            'smart_report_handler_mati_invalid_response',
            'Balas 1, 2, 3, atau 0.'
        )
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
            message: renderResponseTemplate(
                'smart_report_handler_report_cancelled',
                'Laporan dibatalkan. Silakan lapor kembali jika masih ada masalah.'
            )
        };
    }

    // 2 = sudah bisa terkoneksi
    if (response === '2' || response.includes('sudah bisa') || response.includes('sudahbisa') || response.includes('terkoneksi')) {
        deleteUserState(sender);
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_handler_problem_solved',
                'Terima kasih. Silakan hubungi kami kembali jika masalah muncul lagi.'
            )
        };
    }

    // 1 = tetap mati
    if (response === '1' || response.includes('tetap mati') || response.includes('tetapmati') || response.includes('masih mati')) {
        // CREATE MEDIUM PRIORITY TICKET (modem online, WiFi issue)
        const newReport = await createCustomerReportTicket({
            user: state.targetUser,
            sender,
            laporanText: 'Tidak bisa konek WiFi - Device ONLINE\nModem terdeteksi aktif tapi WiFi tidak bisa diakses.\nTroubleshooting sudah dilakukan.',
            issueType: 'WIFI_ISSUE',
            priority: 'MEDIUM',
            createdBy: sender,
            createdByRole: 'customer',
            additionalFields: {
                deviceOnline: true,
                troubleshootingDone: true
            }
        });
        const ticketId = newReport.ticketId;

        // Notify teknisi dan admin - MEDIUM priority
        const notifMessage = renderResponseTemplate(
            'smart_report_handler_wifi_ticket_technician_notification',
            `Tiket WiFi baru ${ticketId}`,
            {
                ticketId,
                customerName: state.targetUser.name || '-',
                customerPhone: (state.targetUser.phone_number || '').split('|')[0] || '-',
                customerAddress: state.targetUser.address || '-',
                customerPackage: state.targetUser.subscription || 'N/A'
            }
        );

        // Send to all teknisi
        const teknisiAccounts = global.accounts.filter(acc =>
            acc.role === 'teknisi' && acc.phone_number && acc.phone_number.trim() !== ""
        );

        const teknisiRecipients = teknisiAccounts.map((teknisi) => teknisi.phone_number);
        await sendMessageToMany(teknisiRecipients, { text: notifMessage });

        deleteUserState(sender);

        const responseTime = getResponseTimeMessage('MEDIUM');

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_handler_wifi_ticket_customer_success',
                `Tiket ${ticketId} dibuat. Teknisi akan menghubungi Anda.`,
                { ticketId, responseTime }
            )
        };
    }

    // Default - remind user with numbers
    return {
        success: true,
        message: renderResponseTemplate(
            'smart_report_handler_mati_invalid_response',
            'Balas 1, 2, atau 0.'
        )
    };
}

/**
 * Notify technicians about new ticket
 */
async function notifyTechnicians(report) {
    return notifyNewReport(report, { photoBuffers: report.photoBuffers || [] });
}

/**
 * Helper function to create LEMOT ticket after photo upload
 */
async function createLemotTicket(sender, state, reply) {
    const speedInfo = state.speedTest ? `Speed test: ${state.speedTest} Mbps` : 'Belum speed test';

    // Get estimation time
    const estimasi = state.estimatedTime || getResponseTimeMessage('MEDIUM');
    const targetTime = state.targetTime || '';

    const customerPhotos = Array.isArray(state.uploadedPhotos)
        ? state.uploadedPhotos.map((photo, index) => ({
            fileName: photo.fileName,
            path: photo.path,
            uploadedAt: photo.uploadedAt || new Date().toISOString(),
            uploadedBy: 'customer',
            source: 'customer',
            order: index + 1
        }))
        : [];
    const newReport = await createCustomerReportTicket({
        user: state.targetUser,
        sender,
        laporanText: `Internet lemot/lambat - Device ONLINE\n${speedInfo}\nTroubleshooting sudah dilakukan.`,
        issueType: 'LEMOT',
        priority: 'MEDIUM',
        createdBy: sender,
        createdByRole: 'customer',
        customerPhotos,
        photoBuffers: state.photoBuffers || [],
        additionalFields: {
            deviceOnline: true,
            troubleshootingDone: true
        }
    });
    const ticketId = newReport.ticketId;
    console.log(`[REPORT_CREATE] Ticket ${ticketId} created for ${state.targetUser.name}`);

    // Clear state BEFORE notifying (important!)
    deleteUserState(sender);

    // NOTIFY TECHNICIANS - THIS WAS MISSING!
    await notifyTechnicians(newReport);
    console.log(`[REPORT_CREATE] Technicians notified for ticket ${ticketId}`);

    // Clear photo buffers from saved data to prevent huge JSON files
    // (buffers were only needed for sending to technicians)
    delete newReport.photoBuffers;

    return {
        success: true,
        message: renderResponseTemplate(
            'smart_report_handler_lemot_ticket_created_success',
            `Tiket speed issue ${ticketId} dibuat.`,
            {
                ticketId,
                speedInfo,
                photoCount: state.uploadedPhotos ? state.uploadedPhotos.length : 0,
                estimasi,
                targetTimeLine: targetTime ? `Target: *${targetTime}*` : ''
            }
        )
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
                message: renderResponseTemplate(
                    'smart_report_handler_lemot_photo_skipped',
                    'Foto dilewati.'
                )
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
                message: renderResponseTemplate(
                    'smart_report_handler_lemot_photo_received',
                    `${state.uploadedPhotos.length} foto diterima.`,
                    { photoCount: state.uploadedPhotos.length }
                )
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
                    message: renderResponseTemplate(
                        'smart_report_handler_lemot_photo_max',
                        'Maksimal foto diterima.'
                    )
                };
        } else {
            // Update state and ask for more (but don't save buffers)
            const stateToSave = { ...state };
            delete stateToSave.photoBuffers; // Don't save buffers to state
            setUserState(sender, stateToSave);

                return {
                    success: true,
                    message: renderResponseTemplate(
                        'smart_report_handler_lemot_photo_more',
                        `Foto ${state.uploadedPhotos.length} diterima. Kirim lagi atau ketik LANJUT.`,
                        { photoCount: state.uploadedPhotos.length }
                    )
                };
        }
    }

    return {
        success: false,
        message: renderResponseTemplate(
            'smart_report_handler_lemot_photo_invalid',
            'Silakan kirim foto, ketik SKIP, atau ketik LANJUT.'
        )
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
            message: renderResponseTemplate(
                'smart_report_handler_report_cancelled',
                'Laporan dibatalkan. Silakan lapor kembali jika masih ada masalah.'
            )
        };
    }

    // 2 = sudah cepat kembali
    if (response === '2' || response.includes('sudah cepat') || response.includes('sudahcepat')) {
        deleteUserState(sender);
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_handler_problem_solved',
                'Terima kasih. Silakan hubungi kami kembali jika masalah muncul lagi.'
            )
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

            // Tolak angka tidak masuk akal: 0 atau NaN, atau > 2x paket (kemungkinan salah ketik).
            if (!Number.isFinite(speed) || speed <= 0) {
                return {
                    success: true,
                    message: renderResponseTemplate(
                        'smart_report_handler_speedtest_invalid',
                        '⚠️ Angka speedtest tidak valid. Coba kirim ulang hasil speedtest, contoh: "speedtest 5 mbps".'
                    )
                };
            }
            if (packageSpeed && speed > packageSpeed * 2) {
                return {
                    success: true,
                    message: renderResponseTemplate(
                        'smart_report_handler_speedtest_unrealistic',
                        `⚠️ Angka ${speed} Mbps terlalu tinggi untuk paket ${packageSpeed} Mbps. Coba kirim ulang hasil speedtest yang benar.`,
                        { speed, packageSpeed }
                    )
                };
            }

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
                        message: renderResponseTemplate(
                            'smart_report_handler_speedtest_low',
                            'Hasil speedtest rendah. Balas 1, 2, atau 0.',
                            {
                                speed,
                                packageSpeed,
                                percentage: Math.round(speed / packageSpeed * 100)
                            }
                        )
                    };
                } else if (packageSpeed) {
                    return {
                        success: true,
                        message: renderResponseTemplate(
                            'smart_report_handler_speedtest_normal',
                            'Hasil speedtest masih dalam range normal. Balas 1, 2, atau 0.',
                            {
                                speed,
                                packageSpeed,
                                percentage: Math.round(speed / packageSpeed * 100)
                            }
                        )
                    };
                } else {
                    return {
                        success: true,
                        message: renderResponseTemplate(
                            'smart_report_handler_speedtest_recorded',
                            `Speedtest ${speed} Mbps dicatat. Balas 1, 2, atau 0.`,
                            { speed }
                        )
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
            message: renderResponseTemplate(
                'smart_report_handler_lemot_photo_prompt',
                'Silakan kirim foto/screenshot, ketik SKIP, atau ketik LANJUT.'
            )
        };
    }

    // Handle "buat tiket" response after speed test (also accept "1")
    if (state.step === 'GANGGUAN_LEMOT_CONFIRM_TICKET' && (response === '1' || response.includes('buat tiket') || response.includes('buattiket'))) {
        // User confirm create ticket after speed test
        const speedInfo = state.speedTest ? `Speed test: ${state.speedTest} Mbps (seharusnya ${state.packageSpeed} Mbps)` : '';

        // Get estimation time for MEDIUM priority
        const estimasi = state.estimatedTime || getResponseTimeMessage('MEDIUM');
        const targetTime = state.targetTime || '';

        const newReport = await createCustomerReportTicket({
            user: state.targetUser,
            sender,
            laporanText: `Internet lemot - Speed di bawah 50% paket\n${speedInfo}`,
            issueType: 'LEMOT',
            priority: 'MEDIUM',
            createdBy: sender,
            createdByRole: 'customer',
            additionalFields: {
                deviceOnline: true,
                troubleshootingDone: true
            }
        });
        const ticketId = newReport.ticketId;

        deleteUserState(sender);

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_handler_lemot_ticket_created_success',
                `Tiket speed issue ${ticketId} dibuat.`,
                {
                    ticketId,
                    speedInfo: `${state.speedTest || 'N/A'} Mbps`,
                    photoCount: 0,
                    estimasi,
                    targetTimeLine: targetTime ? `Target: *${targetTime}*` : ''
                }
            )
        };
    }

    // Handle "nanti dulu" or "2" (coba lagi nanti)
    if (response === '2' || response.includes('nanti') || response.includes('coba lagi')) {
        deleteUserState(sender);
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_handler_lemot_retry_later',
                'Silakan coba lagi nanti. Jika masih bermasalah, lapor kembali.'
            )
        };
    }

    // Default - remind user with numbers
    return {
        success: true,
        message: renderResponseTemplate(
            'smart_report_handler_mati_invalid_response',
            'Balas 1, 2, atau 0. Anda juga bisa mengirim hasil speedtest.'
        )
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
