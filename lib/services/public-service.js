/**
 * PublicService
 * 
 * Service untuk handle business logic terkait public data operations.
 * 
 * Methods:
 * - getAnnouncements() - Get announcements (sorted by date)
 * - getNews() - Get news (sorted by date)
 * - getWifiName() - Get WiFi name from config
 * - getDashboardStatus() - Get dashboard status (active boost, active report)
 */

const BaseService = require('./base-service');
const SpeedRequestService = require('./speed-request-service');
const ReportService = require('./report-service');

class PublicService extends BaseService {
    /**
     * Get announcements sorted by date (newest first)
     * 
     * @param {Object} options - Options for filtering/limiting
     * @param {number} options.limit - Limit number of results (optional)
     * @returns {Promise<Array>} Array of announcements dengan field compatibility
     */
    static async getAnnouncements(options = {}) {
        const announcements = global.announcements || [];
        
        // Sort by created date (newest first)
        let sortedAnnouncements = [...announcements].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        
        // Apply limit if specified
        if (options.limit && options.limit > 0) {
            sortedAnnouncements = sortedAnnouncements.slice(0, options.limit);
        }
        
        // Add compatibility fields untuk frontend
        return sortedAnnouncements.map(item => ({
            ...item,
            // Field compatibility: createdAt -> created_at (untuk admin panel)
            created_at: item.createdAt,
            // Field compatibility: message -> title (untuk announcements yang mungkin butuh title)
            title: item.message || item.title || '',
            // Keep original fields
            id: item.id,
            message: item.message || ''
        }));
    }

    /**
     * Get news sorted by date (newest first)
     * 
     * @param {Object} options - Options for filtering/limiting
     * @param {number} options.limit - Limit number of results (optional)
     * @returns {Promise<Array>} Array of news dengan field compatibility
     */
    static async getNews(options = {}) {
        const news = global.news || [];
        
        // Sort by created date (newest first)
        let sortedNews = [...news].sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        
        // Apply limit if specified
        if (options.limit && options.limit > 0) {
            sortedNews = sortedNews.slice(0, options.limit);
        }
        
        // Add compatibility fields untuk frontend
        return sortedNews.map(item => ({
            ...item,
            // Field compatibility: createdAt -> created_at (untuk admin panel)
            created_at: item.createdAt,
            // Keep original fields
            id: item.id,
            title: item.title || '',
            content: item.content || ''
        }));
    }

    /**
     * Get WiFi name from config
     * 
     * @returns {Promise<Object>} { wifiName }
     */
    static async getWifiName() {
        return {
            wifiName: global.config?.nama || "Default WiFi Name"
        };
    }

    /**
     * Get dashboard status untuk customer
     * 
     * @param {Object} customer - Customer user object
     * @returns {Promise<Object>} Dashboard status customer API contract
     */
    static async getDashboardStatus(customer) {
        if (!customer) {
            return {
                profile: null,
                activeSpeedBoost: null,
                pendingReports: 0,
                recentReports: []
            };
        }

        const activeSpeedBoost = await SpeedRequestService.getActiveRequest(customer);
        const reportHistory = await ReportService.getReportHistory(customer);
        const recentReports = reportHistory.slice(0, 10);
        const pendingReports = reportHistory.filter((report) =>
            ReportService.isCustomerActiveStatus(report.status)
        ).length;

        return {
            profile: {
                name: customer.name || null,
                subscription: customer.subscription || null,
                paid: customer.paid === true
            },
            activeSpeedBoost: activeSpeedBoost,
            pendingReports,
            recentReports
        };
    }
}

module.exports = PublicService;

