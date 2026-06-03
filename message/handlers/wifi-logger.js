"use strict";

/**
 * WiFi Change Logger
 * Handles logging of WiFi configuration changes
 */

const fs = require('fs');
const path = require('path');

// Path untuk log WiFi changes
const wifiLogPath = path.join(__dirname, '../../database/wifi_change_logs.json');

/**
 * Save WiFi change log
 * @param {Object} logEntry - Log entry to save
 */
function saveWifiChangeLog(logEntry) {
    try {
        let logs = [];
        if (fs.existsSync(wifiLogPath)) {
            const data = fs.readFileSync(wifiLogPath, 'utf8');
            logs = JSON.parse(data);
        }
        
        // Add timestamp if not present
        if (!logEntry.timestamp) {
            logEntry.timestamp = new Date().toISOString();
        }
        
        // Generate unique ID if not present
        if (!logEntry.id) {
            const randomStr = Math.random().toString(36).substring(2, 11);
            logEntry.id = `wifi_log_${Date.now()}_${randomStr}`;
        }
        
        // Prepare changes object
        if (!logEntry.changes) {
            logEntry.changes = {};
        }
        
        // Store password changes (needed for customer support)
        if (logEntry.type === 'password_change') {
            // Keep password in logs for admin reference
            // NOTE: Ensure this log file has proper access control
            
            // Store the new password if provided
            if (logEntry.newPassword) {
                logEntry.changes.newPassword = logEntry.newPassword;
            }
            if (logEntry.sandi_wifi_baru) {
                logEntry.changes.newPassword = logEntry.sandi_wifi_baru;
            }
            
            logEntry.changes.passwordChanged = true;
            
            // Debug log to verify password is being saved
            console.log('[WIFI_LOG_DEBUG] Password change - newPassword:', logEntry.changes.newPassword);
        }
        
        // Ensure consistent format
        const formattedEntry = {
            id: logEntry.id,
            timestamp: logEntry.timestamp,
            userId: logEntry.userId || logEntry.user_id,
            deviceId: logEntry.deviceId || logEntry.device_id,
            customerName: logEntry.userName || logEntry.customerName || 'N/A',
            customerPhone: logEntry.userPhone || logEntry.customerPhone || 'N/A',
            changeType: mapChangeType(logEntry.type),
            changes: logEntry.changes, // Use the prepared changes object
            changedBy: logEntry.changedBy || 'unknown',
            changedBySender: logEntry.changedBySender || 'N/A',
            changeSource: 'wa_bot',
            reason: getChangeReason(logEntry.type),
            notes: logEntry.notes || '',
            ipAddress: 'WhatsApp',
            userAgent: 'WhatsApp Bot'
        };
        
        logs.push(formattedEntry);
        
        // Keep only last 1000 entries to prevent file from growing too large
        if (logs.length > 1000) {
            logs = logs.slice(-1000);
        }
        
        fs.writeFileSync(wifiLogPath, JSON.stringify(logs, null, 2));
        
        console.log('[WIFI_CHANGE_LOG] Saved:', {
            id: formattedEntry.id,
            user: formattedEntry.userId,
            type: formattedEntry.changeType,
            timestamp: formattedEntry.timestamp
        });
    } catch (error) {
        console.error('[WIFI_LOG_ERROR]', error);
    }
}

/**
 * Map change type to consistent format
 */
function mapChangeType(type) {
    const typeMap = {
        'name_change': 'ssid_name',
        'password_change': 'password',
        'power_change': 'transmit_power'
    };
    return typeMap[type] || type;
}

/**
 * Get change reason based on type
 */
function getChangeReason(type) {
    const reasons = {
        'name_change': 'Perubahan nama WiFi melalui WhatsApp Bot',
        'password_change': 'Perubahan password WiFi melalui WhatsApp Bot',
        'power_change': 'Perubahan transmit power WiFi melalui WhatsApp Bot'
    };
    return reasons[type] || 'Perubahan konfigurasi WiFi melalui WhatsApp Bot';
}

/**
 * Get WiFi change logs
 * @param {Object} filters - Optional filters
 * @returns {Array} Filtered logs
 */
function getWifiChangeLogs(filters = {}) {
    try {
        if (!fs.existsSync(wifiLogPath)) {
            return [];
        }
        
        const data = fs.readFileSync(wifiLogPath, 'utf8');
        let logs = JSON.parse(data);
        
        // Apply filters
        if (filters.userId) {
            logs = logs.filter(log => log.userId === filters.userId || log.user_id === filters.userId);
        }
        
        if (filters.type) {
            logs = logs.filter(log => log.type === filters.type);
        }
        
        if (filters.startDate) {
            const startDate = new Date(filters.startDate);
            logs = logs.filter(log => new Date(log.timestamp) >= startDate);
        }
        
        if (filters.endDate) {
            const endDate = new Date(filters.endDate);
            logs = logs.filter(log => new Date(log.timestamp) <= endDate);
        }
        
        return logs;
    } catch (error) {
        console.error('[WIFI_LOG_READ_ERROR]', error);
        return [];
    }
}

/**
 * Clear old WiFi change logs
 * @param {number} daysToKeep - Number of days to keep logs
 */
function clearOldWifiLogs(daysToKeep = 30) {
    try {
        if (!fs.existsSync(wifiLogPath)) {
            return;
        }
        
        const data = fs.readFileSync(wifiLogPath, 'utf8');
        let logs = JSON.parse(data);
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        const filteredLogs = logs.filter(log => {
            return new Date(log.timestamp) > cutoffDate;
        });
        
        if (filteredLogs.length < logs.length) {
            fs.writeFileSync(wifiLogPath, JSON.stringify(filteredLogs, null, 2));
            console.log(`[WIFI_LOG_CLEANUP] Removed ${logs.length - filteredLogs.length} old entries`);
        }
    } catch (error) {
        console.error('[WIFI_LOG_CLEANUP_ERROR]', error);
    }
}

module.exports = {
    saveWifiChangeLog,
    getWifiChangeLogs,
    clearOldWifiLogs
};
