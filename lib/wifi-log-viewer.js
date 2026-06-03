"use strict";

/**
 * WiFi Log Viewer
 * Utility to view WiFi change logs safely
 */

const { getWifiChangeLogs } = require('../message/handlers/wifi-logger');

/**
 * Get recent WiFi changes for a user
 * @param {string} userId - User ID
 * @param {number} limit - Number of recent changes to return
 * @returns {Array} Recent changes
 */
function getRecentChangesForUser(userId, limit = 10) {
    const logs = getWifiChangeLogs({ userId: userId });
    
    // Sort by timestamp descending (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Take only the requested number
    return logs.slice(0, limit);
}

/**
 * Format WiFi change log for display
 * @param {Object} log - Log entry
 * @returns {string} Formatted string
 */
function formatWifiChangeLog(log) {
    const date = new Date(log.timestamp);
    const dateStr = date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    let changeDescription = '';
    
    switch (log.changeType) {
        case 'ssid_name':
            changeDescription = `Nama WiFi diubah`;
            if (log.changes.oldSsidName && log.changes.newSsidName) {
                changeDescription += ` dari "${log.changes.oldSsidName}" menjadi "${log.changes.newSsidName}"`;
            }
            break;
            
        case 'password':
            changeDescription = `Password WiFi diubah`;
            if (log.changes.newPassword) {
                changeDescription += ` menjadi "${log.changes.newPassword}"`;
            } else if (log.changes.passwordChanged) {
                changeDescription += ` (berhasil)`;
            }
            break;
            
        case 'transmit_power':
            changeDescription = `Transmit power WiFi diubah`;
            if (log.changes.oldTransmitPower && log.changes.newTransmitPower) {
                changeDescription += ` dari ${log.changes.oldTransmitPower} menjadi ${log.changes.newTransmitPower}`;
            }
            break;
            
        default:
            changeDescription = `Konfigurasi WiFi diubah (${log.changeType})`;
    }
    
    return `📅 ${dateStr}\n` +
           `👤 Pelanggan: ${log.customerName}\n` +
           `📝 Perubahan: ${changeDescription}\n` +
           `👨‍💻 Diubah oleh: ${log.changedBy}\n` +
           (log.notes ? `📌 Catatan: ${log.notes}\n` : '');
}

/**
 * Get summary of WiFi changes
 * @param {Object} filters - Optional filters
 * @returns {Object} Summary statistics
 */
function getWifiChangeSummary(filters = {}) {
    const logs = getWifiChangeLogs(filters);
    
    const summary = {
        totalChanges: logs.length,
        nameChanges: 0,
        passwordChanges: 0,
        powerChanges: 0,
        otherChanges: 0,
        uniqueUsers: new Set(),
        uniqueDevices: new Set(),
        recentChanges: []
    };
    
    logs.forEach(log => {
        switch (log.changeType) {
            case 'ssid_name':
                summary.nameChanges++;
                break;
            case 'password':
                summary.passwordChanges++;
                break;
            case 'transmit_power':
                summary.powerChanges++;
                break;
            default:
                summary.otherChanges++;
        }
        
        summary.uniqueUsers.add(log.userId);
        summary.uniqueDevices.add(log.deviceId);
    });
    
    // Convert Sets to counts
    summary.uniqueUsers = summary.uniqueUsers.size;
    summary.uniqueDevices = summary.uniqueDevices.size;
    
    // Get 5 most recent changes
    const sortedLogs = logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    summary.recentChanges = sortedLogs.slice(0, 5).map(log => ({
        timestamp: log.timestamp,
        user: log.customerName,
        type: log.changeType,
        notes: log.notes
    }));
    
    return summary;
}

/**
 * Check if user has recent password change
 * @param {string} userId - User ID
 * @param {number} hoursAgo - Check within last N hours
 * @returns {boolean} True if password was changed recently
 */
function hasRecentPasswordChange(userId, hoursAgo = 24) {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hoursAgo);
    
    const logs = getWifiChangeLogs({ 
        userId: userId,
        type: 'password',
        startDate: cutoffTime.toISOString()
    });
    
    return logs.length > 0;
}

module.exports = {
    getRecentChangesForUser,
    formatWifiChangeLog,
    getWifiChangeSummary,
    hasRecentPasswordChange
};
