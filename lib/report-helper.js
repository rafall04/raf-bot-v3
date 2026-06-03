/**
 * Report Helper Functions
 * Utility functions untuk operasi report/ticket
 */

/**
 * Check if user has active report
 * @param {string} userId - User ID
 * @param {Array} reports - Array of reports
 * @returns {Object|null} - Active report or null
 */
function hasActiveReport(userId, reports) {
    if (!reports || !Array.isArray(reports)) {
        return null;
    }
    
    return reports.find(r => {
        // Check if report belongs to user
        const isUserReport = r.pelangganUserId === userId || 
                            r.pelangganId === userId ||
                            (r.pelangganDataSystem && r.pelangganDataSystem.id === userId);
        
        if (!isUserReport) {
            return false;
        }
        
        // Check if report is still active (not completed/cancelled)
        const inactiveStatuses = [
            'selesai',
            'completed',
            'cancelled',
            'dibatalkan',
            'resolved'
        ];
        
        return !inactiveStatuses.includes(r.status);
    });
}

/**
 * Get active report for user
 * @param {string} userId - User ID
 * @param {Array} reports - Array of reports
 * @returns {Object|null} - Active report or null
 */
function getActiveReport(userId, reports) {
    return hasActiveReport(userId, reports);
}

/**
 * Check if report status is active
 * @param {string} status - Report status
 * @returns {boolean} - True if status is active
 */
function isActiveStatus(status) {
    const inactiveStatuses = [
        'selesai',
        'completed',
        'cancelled',
        'dibatalkan',
        'resolved'
    ];
    
    return !inactiveStatuses.includes(status);
}

module.exports = {
    hasActiveReport,
    getActiveReport,
    isActiveStatus
};

