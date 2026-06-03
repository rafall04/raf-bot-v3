/**
 * Header Doc
 * Purpose: Router tiket gangguan untuk admin/teknisi termasuk workflow tiket web, upload foto, dan notifikasi WhatsApp outbound.
 * Caller: Express route registry.
 * Deps: database, activity logger, ticket-workflow, report-notification-service, working-hours-helper, path-helper, template-service.
 * MainFuncs: ensureAuthenticatedStaff, ensureAdmin, ticket process/otw/arrived/complete/create/cancel routes, renderResponseTemplate.
 * SideEffects: Menulis laporan/tiket, upload file foto, log activity, mengirim notifikasi WhatsApp.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { saveReports, loadJSON, saveJSON } = require('../lib/database');
const { logActivity } = require('../lib/activity-logger');
const { rateLimit } = require('../lib/security');
const { withLock } = require('../lib/request-lock');
const {
    createBaseTicket,
    ensureTicketShape,
    normalizeAllTickets,
    normalizeStatus,
    processTicket: processTicketWorkflow,
    markTicketOtw,
    markTicketArrived,
    verifyTicketOtp,
    appendTechnicianPhoto,
    completeTicket: completeTicketWorkflow
} = require('../lib/ticket-workflow');
const {
    notifyNewReport,
    notifyCustomerTicketUpdate,
    notifyTicketProcessed,
    notifyTicketOtw,
    notifyTicketArrived,
    notifyTicketWorking,
    notifyTicketCompleted,
    notifyTicketCancelled,
    toJid
} = require('../lib/report-notification-service');
const { renderCategoryTemplate } = require('../lib/template-service');

const router = express.Router();
const reportsDbPath = path.join(__dirname, '..', 'database', 'reports.json');

// Debug flag for verbose logging
const DEBUG = process.env.TICKET_DEBUG === 'true' || false;

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate("responseTemplates", key, data).text;
}

function formatTicketPriority(priority) {
    if (priority === 'HIGH') return 'URGENT';
    if (priority === 'MEDIUM') return 'NORMAL';
    return 'LOW';
}

function buildWorkingHoursNotice(config, nextAvailable) {
    return renderResponseTemplate("routes_ticket_working_hours_notice", {
        outOfHoursMessage: config?.outOfHoursMessage || '',
        nextAvailable: nextAvailable || ''
    });
}

// Import working hours helper
const { isWithinWorkingHours, getNextAvailableMessage, getResponseTimeMessage } = require('../lib/working-hours-helper');

/**
 * Configure multer for photo uploads
 * Store in uploads/tickets/YEAR/MONTH/TICKET_ID/ (structured, consistent with reports)
 */
const { getTicketsUploadsPathByTicket, getReportsUploadsPath } = require('../lib/path-helper');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // PENTING: req.body mungkin belum tersedia saat destination dipanggil untuk multipart/form-data
        // Gunakan query parameter atau header sebagai fallback
        const ticketId = req.query?.ticketId || req.body?.ticketId || req.headers['x-ticket-id'] || 'UNKNOWN';
        
        // Get year and month from ticket creation date (if available) or current date
        let year, month;
        const ticketCreatedAt = req.query?.ticketCreatedAt || req.body?.ticketCreatedAt || req.headers['x-ticket-created-at'];
        if (ticketCreatedAt) {
            const ticketDate = new Date(ticketCreatedAt);
            year = ticketDate.getFullYear();
            month = String(ticketDate.getMonth() + 1).padStart(2, '0');
        } else {
            // Fallback to current date if ticket date not available
            const now = new Date();
            year = now.getFullYear();
            month = String(now.getMonth() + 1).padStart(2, '0');
        }
        
        // Use structured path: uploads/tickets/YEAR/MONTH/TICKET_ID/
        const uploadDir = getTicketsUploadsPathByTicket(year, month, ticketId, __dirname);
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename: photo_TIMESTAMP_RANDOM.ext
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const ext = path.extname(file.originalname);
        cb(null, `photo_${timestamp}_${random}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept images only
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Hanya file gambar yang diperbolehkan'), false);
        }
        cb(null, true);
    }
});

// Middleware for authentication
function ensureAuthenticatedStaff(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak." });
    }
    next();
}

function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: "Akses ditolak. Hanya admin yang diizinkan." });
    }
    next();
}

// GET /api/tickets - Get tickets for teknisi (filtered by status)
router.get('/tickets', ensureAuthenticatedStaff, async (req, res) => {
    try {
        normalizeAllTickets();
        const { status } = req.query;
        let filteredReports = [...global.reports];
        
        // Filter by status if provided
        if (status) {
            const statusArray = status.split(',').map(s => s.trim().toLowerCase());
            filteredReports = filteredReports.filter(report => {
                const reportStatus = normalizeStatus(report.status || 'baru');
                return statusArray.includes(reportStatus);
            });
            // Only log if there are tickets or if it's an error case
            // Removed verbose logging
        }
        
        // REMOVED DOUBLE FILTER for teknisi role!
        // Frontend already specifies which statuses to show via query param
        // No need to filter again here - it was killing tickets with status='process', 'otw', etc.
        // See TICKET_STATUS_STANDARD.md for correct workflow
        
        // Sort by created_at descending (newest first)
        filteredReports.sort((a, b) => {
            const dateA = new Date(a.created_at || 0);
            const dateB = new Date(b.created_at || 0);
            return dateB - dateA;
        });
        
        // Add user details to each report
        const reportsWithDetails = filteredReports.map(report => {
            const user = global.users.find(u => u.id === report.user_id);
            return {
                ...report,
                normalizedStatus: normalizeStatus(report.status || 'baru'),
                user_name: user ? user.name : 'Unknown',
                user_phone: user ? (user.phone_number || user.phone || '') : '',
                user_package: user ? user.package : '',
                user_pppoe: user ? user.pppoe_username : ''
            };
        });
        
        return res.json({
            status: 200,
            data: reportsWithDetails
        });
    } catch (error) {
        console.error('[API_TICKETS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat mengambil data tiket'
        });
    }
});

// GET /api/admin/tickets - Get all tickets for admin
router.get('/admin/tickets', ensureAdmin, async (req, res) => {
    try {
        normalizeAllTickets();
        const { status, pppoeName, ticketId } = req.query;
        let filteredReports = [...global.reports];
        
        // Filter by status if provided
        if (status && status !== 'all') {
            filteredReports = filteredReports.filter(report => 
                normalizeStatus(report.status || 'baru') === status.toLowerCase()
            );
        }
        
        // Filter by PPPoE name if provided
        if (pppoeName) {
            const usersWithPppoe = global.users.filter(u => 
                u.pppoe_username && u.pppoe_username.toLowerCase().includes(pppoeName.toLowerCase())
            );
            const userIds = usersWithPppoe.map(u => u.id);
            filteredReports = filteredReports.filter(report => 
                userIds.includes(report.user_id)
            );
        }
        
        // Filter by ticket ID if provided
        if (ticketId) {
            filteredReports = filteredReports.filter(report => 
                report.id && report.id.toLowerCase().includes(ticketId.toLowerCase())
            );
        }
        
        // Sort by created_at descending (newest first)
        filteredReports.sort((a, b) => {
            const dateA = new Date(a.created_at || 0);
            const dateB = new Date(b.created_at || 0);
            return dateB - dateA;
        });
        
        // Add user details to each report
        const reportsWithDetails = filteredReports.map(report => {
            const user = global.users.find(u => u.id === report.user_id);
            return {
                ...report,
                normalizedStatus: normalizeStatus(report.status || 'baru'),
                user_name: user ? user.name : 'Unknown',
                user_phone: user ? (user.phone_number || user.phone || '') : '',
                user_package: user ? user.package : '',
                user_pppoe: user ? user.pppoe_username : ''
            };
        });
        
        return res.json({
            status: 200,
            data: reportsWithDetails
        });
    } catch (error) {
        console.error('[API_ADMIN_TICKETS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat mengambil data tiket'
        });
    }
});

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

// POST /api/ticket/upload-photo - Upload photo documentation
// Follows WhatsApp bot workflow: handleTeknisiPhotoUpload()
router.post('/ticket/upload-photo', ensureAuthenticatedStaff, rateLimit('ticket-upload-photo', 20, 60000), upload.single('photo'), async (req, res) => {
    try {
        const { ticketId } = req.body;
        
        if (!ticketId) {
            return res.status(400).json({
                status: 400,
                message: 'ID tiket harus diisi'
            });
        }
        
        if (!req.file) {
            return res.status(400).json({
                status: 400,
                message: 'File foto harus diupload'
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
        
        // Check status - must be 'working' to upload photos
        if (ticket.status !== 'working') {
            return res.status(400).json({
                status: 400,
                message: `Harus verifikasi OTP dulu. Status saat ini: ${ticket.status}`
            });
        }
        
        // Check maximum photos limit (max 5 photos)
        const totalPhotos = ticket.teknisiPhotos.length;
        
        if (totalPhotos >= 5) {
            // Delete the uploaded file since we're rejecting it
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                status: 400,
                message: 'Maksimal 5 foto sudah tercapai'
            });
        }
        
        // Get category information from request (optional, for new categorized workflow)
        const category = req.body.category || null;
        const categoryLabel = req.body.categoryLabel || null;
        
        // Get year and month from ticket creation date for structured path
        const ticketDate = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
        const year = ticketDate.getFullYear();
        const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
        
        const photoInfo = {
            path: `/uploads/tickets/${year}/${month}/${ticketId}/${req.file.filename}`,
            fileName: req.file.filename,
            uploadedAt: new Date().toISOString(),
            uploadedBy: req.user.username,
            size: req.file.size,
            ...(category && { category, categoryLabel }),
            source: 'web_teknisi',
            order: ticket.teknisiPhotos.length + 1
        };
        ({ ticket } = appendTechnicianPhoto({
            ticketId,
            actor: {
                id: req.user.id || req.user.username,
                username: req.user.username,
                name: req.user.name || req.user.username,
                phoneNumber: req.user.phone || req.user.phone_number,
                channel: 'web'
            },
            photo: photoInfo
        }));
        if (DEBUG) console.log(`[TICKET_UPLOAD_PHOTO] Photo uploaded for ticket ${ticketId}. Total: ${ticket.teknisiPhotos.length}`);
        
        // Check if minimum photos requirement is met
        const minPhotos = 2;
        const currentTotal = ticket.teknisiPhotos.length;
        const canComplete = currentTotal >= minPhotos;
        
        return res.json({
            status: 200,
            message: `Foto ${currentTotal} berhasil diupload`,
            data: {
                ticketId: ticket.ticketId || ticket.id,
                photoCount: currentTotal,
                totalPhotos: currentTotal,
                minPhotos: minPhotos,
                canComplete: canComplete,
                photo: photoInfo,
                nextStep: canComplete ? 'Bisa selesaikan tiket sekarang' : `Perlu ${minPhotos - currentTotal} foto lagi (minimal ${minPhotos} foto)`
            }
        });
    } catch (error) {
        console.error('[API_TICKET_UPLOAD_PHOTO_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat upload foto',
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

// POST /api/admin/ticket/create - Admin create ticket (UPDATED to match WhatsApp bot)
router.post('/admin/ticket/create', ensureAdmin, async (req, res) => {
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
            createdByRole: req.user.role || 'admin'
        });
        const ticketId = newTicket.ticketId;
        newTicket.createdByAdmin = true;
        newTicket.deviceOnline = null;
        saveReports(global.reports);
        
        // Log activity (admin create ticket)
        try {
            await logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: 'CREATE',
                resourceType: 'ticket',
                resourceId: ticketId,
                resourceName: `Ticket ${ticketId}`,
                description: `Created ticket ${ticketId} for user ${user.name} (${issueType || 'GENERAL'}, ${priority || 'MEDIUM'})`,
                oldValue: null,
                newValue: {
                    ticketId: ticketId,
                    customer: user.name,
                    issueType: issueType || 'GENERAL',
                    priority: priority || 'MEDIUM',
                    status: 'baru'
                },
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            });
        } catch (logErr) {
            console.error('[ACTIVITY_LOG_ERROR] Failed to log ticket create:', logErr);
        }
        
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

        const adminName = req.user.name || req.user.username;
        const customerMsg = renderResponseTemplate("routes_ticket_created_customer_admin", {
            customerName: user.name || 'Pelanggan',
            adminName,
            ticketId,
            priorityText: formatTicketPriority(priority),
            reportText: laporanText,
            createdAt: new Date().toLocaleString('id-ID'),
            workingHoursNotice
        });

        (async () => {
            try {
                await notifyCustomerTicketUpdate(newTicket, customerMsg, {
                    flow: 'web_admin_ticket',
                    step: 'created_customer'
                });
                await notifyNewReport(newTicket, {
                    notifyAdmins: false
                });
            } catch (notifyError) {
                console.error('[ADMIN_CREATE_TICKET_NOTIFY_ERROR]', notifyError);
            }
        })();
        return;
    } catch (error) {
        console.error('[API_ADMIN_TICKET_CREATE_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat membuat tiket',
            error: error.message
        });
    }
});

// Multer storage khusus untuk upload foto saat create ticket (menggunakan struktur reports)
const createTicketPhotoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // PENTING: req.body mungkin belum tersedia saat destination dipanggil untuk multipart/form-data
        // Gunakan query parameter atau header sebagai fallback
        const ticketId = req.query?.ticketId || req.body?.ticketId || req.headers['x-ticket-id'];
        
        if (!ticketId) {
            // Jangan throw error di destination, biarkan handler yang handle
            // Gunakan temporary directory dan akan dipindahkan di handler
            const tempDir = path.join(__dirname, '..', 'uploads', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            return cb(null, tempDir);
        }
        
        // Find report to get creation date
        const report = global.reports.find(r => r.ticketId === ticketId || r.id === ticketId);
        let year, month;
        
        if (report && report.createdAt) {
            const reportDate = new Date(report.createdAt);
            year = reportDate.getFullYear();
            month = String(reportDate.getMonth() + 1).padStart(2, '0');
        } else {
            // Fallback to current date
            const now = new Date();
            year = now.getFullYear();
            month = String(now.getMonth() + 1).padStart(2, '0');
        }
        
        const uploadDir = getReportsUploadsPath(year, month, ticketId, __dirname);
        
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // PENTING: req.body mungkin belum tersedia, gunakan query/header sebagai fallback
        const ticketId = req.query?.ticketId || req.body?.ticketId || req.headers['x-ticket-id'] || 'UNKNOWN';
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const ext = path.extname(file.originalname);
        cb(null, `teknisi_${ticketId}_${timestamp}_${random}${ext}`);
    }
});

const createTicketPhotoUpload = multer({
    storage: createTicketPhotoStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Hanya file gambar yang diperbolehkan'), false);
        }
        cb(null, true);
    }
});

// POST /api/ticket/create/upload-photo - Upload photo saat create ticket (teknisi)
// Endpoint ini digunakan setelah ticket dibuat untuk upload foto opsional
router.post('/ticket/create/upload-photo', ensureAuthenticatedStaff, rateLimit('ticket-create-upload-photo', 10, 60000), createTicketPhotoUpload.single('photo'), async (req, res) => {
    try {
        // PENTING: req.body sudah tersedia di handler (setelah multer parse)
        const ticketId = req.query?.ticketId || req.body?.ticketId || req.headers['x-ticket-id'];
        
        if (!ticketId) {
            // Clean up uploaded file if exists
            if (req.file && req.file.path) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (err) {
                    console.error('[TICKET_CREATE_UPLOAD_PHOTO] Failed to delete file:', err);
                }
            }
            return res.status(400).json({
                status: 400,
                message: 'Ticket ID harus diisi'
            });
        }
        
        if (!req.file) {
            return res.status(400).json({
                status: 400,
                message: 'File foto harus diupload'
            });
        }
        
        // Helper function untuk process photo upload (didefinisikan di sini untuk digunakan di retry dan normal flow)
        const processPhotoUpload = (report) => {
            // Initialize arrays untuk foto (konsisten dengan struktur yang ada)
            if (!report.teknisiPhotos) report.teknisiPhotos = [];
            if (!report.photos) report.photos = [];
            if (!report.customerPhotos) report.customerPhotos = [];
            
            // Check max photos (3 photos max untuk create ticket - total customer + teknisi saat create)
            const totalPhotos = report.customerPhotos.length + report.teknisiPhotos.length;
            if (totalPhotos >= 3) {
                // Clean up uploaded file
                if (req.file && req.file.path) {
                    try {
                        fs.unlinkSync(req.file.path);
                    } catch (err) {
                        console.error('[TICKET_CREATE_UPLOAD_PHOTO] Failed to delete file:', err);
                    }
                }
                return {
                    error: true,
                    status: 400,
                    message: 'Maksimal 3 foto per laporan (termasuk foto dari customer)'
                };
            }
            
            // Get year and month from ticket creation date
            const ticketDate = report.createdAt ? new Date(report.createdAt) : new Date();
            const year = ticketDate.getFullYear();
            const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
            
            // Store photo info (konsisten dengan struktur customerPhotos)
            const photoInfo = {
                fileName: req.file.filename,
                path: `/uploads/reports/${year}/${month}/${ticketId}/${req.file.filename}`,
                uploadedAt: new Date().toISOString(),
                size: req.file.size,
                uploadedBy: req.user.username || req.user.name || 'teknisi',
                uploadedVia: 'teknisi_panel_create'
            };
            
            // Add to teknisiPhotos (array object, konsisten dengan customerPhotos)
            report.teknisiPhotos.push(photoInfo);
            // Juga simpan ke photos untuk kompatibilitas (tapi cek duplicate dulu)
            // Cek apakah foto dengan filename yang sama sudah ada di photos
            const existingPhotoIndex = report.photos.findIndex(p => {
                if (typeof p === 'object' && p.fileName) {
                    return p.fileName === photoInfo.fileName;
                } else if (typeof p === 'string') {
                    return p === photoInfo.fileName;
                }
                return false;
            });
            if (existingPhotoIndex === -1) {
                report.photos.push(photoInfo);
            }
            report.hasTeknisiPhotos = true;
            report.photoCount = report.customerPhotos.length + report.teknisiPhotos.length;
            
            // Save to database
            saveReports(global.reports);
            
            return {
                error: false,
                photoInfo,
                report
            };
        };
        
        // Jika file di-upload ke temp directory (karena ticketId tidak ada saat destination), pindahkan ke lokasi yang benar
        const isTempFile = req.file.path && req.file.path.includes(path.join('uploads', 'temp'));
        if (isTempFile && ticketId) {
            // Find report to get creation date
            const report = global.reports.find(r => r.ticketId === ticketId || r.id === ticketId);
            let year, month;
            
            if (report && report.createdAt) {
                const reportDate = new Date(report.createdAt);
                year = reportDate.getFullYear();
                month = String(reportDate.getMonth() + 1).padStart(2, '0');
            } else {
                const now = new Date();
                year = now.getFullYear();
                month = String(now.getMonth() + 1).padStart(2, '0');
            }
            
            const correctDir = getReportsUploadsPath(year, month, ticketId, __dirname);
            if (!fs.existsSync(correctDir)) {
                fs.mkdirSync(correctDir, { recursive: true });
            }
            
            const correctPath = path.join(correctDir, req.file.filename);
            try {
                fs.renameSync(req.file.path, correctPath);
                req.file.path = correctPath;
                req.file.destination = correctDir;
            } catch (err) {
                console.error('[TICKET_CREATE_UPLOAD_PHOTO] Failed to move file from temp:', err);
                // Continue with temp path, will be cleaned up later
            }
        }
        
        // Find the ticket - normalize ticketId untuk matching (case-insensitive, trim whitespace)
        const normalizedTicketId = String(ticketId).trim().toUpperCase();
        const reportIndex = global.reports.findIndex(r => {
            const rTicketId = r.ticketId ? String(r.ticketId).trim().toUpperCase() : null;
            const rId = r.id ? String(r.id).trim().toUpperCase() : null;
            return rTicketId === normalizedTicketId || rId === normalizedTicketId;
        });
        
        if (reportIndex === -1) {
            // Retry: Mungkin ticket baru saja dibuat dan belum ter-sync
            // Reload reports dari file dan coba lagi (max 3 retries dengan delay)
            let found = false;
            for (let retry = 0; retry < 3; retry++) {
                await new Promise(resolve => setTimeout(resolve, 100 * (retry + 1)));
                
                // Reload reports dari file untuk memastikan data ter-update
                try {
                    const { loadReports } = require('../lib/database');
                    loadReports();
                } catch (err) {
                    console.warn('[TICKET_CREATE_UPLOAD_PHOTO] Failed to reload reports:', err.message);
                }
                
                // Coba cari lagi setelah reload
                const retryIndex = global.reports.findIndex(r => {
                    const rTicketId = r.ticketId ? String(r.ticketId).trim().toUpperCase() : null;
                    const rId = r.id ? String(r.id).trim().toUpperCase() : null;
                    return rTicketId === normalizedTicketId || rId === normalizedTicketId;
                });
                
                if (retryIndex !== -1) {
                    found = true;
                    const actualReport = global.reports[retryIndex];
                    const uploadResult = processPhotoUpload(actualReport);
                    
                    if (uploadResult.error) {
                        return res.status(uploadResult.status).json({
                            status: uploadResult.status,
                            message: uploadResult.message
                        });
                    }
                    
                    if (DEBUG) console.log(`[TICKET_CREATE_UPLOAD_PHOTO] Photo uploaded for ticket ${ticketId} during creation (after retry ${retry + 1}). Total: ${uploadResult.report.teknisiPhotos.length}`);
                    
                    return res.json({
                        status: 200,
                        message: `Foto berhasil diupload (${uploadResult.report.teknisiPhotos.length}/3)`,
                        data: {
                            ticketId: uploadResult.report.ticketId || uploadResult.report.id,
                            photoCount: uploadResult.report.teknisiPhotos.length,
                            totalPhotos: uploadResult.report.photoCount,
                            maxPhotos: 3,
                            photo: uploadResult.photoInfo
                        }
                    });
                }
            }
            
            // Jika masih tidak ditemukan setelah retry
            if (!found) {
                // Debug: Log untuk troubleshooting
                console.warn(`[TICKET_CREATE_UPLOAD_PHOTO] Ticket not found after retries. Looking for: "${ticketId}" (normalized: "${normalizedTicketId}")`);
                console.warn(`[TICKET_CREATE_UPLOAD_PHOTO] Total reports: ${global.reports.length}`);
                console.warn(`[TICKET_CREATE_UPLOAD_PHOTO] Last 5 tickets:`, global.reports.slice(-5).map(r => ({
                    ticketId: r.ticketId,
                    id: r.id,
                    status: r.status,
                    createdAt: r.createdAt
                })));
                
                // Clean up uploaded file
                if (req.file && req.file.path) {
                    try {
                        fs.unlinkSync(req.file.path);
                    } catch (err) {
                        console.error('[TICKET_CREATE_UPLOAD_PHOTO] Failed to delete file:', err);
                    }
                }
                return res.status(404).json({
                    status: 404,
                    message: 'Tiket tidak ditemukan. Pastikan tiket sudah dibuat sebelum upload foto. Silakan refresh halaman dan coba lagi.'
                });
            }
        }
        
        const report = global.reports[reportIndex];
        const uploadResult = processPhotoUpload(report);
        
        if (uploadResult.error) {
            return res.status(uploadResult.status).json({
                status: uploadResult.status,
                message: uploadResult.message
            });
        }
        
        if (DEBUG) console.log(`[TICKET_CREATE_UPLOAD_PHOTO] Photo uploaded for ticket ${ticketId} during creation. Total: ${uploadResult.report.teknisiPhotos.length}`);
        
        return res.json({
            status: 200,
            message: `Foto berhasil diupload (${uploadResult.report.teknisiPhotos.length}/3)`,
            data: {
                ticketId: uploadResult.report.ticketId || uploadResult.report.id,
                photoCount: uploadResult.report.teknisiPhotos.length,
                totalPhotos: uploadResult.report.photoCount,
                maxPhotos: 3,
                photo: uploadResult.photoInfo
            }
        });
    } catch (error) {
        console.error('[TICKET_CREATE_UPLOAD_PHOTO_ERROR]', error);
        // Clean up uploaded file if exists
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                console.error('[TICKET_CREATE_UPLOAD_PHOTO] Failed to delete file:', err);
            }
        }
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat upload foto',
            error: error.message
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

// POST /api/admin/ticket/cancel - Cancel a ticket (admin only)
router.post('/admin/ticket/cancel', ensureAdmin, async (req, res) => {
    try {
        const { ticketId, cancellationReason } = req.body;
        
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
        
        const report = global.reports[reportIndex];
        
        // Store old status for activity log
        const oldStatus = report.status;
        
        // Update ticket status
        report.status = 'dibatalkan';
        report.cancelled_by = req.user.username;
        report.cancelled_at = new Date().toISOString();
        if (cancellationReason) {
            report.cancellation_reason = cancellationReason;
        }
        
        // Save to database
        saveReports(global.reports);
        
        // Log activity
        try {
            await logActivity({
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role,
                actionType: 'UPDATE',
                resourceType: 'ticket',
                resourceId: report.ticketId || report.id,
                resourceName: `Ticket ${report.ticketId || report.id}`,
                description: `Cancelled ticket ${report.ticketId || report.id}${cancellationReason ? `: ${cancellationReason}` : ''}`,
                oldValue: { status: oldStatus },
                newValue: { status: 'dibatalkan', cancellationReason: cancellationReason },
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            });
        } catch (logErr) {
            console.error('[ACTIVITY_LOG_ERROR] Failed to log ticket cancel:', logErr);
        }

        await notifyTicketCancelled(report, {
            name: req.user.name || req.user.username || 'Admin',
            username: req.user.username
        }, {
            cancellationDate: new Date(report.cancelled_at).toLocaleString('id-ID', {
                timeZone: 'Asia/Jakarta',
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }),
            cancellationReason
        });

        return res.json({
            status: 200,
            message: 'Tiket berhasil dibatalkan'
        });
    } catch (error) {
        console.error('[API_ADMIN_TICKET_CANCEL_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Terjadi kesalahan saat membatalkan tiket'
        });
    }
});

module.exports = router;
