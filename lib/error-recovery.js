/**
 * Header Doc
 * Purpose: Menangani recovery otomatis, pencatatan error, dan alert kegagalan sistem.
 * Caller: Bootstrap runtime, monitoring internal, dan workflow recovery saat exception kritis.
 * Deps: `fs-extra`, `path`, `os`, `./whatsapp-delivery-service`, `./whatsapp-gateway`, dan `./whatsapp-bootstrap`.
 * MainFuncs: `ErrorRecovery` dan metode alert/reconnect/recovery action.
 * SideEffects: Menulis log recovery, memicu restart/reconnect, dan mengirim alert WhatsApp ke admin.
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { sendMessage } = require('./whatsapp-delivery-service');
const { closeActiveSocket, hasAuthenticatedSession, isReady } = require('./whatsapp-gateway');
const { triggerWhatsAppReconnect } = require('./whatsapp-bootstrap');

class ErrorRecovery {
    constructor() {
        this.retryAttempts = new Map();
        this.errorLog = [];
        this.recoveryActions = new Map();
        this.maxRetries = 5;
        this.retryDelay = 1000; // Initial delay in ms
        this.maxErrorLogSize = 1000;
        this.lastReconnectAttempt = 0;
        this.reconnectCooldown = 30000; // 30 seconds between reconnect attempts
        
        // Define recovery actions for common errors
        this.setupRecoveryActions();
        
        // Initialize error log file
        this.errorLogPath = path.join(__dirname, '../logs/error-recovery.log');
        this.ensureLogDirectory();
    }
    
    setupRecoveryActions() {
        // WhatsApp connection errors
        this.recoveryActions.set('ECONNREFUSED', 'RECONNECT_WA');
        this.recoveryActions.set('ETIMEDOUT', 'RECONNECT_WA');
        this.recoveryActions.set('CONNECTION_CLOSED', 'RECONNECT_WA');
        this.recoveryActions.set('401', 'RECONNECT_WA'); // Unauthorized
        
        // Database errors
        this.recoveryActions.set('SQLITE_BUSY', 'RESET_DB');
        this.recoveryActions.set('SQLITE_LOCKED', 'RESET_DB');
        this.recoveryActions.set('SQLITE_CORRUPT', 'RESTORE_DB');
        
        // Memory/resource errors
        this.recoveryActions.set('ENOMEM', 'CLEAR_MEMORY');
        this.recoveryActions.set('EMFILE', 'CLOSE_FILES');
        
        // Queue errors
        this.recoveryActions.set('QUEUE_FULL', 'CLEAR_QUEUE');
        this.recoveryActions.set('QUEUE_STUCK', 'RESET_QUEUE');
    }
    
    ensureLogDirectory() {
        const logsDir = path.dirname(this.errorLogPath);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
    }
    
    /**
     * Main error handler
     */
    async handleError(error, context = {}) {
        const errorInfo = {
            timestamp: new Date().toISOString(),
            message: error.message || 'Unknown error',
            code: error.code || 'UNKNOWN',
            stack: error.stack,
            context: context
        };
        
        // Log error
        this.logError(errorInfo);
        
        // Determine severity
        const severity = this.analyzeSeverity(error);
        
        // Get recovery action - ensure we pass a string
        const errorCode = error.code || error.message || error.toString();
        const action = this.getRecoveryAction(errorCode);
        
        // Execute recovery if available
        if (action) {
            const recovered = await this.executeRecovery(action, context);
            if (recovered) {
                console.log(`[ERROR_RECOVERY] Successfully recovered from ${error.code} using ${action}`);
                this.resetRetryCount(context.identifier || 'default');
                return { recovered: true, action };
            }
        }
        
        // Handle retry logic
        const shouldRetry = this.shouldRetry(context.identifier || 'default');
        if (shouldRetry && context.retryable !== false) {
            const retryCount = this.incrementRetryCount(context.identifier || 'default');
            const delay = this.calculateRetryDelay(retryCount);
            
            console.log(`[ERROR_RECOVERY] Will retry in ${delay}ms (attempt ${retryCount}/${this.maxRetries})`);
            
            // Alert if critical
            if (severity === 'CRITICAL' || retryCount >= 3) {
                await this.alertAdmin(error, context, retryCount);
            }
            
            return { 
                recovered: false, 
                retry: true, 
                delay,
                attempt: retryCount 
            };
        }
        
        // Max retries reached or non-retryable error
        if (severity === 'CRITICAL') {
            await this.alertAdmin(error, context, -1); // -1 indicates max retries reached
        }
        
        return { 
            recovered: false, 
            retry: false,
            reason: 'max_retries_reached' 
        };
    }
    
    /**
     * Analyze error severity
     */
    analyzeSeverity(error) {
        const criticalPatterns = [
            /EACCES/,           // Permission denied
            /SQLITE_CORRUPT/,   // Database corruption
            /ENOMEM/,           // Out of memory
            /ENOSPC/,           // No space left
            /401/,              // Authentication failure
            /403/               // Forbidden
        ];
        
        const warningPatterns = [
            /ETIMEDOUT/,        // Timeout
            /ECONNREFUSED/,     // Connection refused
            /SQLITE_BUSY/,      // Database busy
            /QUEUE_FULL/        // Queue full
        ];
        
        const errorStr = error.message + (error.code || '');
        
        if (criticalPatterns.some(pattern => pattern.test(errorStr))) {
            return 'CRITICAL';
        }
        
        if (warningPatterns.some(pattern => pattern.test(errorStr))) {
            return 'WARNING';
        }
        
        return 'INFO';
    }
    
    /**
     * Get recovery action for error
     */
    getRecoveryAction(errorCode) {
        // Direct match
        if (this.recoveryActions.has(errorCode)) {
            return this.recoveryActions.get(errorCode);
        }
        
        // Pattern matching
        for (const [pattern, action] of this.recoveryActions) {
            // Convert errorCode to string if it's not already
            const errorStr = errorCode ? String(errorCode) : '';
            if (errorStr && typeof errorStr === 'string' && errorStr.includes(pattern)) {
                return action;
            }
        }
        
        return null;
    }
    
    /**
     * Execute recovery action
     */
    async executeRecovery(action, context) {
        console.log(`[ERROR_RECOVERY] Executing recovery action: ${action}`);
        
        try {
            switch(action) {
                case 'RECONNECT_WA':
                    return await this.reconnectWhatsApp();
                    
                case 'RESET_DB':
                    return await this.resetDatabase();
                    
                case 'RESTORE_DB':
                    return await this.restoreDatabase();
                    
                case 'CLEAR_QUEUE':
                    return await this.clearQueue(context.queue);
                    
                case 'RESET_QUEUE':
                    return await this.resetQueue(context.queue);
                    
                case 'CLEAR_MEMORY':
                    return await this.clearMemory();
                    
                case 'CLOSE_FILES':
                    return await this.closeExcessFiles();
                    
                case 'RESTART_SERVICE':
                    return await this.restartService(context.service);
                    
                default:
                    console.log(`[ERROR_RECOVERY] Unknown action: ${action}`);
                    return false;
            }
        } catch (recoveryError) {
            console.error(`[ERROR_RECOVERY] Recovery action failed:`, recoveryError);
            return false;
        }
    }
    
    /**
     * WhatsApp reconnection logic
     * PENTING: Untuk stream error (515), jangan logout - cukup reconnect
     */
    async reconnectWhatsApp() {
        const now = Date.now();
        
        // Check cooldown
        if (now - this.lastReconnectAttempt < this.reconnectCooldown) {
            console.log('[ERROR_RECOVERY] Reconnect cooldown active');
            return false;
        }
        
        this.lastReconnectAttempt = now;
        
        try {
            console.log('[ERROR_RECOVERY] Attempting WhatsApp reconnection...');
            
            // JANGAN logout untuk stream error - cukup reconnect
            // Logout akan menghapus session dan memerlukan scan QR ulang
            
            await closeActiveSocket({ nextState: 'temporary_disconnect' });
            
            // Wait a bit before reconnecting
            await this.delay(3000);
            
            await triggerWhatsAppReconnect();
            console.log('[ERROR_RECOVERY] WhatsApp reconnection initiated');
            return true;
        } catch (error) {
            console.error('[ERROR_RECOVERY] Reconnection failed:', error);
            return false;
        }
    }
    
    /**
     * Database recovery
     */
    async resetDatabase() {
        try {
            if (global.db) {
                console.log('[ERROR_RECOVERY] Resetting database connection...');
                
                // Close existing connection
                if (global.db.close) {
                    await new Promise((resolve) => {
                        global.db.close((err) => {
                            if (err) console.error('[ERROR_RECOVERY] DB close error:', err);
                            resolve();
                        });
                    });
                }
                
                // Reinitialize - all databases stored in database/ folder
                const sqlite3 = require('sqlite3').verbose();
                const path = require('path');
                const dbPath = path.join(__dirname, '..', 'database', 'users.sqlite');
                global.db = new sqlite3.Database(dbPath);
                {
                    const { applySqlitePragmas } = require('./sqlite-pragmas');
                    applySqlitePragmas(global.db).catch((pragmaErr) => {
                        console.warn(`[ERROR_RECOVERY_PRAGMA_WARN] ${pragmaErr.message}`);
                    });
                }

                console.log('[ERROR_RECOVERY] Database connection reset');
                return true;
            }
            return false;
        } catch (error) {
            console.error('[ERROR_RECOVERY] Database reset failed:', error);
            return false;
        }
    }
    
    /**
     * Restore database from backup
     */
    async restoreDatabase() {
        try {
            // All databases stored in database/ folder
            const path = require('path');
            const backupPath = path.join(__dirname, '..', 'backups', 'database_latest.sqlite');
            const dbPath = path.join(__dirname, '..', 'database', 'users.sqlite');
            
            if (fs.existsSync(backupPath)) {
                console.log('[ERROR_RECOVERY] Restoring database from backup...');
                
                // Close current connection
                if (global.db && global.db.close) {
                    await new Promise((resolve) => {
                        global.db.close(() => resolve());
                    });
                }
                
                // Copy backup
                await fs.copy(backupPath, dbPath, { overwrite: true });

                // Hapus file companion WAL/SHM lama sebelum reopen — backup yang
                // di-copy belum tentu sesuai dengan WAL file yang menyisa di disk.
                // SQLite akan buat ulang file companion saat open berikutnya.
                {
                    const { cleanupWalCompanions } = require('./sqlite-pragmas');
                    cleanupWalCompanions(dbPath);
                }

                // Reinitialize
                const sqlite3 = require('sqlite3').verbose();
                global.db = new sqlite3.Database(dbPath);
                {
                    const { applySqlitePragmas } = require('./sqlite-pragmas');
                    applySqlitePragmas(global.db).catch((pragmaErr) => {
                        console.warn(`[ERROR_RECOVERY_PRAGMA_WARN] ${pragmaErr.message}`);
                    });
                }

                console.log('[ERROR_RECOVERY] Database restored from backup');
                return true;
            }
            
            console.log('[ERROR_RECOVERY] No backup available');
            return false;
        } catch (error) {
            console.error('[ERROR_RECOVERY] Database restore failed:', error);
            return false;
        }
    }
    
    /**
     * Clear stuck queues
     */
    async clearQueue(queueName) {
        try {
            if (global.messageQueue && queueName) {
                console.log(`[ERROR_RECOVERY] Clearing queue: ${queueName}`);
                
                if (global.messageQueue[queueName]) {
                    global.messageQueue[queueName] = [];
                    return true;
                }
            }
            
            // Clear all queues
            if (global.messageQueue) {
                Object.keys(global.messageQueue).forEach(key => {
                    global.messageQueue[key] = [];
                });
                console.log('[ERROR_RECOVERY] All queues cleared');
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[ERROR_RECOVERY] Queue clear failed:', error);
            return false;
        }
    }
    
    /**
     * Reset queue processing
     */
    async resetQueue(queueName) {
        try {
            // Clear the queue first
            await this.clearQueue(queueName);
            
            // Reset processing flags
            if (global.queueProcessing) {
                if (queueName) {
                    global.queueProcessing[queueName] = false;
                } else {
                    Object.keys(global.queueProcessing).forEach(key => {
                        global.queueProcessing[key] = false;
                    });
                }
            }
            
            console.log('[ERROR_RECOVERY] Queue reset completed');
            return true;
        } catch (error) {
            console.error('[ERROR_RECOVERY] Queue reset failed:', error);
            return false;
        }
    }
    
    /**
     * Clear memory by running garbage collection
     */
    async clearMemory() {
        try {
            // Clear caches if they exist
            if (global.cache) {
                Object.keys(global.cache).forEach(key => {
                    delete global.cache[key];
                });
            }
            
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
                console.log('[ERROR_RECOVERY] Garbage collection executed');
            }
            
            // Clear large objects
            if (global.temp) {
                const tempKeys = Object.keys(global.temp);
                if (tempKeys.length > 100) {
                    // Keep only recent 50
                    tempKeys.slice(0, -50).forEach(key => {
                        delete global.temp[key];
                    });
                }
            }
            
            console.log('[ERROR_RECOVERY] Memory cleanup completed');
            return true;
        } catch (error) {
            console.error('[ERROR_RECOVERY] Memory clear failed:', error);
            return false;
        }
    }
    
    /**
     * Close excess file handles
     */
    async closeExcessFiles() {
        try {
            // This is platform specific and limited in Node.js
            // Best we can do is log warning
            console.log('[ERROR_RECOVERY] File handle limit reached - consider increasing ulimit');
            
            // Clear any file streams in use
            if (global.fileStreams) {
                Object.values(global.fileStreams).forEach(stream => {
                    if (stream && stream.close) {
                        stream.close();
                    }
                });
                global.fileStreams = {};
            }
            
            return true;
        } catch (error) {
            console.error('[ERROR_RECOVERY] File close failed:', error);
            return false;
        }
    }
    
    /**
     * Restart a specific service
     */
    async restartService(serviceName) {
        try {
            console.log(`[ERROR_RECOVERY] Restarting service: ${serviceName}`);
            
            // Service-specific restart logic
            switch(serviceName) {
                case 'whatsapp':
                    return await this.reconnectWhatsApp();
                    
                case 'database':
                    return await this.resetDatabase();
                    
                case 'monitoring':
                    if (global.monitoring && global.monitoring.restart) {
                        await global.monitoring.restart();
                        return true;
                    }
                    break;
                    
                default:
                    console.log(`[ERROR_RECOVERY] Unknown service: ${serviceName}`);
            }
            
            return false;
        } catch (error) {
            console.error('[ERROR_RECOVERY] Service restart failed:', error);
            return false;
        }
    }
    
    /**
     * Alert admin about critical errors
     */
    async alertAdmin(error, context, retryCount) {
        try {
            const admins = global.config?.admin_numbers || [];
            
            if (admins.length === 0 || !hasAuthenticatedSession()) {
                console.log('[ERROR_RECOVERY] No admin numbers configured or WhatsApp not connected');
                return;
            }
            
            const message = this.formatAlertMessage(error, context, retryCount);
            
            // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
            for (const adminNumber of admins) {
                const jid = adminNumber.includes('@') ? adminNumber : `${adminNumber}@s.whatsapp.net`;
                
                if (isReady()) {
                    try {
                        const delivery = await sendMessage(jid, { text: message });
                        if (!delivery.sent) {
                            throw new Error(delivery.warning || delivery.errorCode || 'SEND_FAILED');
                        }
                        console.log(`[ERROR_RECOVERY] Alert sent to admin: ${adminNumber}`);
                    } catch (sendError) {
                        console.error('[SEND_MESSAGE_ERROR]', {
                            jid,
                            error: sendError.message
                        });
                        console.error(`[ERROR_RECOVERY] Failed to alert admin ${adminNumber}:`, sendError);
                        // Continue to next admin
                    }
                } else {
                    console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to admin', adminNumber);
                }
            }
        } catch (alertError) {
            console.error('[ERROR_RECOVERY] Alert system error:', alertError);
        }
    }
    
    /**
     * Format alert message for admin
     */
    formatAlertMessage(error, context, retryCount) {
        const severity = this.analyzeSeverity(error);
        const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        
        let message = `🚨 *SYSTEM ALERT - ${severity}*\n\n`;
        message += `⏰ *Time:* ${timestamp}\n`;
        message += `❌ *Error:* ${error.message || 'Unknown error'}\n`;
        
        if (error.code) {
            message += `📝 *Code:* ${error.code}\n`;
        }
        
        if (context.identifier) {
            message += `🔍 *Context:* ${context.identifier}\n`;
        }
        
        if (retryCount > 0) {
            message += `🔄 *Retry Attempt:* ${retryCount}/${this.maxRetries}\n`;
        } else if (retryCount === -1) {
            message += `⛔ *Status:* Max retries reached\n`;
        }
        
        // Add system stats
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        
        message += `\n📊 *System Status:*\n`;
        message += `• Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB\n`;
        message += `• Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n`;
        message += `• Platform: ${os.platform()}\n`;
        
        const recovery = this.getRecoveryAction(error.code || error.message);
        if (recovery) {
            message += `\n🔧 *Recovery Action:* ${recovery}`;
        }
        
        return message;
    }
    
    /**
     * Retry management
     */
    shouldRetry(identifier) {
        const attempts = this.retryAttempts.get(identifier) || 0;
        return attempts < this.maxRetries;
    }
    
    incrementRetryCount(identifier) {
        const current = this.retryAttempts.get(identifier) || 0;
        const newCount = current + 1;
        this.retryAttempts.set(identifier, newCount);
        return newCount;
    }
    
    resetRetryCount(identifier) {
        this.retryAttempts.delete(identifier);
    }
    
    /**
     * Calculate retry delay with exponential backoff
     */
    calculateRetryDelay(attemptNumber) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delay = Math.min(this.retryDelay * Math.pow(2, attemptNumber - 1), 30000);
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 1000;
        
        return delay + jitter;
    }
    
    /**
     * Log error to file and memory
     */
    logError(errorInfo) {
        // Add to memory log
        this.errorLog.push(errorInfo);
        
        // Trim if too large
        if (this.errorLog.length > this.maxErrorLogSize) {
            this.errorLog = this.errorLog.slice(-this.maxErrorLogSize / 2);
        }
        
        // Write to file
        try {
            const logLine = JSON.stringify(errorInfo) + '\n';
            fs.appendFileSync(this.errorLogPath, logLine);
        } catch (writeError) {
            console.error('[ERROR_RECOVERY] Failed to write error log:', writeError);
        }
    }
    
    /**
     * Get error statistics
     */
    getErrorStats() {
        const now = Date.now();
        const hour = 3600000;
        const day = 86400000;
        
        const recentErrors = this.errorLog.filter(e => {
            const time = new Date(e.timestamp).getTime();
            return now - time < day;
        });
        
        const hourlyErrors = recentErrors.filter(e => {
            const time = new Date(e.timestamp).getTime();
            return now - time < hour;
        });
        
        const errorsByCode = {};
        recentErrors.forEach(e => {
            const code = e.code || 'UNKNOWN';
            errorsByCode[code] = (errorsByCode[code] || 0) + 1;
        });
        
        return {
            total: this.errorLog.length,
            lastDay: recentErrors.length,
            lastHour: hourlyErrors.length,
            byCode: errorsByCode,
            retryAttempts: Object.fromEntries(this.retryAttempts)
        };
    }
    
    /**
     * Utility delay function
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = ErrorRecovery;
