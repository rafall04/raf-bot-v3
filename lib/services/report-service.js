/**
 * Header Doc
 * Purpose: Service report/ticket customer untuk submit laporan, histori, dan notifikasi outbound WhatsApp.
 * Caller: Route/customer portal report flow.
 * Deps: `./base-service`, database, templating, template-service, dan whatsapp-delivery-service.
 * MainFuncs: `submitReport`, `getReportHistory`, `normalizeCustomerReportStatus`, `_sendReportNotifications`.
 * SideEffects: Menulis laporan dan mengirim notifikasi WhatsApp ke customer/teknisi.
 */

const BaseService = require('./base-service');
const { createError, ErrorTypes } = require('../error-handler');
const { saveReports } = require('../database');
const { renderTemplate: _renderTemplate } = require('../templating');
const { renderCategoryTemplate } = require('../template-service');
const { waktuMulaiKerjaBerikutnya } = require('../working-hours-helper');
const { sendMessage, sendMessageToMany } = require('../whatsapp-delivery-service');

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate('responseTemplates', key, data).text;
}

class ReportService extends BaseService {
    static normalizeCustomerReportStatus(internalStatus) {
        const normalized = String(internalStatus || '').trim().toLowerCase();

        switch (normalized) {
            case 'baru':
            case 'pending':
                return 'pending';
            case 'process':
            case 'diproses teknisi':
            case 'in_progress':
            case 'otw':
            case 'arrived':
            case 'working':
                return 'in_progress';
            case 'completed':
            case 'resolved':
            case 'selesai':
                return 'completed';
            case 'cancelled':
            case 'dibatalkan admin':
            case 'dibatalkan pelanggan':
                return 'cancelled';
            default:
                return 'pending';
        }
    }

    static isCustomerActiveStatus(status) {
        const normalizedStatus = this.normalizeCustomerReportStatus(status);
        return normalizedStatus === 'pending' || normalizedStatus === 'in_progress';
    }

    static getCustomerPhotoUploadStatuses() {
        return ['baru', 'process', 'diproses teknisi', 'otw', 'arrived', 'working'];
    }

    static buildCustomerReportSummary(report) {
        return {
            ticketId: report.ticketId || report.id,
            issue_type: report.category || report.issue_type || 'GENERAL',
            status: this.normalizeCustomerReportStatus(report.status),
            createdAt: report.createdAt || report.created_at || null,
            customerPhotoCount: Array.isArray(report.customerPhotos)
                ? report.customerPhotos.length
                : Number(report.customerPhotoCount) || 0,
            photoCount: Number(report.photoCount) || (
                Array.isArray(report.customerPhotos)
                    ? report.customerPhotos.length
                    : 0
            )
        };
    }

    /**
     * Generate unique ticket ID
     * @param {number} length - Panjang ID (default 7)
     * @returns {string} Ticket ID
     */
    static generateTicketId(length = 7) {
        const characters = 'ABCDEFGHJKLMNOPQRSTUVWXYZ23456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    /**
     * Submit report dari customer
     * 
     * @param {Object} user - Customer user object
     * @param {Object} reportData - { category, reportText }
     * @param {string} ipAddress - IP address dari request (optional)
     * @returns {Promise<Object>} { ticketId }
     * @throws {Error} Jika validasi gagal atau ada error
     */
    static async submitReport(user, reportData, ipAddress = null, req = null) {
        const { category, reportText } = reportData;

        // Audit log: Data access
        this.logDataAccess('ReportService', 'submitReport', user.id, null, true, req || { ip: ipAddress });

        // Validation
        this.validateRequired(reportData, ['category', 'reportText']);

        // Get primary phone number
        const primaryPhoneNumber = user.phone_number.split('|')[0];
        const customerJid = this.getCustomerJid(primaryPhoneNumber);

        // Check for existing active report - hanya report dengan status 'baru' atau 'diproses teknisi' yang dianggap aktif
        // Report dengan status 'dibatalkan', 'dibatalkan admin', 'dibatalkan pelanggan', atau 'selesai' TIDAK dianggap aktif
        const existingActiveReport = global.reports.find(
            (r) => r.pelangganId === customerJid && this.isCustomerActiveStatus(r.status)
        );

        if (existingActiveReport) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Anda sudah memiliki laporan aktif dengan ID Tiket: ${existingActiveReport.ticketId}. Mohon tunggu hingga laporan tersebut diselesaikan.`,
                409
            );
        }

        // Generate ticket ID
        const ticketId = this.generateTicketId(7);
        const now = new Date();

        // Create report object
        const newReport = {
            ticketId,
            pelangganId: customerJid,
            pelangganPushName: user.name,
            pelangganDataSystem: {
                id: user.id,
                name: user.name,
                address: user.address,
                subscription: user.subscription,
                pppoe_username: user.pppoe_username
            },
            category,
            laporanText: reportText,
            status: "baru",
            createdAt: now.toISOString(),
            createdBy: {
                type: 'customer_panel',
                ip: ipAddress,
                userId: user.id
            },
            assignedTeknisiId: null,
            processingStartedAt: null,
            processedByTeknisiId: null,
            processedByTeknisiName: null,
            resolvedAt: null,
            resolvedByTeknisiId: null,
            resolvedByTeknisiName: null
        };

        // Save to database
        global.reports.unshift(newReport);
        saveReports();

        // Send notifications (fire-and-forget)
        this._sendReportNotifications(newReport, user, customerJid, primaryPhoneNumber, now).catch(err => {
            this.logError('ReportService', 'submitReport', err, {
                ticketId,
                userId: user.id
            });
        });

        return { ticketId };
    }

    /**
     * Get report history untuk customer
     * 
     * @param {Object} user - Customer user object
     * @returns {Promise<Array>} Array of report history
     */
    static async getReportHistory(user, req = null) {
        if (!user || !user.phone_number) {
            return [];
        }

        // Audit log: Data access
        this.logDataAccess('ReportService', 'getReportHistory', user.id, null, true, req);

        // Get all customer JIDs
        const customerJids = this.getCustomerJids(user.phone_number);

        // CRITICAL: Strict ownership check - only return reports owned by this user
        // Filter reports by customer JIDs (user bisa punya multiple phone numbers)
        const reportHistory = global.reports.filter(
            r => customerJids.includes(r.pelangganId)
        );

        // Additional security: Verify all reports belong to this user
        // (defense in depth - should already be filtered by JIDs, but double-check)
        const verifiedReports = reportHistory.filter(report => {
            // If report has userId field, verify it matches
            if (report.userId !== undefined) {
                return String(report.userId) === String(user.id);
            }
            // If no userId field, trust JID-based filtering
            return true;
        });

        // Map to response format
        const responseData = verifiedReports
            .map((report) => this.buildCustomerReportSummary(report))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return responseData;
    }

    /**
     * Send notifications untuk report baru
     * @private
     * @param {Object} report - Report object
     * @param {Object} user - User object
     * @param {string} customerJid - Customer JID
     * @param {string} primaryPhoneNumber - Primary phone number
     * @param {Date} now - Current date
     */
    static async _sendReportNotifications(report, user, customerJid, primaryPhoneNumber, now) {
        // Send confirmation to customer
        const confirmationMessage = renderResponseTemplate('report_service_customer_confirmation', {
            customerName: user.name,
            ticketId: report.ticketId,
            category: report.category,
            reportText: report.laporanText,
            serviceName: global.config.nama || 'Kami'
        });

        // Di luar jam kerja teknisi, "akan segera menghubungi Anda" adalah janji yang tak bisa
        // ditepati — form publik ini menerima laporan 24 jam (#b269). Catatannya ditempel di
        // bawah, bukan mengubah slot template lama, supaya template hasil editan admin di
        // produksi tetap utuh.
        const { teks: mulaiKerja } = waktuMulaiKerjaBerikutnya();
        const pesanKePelanggan = mulaiKerja
            ? confirmationMessage + renderResponseTemplate('report_service_luar_jam_kerja', { waktuMulai: mulaiKerja })
            : confirmationMessage;

        await sendMessage(customerJid, { text: pesanKePelanggan });

        // Send notification to teknisi
        const teknisiAccounts = global.accounts.filter(
            acc => acc.role === 'teknisi' && acc.phone_number && acc.phone_number.trim() !== ""
        );

        if (teknisiAccounts.length > 0) {
            const linkWaPelanggan = `https://wa.me/${this.normalizePhoneNumber(primaryPhoneNumber)}`;
            const waktuLaporFormatted = now.toLocaleString('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Jakarta'
            });

            let detailPelangganUntukTeknisi = `*Dari:* ${user.name} (${linkWaPelanggan})\n*Nama Sistem:* ${user.name}\n*Alamat:* ${user.address || 'N/A'}\n*Paket:* ${user.subscription || 'N/A'}\n`;
            if (user.pppoe_username) {
                detailPelangganUntukTeknisi += `*PPPoE:* ${user.pppoe_username}`;
            }

            const messageToTeknisi = renderResponseTemplate('report_service_technician_new_report', {
                ticketId: report.ticketId,
                reportedAt: waktuLaporFormatted,
                customerDetails: detailPelangganUntukTeknisi,
                category: report.category,
                reportText: report.laporanText
            });

            const teknisiRecipients = teknisiAccounts.map((teknisi) => teknisi.phone_number).filter(Boolean);
            await sendMessageToMany(teknisiRecipients, { text: messageToTeknisi });
        }
    }
}

module.exports = ReportService;

