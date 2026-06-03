"use strict";

/**
 * Activity Logger Module
 * Centralized logging for admin/teknisi actions and login activities
 * 
 * IMPORTANT: Uses separate database (activity_logs.sqlite) for logs,
 * NOT the main database.sqlite which is for customer/users data
 */

const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { logger } = require('./logger');

// Database path - SEPARATE from customer database
const LOGS_DB_PATH = path.join(__dirname, '..', 'database', 'activity_logs.sqlite');

// Database connection for logs (separate from global.db)
let logsDb = null;

// Database table names
const TABLES = {
    LOGIN_LOGS: 'login_logs',
    ACTIVITY_LOGS: 'activity_logs'
};

/**
 * Initialize separate database for activity logs
 */
function initializeActivityLogTables() {
    return new Promise(async (resolve, reject) => {
        try {
            // Ensure database directory exists
            const dbDir = path.dirname(LOGS_DB_PATH);
            await fsExtra.ensureDir(dbDir);

            // Create separate database connection for logs
            logsDb = new sqlite3.Database(LOGS_DB_PATH, (err) => {
                if (err) {
                    console.error('[ACTIVITY_LOGGER] Error opening logs database:', err);
                    return reject(err);
                }
                console.log(`[ACTIVITY_LOGGER] Connected to logs database: ${LOGS_DB_PATH}`);
            });

            logsDb.serialize(() => {
            // Create login_logs table
            logsDb.run(`
                CREATE TABLE IF NOT EXISTS ${TABLES.LOGIN_LOGS} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    username TEXT NOT NULL,
                    role TEXT NOT NULL,
                    ip_address TEXT,
                    user_agent TEXT,
                    login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                    logout_time DATETIME,
                    action_type TEXT DEFAULT 'login',
                    success BOOLEAN DEFAULT 1,
                    failure_reason TEXT,
                    session_id TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('[ACTIVITY_LOGGER] Error creating login_logs table:', err);
                    return reject(err);
                }
                
                // Create indexes for login_logs
                logsDb.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_user_id ON ${TABLES.LOGIN_LOGS}(user_id)`, () => {});
                logsDb.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_username ON ${TABLES.LOGIN_LOGS}(username)`, () => {});
                logsDb.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_login_time ON ${TABLES.LOGIN_LOGS}(login_time)`, () => {});
                logsDb.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_action_type ON ${TABLES.LOGIN_LOGS}(action_type)`, () => {});
                logsDb.run(`CREATE INDEX IF NOT EXISTS idx_login_logs_ip ON ${TABLES.LOGIN_LOGS}(ip_address)`, () => {});
                
                // Migrate existing table to add new columns if they don't exist (will fail silently if column exists)
                logsDb.run(`ALTER TABLE ${TABLES.LOGIN_LOGS} ADD COLUMN logout_time DATETIME`, () => {});
                logsDb.run(`ALTER TABLE ${TABLES.LOGIN_LOGS} ADD COLUMN action_type TEXT DEFAULT 'login'`, () => {});
                
                // Create activity_logs table
                logsDb.run(`
                    CREATE TABLE IF NOT EXISTS ${TABLES.ACTIVITY_LOGS} (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        username TEXT NOT NULL,
                        role TEXT NOT NULL,
                        action_type TEXT NOT NULL,
                        resource_type TEXT NOT NULL,
                        resource_id TEXT,
                        resource_name TEXT,
                        description TEXT,
                        old_value TEXT,
                        new_value TEXT,
                        ip_address TEXT,
                        user_agent TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        console.error('[ACTIVITY_LOGGER] Error creating activity_logs table:', err);
                        return reject(err);
                    }
                    
                    // Create indexes for activity_logs
                    logsDb.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON ${TABLES.ACTIVITY_LOGS}(user_id)`, () => {});
                    logsDb.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_action_type ON ${TABLES.ACTIVITY_LOGS}(action_type)`, () => {});
                    logsDb.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_resource_type ON ${TABLES.ACTIVITY_LOGS}(resource_type)`, () => {});
                    logsDb.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON ${TABLES.ACTIVITY_LOGS}(timestamp)`, () => {});
                    
                    // Activity logging initialized (silent)
                    resolve();
                });
            });
        });
        } catch (error) {
            console.error('[ACTIVITY_LOGGER] Error initializing logs database:', error);
            reject(error);
        }
    });
}

/**
 * Log login attempt
 * @param {Object} data - Login data
 * @param {number} data.userId - User ID
 * @param {string} data.username - Username
 * @param {string} data.role - User role (admin, teknisi)
 * @param {string} data.ipAddress - IP address
 * @param {string} data.userAgent - User agent
 * @param {boolean} data.success - Login success status
 * @param {string} data.failureReason - Reason for failure (if failed)
 * @param {string} data.sessionId - Session ID (optional)
 * @param {string} data.actionType - Action type: 'login' or 'logout' (default: 'login')
 */
function logLogin(data) {
    return new Promise((resolve, reject) => {
        if (!logsDb) {
            logger.warn('[ACTIVITY_LOGGER] Logs database not initialized, skipping login log');
            console.warn('[ACTIVITY_LOGGER] Logs database not initialized. Attempting to initialize...');
            // Try to initialize if not already done
            initializeActivityLogTables().then(() => {
                // Retry logging after initialization
                logLogin(data).then(resolve).catch(reject);
            }).catch(reject);
            return;
        }

        const {
            userId = null,
            username,
            role,
            ipAddress,
            userAgent,
            success = true,
            failureReason = null,
            sessionId = null,
            actionType = 'login'
        } = data;

        if (!username || !role) {
            return reject(new Error('Username and role are required'));
        }

        // CRITICAL FIX: For login events, set login_time explicitly with current timestamp
        // For logout events, set logout_time with current timestamp, login_time can be NULL or current time
        // Use current timestamp with proper timezone handling
        const now = new Date().toISOString();
        const loginTime = actionType === 'login' ? now : now; // For both login and logout, use now as login_time
        const logoutTime = actionType === 'logout' ? now : null; // Only set logout_time for logout events
        
        // Include both login_time and logout_time in INSERT
        // IMPORTANT: We must include login_time explicitly, cannot rely on DEFAULT when specifying other columns
        const stmt = logsDb.prepare(`
            INSERT INTO ${TABLES.LOGIN_LOGS} (
                user_id, username, role, ip_address, user_agent,
                login_time, logout_time, action_type, success, failure_reason, session_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            userId,
            username,
            role,
            ipAddress || null,
            userAgent || null,
            loginTime, // Current timestamp for login_time
            logoutTime, // Current timestamp for logout_time (if logout), NULL for login events
            actionType,
            success ? 1 : 0,
            failureReason || null,
            sessionId || null
        , (err) => {
            if (err) {
                console.error(`[AUTH_LOG] ❌ Failed to log ${actionType}: ${username} - ${err.message}`);
                logger.error(`Failed to log ${actionType} attempt`, err);
                return reject(err);
            }
            
            // Success logging - simplified
            const timeStr = actionType === 'login' ? loginTime.substring(0, 19) : logoutTime.substring(0, 19);
            console.log(`[AUTH_LOG] ✅ ${actionType.toUpperCase()}: ${username} (${role}) - ${timeStr}`);
            
            stmt.finalize();
            resolve();
        });
    });
}

/**
 * Log logout event
 * @param {Object} data - Logout data
 * @param {number} data.userId - User ID
 * @param {string} data.username - Username
 * @param {string} data.role - User role (admin, teknisi)
 * @param {string} data.ipAddress - IP address (optional)
 * @param {string} data.userAgent - User agent (optional)
 * @param {string} data.sessionId - Session ID (optional)
 */
function logLogout(data) {
    return logLogin({
        ...data,
        actionType: 'logout',
        success: true,
        failureReason: null
    });
}

/**
 * Log admin/teknisi activity
 * @param {Object} data - Activity data
 * @param {number} data.userId - User ID
 * @param {string} data.username - Username
 * @param {string} data.role - User role
 * @param {string} data.actionType - Action type (CREATE, UPDATE, DELETE, VIEW, etc)
 * @param {string} data.resourceType - Resource type (user, ticket, config, etc)
 * @param {string} data.resourceId - Resource ID
 * @param {string} data.resourceName - Resource name (optional)
 * @param {string} data.description - Description of action
 * @param {Object} data.oldValue - Old value (for updates)
 * @param {Object} data.newValue - New value (for updates)
 * @param {string} data.ipAddress - IP address
 * @param {string} data.userAgent - User agent
 */
function logActivity(data) {
    return new Promise((resolve, reject) => {
        if (!logsDb) {
            logger.warn('[ACTIVITY_LOGGER] Logs database not initialized, skipping activity log');
            console.warn('[ACTIVITY_LOGGER] Logs database not initialized. Attempting to initialize...');
            // Try to initialize if not already done
            initializeActivityLogTables().then(() => {
                // Retry logging after initialization
                logActivity(data).then(resolve).catch(reject);
            }).catch(reject);
            return;
        }

        const {
            userId,
            username,
            role,
            actionType,
            resourceType,
            resourceId = null,
            resourceName = null,
            description,
            oldValue = null,
            newValue = null,
            ipAddress = null,
            userAgent = null
        } = data;

        if (!userId || !username || !role || !actionType || !resourceType || !description) {
            return reject(new Error('Required fields missing for activity log'));
        }

        const stmt = logsDb.prepare(`
            INSERT INTO ${TABLES.ACTIVITY_LOGS} (
                user_id, username, role, action_type, resource_type,
                resource_id, resource_name, description,
                old_value, new_value, ip_address, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            userId,
            username,
            role,
            actionType,
            resourceType,
            resourceId,
            resourceName,
            description,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            ipAddress,
            userAgent
        , (err) => {
            if (err) {
                logger.error('Failed to log activity', err);
                return reject(err);
            }
            stmt.finalize();
            resolve();
        });
    });
}

/**
 * Get login logs
 * @param {Object} options - Query options
 * @param {number} options.limit - Limit results
 * @param {number} options.offset - Offset for pagination
 * @param {string} options.username - Filter by username
 * @param {string} options.actionType - Filter by action type ('login' or 'logout')
 * @param {boolean} options.successOnly - Only successful logins
 * @param {Date} options.startDate - Start date filter
 * @param {Date} options.endDate - End date filter
 */
function getLoginLogs(options = {}) {
    return new Promise((resolve, reject) => {
        if (!logsDb) {
            return reject(new Error('Logs database not initialized'));
        }

        const {
            limit = 100,
            offset = 0,
            username = null,
            actionType = null,
            successOnly = false,
            startDate = null,
            endDate = null
        } = options;

        let query = `SELECT * FROM ${TABLES.LOGIN_LOGS} WHERE 1=1`;
        const params = [];

        if (username) {
            query += ' AND username = ?';
            params.push(username);
        }

        if (actionType) {
            query += ' AND action_type = ?';
            params.push(actionType);
        }

        if (successOnly) {
            query += ' AND success = 1';
        }

        if (startDate) {
            query += ' AND (login_time >= ? OR logout_time >= ?)';
            params.push(startDate.toISOString(), startDate.toISOString());
        }

        if (endDate) {
            query += ' AND (login_time <= ? OR logout_time <= ?)';
            params.push(endDate.toISOString(), endDate.toISOString());
        }

        // Order by login_time or logout_time (whichever is more recent)
        query += ' ORDER BY COALESCE(logout_time, login_time) DESC, login_time DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        logsDb.all(query, params, (err, rows) => {
            if (err) {
                return reject(err);
            }
            resolve(rows);
        });
    });
}

/**
 * Get activity logs
 * @param {Object} options - Query options
 * @param {number} options.limit - Limit results
 * @param {number} options.offset - Offset for pagination
 * @param {number} options.userId - Filter by user ID
 * @param {string} options.actionType - Filter by action type
 * @param {string} options.resourceType - Filter by resource type
 * @param {Date} options.startDate - Start date filter
 * @param {Date} options.endDate - End date filter
 */
function getActivityLogs(options = {}) {
    return new Promise((resolve, reject) => {
        if (!logsDb) {
            return reject(new Error('Logs database not initialized'));
        }

        const {
            limit = 100,
            offset = 0,
            userId = null,
            actionType = null,
            resourceType = null,
            startDate = null,
            endDate = null
        } = options;

        let query = `SELECT * FROM ${TABLES.ACTIVITY_LOGS} WHERE 1=1`;
        const params = [];

        if (userId) {
            query += ' AND user_id = ?';
            params.push(userId);
        }

        if (actionType) {
            query += ' AND action_type = ?';
            params.push(actionType);
        }

        if (resourceType) {
            query += ' AND resource_type = ?';
            params.push(resourceType);
        }

        if (startDate) {
            query += ' AND timestamp >= ?';
            params.push(startDate.toISOString());
        }

        if (endDate) {
            query += ' AND timestamp <= ?';
            params.push(endDate.toISOString());
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        logsDb.all(query, params, (err, rows) => {
            if (err) {
                return reject(err);
            }
            // Parse JSON values
            const parsedRows = rows.map(row => ({
                ...row,
                old_value: row.old_value ? JSON.parse(row.old_value) : null,
                new_value: row.new_value ? JSON.parse(row.new_value) : null
            }));
            resolve(parsedRows);
        });
    });
}

/**
 * Cleanup old logs (keep only last N days)
 * @param {number} daysToKeep - Number of days to keep (default: 90)
 */
function cleanupOldLogs(daysToKeep = 90) {
    return new Promise((resolve, reject) => {
        if (!logsDb) {
            return reject(new Error('Logs database not initialized'));
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffDateStr = cutoffDate.toISOString();

        // Cleanup login logs
        logsDb.run(
            `DELETE FROM ${TABLES.LOGIN_LOGS} WHERE login_time < ? OR (logout_time IS NOT NULL AND logout_time < ?)`,
            [cutoffDateStr, cutoffDateStr],
            function(err) {
                if (err) {
                    return reject(err);
                }
                const loginLogsDeleted = this.changes;

                // Cleanup activity logs
                logsDb.run(
                    `DELETE FROM ${TABLES.ACTIVITY_LOGS} WHERE timestamp < ?`,
                    [cutoffDateStr],
                    function(err) {
                        if (err) {
                            return reject(err);
                        }
                        const activityLogsDeleted = this.changes;
                        logger.info(`Cleaned up old logs: ${loginLogsDeleted} login logs, ${activityLogsDeleted} activity logs`);
                        resolve({
                            loginLogsDeleted,
                            activityLogsDeleted
                        });
                    }
                );
            }
        );
    });
}

/**
 * Close logs database connection
 */
function closeLogsDatabase() {
    return new Promise((resolve, reject) => {
        if (logsDb) {
            logsDb.close((err) => {
                if (err) {
                    console.error('[ACTIVITY_LOGGER] Error closing logs database:', err);
                    return reject(err);
                }
                console.log('[ACTIVITY_LOGGER] Logs database connection closed');
                logsDb = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}

module.exports = {
    initializeActivityLogTables,
    logLogin,
    logLogout,
    logActivity,
    getLoginLogs,
    getActivityLogs,
    cleanupOldLogs,
    closeLogsDatabase
};

