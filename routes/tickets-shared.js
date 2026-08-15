/**
 * Header Doc
 * Purpose: Shared module untuk router tiket gangguan — menyediakan helper render template, formatter prioritas, working-hours notice, middleware auth (`ensureAuthenticatedStaff`, `ensureAdmin`), dan dua multer storage (`upload` untuk foto teknisi pasca-OTP, `createTicketPhotoUpload` untuk foto saat pembuatan tiket).
 * Caller: `routes/tickets.js` (composer), `routes/tickets-list-routes.js`, `routes/tickets-workflow-routes.js`, `routes/tickets-photo-routes.js`, `routes/tickets-admin-routes.js`, `routes/tickets-customer-routes.js`.
 * Deps: `express`, `fs`, `path`, `multer`, `lib/database`, `lib/activity-logger`, `lib/security`, `lib/request-lock`, `lib/ticket-workflow`, `lib/report-notification-service`, `lib/template-service`, `lib/working-hours-helper`, `lib/path-helper`.
 * MainFuncs: `renderResponseTemplate`, `formatTicketPriority`, `buildWorkingHoursNotice`, `ensureAuthenticatedStaff`, `ensureAdmin`, `upload`, `createTicketPhotoUpload`, `DEBUG`, plus re-export dependency umum agar sub-router cukup require modul ini.
 * SideEffects: Membuat folder upload bila belum ada saat multer destination dipanggil.
 */
"use strict";

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
const { isWithinWorkingHours, getNextAvailableMessage, getResponseTimeMessage } = require('../lib/working-hours-helper');
const { getTicketsUploadsPathByTicket, getReportsUploadsPath } = require('../lib/path-helper');
const { isSegmenPathAman } = require('../lib/path-helper');
const { buatDestinationAman, ekstensiGambarAman } = require('../lib/upload-guard');

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

/**
 * Configure multer for photo uploads
 * Store in uploads/tickets/YEAR/MONTH/TICKET_ID/ (structured, consistent with reports)
 */
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
        //
        // `ticketId` datang dari query/body/header — sepenuhnya dikendalikan klien — dan dulu
        // diserahkan mentah ke `path.join`, yang MERESOLVE `..`. Dengan
        // `?ticketId=../../../../views/sb-admin` foldernya benar-benar dibuat dan berkasnya
        // ditulis di luar `uploads/` (mis. ke direktori yang dirender php-express), sebelum
        // handler sempat memvalidasi apa pun. `getTicketsUploadsPathByTicket` kini MELEMPAR
        // untuk segmen tak aman; tolak request di sini alih-alih menyimpan ke lokasi tebakan.
        let uploadDir;
        try {
            uploadDir = getTicketsUploadsPathByTicket(year, month, ticketId, __dirname);
        } catch (err) {
            console.warn(`[TICKET_UPLOAD] Tujuan upload ditolak: ${err.message}`);
            return cb(new Error('ID tiket tidak valid.'), null);
        }

        try {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
        } catch (err) {
            console.error('[TICKET_UPLOAD] Gagal menyiapkan folder upload:', err);
            return cb(new Error('Gagal menyiapkan folder upload.'), null);
        }

        return cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename: photo_TIMESTAMP_RANDOM.ext
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        // Ekstensi diambil dari `originalname` yang dikirim klien. `fileFilter` di bawah hanya
        // memeriksa mimetype — dan mimetype pun dikirim klien. Tanpa allowlist ini, nama
        // `pwn.php` bertipe `image/png` menghasilkan berkas `.php` di disk.
        const EKSTENSI_GAMBAR = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic']);
        const extAsli = String(path.extname(file.originalname) || '').toLowerCase();
        const ext = EKSTENSI_GAMBAR.has(extAsli) ? extAsli : '.jpg';
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

// Multer storage khusus untuk upload foto saat create ticket (menggunakan struktur reports)
// Storage KEDUA. #b229 hanya mengeraskan storage pertama di berkas ini; yang ini memanggil
// `getReportsUploadsPath` (yang kini MELEMPAR untuk segmen tak aman) TANPA try/catch, jadi
// lemparannya tak tertangani. Ekstensinya pun masih diambil mentah dari `originalname`.
// Keduanya kini lewat penjaga bersama lib/upload-guard.js.
const createTicketPhotoStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const ticketId = req.query?.ticketId || req.body?.ticketId || req.headers['x-ticket-id'];

        // Tanpa ticketId: tetap ke folder temp (handler yang memindahkannya nanti).
        if (!ticketId) {
            const tempDir = path.join(__dirname, '..', 'uploads', 'temp');
            try {
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            } catch (error) {
                return cb(new Error('Gagal menyiapkan folder upload.'), null);
            }
            return cb(null, tempDir);
        }

        return buatDestinationAman({
            namespace: 'reports',
            currentDir: __dirname,
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
        const ticketIdMentah = req.query?.ticketId || req.body?.ticketId || req.headers['x-ticket-id'] || 'UNKNOWN';
        // ticketId ikut masuk NAMA berkas, dan multer melakukan path.join(dest, filename) —
        // jadi nama berkas pun bisa menyeberang direktori bila tak dibersihkan.
        const ticketId = isSegmenPathAman(ticketIdMentah) ? ticketIdMentah : 'UNKNOWN';
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        cb(null, `teknisi_${ticketId}_${timestamp}_${random}${ekstensiGambarAman(file.originalname)}`);
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

module.exports = {
    // Express helper
    express,
    // Native modules
    fs,
    path,
    // Helper functions
    renderResponseTemplate,
    formatTicketPriority,
    buildWorkingHoursNotice,
    DEBUG,
    // Middlewares
    ensureAuthenticatedStaff,
    ensureAdmin,
    // Multer instances
    upload,
    createTicketPhotoUpload,
    // Database
    saveReports,
    loadJSON,
    saveJSON,
    // Activity logger
    logActivity,
    // Security/lock
    rateLimit,
    withLock,
    // Working hours helper
    isWithinWorkingHours,
    getNextAvailableMessage,
    getResponseTimeMessage,
    // Path helper
    getTicketsUploadsPathByTicket,
    getReportsUploadsPath,
    // Ticket workflow
    createBaseTicket,
    ensureTicketShape,
    normalizeAllTickets,
    normalizeStatus,
    processTicketWorkflow,
    markTicketOtw,
    markTicketArrived,
    verifyTicketOtp,
    appendTechnicianPhoto,
    completeTicketWorkflow,
    // Notification service
    notifyNewReport,
    notifyCustomerTicketUpdate,
    notifyTicketProcessed,
    notifyTicketOtw,
    notifyTicketArrived,
    notifyTicketWorking,
    notifyTicketCompleted,
    notifyTicketCancelled,
    toJid
};
