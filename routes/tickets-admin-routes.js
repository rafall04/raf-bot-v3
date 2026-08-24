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
        
        // !! PEMBATALAN LEWAT `ticket-workflow`, BUKAN MENULIS STATUS SENDIRI (#b265).
        //
        // Dulu rute ini menetapkan status pembatalan langsung ke objek tiket. Tiga akibatnya:
        //   1. Ejaan itu di luar kosakata kanonik, sehingga `ensureTicketShape` (yang dipanggil
        //      oleh notifikasi tepat SESUDAHNYA) memulangkannya jadi `baru` — tiket yang sudah
        //      dibatalkan tampak terbuka lagi, tombol Batalkan muncul kembali. Terbukti di
        //      produksi: 2 tiket berstatus `baru` tapi ber-`cancelled_by`.
        //   2. Tanpa penjaga transisi: tiket yang SUDAH `completed` pun bisa dibatalkan, padahal
        //      `ALLOWED_TRANSITIONS.completed` himpunan kosong.
        //   3. Tanpa cek idempoten: membatalkan dua kali menimpa jejak pembatalan pertama.
        //
        // `cancelTicket` memberi ketiganya sekaligus, dan menulis ejaan kanonik `cancelled`.
        const { cancelTicket } = require('../lib/ticket-workflow');
        let report;
        try {
            const hasil = cancelTicket({
                ticketId,
                actor: { id: req.user.id, username: req.user.username, name: req.user.name || req.user.username },
                reason: cancellationReason,
                cancelledByType: 'admin'
            });
            report = hasil.ticket;
        } catch (err) {
            const kode = err && err.code;
            if (kode === 'NOT_FOUND') {
                return res.status(404).json({ status: 404, message: 'Tiket tidak ditemukan' });
            }
            if (kode === 'ALREADY_COMPLETED' || kode === 'ALREADY_CANCELLED' || kode === 'INVALID_TRANSITION') {
                // 409 = keadaan tiket menolak aksi ini. Bedakan dari 500 supaya UI bisa
                // menjelaskan sebabnya, bukan sekadar "terjadi kesalahan".
                return res.status(409).json({ status: 409, message: err.message });
            }
            throw err;
        }
        const oldStatus = report.previousStatus || null;
        
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
                // Ejaan KANONIK — log aktivitas harus mencatat status yang benar-benar tersimpan.
                newValue: { status: 'cancelled', cancellationReason: cancellationReason },
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
