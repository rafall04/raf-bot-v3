/**
 * Purpose: Menjalankan workflow teknisi WhatsApp dari proses tiket, OTW, tiba, OTP, foto, sampai selesai.
 * Caller: `message/handlers/raf-intent-dispatch.js`, state teknisi, dan command teknisi dari router WhatsApp.
 * Deps: `conversation-handler`, `teknisi-photo-handler-v3`, `report-notification-service`, `ticket-workflow`, global reports/accounts.
 * MainFuncs: `handleProsesTicket`, `handleOTW`, `handleSampaiLokasi`, `handleVerifikasiOTP`, `handleSelesaiTicket`, `sendCustomerNotification`.
 * SideEffects: Mutasi tiket di `global.reports`, state percakapan teknisi, queue foto, dan pengiriman notifikasi WhatsApp pelanggan.
 */

const { normalizePhone: _normalizePhone, deduplicatePhones: _deduplicatePhones, isSameRecipient: _isSameRecipient } = require('../../lib/notification-tracker');
const { getUserState, setUserState, deleteUserState, format } = require('./conversation-handler');
const { clearUploadQueue: _clearUploadQueue } = require('./teknisi-photo-handler-v3');
const { notifyCustomerTicketUpdate } = require('../../lib/report-notification-service');
const {
    ensureTicketShape: _ensureTicketShape,
    processTicket: processTicketWorkflow,
    markTicketOtw,
    markTicketArrived,
    verifyTicketOtp,
    appendTechnicianPhoto,
    completeTicket: completeTicketWorkflow
} = require('../../lib/ticket-workflow');

function renderResponseTemplate(key, fallback, data = {}) {
    const rendered = format(key, data);
    return rendered && rendered.trim() ? rendered : fallback;
}
/**
 * Send notification to customer without duplicates
 * Handles both @lid and regular phone formats
 */
async function sendCustomerNotification(ticket, message) {
    return notifyCustomerTicketUpdate(ticket, message, {
        flow: 'teknisi_workflow',
        step: 'customer_update'
    });
}

// generateOTP is imported from ../../lib/otp-generator

/**
 * Resolve teknisi account dari sender (LID-aware).
 * Dipakai sebagai fallback bila caller tidak pass teknisi account yang sudah resolved.
 */
function resolveTeknisiFromSender(sender) {
    const senderNumber = sender.replace('@s.whatsapp.net', '');
    const isLid = sender.endsWith('@lid');

    return global.accounts.find(acc => {
        if (!acc || acc.role !== 'teknisi') return false;

        // LID-aware: match by stored lid field jika sender @lid
        if (isLid && acc.lid && acc.lid === sender) return true;

        // Phone-number match (legacy + canonical)
        if (!acc.phone_number) return false;
        const phone = acc.phone_number;
        const phoneNoPrefix = senderNumber.startsWith('62') ? senderNumber.substring(2) : senderNumber;
        return phone === phoneNoPrefix
            || phone === senderNumber
            || `62${phone}` === senderNumber;
    });
}

/**
 * Handle "proses" command - teknisi takes ticket
 * @param sender   JID asli pengirim (sudah include @lid bila MD)
 * @param ticketId
 * @param reply
 * @param teknisiAccount Optional. Account teknisi yang sudah di-resolve di pipeline.
 *                      Disarankan pass dari dispatcher supaya LID-aware (lihat raf-context.resolveActorCapabilities).
 */
async function handleProsesTicket(sender, ticketId, reply, teknisiAccount = null) {
    try {
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());

        if (!ticket) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_ticket_not_found', `Tiket *${ticketId}* tidak ditemukan.`, { ticketId })
            };
        }

        if (ticket.status === 'process') {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_already_processed', `Tiket *${ticketId}* sudah diproses oleh teknisi lain.`, { ticketId })
            };
        }

        if (ticket.status === 'completed' || ticket.status === 'selesai') {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_already_completed', `Tiket *${ticketId}* sudah selesai.`, { ticketId })
            };
        }

        // Pakai account dari pipeline kalau ada (LID-aware via raf-context). Fallback resolusi lokal.
        const teknisi = teknisiAccount || resolveTeknisiFromSender(sender);

        if (!teknisi) {
            console.error(`[TEKNISI_NOT_FOUND] Sender: ${sender}, teknisiAccount provided: ${!!teknisiAccount}`);
            console.error(`[TEKNISI_NOT_FOUND] Available teknisi:`, global.accounts.filter(a => a.role === 'teknisi').map(a => ({ phone: a.phone_number, lid: a.lid })));
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_not_registered', 'Nomor ini belum terdaftar sebagai petugas.')
            };
        }
        
        const { ticket: updatedTicket, otp } = processTicketWorkflow({
            ticketId,
            actor: {
                sender,
                id: sender,
                username: teknisi.username,
                name: teknisi.name || teknisi.username,
                phoneNumber: teknisi.phone_number,
                channel: 'wa'
            }
        });
        Object.assign(ticket, updatedTicket);
        
        // Get teknisi phone number for customer contact
        const teknisiPhone = (() => {
            const senderNum = sender.replace('@s.whatsapp.net', '');
            if (senderNum.startsWith('62')) {
                return senderNum;
            } else if (senderNum.startsWith('0')) {
                return '62' + senderNum.substring(1);
            } else {
                return '62' + senderNum;
            }
        })();
        
        // Notify customer with OTP - Send to ALL registered numbers
        const customerMessage = renderResponseTemplate('teknisi_workflow_process_customer_otp', `Tiket *${ticketId}* sedang diproses.

Teknisi: *${teknisi.name || teknisi.username}*
Kontak: wa.me/${teknisiPhone}
Kode verifikasi: *${otp}*

Simpan kode ini dan berikan ke teknisi saat tiba.`, {
            ticketId,
            teknisiName: teknisi.name || teknisi.username,
            teknisiPhone,
            otp
        });

        // Send OTP notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        return {
            success: true,
            message: renderResponseTemplate('teknisi_workflow_process_success', `Tiket *${ticketId}* berhasil diproses.

Pelanggan: ${ticket.pelangganName}
No: ${ticket.pelangganPhone}
Alamat: ${ticket.pelangganAddress || 'Tidak ada'}

Kode verifikasi telah dikirim ke pelanggan.
Langkah berikutnya: ketik *otw ${ticketId}*.`, {
                ticketId,
                customerName: ticket.pelangganName,
                customerPhone: ticket.pelangganPhone,
                customerAddress: ticket.pelangganAddress || 'Tidak ada'
            })
        };
        
    } catch (error) {
        console.error('[PROSES_TICKET_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate('teknisi_workflow_process_error', 'Gagal memproses tiket. Silakan coba lagi.')
        };
    }
}

/**
 * Handle "otw" command - teknisi on the way
 */
async function handleOTW(sender, ticketId, locationUrl, _reply) {
    try {
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_ticket_not_found', `Tiket *${ticketId}* tidak ditemukan.`, { ticketId })
            };
        }
        
        // Verify teknisi - check all possible field names (support old and new workflows)
        const assignedTeknisi = ticket.teknisiId || ticket.processedByTeknisiId || ticket.processedByTeknisi;
        if (assignedTeknisi && assignedTeknisi !== sender) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_not_assigned', 'Anda bukan petugas yang menangani tiket ini.', { ticketId })
            };
        }
        
        // Check status - support both new and old status values
        const validStatuses = ['process', 'diproses teknisi'];
        if (!validStatuses.includes(ticket.status)) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_invalid_status_process_first', 'Status tiket belum siap untuk perjalanan. Proses tiket dulu.', { ticketId })
            };
        }
        
        // Get existing state to preserve OTP data
        const existingState = getUserState(sender);
        
        // Set state untuk menunggu lokasi while preserving OTP data (SAMA DENGAN mulai perjalanan)
        setUserState(sender, {
            step: 'AWAITING_LOCATION_FOR_JOURNEY',
            ticketId: ticketId.toUpperCase(),
            reportData: ticket,
            // Preserve OTP data if exists
            otp: existingState?.otp || ticket.otp,
            otpCreatedAt: existingState?.otpCreatedAt,
            isProcessing: true // Mark that this ticket is being processed
        });
        
        const { ticket: updatedTicket } = markTicketOtw({
            ticketId,
            actor: {
                sender,
                id: sender,
                username: ticket.teknisiName,
                name: ticket.teknisiName,
                channel: 'wa'
            },
            location: locationUrl || null
        });
        Object.assign(ticket, updatedTicket);
        
        // Get teknisi phone for customer contact
        const teknisiPhone = (() => {
            const senderNum = sender.replace('@s.whatsapp.net', '');
            if (senderNum.startsWith('62')) {
                return senderNum;
            } else if (senderNum.startsWith('0')) {
                return '62' + senderNum.substring(1);
            } else {
                return '62' + senderNum;
            }
        })();
        
        // Notify customer with SAME MESSAGE as mulai perjalanan
        const customerMessage = renderResponseTemplate('teknisi_workflow_otw_customer', `Petugas sedang menuju lokasi Anda.

Tiket: *${ticketId.toUpperCase()}*
Petugas: *${ticket.teknisiName || ticket.processedByTeknisiName || 'Teknisi'}*
Kontak: wa.me/${teknisiPhone}
Estimasi tiba: 30-60 menit
Kode verifikasi: *${ticket.otp}*

Berikan kode ini saat petugas tiba.`, {
            ticketId: ticketId.toUpperCase(),
            teknisiName: ticket.teknisiName || ticket.processedByTeknisiName || 'Teknisi',
            teknisiPhone,
            otp: ticket.otp
        });
        
        // Send OTW notification without duplicates using consistent helper
        await sendCustomerNotification(ticket, customerMessage);
        
        return {
            success: true,
            message: renderResponseTemplate('teknisi_workflow_otw_success', `Perjalanan dimulai.

Tiket: *${ticketId.toUpperCase()}*
Pelanggan: ${ticket.pelangganName}

Pelanggan telah diberitahu.
Wajib share live location selama perjalanan.
Saat tiba, ketik: *sampai ${ticketId.toUpperCase()}*.`, {
                ticketId: ticketId.toUpperCase(),
                customerName: ticket.pelangganName
            })
        };
        
    } catch (error) {
        console.error('[OTW_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate('teknisi_workflow_otw_error', 'Gagal update status perjalanan. Silakan coba lagi.')
        };
    }
}

/**
 * Handle "sampai" command - teknisi arrived
 */
async function handleSampaiLokasi(sender, ticketId, _reply) {
    try {
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_ticket_not_found', `Tiket *${ticketId}* tidak ditemukan.`, { ticketId })
            };
        }
        
        // Verify teknisi - check all possible field names
        const assignedTeknisi = ticket.teknisiId || ticket.processedByTeknisiId || ticket.processedByTeknisi;
        if (assignedTeknisi && assignedTeknisi !== sender) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_not_assigned', 'Anda bukan petugas yang menangani tiket ini.', { ticketId })
            };
        }
        
        if (ticket.status !== 'otw' && ticket.status !== 'process' && ticket.status !== 'diproses teknisi') {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_invalid_status', 'Status tiket tidak sesuai.', { ticketId })
            };
        }
        
        const { ticket: updatedTicket } = markTicketArrived({
            ticketId,
            actor: {
                sender,
                id: sender,
                username: ticket.teknisiName,
                name: ticket.teknisiName,
                channel: 'wa'
            }
        });
        Object.assign(ticket, updatedTicket);
        
        // Notify customer (same pattern as OTW notification)
        const teknisiName = ticket.teknisiName || ticket.processedByTeknisiName || 'Teknisi';
        
        // Get teknisi phone number for customer contact
        const teknisiPhone = (() => {
            const teknisiSender = sender.replace('@s.whatsapp.net', '');
            if (teknisiSender.startsWith('62')) {
                return teknisiSender; // Already in correct format
            } else if (teknisiSender.startsWith('0')) {
                return '62' + teknisiSender.substring(1);
            } else {
                return '62' + teknisiSender;
            }
        })();
        
        // Prepare OTP display with fallback
        const otpDisplay = ticket.otp || 'XXXXXX';
        
        const customerMessage = renderResponseTemplate('teknisi_workflow_arrived_customer', `Petugas sudah tiba di lokasi Anda.

Tiket: *${ticketId.toUpperCase()}*
Petugas: *${teknisiName}*
Kontak: wa.me/${teknisiPhone}
Kode verifikasi: *${otpDisplay}*

Berikan kode ini ke petugas untuk memulai perbaikan.`, {
            ticketId: ticketId.toUpperCase(),
            teknisiName,
            teknisiPhone,
            otp: otpDisplay
        });

        // Send arrival notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        return {
            success: true,
            message: renderResponseTemplate('teknisi_workflow_arrived_success', `Status kedatangan tercatat.

Tiket: *${ticketId}*
Tiba: ${new Date().toLocaleTimeString('id-ID')}
Customer telah dinotifikasi.

Minta kode verifikasi pelanggan, lalu ketik:
*verifikasi ${ticketId} [KODE]*`, {
                ticketId,
                arrivalTime: new Date().toLocaleTimeString('id-ID')
            })
        };
        
    } catch (error) {
        console.error('[SAMPAI_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate('teknisi_workflow_arrived_error', 'Gagal update status kedatangan. Silakan coba lagi.')
        };
    }
}

/**
 * Get category label for photo
 */
function getCategoryLabel(category) {
    const labels = {
        'problem': 'Titik Putus / Penyebab Masalah',
        'speedtest': 'Screenshot Speedtest',
        'result': 'Foto Hasil Redaman',
        'extra': 'Foto Tambahan'
    };
    return labels[category] || 'Foto Dokumentasi';
}

/**
 * Get next photo step based on current state
 */
function getNextPhotoStep(state) {
    const { problem, speedtest, result } = state.photoCategories;
    
    // Step 1: Problem photo (WAJIB)
    if (!problem) {
        return {
            step: 'AWAITING_PHOTO_CATEGORY_1',
            category: 'problem',
            message: renderResponseTemplate('teknisi_workflow_photo_problem_prompt', 'Kirim dokumentasi pertama: penyebab masalah atau kondisi awal.')
        };
    }
    
    // Step 2: Speedtest photo (WAJIB)
    if (!speedtest) {
        return {
            step: 'AWAITING_PHOTO_CATEGORY_2',
            category: 'speedtest',
            message: renderResponseTemplate('teknisi_workflow_photo_speedtest_prompt', 'Dokumentasi masalah diterima. Kirim screenshot atau foto hasil speedtest.')
        };
    }
    
    // Step 3: Result photo (OPSIONAL)
    if (!result) {
        return {
            step: 'AWAITING_PHOTO_CATEGORY_3',
            category: 'result',
            message: renderResponseTemplate('teknisi_workflow_photo_result_prompt', 'Dokumentasi speedtest diterima. Kirim foto hasil akhir atau ketik *SKIP*.')
        };
    }
    
    // All required photos done, ask for extra
    return {
        step: 'AWAITING_PHOTO_EXTRA_CONFIRM',
        category: 'extra',
        message: renderResponseTemplate('teknisi_workflow_photo_extra_prompt', 'Dokumentasi wajib sudah lengkap. Balas *YA* untuk tambah foto atau *TIDAK* untuk lanjut.')
    };
}

/**
 * Handle OTP verification
 */
async function handleVerifikasiOTP(sender, ticketId, otp, _reply) {
    try {
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_ticket_not_found', `Tiket *${ticketId}* tidak ditemukan.`, { ticketId })
            };
        }
        
        // Verify teknisi - check all possible field names
        const assignedTeknisi = ticket.teknisiId || ticket.processedByTeknisiId || ticket.processedByTeknisi;
        if (assignedTeknisi && assignedTeknisi !== sender) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_not_assigned', 'Anda bukan petugas yang menangani tiket ini.', { ticketId })
            };
        }
        
        // Check OTP
        if (ticket.otp !== otp) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_otp_invalid', 'Kode verifikasi tidak sesuai. Minta kode yang benar ke pelanggan.', { ticketId })
            };
        }
        
        const { ticket: updatedTicket } = verifyTicketOtp({
            ticketId,
            actor: {
                sender,
                id: sender,
                username: ticket.teknisiName,
                name: ticket.teknisiName,
                channel: 'wa'
            },
            otp
        });
        Object.assign(ticket, updatedTicket);
        
        // Notify customer - Send to ALL registered numbers
        const customerMessage = renderResponseTemplate('teknisi_workflow_repair_started_customer', `Perbaikan tiket *${ticketId}* sudah dimulai.

Petugas: *${ticket.teknisiName}*
Verifikasi berhasil.
Anda akan diinformasikan saat selesai.`, {
            ticketId,
            teknisiName: ticket.teknisiName
        });

        // Send verification notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        // Set state for guided photo upload with categorization
        setUserState(sender, {
            step: 'AWAITING_PHOTO_CATEGORY_1',
            ticketId: ticketId,
            currentPhotoCategory: 'problem',     // Current category being uploaded
            uploadedPhotos: [],                  // Array of photo objects with categories
            photoCategories: {                   // Track which categories are filled
                problem: null,      // Foto penyebab masalah (wajib)
                speedtest: null,    // Screenshot speedtest (wajib)
                result: null,       // Foto hasil redaman (opsional)
                extra: []           // Foto tambahan (opsional)
            },
            minPhotos: 2,
            guidedMode: true,
            flow: 'teknisi',
            ownerType: 'teknisi',
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            context: { ticketId }
        });
        
        return {
            success: true,
            message: renderResponseTemplate('teknisi_workflow_otp_verified_success', `Verifikasi berhasil untuk tiket *${ticketId}*.

Status: perbaikan dimulai.

Dokumentasi wajib:
Foto 1/3 - penyebab masalah atau kondisi awal.
Kirim foto pertama sekarang.`, { ticketId })
        };
        
    } catch (error) {
        console.error('[VERIFIKASI_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate('teknisi_workflow_verify_error', 'Gagal verifikasi kode. Silakan coba lagi.')
        };
    }
}

/**
 * Handle completion with photos
 */
async function handleSelesaiTicket(sender, ticketId, _reply) {
    try {
        // Check teknisi state
        const state = getUserState(sender);
        
        if (!state || state.ticketId !== ticketId) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_completion_not_verified', 'Verifikasi kode dulu sebelum menutup tiket.', { ticketId })
            };
        }
        
        // Also check photo queue for accurate count
        const { getUploadQueue } = require('./teknisi-photo-handler-v3');
        const queue = getUploadQueue(sender);
        
        // Sync uploaded photos from queue if exists
        if (queue && queue.uploadedPhotos.length > 0) {
            state.uploadedPhotos = [...queue.uploadedPhotos];
        }
        
        // Check minimum photos
        if (!state.uploadedPhotos || state.uploadedPhotos.length < 2) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_minimum_photo_required', `Dokumentasi belum cukup.

Minimal: 2 foto.
Saat ini: ${state.uploadedPhotos ? state.uploadedPhotos.length : 0}/2.

Silakan kirim foto dulu.`, {
                    currentPhotoCount: state.uploadedPhotos ? state.uploadedPhotos.length : 0,
                    minimumPhotoCount: 2
                })
            };
        }
        
        // Find ticket
        const ticket = global.reports.find(r => r.ticketId === ticketId.toUpperCase());
        
        if (!ticket) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_ticket_not_found', `Tiket *${ticketId}* tidak ditemukan.`, { ticketId })
            };
        }
        
        const { ticket: completedTicket, durationMinutes } = completeTicketWorkflow({
            ticketId,
            actor: {
                sender,
                id: sender,
                username: ticket.teknisiName || sender,
                name: ticket.teknisiName || sender,
                channel: 'wa'
            },
            resolutionNotes: state.resolutionNotes || 'Selesai'
        });
        Object.assign(ticket, completedTicket);
        
        // Clear teknisi state and photo queue
        deleteUserState(sender);
        
        // Clear photo upload queue
        const { clearUploadQueue } = require('./teknisi-photo-handler-v3');
        clearUploadQueue(sender);
        
        // Notify customer - Send to ALL registered numbers
        const customerMessage = renderResponseTemplate('teknisi_workflow_completion_customer_notification', `Tiket *${ticketId}* sudah ditutup.

Teknisi: *${ticket.teknisiName}*
Durasi: ${durationMinutes} menit
Dokumentasi: ${ticket.teknisiPhotoCount} foto

Terima kasih telah menunggu.`, {
            ticketId,
            teknisiName: ticket.teknisiName,
            durationMinutes,
            photoCount: ticket.teknisiPhotoCount
        });

        // Send completion notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        return {
            success: true,
            message: renderResponseTemplate('teknisi_workflow_completion_success', `Tiket *${ticketId}* sudah ditutup.

Durasi: ${durationMinutes} menit
Dokumentasi: ${ticket.teknisiPhotoCount} foto.
Pelanggan telah diinformasikan.`, {
                ticketId,
                durationMinutes,
                photoCount: ticket.teknisiPhotoCount
            })
        };
        
    } catch (error) {
        console.error('[SELESAI_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate('teknisi_workflow_completion_error', 'Gagal menutup tiket. Silakan coba lagi.')
        };
    }
}

/**
 * Handle teknisi photo upload with categorization
 */
async function handleTeknisiPhotoUpload(sender, photoPath) {
    try {
        // Get teknisi state
        const state = getUserState(sender);
        
        if (!state) {
            return {
                success: false,
                message: null // Not in photo upload state
            };
        }
        
        // Check if in guided mode with categories
        if (state.guidedMode && state.currentPhotoCategory) {
            // GUIDED MODE: Step-by-step with categories
            const currentCategory = state.currentPhotoCategory;
            
            // Check maximum photos
            if (state.uploadedPhotos.length >= 5) {
                return {
                    success: false,
                    message: renderResponseTemplate('teknisi_workflow_photo_max_reached', 'Batas dokumentasi tercapai. Ketik *done* untuk lanjut.', { maxPhotoCount: 5 })
                };
            }
            
            // Create photo object with category metadata
            const photoObj = {
                fileName: photoPath,
                path: photoPath,
                category: currentCategory,
                categoryLabel: getCategoryLabel(currentCategory),
                uploadedAt: new Date().toISOString(),
                uploadedBy: sender,
                source: 'wa_teknisi',
                order: state.uploadedPhotos.length + 1
            };

            await appendTechnicianPhoto({
                ticketId: state.ticketId,
                actor: {
                    sender,
                    id: sender,
                    username: state.teknisiName || sender,
                    name: state.teknisiName || sender,
                    channel: 'wa'
                },
                photo: photoObj
            });
            
            // Save to state
            if (!state.uploadedPhotos) {
                state.uploadedPhotos = [];
            }
            state.uploadedPhotos.push(photoObj);
            
            // Update category tracking
            if (currentCategory === 'extra') {
                state.photoCategories.extra.push(photoPath);
            } else {
                state.photoCategories[currentCategory] = photoPath;
            }
            
            // Get next step
            const nextStep = getNextPhotoStep(state);
            
            if (nextStep) {
                // Update state for next photo
                setUserState(sender, {
                    ...state,
                    step: nextStep.step,
                    currentPhotoCategory: nextStep.category
                });
                
                return {
                    success: true,
                    message: nextStep.message
                };
            } else {
                // All photos done, ready to complete
                setUserState(sender, {
                    ...state,
                    step: 'AWAITING_COMPLETION_CONFIRMATION'
                });
                return {
                    success: true,
                    message: renderResponseTemplate('teknisi_workflow_photo_all_complete', `Dokumentasi lengkap.

Penyebab masalah: ${state.photoCategories.problem ? 'ada' : 'tidak ada'}
Speedtest: ${state.photoCategories.speedtest ? 'ada' : 'tidak ada'}
Hasil akhir: ${state.photoCategories.result ? 'ada' : 'dilewati'}
Tambahan: ${state.photoCategories.extra.length} foto.

Ketik *done*, *lanjut*, atau *next* untuk input catatan.`, {
                        hasProblemPhoto: Boolean(state.photoCategories.problem),
                        hasSpeedtestPhoto: Boolean(state.photoCategories.speedtest),
                        hasResultPhoto: Boolean(state.photoCategories.result),
                        extraPhotoCount: state.photoCategories.extra.length
                    })
                };
            }
            
        } else {
            // LEGACY MODE: Backward compatibility for old flow
            if (state.step !== 'AWAITING_COMPLETION_PHOTOS') {
                return {
                    success: false,
                    message: null
                };
            }
            
            // Old flow without categories
            if (!state.uploadedPhotos) {
                state.uploadedPhotos = [];
            }
            
            // Save as simple string (legacy format)
            const uploadedPhotos = [...state.uploadedPhotos, photoPath];
            await appendTechnicianPhoto({
                ticketId: state.ticketId,
                actor: {
                    sender,
                    id: sender,
                    username: state.teknisiName || sender,
                    name: state.teknisiName || sender,
                    channel: 'wa'
                },
                photo: {
                    fileName: photoPath,
                    path: photoPath,
                    uploadedAt: new Date().toISOString(),
                    uploadedBy: sender,
                    source: 'wa_teknisi',
                    order: uploadedPhotos.length
                }
            });
            setUserState(sender, {
                ...state,
                uploadedPhotos
            });
            const photoCount = uploadedPhotos.length;
            
            if (photoCount < state.minPhotos) {
                return {
                    success: true,
                    message: renderResponseTemplate('teknisi_workflow_photo_legacy_progress', `Dokumentasi ${photoCount} diterima.

Status: ${photoCount}/2.
Kirim dokumentasi ke-${photoCount + 1}.`, {
                        photoCount,
                        minimumPhotoCount: 2,
                        nextPhotoNumber: photoCount + 1
                    })
                };
            } else {
                return {
                    success: true,
                    message: renderResponseTemplate('teknisi_workflow_photo_legacy_complete', `Dokumentasi diterima: ${photoCount} foto.

Minimum terpenuhi.
Ketik *done* atau *lanjut* untuk melanjutkan.`, {
                        photoCount,
                        minimumPhotoCount: 2
                    })
                };
            }
        }
        
    } catch (error) {
        console.error('[TEKNISI_PHOTO_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate('teknisi_workflow_photo_save_error', 'Gagal menyimpan dokumentasi. Coba lagi.')
        };
    }
}

async function handleTeknisiResolutionNotesState(sender, chats) {
    const state = getUserState(sender);
    if (!state || state.step !== 'AWAITING_RESOLUTION_NOTES') {
        return { handled: false };
    }
    if (chats.length < 10) {
        return {
            handled: true,
            success: false,
            message: renderResponseTemplate('teknisi_workflow_resolution_notes_too_short', 'Catatan terlalu singkat. Minimal 10 karakter.', { minimumLength: 10 })
        };
    }

    setUserState(sender, {
        ...state,
        resolutionNotes: chats,
        step: 'AWAITING_CONFIRMATION'
    });

    return {
        handled: true,
        success: true,
        message: renderResponseTemplate('teknisi_workflow_resolution_review', `Review final:

ID Tiket: ${state.ticketId}
Dokumentasi: ${(state.uploadedPhotos || []).length} foto
Catatan:
${chats}

Balas *ya* untuk menutup tiket atau *tidak* untuk edit catatan.`, {
            ticketId: state.ticketId,
            photoCount: (state.uploadedPhotos || []).length,
            resolutionNotes: chats
        })
    };
}

async function handleTeknisiCompletionConfirmationState(sender, chats) {
    const state = getUserState(sender);
    if (!state || state.step !== 'AWAITING_CONFIRMATION') {
        return { handled: false };
    }

    const response = chats.toLowerCase().trim();
    if (response === 'ya' || response === 'yes') {
        const result = await handleCompleteTicket(sender, state);
        deleteUserState(sender);
        return {
            handled: true,
            success: result.success,
            message: result.message
        };
    }

    if (response === 'tidak' || response === 'no') {
        setUserState(sender, {
            ...state,
            step: 'AWAITING_RESOLUTION_NOTES'
        });
        return {
            handled: true,
            success: true,
            message: renderResponseTemplate('teknisi_workflow_resolution_edit_prompt', 'Silakan edit ulang catatan resolusi Anda.')
        };
    }

    return {
        handled: true,
        success: false,
        message: renderResponseTemplate('teknisi_workflow_completion_confirm_invalid', 'Balas *ya* untuk menutup tiket atau *tidak* untuk edit catatan.')
    };
}

/**
 * Complete ticket with resolution notes
 */
async function handleCompleteTicket(sender, state, _reply) {
    try {
        const ticketId = state.ticketId;
        const reportIndex = global.reports.findIndex(r => r.ticketId === ticketId);
        
        if (reportIndex === -1) {
            return {
                success: false,
                message: renderResponseTemplate('teknisi_workflow_ticket_not_found', `Tiket *${ticketId}* tidak ditemukan.`, { ticketId })
            };
        }
        
        const ticket = global.reports[reportIndex];
        
        const { ticket: completedTicket } = completeTicketWorkflow({
            ticketId,
            actor: {
                sender,
                id: sender,
                username: ticket.teknisiName || sender,
                name: ticket.teknisiName || sender,
                channel: 'wa'
            },
            resolutionNotes: state.resolutionNotes
        });
        Object.assign(ticket, completedTicket);
        
        // Notify customer
        const customerMessage = renderResponseTemplate('teknisi_workflow_complete_ticket_customer_notification', `Halo ${ticket.pelangganName},

Tiket *${ticketId}* telah selesai diperbaiki.

Catatan teknisi:
${state.resolutionNotes}

Terima kasih atas kesabaran Anda.
_${global.config.nama || 'Layanan Internet'}_`, {
            ticketId,
            customerName: ticket.pelangganName,
            resolutionNotes: state.resolutionNotes,
            serviceName: global.config.nama || 'Layanan Internet'
        });
        
        // Send completion notification without duplicates
        await sendCustomerNotification(ticket, customerMessage);
        
        // Note: Photos are NOT sent to customer (only stored for admin/teknisi reference)
        
        return {
            success: true,
            message: renderResponseTemplate('teknisi_workflow_complete_ticket_success', `Tiket *${ticketId}* sudah ditutup.

Status: completed.
Catatan tersimpan.
Dokumentasi: ${state.uploadedPhotos.length} foto.
Pelanggan sudah dinotifikasi.

Anda bisa ambil tiket baru dengan *list tiket*.`, {
                ticketId,
                photoCount: state.uploadedPhotos.length
            })
        };
        
    } catch (error) {
        console.error('[COMPLETE_TICKET_ERROR]', error);
        return {
            success: false,
            message: renderResponseTemplate('teknisi_workflow_complete_ticket_error', 'Gagal menutup tiket. Coba lagi.')
        };
    }
}

module.exports = {
    handleProsesTicket,
    handleOTW,
    handleSampaiLokasi,
    handleVerifikasiOTP,
    handleSelesaiTicket,
    handleTeknisiPhotoUpload,
    handleTeknisiResolutionNotesState,
    handleTeknisiCompletionConfirmationState,
    handleCompleteTicket,
    sendCustomerNotification
};
