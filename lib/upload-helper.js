/**
 * Upload Helper - Organized File Upload Management
 * 
 * Provides utilities for organizing uploaded files by category and month
 */

const fs = require('fs');
const path = require('path');

/**
 * Get upload directory with month-based organization
 * @param {string} category - Category folder (e.g., 'speed-requests', 'topup-requests')
 * @param {Date} date - Date for organization (default: now)
 * @returns {string} Full path to upload directory
 */
function getUploadDir(category, date = new Date()) {
    const yearMonth = date.toISOString().slice(0, 7); // YYYY-MM format
    const uploadDir = path.join(__dirname, '..', 'static', 'uploads', category, yearMonth);
    
    // Create directory if not exists
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log(`[UPLOAD] Created directory: uploads/${category}/${yearMonth}/`);
    }
    
    return uploadDir;
}

/**
 * Get web path for uploaded file
 * @param {string} category - Category folder
 * @param {string} filename - File name
 * @param {Date} date - Date for organization (default: now)
 * @returns {string} Web-accessible path
 */
function getUploadPath(category, filename, date = new Date()) {
    const yearMonth = date.toISOString().slice(0, 7);
    return `/static/uploads/${category}/${yearMonth}/${filename}`;
}

/**
 * Generate unique filename
 * @param {string} prefix - Prefix (e.g., 'payment', 'topup')
 * @param {string} requestId - Request ID or identifier
 * @param {string} originalName - Original file name
 * @returns {string} Unique filename
 */
function generateFilename(prefix, requestId, originalName) {
    const timestamp = Date.now();
    const ext = path.extname(originalName);
    const sanitizedId = requestId.replace(/[^a-zA-Z0-9]/g, '-'); // Sanitize ID
    return `${prefix}-${sanitizedId}-${timestamp}${ext}`;
}

/**
 * Get all supported upload categories
 * @returns {Array<string>} List of categories
 */
function getUploadCategories() {
    return [
        'speed-requests',     // Speed on Demand
        'topup-requests',     // Topup/Saldo
        'package-requests',   // Package upgrades
        'payment-requests',   // Regular bill payments
        'compensation',       // Compensation proofs
        'invoices',          // Generated invoices
        'logos'              // Company logos
    ];
}

/**
 * Initialize all upload directories
 * Creates base structure if not exists
 */
function initializeUploadDirs() {
    const categories = getUploadCategories();
    const baseDir = path.join(__dirname, '..', 'static', 'uploads');
    
    // Create base uploads directory
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    
    // Create category directories (current month)
    categories.forEach(category => {
        // Skip logos as it doesn't need month structure
        if (category === 'logos') {
            const logoDir = path.join(baseDir, 'logos');
            if (!fs.existsSync(logoDir)) {
                fs.mkdirSync(logoDir, { recursive: true });
            }
        } else {
            // Create with current month
            getUploadDir(category);
        }
    });
    
    console.log('[UPLOAD] Upload directories initialized');
}

/**
 * Delete old upload files (cleanup)
 * @param {string} category - Category to cleanup
 * @param {number} monthsOld - Delete files older than this many months
 * @returns {Object} Cleanup results
 */
function cleanupOldUploads(category, monthsOld = 6) {
    const categoryDir = path.join(__dirname, '..', 'static', 'uploads', category);
    if (!fs.existsSync(categoryDir)) {
        return { deleted: 0, error: 'Category not found' };
    }
    
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsOld);
    const cutoffYearMonth = cutoffDate.toISOString().slice(0, 7);
    
    let deleted = 0;
    let errors = 0;
    
    try {
        const months = fs.readdirSync(categoryDir);
        months.forEach(month => {
            // Check if it's a valid YYYY-MM format
            if (!/^\d{4}-\d{2}$/.test(month)) return;
            
            if (month < cutoffYearMonth) {
                const monthDir = path.join(categoryDir, month);
                try {
                    const files = fs.readdirSync(monthDir);
                    fs.rmSync(monthDir, { recursive: true });
                    deleted += files.length;
                    console.log(`[UPLOAD] Deleted old uploads: ${category}/${month}/ (${files.length} files)`);
                } catch (err) {
                    console.error(`[UPLOAD] Error deleting ${month}:`, err.message);
                    errors++;
                }
            }
        });
    } catch (err) {
        console.error(`[UPLOAD] Error cleaning up ${category}:`, err.message);
        return { deleted: 0, error: err.message };
    }
    
    return { deleted, errors };
}

/**
 * Get upload statistics
 * @param {string} category - Category to get stats for (optional)
 * @returns {Object} Upload statistics
 */
function getUploadStats(category = null) {
    const baseDir = path.join(__dirname, '..', 'static', 'uploads');
    const categories = category ? [category] : getUploadCategories();
    
    const stats = {};
    
    categories.forEach(cat => {
        const catDir = path.join(baseDir, cat);
        if (!fs.existsSync(catDir)) {
            stats[cat] = { months: 0, files: 0, size: 0 };
            return;
        }
        
        let totalFiles = 0;
        let totalSize = 0;
        let months = 0;
        
        try {
            const items = fs.readdirSync(catDir);
            months = items.filter(item => {
                const itemPath = path.join(catDir, item);
                return fs.statSync(itemPath).isDirectory();
            }).length;
            
            // Count files and size
            items.forEach(item => {
                const itemPath = path.join(catDir, item);
                if (fs.statSync(itemPath).isDirectory()) {
                    const files = fs.readdirSync(itemPath);
                    totalFiles += files.length;
                    files.forEach(file => {
                        const filePath = path.join(itemPath, file);
                        totalSize += fs.statSync(filePath).size;
                    });
                } else {
                    // File in root (e.g., logos)
                    totalFiles++;
                    totalSize += fs.statSync(itemPath).size;
                }
            });
        } catch (err) {
            console.error(`[UPLOAD] Error getting stats for ${cat}:`, err.message);
        }
        
        stats[cat] = {
            months,
            files: totalFiles,
            size: totalSize,
            sizeKB: (totalSize / 1024).toFixed(2),
            sizeMB: (totalSize / 1024 / 1024).toFixed(2)
        };
    });
    
    return stats;
}

module.exports = {
    getUploadDir,
    getUploadPath,
    generateFilename,
    getUploadCategories,
    initializeUploadDirs,
    cleanupOldUploads,
    getUploadStats
};
