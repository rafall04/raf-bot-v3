/**
 * Header Doc
 * Purpose: Sub-router tiket gangguan untuk endpoint READ (listing) — staff list dan admin list. Auth tier: staff (teknisi/admin) untuk listing umum, admin saja untuk listing admin.
 * Caller: `routes/tickets.js` (composer via `router.use`).
 * Deps: `./tickets-shared` (express, normalizeAllTickets, normalizeStatus, ensureAuthenticatedStaff, ensureAdmin).
 * MainFuncs: GET `/tickets`, GET `/admin/tickets`.
 * SideEffects: Membaca `global.reports` dan `global.users` untuk melengkapi data response.
 */
"use strict";

const {
    express,
    ensureAuthenticatedStaff,
    ensureAdmin,
    normalizeAllTickets,
    normalizeStatus
} = require('./tickets-shared');

const router = express.Router();

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

module.exports = router;
