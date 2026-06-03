/**
 * Header Doc
 * Purpose: Sub-router tiket gangguan untuk workflow state-transition staff (teknisi/admin) — process, OTW, arrived, verify-otp, complete, resolve, dan staff-side ticket create. Auth tier: staff write (`ensureAuthenticatedStaff`).
 * Caller: `routes/tickets.js` (composer via `router.use`).
 * Deps: `./tickets-shared` untuk middleware, helper, ticket-workflow API, dan notification service.
 * MainFuncs: POST `/ticket/process`, `/ticket/otw`, `/ticket/arrived`, `/ticket/verify-otp`, `/ticket/complete`, `/ticket/resolve`, `/ticket/create`.
 * SideEffects: Menulis `global.reports` via ticket-workflow, mengirim notifikasi WhatsApp, log activity.
 */
"use strict";

const {
    express,
    rateLimit,
    withLock,
    ensureAuthenticatedStaff,
    DEBUG,
    logActivity,
    saveReports,
    isWithinWorkingHours,
    getNextAvailableMessage,
    renderResponseTemplate,
    formatTicketPriority,
    buildWorkingHoursNotice,
    toJid,
    createBaseTicket,
    ensureTicketShape,
    normalizeStatus,
    processTicketWorkflow,
    markTicketOtw,
    markTicketArrived,
    verifyTicketOtp,
    completeTicketWorkflow,
    notifyNewReport,
    notifyCustomerTicketUpdate,
    notifyTicketProcessed,
    notifyTicketOtw,
    notifyTicketArrived,
    notifyTicketWorking,
    notifyTicketCompleted
} = require('./tickets-shared');
const { persistTicketLocation, notifyCustomerLocation } = require('../lib/ticket-location-service');

const router = express.Router();

// POST /api/ticket/process - Process a ticket (teknisi)
// UPDATED: Now follows WhatsApp bot workflow with OTP generation and multi-phone notifications
router.post('/ticket/process', ensureAuthenticatedStaff, rateLimit('ticket-process', 10, 60000), async (req, res) => {
    try {
        const { ticketId } = req.body;
        
        if (!ticketId) {
            return res.status(400).json({
                status: 400,
                message: 'ID tiket harus diisi'
            });
        }
        
        // Use lock to prevent concurrent processing of same ticket
        return await withLock(`ticket-process-${ticketId}`, async () => {
            // Find the ticket (support both 'id' and 'ticketId' fields)
            const reportIndex = global.reports.findIndex(r => 
                r.id === ticketId || r.ticketId === ticketId || 
                r.id === ticketId.toUpperCase() || r.ticketId === ticketId.toUpperCase()
            );
            
            if (reportIndex === -1) {
                return res.status(404).json({
                    status: 404,
                    message: 'Tiket tidak ditemukan'
                });
            }
            
            let ticket = ensureTicketShape(global.reports[reportIndex]);
            
            // Log current ticket status for debugging
            if (DEBUG) console.log(`[TICKET_PROCESS] Ticket ${ticketId} current status: "${ticket.status}"`);
            
            // Check if ticket is already being processed (support multiple status formats)
            if (ticket.status === 'process' || 
                ticket.status === 'otw' || ticket.status === 'arrived' || ticket.status === 'working') {
                return res.status(400).json({
                    status: 400,
                    message: `Tiket sudah dalam proses atau sedang ditangani (Status: ${ticket.status})`
                });
            }
            
            if (ticket.status === 'completed') {
                return res.status(400).json({
                    status: 400,
                    message: 'Tiket sudah selesai'
                });
            }
            
            // Find teknisi account from global.accounts
            // Match by username, ID, or phone number
            const teknisi = global.accounts.find(acc => 
                acc.role === 'teknisi' && (
                    acc.username === req.user.username ||
                    acc.id === req.user.id ||
                    (acc.phone_number && req.user.phone && acc.phone_number === req.user.phone)
                )
            );
            
            if (!teknisi) {
                console.error(`[TICKET_PROCESS] Teknisi not found in accounts. User:`, req.user);
                return res.status(403).json({
                    status: 403,
                    message: 'Akun teknisi tidak ditemukan'
                });
            }
            
            if (DEBUG) console.log(`[TICKET_PROCESS] Teknisi found: ${teknisi.name || teknisi.username} (ID: ${teknisi.id})`);
            
            const oldStatus = ticket.status;
            const { ticket: updatedTicket, otp } = processTicketWorkflow({
                ticketId,
                actor: {
                    id: req.user.id || req.user.username,
                    username: req.user.username,
                    name: teknisi.name || teknisi.username,
                    phoneNumber: teknisi.phone_number,
                    channel: 'web'
                }
            });
            ticket = updatedTicket;
            if (DEBUG) console.log(`[TICKET_PROCESS] Ticket ${ticketId} updated with status=process, OTP=${otp}`);
            
            // Log activity
            try {
                await logActivity({
                    userId: req.user.id,
                    username: req.user.username,
                    role: req.user.role,
                    actionType: 'UPDATE',
                    resourceType: 'ticket',
                    resourceId: ticket.ticketId || ticket.id,
                    resourceName: `Ticket ${ticket.ticketId || ticket.id}`,
                    description: `Assigned ticket ${ticket.ticketId || ticket.id} to teknisi ${teknisi.name || teknisi.username}`,
                    oldValue: { status: oldStatus, teknisiId: null },
                    newValue: { status: 'process', teknisiId: teknisi.id, teknisiName: teknisi.name || teknisi.username },
                    ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                    userAgent: req.headers['user-agent']
                });
            } catch (logErr) {
                console.error('[ACTIVITY_LOG_ERROR] Failed to log ticket process:', logErr);
            }
            
            // Get customer (user) details - support both field names for backward compatibility
            const userId = ticket.pelangganUserId || ticket.user_id;
            if (DEBUG) console.log(`[TICKET_PROCESS] Looking for user with ID: ${userId}`);
            
            const user = global.users.find(u => u.id === userId);
            
            if (!user) {
                console.error(`[TICKET_PROCESS] User not found. Tried pelangganUserId: ${ticket.pelangganUserId}, user_id: ${ticket.user_id}`);
                console.error(`[TICKET_PROCESS] Available users:`, global.users.length, 'users in database');
                return res.status(404).json({
                    status: 404,
                    message: 'Data pelanggan tidak ditemukan. Pastikan pelanggan terdaftar di sistem.'
                });
            }
            
            if (DEBUG) console.log(`[TICKET_PROCESS] User found: ${user.name} (ID: ${user.id})`);

            const notifyResult = await notifyTicketProcessed(ticket, {
                name: teknisi.name || teknisi.username,
                username: teknisi.username,
                phoneNumber: teknisi.phone_number
            }, { otp });

            return res.json({
                status: 200,
                message: 'Tiket berhasil diproses',
                data: {
                    ticketId: ticket.ticketId || ticket.id,
                    teknisiName: teknisi.name || teknisi.username,
                    otp: otp,
                    status: 'process',
                    customerNotified: notifyResult.sent
                }
            });
        });
    } catch (error) {
        console.error('[API_TICKET_PROCESS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: error.message === `Could not acquire lock for ticket-process-${req.body.ticketId}`
                ? 'Tiket sedang diproses. Silakan coba lagi.'
                : 'Terjadi kesalahan saat memproses tiket',
            error: error.message
        });
    }
});

// POST /api/ticket/otw - Teknisi on the way (OTW)
// Follows WhatsApp bot workflow: handleOTW()
router.post('/ticket/otw', ensureAuthenticatedStaff, rateLimit('ticket-otw', 10, 60000), async (req, res) => {
    try {
        const { ticketId, location } = req.body;
        
        if (!ticketId) {
            return res.status(400).json({
                status: 400,
                message: 'ID tiket harus diisi'
            });
        }
        
        // Find the ticket
        const reportIndex = global.reports.findIndex(r => 
            r.id === ticketId || r.ticketId === ticketId || 
            r.id === ticketId.toUpperCase() || r.ticketId === ticketId.toUpperCase()
        );
        
        if (reportIndex === -1) {
            return res.status(404).json({
                status: 404,
                message: 'Tiket tidak ditemukan'
            });
        }
        
        let ticket = ensureTicketShape(global.reports[reportIndex]);
        
        // Verify teknisi is assigned to this ticket
        if (ticket.teknisiId && ticket.teknisiId !== req.user.id && ticket.teknisiId !== req.user.username) {
            return res.status(403).json({
                status: 403,
                message: 'Anda bukan teknisi yang menangani tiket ini'
            });
        }
        
        // Check status - must be 'process' to go OTW
        if (ticket.status !== 'process' && ticket.status !== 'diproses teknisi') {
            return res.status(400).json({
                status: 400,
                message: `Status tiket tidak sesuai. Harus diproses dulu. Status saat ini: ${ticket.status}`
            });
        }
        
        // Find teknisi info
        const teknisi = global.accounts.find(acc => 
            acc.role === 'teknisi' && (
                acc.username === req.user.username ||
                acc.id === req.user.id
            )
        );
        
        if (!teknisi) {
            return res.status(403).json({
                status: 403,
                message: 'Akun teknisi tidak ditemukan'
            });
        }
        
        ({ ticket } = markTicketOtw({
            ticketId,
            actor: {
                id: req.user.id || req.user.username,
                username: req.user.username,
                name: teknisi.name || teknisi.username,
                phoneNumber: teknisi.phone_number,
                channel: 'web'
            },
            location: location || null
        }));
        if (DEBUG) console.log(`[TICKET_OTW] Ticket ${ticketId} status updated to OTW`);

        let notifyResult = { sent: false };
        let notifyErrorMessage = null;
        try {
            notifyResult = await notifyTicketOtw(ticket, {
                name: teknisi.name || teknisi.username,
                username: teknisi.username,
                phoneNumber: teknisi.phone_number
            });
        } catch (notifyError) {
            notifyErrorMessage = notifyError.message;
            console.error('[TICKET_OTW_NOTIFY_ERROR]', notifyError);
        }

        return res.json({
            status: 200,
            message: notifyResult.sent ? 'Status OTW berhasil diupdate. Pelanggan telah dinotifikasi.' : 'Status OTW berhasil diupdate, namun notifikasi pelanggan gagal.',
            data: {
                ticketId: ticket.ticketId || ticket.id,
                status: 'otw',
                teknisiName: teknisi.name || teknisi.username,
                customerNotified: notifyResult.sent,
                notificationError: notifyErrorMessage || undefined
            }
        });
    } catch (error) {
        console.error('[API_TICKET_OTW_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat update status OTW',
            error: error.message
        });
    }
});

// POST /api/ticket/arrived - Teknisi arrived at location (Sampai Lokasi)
// Follows WhatsApp bot workflow: handleSampaiLokasi()
router.post('/ticket/arrived', ensureAuthenticatedStaff, rateLimit('ticket-arrived', 10, 60000), async (req, res) => {
    try {
        const { ticketId } = req.body;
        
        if (!ticketId) {
            return res.status(400).json({
                status: 400,
                message: 'ID tiket harus diisi'
            });
        }
        
        // Find the ticket
        const reportIndex = global.reports.findIndex(r => 
            r.id === ticketId || r.ticketId === ticketId || 
            r.id === ticketId.toUpperCase() || r.ticketId === ticketId.toUpperCase()
        );
        
        if (reportIndex === -1) {
            return res.status(404).json({
                status: 404,
                message: 'Tiket tidak ditemukan'
            });
        }
        
        let ticket = ensureTicketShape(global.reports[reportIndex]);
        
        // Verify teknisi is assigned to this ticket
        if (ticket.teknisiId && ticket.teknisiId !== req.user.id && ticket.teknisiId !== req.user.username) {
            return res.status(403).json({
                status: 403,
                message: 'Anda bukan teknisi yang menangani tiket ini'
            });
        }
        
        // Check status - can be OTW or process (allow flexibility)
        if (ticket.status !== 'otw' && ticket.status !== 'process' && ticket.status !== 'diproses teknisi') {
            return res.status(400).json({
                status: 400,
                message: `Status tiket tidak sesuai. Status saat ini: ${ticket.status}`
            });
        }
        
        // Find teknisi info
        const teknisi = global.accounts.find(acc => 
            acc.role === 'teknisi' && (
                acc.username === req.user.username ||
                acc.id === req.user.id
            )
        );
        
        if (!teknisi) {
            return res.status(403).json({
                status: 403,
                message: 'Akun teknisi tidak ditemukan'
            });
        }
        
        ({ ticket } = markTicketArrived({
            ticketId,
            actor: {
                id: req.user.id || req.user.username,
                username: req.user.username,
                name: teknisi.name || teknisi.username,
                phoneNumber: teknisi.phone_number,
                channel: 'web'
            }
        }));
        if (DEBUG) console.log(`[TICKET_ARRIVED] Ticket ${ticketId} status updated to arrived, OTP: ${ticket.otp}`);

        const notifyResult = await notifyTicketArrived(ticket, {
            name: teknisi.name || teknisi.username,
            username: teknisi.username,
            phoneNumber: teknisi.phone_number
        });

        return res.json({
            status: 200,
            message: 'Status arrived berhasil diupdate',
            data: {
                ticketId: ticket.ticketId || ticket.id,
                status: 'arrived',
                otp: ticket.otp,
                teknisiName: teknisi.name || teknisi.username,
                customerNotified: notifyResult.sent,
                nextStep: 'verifikasi OTP'
            }
        });
    } catch (error) {
        console.error('[API_TICKET_ARRIVED_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat update status arrived',
            error: error.message
        });
    }
});

// POST /api/ticket/verify-otp - Verify OTP and start work
// Follows WhatsApp bot workflow: handleVerifikasiOTP()
// IMPORTANT: OTP attempt limit to prevent brute force
router.post('/ticket/verify-otp', ensureAuthenticatedStaff, rateLimit('ticket-verify-otp', 10, 60000), async (req, res) => {
    try {
        const { ticketId, otp } = req.body;
        
        if (!ticketId || !otp) {
            return res.status(400).json({
                status: 400,
                message: 'ID tiket dan OTP harus diisi'
            });
        }
        
        // Find the ticket
        const reportIndex = global.reports.findIndex(r => 
            r.id === ticketId || r.ticketId === ticketId || 
            r.id === ticketId.toUpperCase() || r.ticketId === ticketId.toUpperCase()
        );
        
        if (reportIndex === -1) {
            return res.status(404).json({
                status: 404,
                message: 'Tiket tidak ditemukan'
            });
        }
        
        let ticket = ensureTicketShape(global.reports[reportIndex]);
        
        // Verify teknisi is assigned to this ticket
        if (ticket.teknisiId && ticket.teknisiId !== req.user.id && ticket.teknisiId !== req.user.username) {
            return res.status(403).json({
                status: 403,
                message: 'Anda bukan teknisi yang menangani tiket ini'
            });
        }
        
        // Check status - must be 'arrived' to verify OTP
        if (ticket.status !== 'arrived') {
            return res.status(400).json({
                status: 400,
                message: `Harus sampai di lokasi dulu. Status saat ini: ${ticket.status}`
            });
        }
        
        // OTP Attempt Limit: Prevent brute force attacks
        const MAX_OTP_ATTEMPTS = 5;
        const OTP_ATTEMPT_RESET_WINDOW = 15 * 60 * 1000; // 15 minutes
        
        // Initialize OTP attempts if not exists
        if (ticket.otpAttempts === undefined) {
            ticket.otpAttempts = 0;
            ticket.otpAttemptsResetAt = Date.now();
        }
        
        // Reset attempts if window has passed
        const now = Date.now();
        if (now - ticket.otpAttemptsResetAt > OTP_ATTEMPT_RESET_WINDOW) {
            ticket.otpAttempts = 0;
            ticket.otpAttemptsResetAt = now;
        }
        
        // Check if attempts exceeded
        if (ticket.otpAttempts >= MAX_OTP_ATTEMPTS) {
            const remainingTime = Math.ceil((OTP_ATTEMPT_RESET_WINDOW - (now - ticket.otpAttemptsResetAt)) / (60 * 1000));
            return res.status(429).json({
                status: 429,
                message: `Terlalu banyak percobaan verifikasi OTP. Coba lagi dalam ${remainingTime} menit atau minta OTP baru.`,
                data: {
                    attemptsUsed: ticket.otpAttempts,
                    maxAttempts: MAX_OTP_ATTEMPTS,
                    remainingTimeMinutes: remainingTime
                }
            });
        }
        
        // Verify OTP
        if (ticket.otp !== otp.toString().trim()) {
            // Increment attempt counter
            ticket.otpAttempts = (ticket.otpAttempts || 0) + 1;
            if (!ticket.otpAttemptsResetAt) {
                ticket.otpAttemptsResetAt = now;
            }
            saveReports(global.reports);
            
            const remainingAttempts = MAX_OTP_ATTEMPTS - ticket.otpAttempts;
            return res.status(400).json({
                status: 400,
                message: `Kode OTP salah! Minta kode yang benar dari pelanggan. (Percobaan ${ticket.otpAttempts}/${MAX_OTP_ATTEMPTS})`,
                data: {
                    attemptsUsed: ticket.otpAttempts,
                    maxAttempts: MAX_OTP_ATTEMPTS,
                    remainingAttempts: remainingAttempts
                }
            });
        }
        
        // Find teknisi info
        const teknisi = global.accounts.find(acc => 
            acc.role === 'teknisi' && (
                acc.username === req.user.username ||
                acc.id === req.user.id
            )
        );
        
        if (!teknisi) {
            return res.status(403).json({
                status: 403,
                message: 'Akun teknisi tidak ditemukan'
            });
        }
        
        ({ ticket } = verifyTicketOtp({
            ticketId,
            actor: {
                id: req.user.id || req.user.username,
                username: req.user.username,
                name: teknisi.name || teknisi.username,
                phoneNumber: teknisi.phone_number,
                channel: 'web'
            },
            otp
        }));
        if (DEBUG) console.log(`[TICKET_VERIFY_OTP] Ticket ${ticketId} OTP verified, status updated to working`);

        const notifyResult = await notifyTicketWorking(ticket, {
            name: teknisi.name || teknisi.username,
            username: teknisi.username,
            phoneNumber: teknisi.phone_number
        });

        return res.json({
            status: 200,
            message: 'OTP berhasil diverifikasi',
            data: {
                ticketId: ticket.ticketId || ticket.id,
                status: 'working',
                teknisiName: teknisi.name || teknisi.username,
                workStartedAt: ticket.workStartedAt,
                customerNotified: notifyResult.sent,
                nextStep: 'upload foto (minimal 2)'
            }
        });
    } catch (error) {
        console.error('[API_TICKET_VERIFY_OTP_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat verifikasi OTP',
            error: error.message
        });
    }
});

// POST /api/ticket/complete - Complete ticket with resolution notes
// Follows WhatsApp bot workflow: handleSelesaiTicket() / handleCompleteTicket()
// IMPORTANT: Enforces minimum 2 photos requirement
router.post('/ticket/complete', ensureAuthenticatedStaff, rateLimit('ticket-complete', 10, 60000), async (req, res) => {
    try {
        const { ticketId, resolutionNotes } = req.body;
        
        if (!ticketId) {
            return res.status(400).json({
                status: 400,
                message: 'ID tiket harus diisi'
            });
        }
        
        // Find the ticket
        const reportIndex = global.reports.findIndex(r => 
            r.id === ticketId || r.ticketId === ticketId || 
            r.id === ticketId.toUpperCase() || r.ticketId === ticketId.toUpperCase()
        );
        
        if (reportIndex === -1) {
            return res.status(404).json({
                status: 404,
                message: 'Tiket tidak ditemukan'
            });
        }
        
        let ticket = ensureTicketShape(global.reports[reportIndex]);
        
        // Verify teknisi is assigned to this ticket
        if (ticket.teknisiId && ticket.teknisiId !== req.user.id && ticket.teknisiId !== req.user.username) {
            return res.status(403).json({
                status: 403,
                message: 'Anda bukan teknisi yang menangani tiket ini'
            });
        }
        
        // Check status - must be 'working' to complete
        if (ticket.status !== 'working') {
            return res.status(400).json({
                status: 400,
                message: `Tiket belum dalam status working. Status saat ini: ${ticket.status}`
            });
        }
        
        const minPhotos = 2;
        if (!ticket.teknisiPhotos || ticket.teknisiPhotos.length < minPhotos) {
            return res.status(400).json({
                status: 400,
                message: `Minimal ${minPhotos} foto diperlukan! Saat ini: ${ticket.teknisiPhotos ? ticket.teknisiPhotos.length : 0} foto`,
                data: {
                    currentPhotos: ticket.teknisiPhotos ? ticket.teknisiPhotos.length : 0,
                    requiredPhotos: minPhotos,
                    missing: minPhotos - (ticket.teknisiPhotos ? ticket.teknisiPhotos.length : 0)
                }
            });
        }
        
        // Find teknisi info
        const teknisi = global.accounts.find(acc => 
            acc.role === 'teknisi' && (
                acc.username === req.user.username ||
                acc.id === req.user.id
            )
        );
        
        if (!teknisi) {
            return res.status(403).json({
                status: 403,
                message: 'Akun teknisi tidak ditemukan'
            });
        }
        
        // Store old status for activity log
        const oldStatus = ticket.status;
        const { ticket: completedTicket, durationMinutes } = completeTicketWorkflow({
            ticketId,
            actor: {
                id: req.user.id || req.user.username,
                username: req.user.username,
                name: teknisi.name || teknisi.username,
                phoneNumber: teknisi.phone_number,
                channel: 'web'
            },
            resolutionNotes
        });
        ticket = completedTicket;
        if (DEBUG) console.log(`[TICKET_COMPLETE] Ticket ${ticketId} completed. Duration: ${durationMinutes} min, Photos: ${ticket.teknisiPhotos.length}`);
        
        // Log activity
        try {
            await logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: 'UPDATE',
                resourceType: 'ticket',
                resourceId: ticket.ticketId || ticket.id,
                resourceName: `Ticket ${ticket.ticketId || ticket.id}`,
                description: `Completed ticket ${ticket.ticketId || ticket.id} (duration: ${durationMinutes} min, photos: ${ticket.teknisiPhotos.length})`,
                oldValue: { status: oldStatus },
                newValue: { 
                    status: 'completed', 
                    resolvedBy: teknisi.name || teknisi.username,
                    resolutionNotes: resolutionNotes || 'Selesai',
                    workDuration: durationMinutes,
                    photoCount: ticket.teknisiPhotos.length
                },
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            });
        } catch (logErr) {
            console.error('[ACTIVITY_LOG_ERROR] Failed to log ticket complete:', logErr);
        }

        const notifyResult = await notifyTicketCompleted(ticket, {
            name: teknisi.name || teknisi.username,
            username: teknisi.username,
            phoneNumber: teknisi.phone_number
        }, {
            durationMinutes
        });

        return res.json({
            status: 200,
            message: 'Tiket berhasil diselesaikan',
            data: {
                ticketId: ticket.ticketId || ticket.id,
                status: 'completed',
                teknisiName: teknisi.name || teknisi.username,
                duration: durationMinutes,
                photoCount: ticket.teknisiPhotos.length,
                customerNotified: notifyResult.sent,
                completedAt: ticket.completedAt
            }
        });
    } catch (error) {
        console.error('[API_TICKET_COMPLETE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat menyelesaikan tiket',
            error: error.message
        });
    }
});

// POST /api/ticket/resolve - Resolve a ticket (teknisi)
router.post('/ticket/resolve', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const { ticketId, resolution } = req.body;
        
        if (!ticketId) {
            return res.status(400).json({
                status: 400,
                message: 'ID tiket harus diisi'
            });
        }
        
        // Find the ticket - cek dengan ticketId atau id (untuk kompatibilitas)
        const reportIndex = global.reports.findIndex(r => 
            r.ticketId === ticketId || r.id === ticketId
        );
        if (reportIndex === -1) {
            return res.status(404).json({
                status: 404,
                message: 'Tiket tidak ditemukan'
            });
        }
        
        let report = ensureTicketShape(global.reports[reportIndex]);
        const teknisi = global.accounts.find(acc =>
            acc.role === 'teknisi' && (
                acc.username === req.user.username ||
                acc.id === req.user.id
            )
        );
        const { ticket: completedTicket, durationMinutes } = completeTicketWorkflow({
            ticketId,
            actor: {
                id: req.user.id || req.user.username,
                username: req.user.username,
                name: teknisi?.name || req.user.name || req.user.username,
                phoneNumber: teknisi?.phone_number || req.user.phone || req.user.phone_number,
                channel: 'web'
            },
            resolutionNotes: resolution || 'Selesai'
        });
        report = completedTicket;

        await notifyTicketCompleted(report, {
            name: teknisi?.name || req.user.name || req.user.username,
            username: req.user.username,
            phoneNumber: teknisi?.phone_number || req.user.phone || req.user.phone_number
        }, {
            durationMinutes
        });

        return res.json({
            status: 200,
            message: 'Tiket berhasil diselesaikan'
        });
    } catch (error) {
        console.error('[API_TICKET_RESOLVE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat menyelesaikan tiket'
        });
    }
});

// POST /api/ticket/create - Teknisi create ticket (SAME logic as admin)
router.post('/ticket/create', ensureAuthenticatedStaff, rateLimit('ticket-create', 5, 60000), async (req, res) => {
    try {
        const { customerUserId, laporanText, priority, issueType } = req.body;
        
        if (!customerUserId || !laporanText) {
            return res.status(400).json({
                status: 400,
                message: 'User ID dan laporan harus diisi'
            });
        }
        
        // Find the user
        const user = global.users.find(u => u.id === parseInt(customerUserId));
        if (!user) {
            return res.status(404).json({
                status: 404,
                message: 'Pelanggan tidak ditemukan'
            });
        }
        
        // Check working hours before creating ticket
        const workingStatus = isWithinWorkingHours();
        const nextAvailable = getNextAvailableMessage();
        
        // If outside working hours, prepare warning message
        let workingHoursWarning = null;
        if (!workingStatus.isWithinHours) {
            workingHoursWarning = {
                isOutsideHours: true,
                message: workingStatus.message || 'Di luar jam kerja',
                nextAvailable: nextAvailable,
                dayType: workingStatus.dayType
            };
        }
        
        const newTicket = createBaseTicket({
            user,
            laporanText,
            priority: priority || 'MEDIUM',
            issueType: issueType || 'GENERAL',
            createdBy: req.user.name || req.user.username,
            createdByRole: req.user.role || 'teknisi'
        });
        const ticketId = newTicket.ticketId;
        newTicket.deviceOnline = null;
        if (req.user.role === 'teknisi') {
            newTicket.assignedTeknisiId = req.user.id || req.user.username;
            newTicket.assignedTeknisiName = req.user.name || req.user.username;
        }
        saveReports(global.reports);
        
        // Prepare response message based on working hours
        let responseMessage = 'Tiket berhasil dibuat. Notifikasi sedang dikirim...';
        if (workingHoursWarning) {
            responseMessage = `Tiket berhasil dibuat. ${workingHoursWarning.message}. ${workingHoursWarning.nextAvailable || 'Teknisi akan memproses pada jam kerja berikutnya.'}`;
        }
        
        // Send response immediately (don't wait for notifications)
        // PENTING: Pastikan ticketId ada di response untuk frontend (explicit)
        res.json({
            status: 200,
            message: responseMessage,
            data: {
                ...newTicket,
                ticketId: ticketId,  // Explicit ticketId untuk memastikan frontend mendapatkannya
                id: ticketId  // Juga sebagai id untuk kompatibilitas
            },
            workingHours: {
                isWithinHours: workingStatus.isWithinHours,
                warning: workingHoursWarning,
                nextAvailable: nextAvailable
            }
        });

        let workingHoursNotice = '';
        if (workingHoursWarning) {
            const config = global.config.teknisiWorkingHours;
            workingHoursNotice = buildWorkingHoursNotice(config, nextAvailable);
        }

        const creatorName = req.user.name || req.user.username;
        const creatorInfo = req.user.role === 'teknisi' ? `Teknisi ${creatorName}` : `Admin ${creatorName}`;
        const customerMsg = renderResponseTemplate("routes_ticket_created_customer_staff", {
            customerName: user.name || 'Pelanggan',
            creatorInfo,
            ticketId,
            priorityText: formatTicketPriority(priority),
            reportText: laporanText,
            createdAt: new Date().toLocaleString('id-ID'),
            workingHoursNotice
        });

        const excludeJids = [];
        if (req.user.role === 'teknisi' && req.user.phone_number) {
            const teknisiJid = toJid(req.user.phone_number);
            if (teknisiJid) excludeJids.push(teknisiJid);
        }

        (async () => {
            try {
                await notifyCustomerTicketUpdate(newTicket, customerMsg, {
                    flow: 'web_staff_ticket',
                    step: 'created_customer'
                });
                await notifyNewReport(newTicket, {
                    notifyAdmins: req.user.role !== 'admin',
                    excludeJids
                });
            } catch (notifyError) {
                console.error('[CREATE_TICKET_NOTIFY_ERROR]', notifyError);
            }
        })();
        return;
    } catch (error) {
        console.error('[API_TICKET_CREATE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat membuat tiket',
            error: error.message
        });
    }
});

// POST /api/ticket/share-location - Teknisi share/update lokasi terkini ke pelanggan (web)
// Dipakai saat teknisi sedang menangani tiket (process/otw/arrived/working) untuk update posisi.
// Lokasi disimpan ke shared store yang sama dengan command WhatsApp `lokasi <ticketId>`.
router.post('/ticket/share-location', ensureAuthenticatedStaff, rateLimit('ticket-share-location', 20, 60000), async (req, res) => {
    try {
        const { ticketId, location } = req.body;

        if (!ticketId) {
            return res.status(400).json({ status: 400, message: 'ID tiket harus diisi' });
        }

        const latitude = location?.latitude;
        const longitude = location?.longitude;
        if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
            return res.status(400).json({ status: 400, message: 'Data lokasi tidak valid' });
        }

        const reportIndex = global.reports.findIndex(r =>
            r.id === ticketId || r.ticketId === ticketId ||
            r.id === ticketId.toUpperCase() || r.ticketId === ticketId.toUpperCase()
        );

        if (reportIndex === -1) {
            return res.status(404).json({ status: 404, message: 'Tiket tidak ditemukan' });
        }

        let ticket = ensureTicketShape(global.reports[reportIndex]);

        // Verify teknisi is assigned to this ticket
        if (ticket.teknisiId && ticket.teknisiId !== req.user.id && ticket.teknisiId !== req.user.username) {
            return res.status(403).json({ status: 403, message: 'Anda bukan teknisi yang menangani tiket ini' });
        }

        // Lokasi hanya relevan saat tiket sedang ditangani
        const activeStatuses = ['process', 'otw', 'arrived', 'working'];
        if (!activeStatuses.includes(normalizeStatus(ticket.status))) {
            return res.status(400).json({
                status: 400,
                message: `Berbagi lokasi hanya tersedia saat tiket sedang ditangani. Status saat ini: ${ticket.status}`
            });
        }

        let locationData;
        try {
            locationData = persistTicketLocation({
                ticketId: ticket.ticketId,
                teknisiId: ticket.teknisiId || req.user.id || req.user.username,
                latitude,
                longitude,
                accuracy: location.accuracy
            });
        } catch (locationError) {
            if (locationError.code === 'INVALID_LOCATION') {
                return res.status(400).json({ status: 400, message: 'Koordinat lokasi tidak valid' });
            }
            throw locationError;
        }

        // Persist last known location on the ticket itself
        ticket.lastLocation = locationData.googleMapsUrl;
        ensureTicketShape(ticket);
        saveReports(global.reports);

        let notifyResult = { sent: false };
        let notifyErrorMessage = null;
        try {
            notifyResult = await notifyCustomerLocation(ticket, locationData);
        } catch (notifyError) {
            notifyErrorMessage = notifyError.message;
            console.error('[TICKET_SHARE_LOCATION_NOTIFY_ERROR]', notifyError);
        }

        return res.json({
            status: 200,
            message: notifyResult.sent
                ? 'Lokasi berhasil dibagikan ke pelanggan.'
                : 'Lokasi tersimpan, namun notifikasi pelanggan gagal/terlewati.',
            data: {
                ticketId: ticket.ticketId || ticket.id,
                status: ticket.status,
                googleMapsUrl: locationData.googleMapsUrl,
                customerNotified: notifyResult.sent,
                notificationError: notifyErrorMessage || undefined
            }
        });
    } catch (error) {
        console.error('[API_TICKET_SHARE_LOCATION_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat membagikan lokasi',
            error: error.message
        });
    }
});

module.exports = router;
