/**
 * Header Doc
 * Purpose: Sub-router tiket gangguan untuk upload foto staff (teknisi/admin) — foto dokumentasi pasca-OTP dan foto saat pembuatan tiket. Auth tier: staff write (`ensureAuthenticatedStaff`).
 * Caller: `routes/tickets.js` (composer via `router.use`).
 * Deps: `./tickets-shared` untuk express, multer instance, helper, dan ticket-workflow.
 * MainFuncs: POST `/ticket/upload-photo`, POST `/ticket/create/upload-photo`.
 * SideEffects: Menulis file foto ke `uploads/tickets/...` atau `uploads/reports/...`, update `global.reports`, hapus file pada error.
 */
"use strict";

const {
    express,
    fs,
    path,
    rateLimit,
    ensureAuthenticatedStaff,
    DEBUG,
    saveReports,
    upload,
    createTicketPhotoUpload,
    getReportsUploadsPath,
    ensureTicketShape,
    appendTechnicianPhoto
} = require('./tickets-shared');

const router = express.Router();

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

module.exports = router;
