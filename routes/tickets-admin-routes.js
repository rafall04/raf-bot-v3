/**
 * Header Doc
 * Purpose: Sub-router tiket gangguan KHUSUS admin — admin-create ticket dan admin-cancel ticket. Auth tier: admin only (`ensureAdmin`). Dipisah supaya middleware ketat lebih mudah ditambah/swap di masa depan tanpa mempengaruhi staff/customer endpoint.
 * Caller: `routes/tickets.js` (composer via `router.use`).
 * Deps: `./tickets-shared` untuk middleware, helper, ticket-workflow API, dan notification service.
 * MainFuncs: POST `/admin/ticket/create`, POST `/admin/ticket/cancel`.
 * SideEffects: Menulis `global.reports`, log activity, mengirim notifikasi WhatsApp ke customer/admin/teknisi.
 */
"use strict";

const {
    express,
    ensureAdmin,
    DEBUG: _DEBUG,
    logActivity,
    saveReports,
    isWithinWorkingHours,
    getNextAvailableMessage,
    renderResponseTemplate,
    formatTicketPriority,
    buildWorkingHoursNotice,
    createBaseTicket,
    notifyNewReport,
    notifyCustomerTicketUpdate,
    notifyTicketCancelled
} = require('./tickets-shared');

const router = express.Router();

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
