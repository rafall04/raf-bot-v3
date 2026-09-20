/**
 * Header Doc
 * Purpose: Sub-router LAPORAN pelanggan — `POST /api/lapor` (buat tiket keluhan) dan
 *          `POST /api/customer/reports/upload-photo` (unggah foto bukti tiket).
 * Caller: `routes/public.js` (composer) → Express app.
 * Deps: express, multer, fs, `lib/auth` (apiAuth), `lib/error-handler`, `lib/response-helper`,
 *       `lib/services/report-service`, `lib/ticket-workflow`, `lib/report-orchestration-service`,
 *       `lib/path-helper`, `lib/upload-guard`, lazy `lib/services/base-service`.
 * MainFuncs: route /api/lapor; pipeline upload foto `reportPhotoStorage`/`reportPhotoUpload`/
 *            `handleReportPhotoUpload` + handler.
 * SideEffects: Menulis file foto ke uploads/reports/..., update global.reports.
 */
const log = require('../../lib/logger').logger.child('REPORTS');
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { apiAuth } = require('../../lib/auth');
const { asyncHandler } = require('../../lib/error-handler');
const { sendSuccess, sendError } = require('../../lib/response-helper');
const ReportService = require('../../lib/services/report-service');
const { ensureTicketShape } = require('../../lib/ticket-workflow');
const { appendCustomerReportPhoto } = require('../../lib/report-orchestration-service');
const { isSegmenPathAman } = require('../../lib/path-helper');
const { buatDestinationAman, ekstensiGambarAman } = require('../../lib/upload-guard');

const router = express.Router();

// This route is obsolete and insecure. It is replaced by GET /api/customer/profile
// router.get('/api/user/:phoneNumber', apiAuth, async (req, res) => { ... });

router.post('/api/lapor', apiAuth, asyncHandler(async (req, res) => {
    const { category, reportText } = req.body;
    const user = req.customer;
    
    const result = await ReportService.submitReport(user, { category, reportText }, req.ip, req);
    
    return sendSuccess(res, { ticketId: result.ticketId }, "Laporan berhasil dibuat. Tim kami akan segera menghubungi Anda.", 201);
}));

// POST /api/customer/reports/upload-photo - Upload photo untuk report (customer)

// Jalur upload foto laporan PELANGGAN — permukaan paling terbuka dari ketiga jalur upload.
// Sebelumnya memanggil `getReportsUploadsPath` (yang kini MELEMPAR untuk segmen tak aman)
// TANPA try/catch, sehingga lemparannya tak tertangani; ekstensinya pun mentah dari
// `originalname` sementara fileFilter hanya memeriksa mimetype kiriman klien. Kini lewat
// penjaga bersama lib/upload-guard.js — satu implementasi untuk ketiga jalur upload.
const reportPhotoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const ticketId = req.body?.ticketId;
        if (!ticketId) {
            return cb(new Error('Ticket ID harus diisi'), null);
        }

        return buatDestinationAman({
            namespace: 'reports',
            // File ini hidup satu level lebih dalam (routes/public/) — naik satu level agar
            // getProjectRoot(currentDir) tetap memecah ke root repo (uploads/ tetap sama).
            currentDir: require('path').join(__dirname, '..'),
            ambilSegmen: () => ticketId,
            ambilTahunBulan: () => {
                const report = global.reports.find((r) => r.ticketId === ticketId || r.id === ticketId);
                const tanggal = report && report.createdAt ? new Date(report.createdAt) : new Date();
                return {
                    tahun: String(tanggal.getFullYear()),
                    bulan: String(tanggal.getMonth() + 1).padStart(2, '0')
                };
            }
        })(req, file, cb);
    },
    filename: function (req, file, cb) {
        const mentah = req.body?.ticketId || 'UNKNOWN';
        // ticketId ikut ke NAMA berkas dan multer melakukan path.join(dest, filename).
        const ticketId = isSegmenPathAman(mentah) ? mentah : 'UNKNOWN';
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        cb(null, `customer_${ticketId}_${timestamp}_${random}${ekstensiGambarAman(file.originalname)}`);
    }
});

const reportPhotoUpload = multer({
    storage: reportPhotoStorage,
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

function handleReportPhotoUpload(req, res, next) {
    reportPhotoUpload.single('photo')(req, res, (error) => {
        if (!error) {
            return next();
        }

        return sendError(res, error.message || 'File foto tidak valid', 400);
    });
}

router.post('/api/customer/reports/upload-photo', apiAuth, handleReportPhotoUpload, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { ticketId } = req.body;
    
    if (!ticketId) {
        return sendError(res, "Ticket ID harus diisi", 400);
    }
    
    if (!req.file) {
        return sendError(res, "File foto harus diupload", 400);
    }
    
    // Get all customer JIDs (customer bisa punya multiple phone numbers)
    const BaseService = require('../../lib/services/base-service');
    const customerJids = BaseService.getCustomerJids(customer.phone_number);
    
    // Find report - check by ticketId and customer JIDs
    const reportIndex = global.reports.findIndex(r => 
        (r.ticketId === ticketId || r.id === ticketId) &&
        customerJids.includes(r.pelangganId)
    );
    
    if (reportIndex === -1) {
        // Clean up uploaded file
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                log.error('[REPORT_UPLOAD_PHOTO] Failed to delete file:', err);
            }
        }
        return sendError(res, "Tiket tidak ditemukan atau tidak memiliki akses", 404);
    }
    
    let report = global.reports[reportIndex];
    
    ensureTicketShape(report);

    if (!ReportService.isCustomerActiveStatus(report.status)) {
        // Clean up uploaded file
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                log.error('[REPORT_UPLOAD_PHOTO] Failed to delete file:', err);
            }
        }
        return sendError(res, `Tidak bisa upload foto. Status tiket: ${report.status}`, 400);
    }
    
    const photoInfo = {
        fileName: req.file.filename,
        path: req.file.path,
        uploadedAt: new Date().toISOString(),
        size: req.file.size,
        uploadedBy: 'customer',
        uploadedVia: 'customer_panel'
    };

    try {
        ({ ticket: report } = await appendCustomerReportPhoto({
            ticketId: report.ticketId || report.id,
            actor: {
                id: req.customer?.id || req.customer?.user_id || 'customer',
                username: req.customer?.name || req.customer?.username || 'customer',
                source: 'customer_panel'
            },
            photo: photoInfo,
            maxPhotos: 3,
            allowedStatuses: ReportService.getCustomerPhotoUploadStatuses()
        }));
    } catch (error) {
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                log.error('[REPORT_UPLOAD_PHOTO] Failed to delete file:', err);
            }
        }
        return sendError(res, error.message, error.code === 'MAX_CUSTOMER_PHOTOS' ? 400 : 500);
    }
    
    return sendSuccess(res, {
        ticketId: report.ticketId || report.id,
        photoCount: report.customerPhotos.length,
        totalPhotos: report.customerPhotos.length,
        maxPhotos: 3,
        photo: {
            fileName: photoInfo.fileName,
            uploadedAt: photoInfo.uploadedAt,
            size: photoInfo.size
        }
    }, `Foto berhasil diupload (${report.customerPhotos.length}/3)`, 200);
}));

module.exports = router;
