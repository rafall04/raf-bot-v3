/**
 * Header Doc
 * Purpose: Workflow laporan gangguan WhatsApp berbasis menu teks untuk pelanggan, termasuk cek device, troubleshooting, dan pembuatan tiket.
 * Caller: `message/handlers/domains/reporting.domain.js` dan state reporting dari router bot WhatsApp.
 * Deps: device status, conversation state, working-hours helper, report orchestration/notification, WhatsApp delivery service.
 * MainFuncs: startReportFlow, handleMenuSelection, handleInternetMati, handleInternetLemot, handleTroubleshootResult, handleMatiConfirmation, handleMatiTroubleshootOptions, handleMatiPhotoUpload.
 * SideEffects: Membaca state/customer/report global legacy, menulis state percakapan, membuat tiket, dan mengirim notifikasi WhatsApp teknisi.
 */

const { isDeviceOnline, getDeviceOfflineMessage: _getDeviceOfflineMessage } = require('../../lib/device-status');
const { setUserState, getUserState, deleteUserState, format, registerStateTimeoutHandler } = require('./conversation-handler');
// Draft DURABEL: state percakapan + timer timeout sama-sama hidup di memori dan lenyap saat
// `pm2 restart`. Store ini yang membuat laporan pelanggan tetap ada sesudahnya.
const { simpanDraft, hapusDraft } = require('../../lib/laporan-draft-store');
const { getResponseTimeMessage, isWithinWorkingHours } = require('../../lib/working-hours-helper');
const { hasActiveReport } = require('../../lib/report-helper');
const { resolveCustomerBySender } = require('../../lib/jid-utils');
const { createCustomerReportTicket } = require('../../lib/report-orchestration-service');
const { notifyNewReport } = require('../../lib/report-notification-service');
const { isCleanConsent, isDecline } = require('../../lib/affirmative-parser');

// Kata yang wajar muncul saat pelanggan menyetujui pembuatan tiket, jadi tak boleh dianggap
// "muatan lain" oleh blocklist konsen yang disusun dari sudut pandang reboot.
const TICKET_CONSENT_ON_TOPIC = ['lapor', 'laporan', 'keluhan', 'komplain'];

function getReportStateId(sender, stateKey) {
    return stateKey || sender;
}

function getReportCustomer(state) {
    return state?.customer || state?.userData || state?.targetUser || null;
}

function getReportAttachments(state) {
    return state?.attachments || state?.uploadedPhotos || [];
}

function buildReportState(baseState = {}, updates = {}) {
    const customer = updates.customer || getReportCustomer(baseState);
    return {
        ...baseState,
        ...updates,
        flow: 'report',
        customer,
        userData: customer,
        targetUser: customer,
        ticketDraft: {
            ...(baseState.ticketDraft || {}),
            ...(updates.ticketDraft || {})
        },
        diagnostic: {
            ...(baseState.diagnostic || {}),
            ...(updates.diagnostic || {})
        },
        attachments: updates.attachments || getReportAttachments(baseState)
    };
}

function renderResponseTemplate(key, fallback, data = {}) {
    const rendered = format(key, data);
    return rendered && rendered.trim() ? rendered : fallback;
}

// Generate ticket ID function

/**
 * Start report flow dengan menu interaktif
 */
async function startReportFlow({ sender, pushname: _pushname, reply: _reply, msg, raf, stateKey }) {
    try {
        const resolved = await resolveCustomerBySender({
            users: global.users || [],
            sender,
            msg,
            raf
        });
        const user = resolved.user;

        // Handle @lid users - no manual verification needed
        if (!user && sender.endsWith('@lid')) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'smart_report_text_lid_not_registered',
                    'Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.'
                )
            };
        }

        if (!user) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'smart_report_text_customer_not_registered',
                    'Nomor Anda belum terdaftar sebagai pelanggan.\n\nSilakan hubungi admin untuk mendaftar.'
                )
            };
        }

        // Check for existing active report menggunakan helper function
        const activeReport = hasActiveReport(user.id, global.reports);

        if (activeReport) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'smart_report_text_active_report_found',
                    'Laporan aktif ditemukan.\n\nID Tiket: *${ticketId}*\nStatus: *${status}*\nDibuat: ${createdAt}\n\nHarap tunggu penyelesaian tiket ini.\nKetik *cektiket ${ticketId}* untuk status.',
                    {
                        ticketId: activeReport.ticketId,
                        status: activeReport.status,
                        createdAt: new Date(activeReport.createdAt).toLocaleString('id-ID')
                    }
                )
            };
        }

        // Set state for text-based flow
        setUserState(getReportStateId(sender, stateKey), buildReportState({}, {
            step: 'REPORT_MENU',
            ownerType: 'customer',
            customer: user,
            context: {
                entrypoint: 'smart-report-text-menu'
            }
        }));

        // Send interactive text menu
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_main_menu',
                'Menu laporan gangguan.\n\nBalas 1, 2, atau 3.'
            )
        };

    } catch (error) {
        console.error('[REPORT_START_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_text_generic_error',
                'Terjadi kesalahan. Silakan coba lagi.'
            )
        };
    }
}

/**
 * Handle menu selection
 */
async function handleMenuSelection({ sender, choice, reply, msg = null, raf = null, stateKey }) {
    const stateId = getReportStateId(sender, stateKey);
    const state = getUserState(stateId);
    if (!state || state.step !== 'REPORT_MENU') {
        return { success: false };
    }

    const user = getReportCustomer(state);
    const selection = choice.trim();

    if (selection === '1' || selection.includes('mati')) {
        return await handleInternetMati({ sender, pushname: user?.username || user?.full_name, reply, msg, raf, stateKey: stateId });
    } else if (selection === '2' || selection.includes('lemot')) {
        return await handleInternetLemot({ sender, pushname: user?.username || user?.full_name, reply, msg, raf, stateKey: stateId });
    } else if (selection === '3' || selection.includes('lain')) {
        deleteUserState(stateId);
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_contact_customer_service',
                'Silakan hubungi layanan pelanggan untuk gangguan lain.'
            )
        };
    } else {
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_text_invalid_menu_choice',
                'Input menu tidak sesuai. Balas 1, 2, atau 3.'
            )
        };
    }
}

/**
 * Handle Internet Mati with Troubleshooting Options
 */
async function handleInternetMati({ sender, pushname: _pushname, reply: _reply, msg, raf, stateKey }) {
    try {
        const resolved = await resolveCustomerBySender({
            users: global.users || [],
            sender,
            msg,
            raf
        });
        const user = resolved.user;

        if (!user && sender.endsWith('@lid')) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'smart_report_text_lid_not_registered',
                    'Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.'
                )
            };
        }

        if (!user) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'smart_report_text_customer_data_missing',
                    'Data pelanggan tidak ditemukan. Silakan hubungi admin.'
                )
            };
        }

        // Check device status via GenieACS
        // Use device_id from user record, fallback to mock if not available
        const deviceId = user.device_id || `DEVICE-${user.id}`; // Proper device ID needed
        const deviceStatus = await isDeviceOnline(deviceId);

        // Format last online time - ALWAYS show in minutes for accuracy
        let lastOnlineText = '';
        let offlineMinutes = null;

        if (deviceStatus.lastInform) {
            const lastSeenDate = new Date(deviceStatus.lastInform);
            const now = new Date();
            offlineMinutes = Math.floor((now - lastSeenDate) / 1000 / 60);
            const diffHours = Math.floor(offlineMinutes / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffDays > 0) {
                lastOnlineText = `${diffDays} hari yang lalu (${offlineMinutes} menit)`;
            } else if (diffHours > 0) {
                lastOnlineText = `${diffHours} jam ${offlineMinutes % 60} menit yang lalu`;
            } else if (offlineMinutes > 0) {
                lastOnlineText = `${offlineMinutes} menit yang lalu`;
            } else {
                lastOnlineText = 'Baru saja (< 1 menit)';
            }
        } else {
            lastOnlineText = 'Tidak diketahui';
        }

        let statusSection = '';
        if (deviceStatus.mockMode) {
            statusSection = 'Status Modem: *Checking manual...*\nCatatan: Teknisi akan cek langsung ke lokasi';
        } else if (deviceStatus.online === false) {
            statusSection = `Status Modem: *OFFLINE*\nTerakhir Online: *${lastOnlineText}*`;
        } else {
            statusSection = 'Status Modem: *ONLINE*\nCatatan: Modem terdeteksi online, mungkin masalah di jaringan lokal';
        }

        // Save state for next step
        const stateId = getReportStateId(sender, stateKey);
        setUserState(stateId, buildReportState(getUserState(stateId) || {}, {
            step: 'REPORT_MATI_TROUBLESHOOT',
            customer: user,
            ticketDraft: {
                issueType: 'MATI'
            },
            diagnostic: {
                deviceStatus,
                issueType: 'MATI',
                lastOnlineText
            },
            issueType: 'MATI',
            lastOnlineText
        }));

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_mati_troubleshoot_menu',
                'Menu gangguan internet mati.\n\n${statusSection}\n\nBalas 1/2/3 untuk langkah berikutnya.',
                { statusSection }
            )
        };

    } catch (error) {
        console.error('[HANDLE_MATI_ERROR]', error);
        deleteUserState(getReportStateId(sender, stateKey));
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_text_device_check_failed',
                'Pemeriksaan perangkat gagal. Silakan coba lagi.'
            )
        };
    }
}

/**
 * Handle Internet Lemot with Auto-Redirect if Device Offline
 */
async function handleInternetLemot({ sender, pushname: _pushname, reply: _reply, msg, raf, stateKey }) {
    try {
        const resolved = await resolveCustomerBySender({
            users: global.users || [],
            sender,
            msg,
            raf
        });
        const user = resolved.user;

        if (!user && sender.endsWith('@lid')) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'smart_report_text_lid_not_registered',
                    'Maaf, nomor Anda tidak terdaftar dalam database.\n\nSilakan hubungi admin untuk bantuan.'
                )
            };
        }

        if (!user) {
            return {
                success: false,
                message: renderResponseTemplate(
                    'smart_report_text_customer_data_missing',
                    'Data pelanggan tidak ditemukan. Silakan hubungi admin.'
                )
            };
        }

        // Check device status FIRST
        const deviceId = user.device_id || `DEVICE-${user.id}`;
        const deviceStatus = await isDeviceOnline(deviceId);

        // !! JANGAN memvonis "modem mati" dari UMUR INFORM saja (#b261).
        //
        // Inform periodik di ACS ini 900 detik, jadi modem yang sehat pun sering terlihat "diam".
        // Terukur 160 modem: ambang 5 menit memvonis mati 79% modem yang baik-baik saja. Pelanggan
        // yang mengeluh LEMOT lalu dialihkan ke alur MATI diberi tahu perangkatnya rusak, dan
        // disuruh mengurus benda yang bukan penyebabnya — sementara sebab sebenarnya sering ada
        // di JARINGAN (gangguan upstream), bukan di rumahnya.
        //
        // Karena itu pengalihan menuntut BUKTI POSITIF bahwa modem tak terjangkau: connection
        // request yang TIDAK dijawab (HTTP 202 = cuma masuk antrean). Modem yang menjawab (200)
        // membuktikan dirinya hidup — terukur menjawab dalam 0,6–7 detik.
        //
        // Kalau probe-nya sendiri gagal (ACS error/timeout), kita sedang BUTA. Aturan rumah:
        // "cannot observe" != "observed bad" — maka keluhan pelanggan yang dipercaya, dan alur
        // LEMOT diteruskan. Salah menebak ke arah ini hanya membuat kita mendiagnosa lebih jauh;
        // salah ke arah sebaliknya membuat kita membantah pelanggan yang benar.
        let alihkanKeMati = false;
        let buktiJangkau = null;
        if (deviceStatus.online === false) {
            try {
                const { probeDeviceReachable } = require('../../lib/genieacs');
                buktiJangkau = await probeDeviceReachable(deviceId, { operation: 'lemot.buktiJangkau' });
            } catch (_e) {
                buktiJangkau = { reachable: null, reason: 'probe gagal dimuat' };
            }
            alihkanKeMati = buktiJangkau && buktiJangkau.reachable === false;
            console.log(
                `[LEMOT_BUKTI] inform ${deviceStatus.minutesAgo} mnt lalu | probe: ${buktiJangkau ? buktiJangkau.reason : '-'}` +
                ` (${buktiJangkau && buktiJangkau.httpStatus ? 'HTTP ' + buktiJangkau.httpStatus : 'tanpa status'})` +
                ` -> ${alihkanKeMati ? 'ALIHKAN ke MATI' : 'TETAP di alur LEMOT'}`
            );
        }

        // IMPORTANT: Check if device is OFFLINE and auto-redirect to MATI flow
        if (alihkanKeMati) {
            console.log('[AUTO-REDIRECT] User selected LEMOT but device is OFFLINE - redirecting to MATI flow');

            // Get offline duration
            let lastOnlineText = 'Tidak diketahui';
            let offlineMinutes = null;

            if (deviceStatus.lastInform) {
                const lastSeenDate = new Date(deviceStatus.lastInform);
                const now = new Date();
                offlineMinutes = Math.floor((now - lastSeenDate) / 1000 / 60);
                const diffHours = Math.floor(offlineMinutes / 60);
                const diffDays = Math.floor(diffHours / 24);

                if (diffDays > 0) {
                    lastOnlineText = `${diffDays} hari yang lalu`;
                } else if (diffHours > 0) {
                    lastOnlineText = `${diffHours} jam ${offlineMinutes % 60} menit yang lalu`;
                } else if (offlineMinutes > 0) {
                    lastOnlineText = `${offlineMinutes} menit yang lalu`;
                } else {
                    lastOnlineText = 'Baru saja (< 1 menit)';
                }
            }

            // Get estimation time for HIGH priority
            const estimasi = getResponseTimeMessage('HIGH');
            const workingStatus = isWithinWorkingHours();
            let targetTime = '';

            if (workingStatus.isWithinHours) {
                const now = new Date();
                const target = new Date(now.getTime() + 2 * 60 * 60 * 1000);
                targetTime = `Hari ini sebelum ${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')} WIB`;
            } else {
                if (workingStatus.nextWorkingTime) {
                    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
                    const next = workingStatus.nextWorkingTime;
                    targetTime = `${dayNames[next.getDay()]} pukul ${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')} WIB`;
                }
            }

            // Save state for MATI flow instead of LEMOT
            const stateId = getReportStateId(sender, stateKey);
            setUserState(stateId, buildReportState(getUserState(stateId) || {}, {
                step: 'REPORT_MATI_TROUBLESHOOT',
                customer: user,
                ticketDraft: {
                    issueType: 'MATI'
                },
                diagnostic: {
                    deviceStatus,
                    issueType: 'MATI',
                    lastOnlineText,
                    autoRedirected: true,
                    originalSelection: 'LEMOT',
                    estimatedTime: estimasi,
                    targetTime
                },
                issueType: 'MATI',
                lastOnlineText,
                autoRedirected: true,
                originalSelection: 'LEMOT',
                estimatedTime: estimasi,
                targetTime
            }));

            // Return MATI flow message instead of LEMOT
            return {
                success: true,
                message: renderResponseTemplate(
                    'smart_report_text_lemot_auto_redirect_menu',
                    'Device terdeteksi offline.\n\nTerakhir Online: *${lastOnlineText}*\nEstimasi: *${estimasi}*\n${targetLine}\nBalas 1/2/3 untuk langkah berikutnya.',
                    {
                        lastOnlineText,
                        estimasi,
                        targetLine: targetTime ? `Target: *${targetTime}*` : ''
                    }
                )
            };
        }

        // Device is ONLINE - continue with normal LEMOT flow
        // Get estimation for MEDIUM priority
        const estimasiLemot = getResponseTimeMessage('MEDIUM');

        // Initialize or get state
        const stateId = getReportStateId(sender, stateKey);
        setUserState(stateId, buildReportState(getUserState(stateId) || {}, {
            step: 'REPORT_LEMOT_ANALYSIS',
            customer: user,
            ticketDraft: {
                issueType: 'LEMOT'
            },
            diagnostic: {
                issueType: 'LEMOT',
                deviceStatus,
                estimatedTime: estimasiLemot
            },
            issueType: 'LEMOT',
            deviceStatus,
            estimatedTime: estimasiLemot
        }));

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_lemot_troubleshoot_menu',
                'Troubleshooting internet lemot.\n\nStatus Device: *ONLINE*\nEstimasi penanganan: *${estimasiLemot}*\n\nBalas *SUDAH* jika teratasi atau *BELUM* untuk buat laporan.',
                { estimasiLemot }
            )
        };

    } catch (error) {
        console.error('[HANDLE_LEMOT_ERROR]', error);
        deleteUserState(getReportStateId(sender, stateKey));
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_text_generic_error',
                'Terjadi kesalahan. Silakan coba lagi.'
            )
        };
    }
}

/**
 * Handle troubleshoot result
 */
async function handleTroubleshootResult({ sender, response, reply }) {
    const state = getUserState(sender);
    if (!state || !['REPORT_LEMOT_ANALYSIS', 'TROUBLESHOOT_LEMOT'].includes(state.step)) {
        return { success: false };
    }

    const answer = response.toLowerCase().trim();

    if (answer.includes('sudah') || answer.includes('solved') || answer.includes('teratasi')) {
        deleteUserState(sender);
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_problem_solved',
                'Masalah sudah teratasi.\n\nTerima kasih sudah melakukan pengecekan.'
            )
        };
    } else if (answer.includes('belum') || answer.includes('tidak')) {
        setUserState(sender, buildReportState(state, {
            step: 'REPORT_LEMOT_CONFIRM',
            ticketDraft: {
                troubleshootingDone: true
            },
            diagnostic: {
                troubleshootingDone: true
            },
            troubleshootingDone: true
        }));

        return await createReportTicket({ sender, state: getUserState(sender), reply });
    } else {
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_text_troubleshoot_result_invalid',
                'Balas *SUDAH* jika teratasi atau *BELUM* jika masih bermasalah.'
            )
        };
    }
}

/**
 * Handle confirmation for MATI report
 */
async function handleMatiConfirmation({ sender, response, reply }) {
    const state = getUserState(sender);
    if (!state || !['CONFIRM_MATI_REPORT', 'REPORT_LEMOT_CONFIRM'].includes(state.step)) {
        return { success: false };
    }

    const answer = response.toLowerCase().trim();

    // Membuat tiket menurunkan teknisi → konsen KETAT, tapi menerima bahasa pelanggan sungguhan
    // ("Ok mas", "ya ka", "siap"). Exact-match sebelumnya menolak mayoritas balasan nyata.
    if (isCleanConsent(answer, { onTopic: TICKET_CONSENT_ON_TOPIC })) {
        return await createReportTicket({ sender, state, reply });
    } else if (answer === 'tidak' || answer === 'no' || answer === 'n' || answer.includes('batal') || isDecline(answer)) {
        deleteUserState(sender);
        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_report_cancelled',
                'Laporan dibatalkan.\n\nJika butuh bantuan, ketik *lapor* kapan saja.'
            )
        };
    } else {
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_text_yes_no_invalid',
                'Balas *YA* untuk lanjut atau *TIDAK* untuk batal.'
            )
        };
    }
}

/**
 * Handle MATI Troubleshooting Options (1/2/3)
 */
async function handleMatiTroubleshootOptions({ sender, response, reply: _reply }) {
    const state = getUserState(sender);
    if (!state || !['REPORT_MATI_TROUBLESHOOT', 'MATI_TROUBLESHOOT_OPTIONS'].includes(state.step)) {
        return { success: false };
    }

    const choice = response.trim();

    if (choice === '1') {
        // Sudah coba restart, masih mati - Ask for photo first
        // IMPORTANT: Preserve all existing state data
        const updatedState = buildReportState(state, {
            step: 'REPORT_MATI_PHOTO',
            ticketDraft: {
                troubleshootingDone: true,
                troubleshootingResult: 'failed'
            },
            diagnostic: {
                troubleshootingDone: true,
                troubleshootingResult: 'failed'
            },
            troubleshootingDone: true,
            troubleshootingResult: 'failed'
        });
        setUserState(sender, updatedState);
        simpanDraftLaporanIni(sender, updatedState);

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_photo_upload_prompt',
                'Kirim foto gangguan jika ada, atau ketik *SKIP* untuk lewati.'
            )
        };

    } else if (choice === '2') {
        // Belum coba restart - Guide untuk restart
        deleteUserState(sender);

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_restart_guide',
                'Silakan restart modem: cabut power, tunggu 10-30 detik, pasang kembali, lalu cek koneksi.'
            )
        };

    } else if (choice === '3') {
        // Sudah normal kembali
        deleteUserState(sender);

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_mati_solved',
                'Internet sudah normal kembali. Terima kasih sudah melakukan pengecekan.'
            )
        };

    } else {
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_text_mati_option_invalid',
                'Input belum sesuai. Balas 1, 2, atau 3.'
            )
        };
    }
}

/**
 * Handle Photo Upload for MATI Report
 */
async function handleMatiPhotoUpload({ sender, response, photoPath, photoBuffer, reply }) {
    const state = getUserState(sender);
    if (!state || !['REPORT_MATI_PHOTO', 'MATI_AWAITING_PHOTO'].includes(state.step)) {
        return { success: false };
    }

    // Handle text response (SKIP)
    if (response && response.toLowerCase().trim() === 'skip') {
        console.log('[PHOTO_UPLOAD] User skipped photo upload');
        const nextState = buildReportState(state, {
            step: 'REPORT_TICKET_CREATED',
            diagnostic: {
                photoSkipped: true
            },
            photoSkipped: true
        });
        setUserState(sender, nextState);

        // Create ticket without photo
        const ticketResult = await createReportTicket({ sender, state: nextState, reply });

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_photo_skipped',
                'Foto tidak dilampirkan.\n\n${ticketMessage}',
                { ticketMessage: ticketResult.message }
            )
        };
    }

    // Handle photo upload
    if (photoPath) {
        console.log('[PHOTO_UPLOAD] Photo received:', photoPath);

        const uploadedPhotos = [
            ...getReportAttachments(state),
            { fileName: photoPath }
        ];
        const nextState = buildReportState(state, {
            step: uploadedPhotos.length < 3 ? 'REPORT_MATI_PHOTO' : 'REPORT_TICKET_CREATED',
            attachments: uploadedPhotos,
            uploadedPhotos
        });
        state.uploadedPhotos = uploadedPhotos;
        nextState.photoBuffers = [...(state.photoBuffers || []), photoBuffer];

        // Check if user wants to add more photos (max 3)
        if (uploadedPhotos.length < 3) {
            // Update state and ask if want to add more
            // IMPORTANT: Save state WITHOUT buffers
            const stateToSave = { ...nextState };
            delete stateToSave.photoBuffers;  // Don't save buffers!
            setUserState(sender, stateToSave);

            return {
                success: true,
                message: renderResponseTemplate(
                    'smart_report_text_photo_received_more',
                    'Foto ${photoCount} diterima.\n\nAnda bisa kirim foto lagi, atau ketik *LANJUT* untuk buat laporan.',
                    { photoCount: state.uploadedPhotos.length }
                )
            };
        } else {
            // Max photos reached, create ticket
            const ticketResult = await createReportTicket({ sender, state: nextState, reply });

            return {
                success: true,
                message: renderResponseTemplate(
                    'smart_report_text_photo_received_max',
                    'Batas maksimal foto sudah diterima.\n\n${ticketMessage}',
                    { ticketMessage: ticketResult.message }
                )
            };
        }
    }

    // Handle "LANJUT" command after uploading photos
    if (response && response.toLowerCase().trim() === 'lanjut' && state.uploadedPhotos && state.uploadedPhotos.length > 0) {
        const ticketResult = await createReportTicket({ sender, state, reply });

        return {
            success: true,
            message: renderResponseTemplate(
                'smart_report_text_photo_attached_continue',
                '${photoCount} foto dilampirkan.\n\n${ticketMessage}',
                {
                    photoCount: state.uploadedPhotos.length,
                    ticketMessage: ticketResult.message
                }
            )
        };
    }

    return {
        success: false,
        message: renderResponseTemplate(
            'smart_report_text_photo_upload_invalid',
            'Kirim foto gangguan, ketik *SKIP*, atau ketik *LANJUT* jika sudah mengirim foto.'
        )
    };
}

/**
 * Create report ticket
 */
async function createReportTicket({ sender, state, reply: _reply }) {
    try {
        const user = getReportCustomer(state);

        // Determine priority
        const issueType = state.ticketDraft?.issueType || state.issueType || state.diagnostic?.issueType || 'LEMOT';
        const priority = issueType === 'MATI' ? 'HIGH' : 'MEDIUM';

        let laporanText = issueType === 'MATI' ?
            'Internet mati total - Device OFFLINE' :
            'Internet lambat/lemot';

        // Use lastOnlineText from state instead of deviceStatus
        const lastOnlineText = state.diagnostic?.lastOnlineText || state.lastOnlineText;
        const deviceStatus = state.diagnostic?.deviceStatus || state.deviceStatus;
        if (lastOnlineText && lastOnlineText !== 'Tidak diketahui') {
            laporanText += `\nTerakhir online: ${lastOnlineText}`;
        } else if (deviceStatus && deviceStatus.minutesAgo) {
            laporanText += `\nTerakhir online: ${deviceStatus.minutesAgo} menit yang lalu`;
        }

        if (state.ticketDraft?.troubleshootingDone || state.troubleshootingDone) {
            laporanText += '\nTroubleshooting sudah dilakukan.';
        }

        const customerPhotos = getReportAttachments(state);

        const newReport = await createCustomerReportTicket({
            user,
            sender,
            laporanText,
            issueType,
            priority,
            createdBy: sender,
            createdByRole: 'customer_wa',
            customerPhotos,
            photoBuffers: state.photoBuffers || [],
            additionalFields: {
                deviceOnline: state.deviceStatus?.online !== false,
                troubleshootingDone: state.ticketDraft?.troubleshootingDone || state.troubleshootingDone || false
            }
        });
        const ticketId = newReport.ticketId;

        // Get response time
        const estimasi = getResponseTimeMessage(priority);

        // Clear state — DAN draft di disk, supaya pemindai boot tak melahirkan tiket KEDUA
        // untuk laporan yang sudah jadi.
        deleteUserState(sender);
        buangDraftLaporanIni(sender);

        const photoStatus = newReport.photoCount > 0
            ? `${newReport.photoCount} foto dilampirkan`
            : 'Tidak ada';

        return {
            success: true,
            // `ticketId` ikut dipulangkan supaya pemanggil non-percakapan (mis.
            // `promoteReportDraftOnTimeout`) bisa menyebut nomor tiketnya ke pelanggan.
            // Sebelumnya hanya `{success, message}`, sehingga notifikasi promote-on-timeout
            // membaca `undefined` dan tak pernah terkirim — perbaikannya mati separuh.
            ticketId,
            message: renderResponseTemplate(
                'smart_report_text_report_created_success',
                'Laporan berhasil dibuat.\n\nID Tiket: *${ticketId}*\nPrioritas: *${priorityLabel}*\nEstimasi: *${estimasi}*\nStatus: Pending\nFoto: ${photoStatus}\n\nCek status: *cektiket ${ticketId}*',
                {
                    ticketId,
                    priorityLabel: priority === 'HIGH' ? 'URGENT' : 'NORMAL',
                    estimasi,
                    photoStatus
                }
            )
        };

    } catch (error) {
        console.error('[CREATE_REPORT_ERROR]', error);
        deleteUserState(sender);
        buangDraftLaporanIni(sender);
        return {
            success: false,
            message: renderResponseTemplate(
                'smart_report_text_report_create_failed',
                'Laporan belum bisa dibuat. Silakan coba lagi.'
            )
        };
    }
}

/**
 * Notify technicians with delay to prevent spam
 */

/**
 * Draft laporan yang DITINGGALKAN di langkah foto tidak boleh ikut mati bersama state-nya.
 *
 * Alur hidup (text-menu) berhenti di step `REPORT_MATI_PHOTO` sambil meminta foto. Pelanggan yang
 * internetnya mati sering tak punya yang bisa difoto (layar modem gelap), lalu diam. Setelah 15
 * menit state dihapus — dan tiketnya TIDAK PERNAH LAHIR. Teknisi tak pernah tahu ada yang melapor.
 *
 * Handler timeout memang sudah ada, tapi hanya terdaftar untuk step LEGACY
 * (`GANGGUAN_MATI_AWAITING_PHOTO`/`LEMOT_AWAITING_PHOTO`) dan menuntut bentuk state lama
 * (`state.ticketData`), sedangkan alur ini memakai `ticketDraft`. Jadi ia tak pernah menolong di
 * sini. Solusinya memakai pembuat tiket milik alur ini sendiri, yang sudah paham bentuk state-nya.
 *
 * Foto adalah LAMPIRAN, bukan syarat lahirnya tiket. NEVER-THROW.
 */
/**
 * Tulis draft ke DISK, bukan cuma ke state memori.
 *
 * Handler timeout step lampiran (didaftarkan di bawah) sudah menyelamatkan pelanggan yang DIAM
 * — setelah 15 menit tiketnya tetap lahir. Tapi timer itu hidup di memori: bila proses
 * `pm2 restart` di tengah jendela 15 menit (produksi restart berkali-kali sehari), state DAN
 * timer sama-sama lenyap, tiket tak pernah lahir, dan pelanggan menunggu tindak lanjut atas
 * laporan yang dari sisinya sudah dibuat. Draft di disk membuat jaring itu tetap ada:
 * `pindaiDraftLaporanTertunda` memindainya saat boot.
 *
 * NEVER-THROW: gagal menulis draft tak boleh menjatuhkan alur laporan yang sedang berjalan.
 */
function simpanDraftLaporanIni(sender, state) {
    try {
        const pelanggan = getReportCustomer(state) || null;
        simpanDraft(sender, {
            step: 'REPORT_MATI_PHOTO',
            // Alur ini memakai bentuk state sendiri (`ticketDraft`), bukan `ticketData` milik
            // alur legacy — ditandai `alur` supaya pemindai boot memakai promoter yang benar.
            ticketData: { alur: 'text-menu', state },
            targetUser: pelanggan,
            deviceStatus: state && state.deviceStatus ? state.deviceStatus : null
        });
    } catch (e) {
        console.warn('[REPORT_DRAFT] gagal menulis draft durabel:', e && e.message);
    }
}

/** Draft sudah tak diperlukan (tiket lahir / dibatalkan). NEVER-THROW. */
function buangDraftLaporanIni(sender) {
    try {
        hapusDraft(sender);
    } catch (e) {
        console.warn('[REPORT_DRAFT] gagal menghapus draft:', e && e.message);
    }
}

async function promoteReportDraftOnTimeout(userId, state) {
    try {
        if (!state || !getReportCustomer(state)) {
            console.warn('[REPORT_TIMEOUT_PROMOTE] state/pelanggan kosong, dilewati', { userId });
            // Draft yang tak bisa dipromosikan WAJIB dibuang — kalau tidak, pemindai boot
            // mencobanya lagi setiap kali proses start, selamanya.
            buangDraftLaporanIni(userId);
            return;
        }
        const hasil = await createReportTicket({ sender: userId, state, reply: async () => {} });
        const ticketId = hasil && (hasil.ticketId || (hasil.data && hasil.data.ticketId));
        console.log('[REPORT_TIMEOUT_PROMOTE] draft laporan dipromosikan jadi tiket', { userId, ticketId: ticketId || null });

        // Pelanggan WAJIB diberi tahu — kalau tidak, dari sisinya laporannya tetap "hilang".
        if (ticketId) {
            try {
                const { sendMessage } = require('../../lib/whatsapp-delivery-service');
                await sendMessage(userId, {
                    text: renderResponseTemplate(
                        'report_draft_promoted_timeout',
                        `✅ Laporan Anda tetap kami catat ya Kak.\n\nNo. Tiket: *${ticketId}*\n\n` +
                        `Fotonya boleh menyusul — tidak wajib. Cek status kapan saja dengan *cek tiket ${ticketId}*.`,
                        { ticket_id: ticketId }
                    )
                }, { skipDuplicateCheck: true });
            } catch (kirimErr) {
                console.error('[REPORT_TIMEOUT_PROMOTE] gagal beri tahu pelanggan:', kirimErr && kirimErr.message);
            }
        }
    } catch (error) {
        console.error('[REPORT_TIMEOUT_PROMOTE] gagal promote draft jadi tiket', { userId, error: error && error.message });
    }
}

// Guard sama seperti smart-report-handler: test yang me-mock conversation-handler tak selalu
// mengekspor fungsi ini.
// HANYA step LAMPIRAN, bukan step KEPUTUSAN.
//
// `REPORT_MATI_PHOTO` tercapai SETELAH pelanggan memilih "sudah restart, masih mati" — niat
// melapornya sudah jelas, dan yang ditunggu tinggal foto (lampiran opsional). Di situ, diam
// wajar diartikan "tak ada yang bisa difoto", dan tiket memang layak lahir.
//
// Step lain SENGAJA TIDAK didaftarkan meski sempat saya pasang: `REPORT_LEMOT_ANALYSIS`,
// `REPORT_LEMOT_CONFIRM`, dan `CONFIRM_MATI_REPORT` adalah step KEPUTUSAN — bot bertanya
// "Balas *SUDAH* jika teratasi atau *BELUM* untuk buat laporan". Mayoritas pelanggan yang
// masalahnya sudah beres sendiri tidak membalas apa-apa; menafsirkan diam sebagai "BELUM"
// akan melahirkan tiket palsu, mem-blast WA ke SELURUH teknisi & admin, dan (lewat
// `hasActiveReport`) menutup pintu lapor pelanggan itu untuk gangguan berikutnya.
// Membuat tiket menurunkan teknisi ke lapangan — itu butuh persetujuan EKSPLISIT, bukan diam.
if (typeof registerStateTimeoutHandler === 'function') {
    registerStateTimeoutHandler('REPORT_MATI_PHOTO', promoteReportDraftOnTimeout);
}

module.exports = {
    startReportFlow,
    promoteReportDraftOnTimeout,
    handleMenuSelection,
    handleInternetMati,
    handleInternetLemot,
    handleTroubleshootResult,
    handleMatiConfirmation,
    handleMatiTroubleshootOptions,
    handleMatiPhotoUpload
};
