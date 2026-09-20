"use strict";

/**
 * Centralized Logger Module
 * Provides consistent logging across the application
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

// Log levels
const LogLevel = {
    ERROR: 'ERROR',
    WARN: 'WARN',
    INFO: 'INFO',
    DEBUG: 'DEBUG'
};

// Configuration
const config = {
    logToFile: process.env.NODE_ENV !== 'test',
    logToConsole: true,
    logLevel: process.env.LOG_LEVEL || 'INFO',
    maxFileSize: 10 * 1024 * 1024, // 10MB
    logDirectory: path.join(__dirname, '../logs'),
    dateFormat: 'YYYY-MM-DD HH:mm:ss'
};

// Ensure log directory exists
if (config.logToFile && !fs.existsSync(config.logDirectory)) {
    fs.mkdirSync(config.logDirectory, { recursive: true });
}

/**
 * Format timestamp
 * @returns {string} Formatted timestamp
 */
function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Format log message
 * @param {string} level - Log level
 * @param {string} category - Log category
 * @param {string} message - Log message
 * @param {*} data - Additional data
 * @returns {string} Formatted log message
 */
function formatMessage(level, category, message, data) {
    const timestamp = getTimestamp();
    let logMessage = `[${timestamp}] [${level}] [${category}] ${message}`;
    
    if (data !== undefined) {
        if (typeof data === 'object') {
            try {
                logMessage += ' ' + JSON.stringify(data, null, 2);
            } catch (_e) {
                logMessage += ' ' + util.inspect(data);
            }
        } else {
            logMessage += ' ' + data;
        }
    }
    
    return logMessage;
}

/**
 * Write log to file
 * @param {string} message - Log message
 */
// Flag emit-internal: saat true, jembatan console-to-logger meneruskan panggilan
// console.* berikut MENTAH ke console asli (tanpa format ulang / rekursi balik ke
// logger). Wajib ada karena logger menulis ke terminal lewat console.* — tanpa ini,
// panggilan `logger.*` langsung di bawah bridge diproses dua kali (double-prefix +
// dobel tulis ke file).
let emittingToConsole = false;
function isEmittingToConsole() {
    return emittingToConsole;
}
function emitConsole(method, message) {
    emittingToConsole = true;
    try {
        console[method](message);
    } finally {
        emittingToConsole = false;
    }
}

function writeToFile(message) {
    if (!config.logToFile) return;
    
    const date = new Date();
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const logFile = path.join(config.logDirectory, `app-${dateStr}.log`);
    
    // Check file size and rotate if needed
    try {
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            if (stats.size > config.maxFileSize) {
                const timestamp = Date.now();
                const rotatedFile = path.join(config.logDirectory, `app-${dateStr}-${timestamp}.log`);
                fs.renameSync(logFile, rotatedFile);
            }
        }
    } catch (e) {
        emitConsole('error', util.format('Error rotating log file:', e));
    }
    
    // Append to log file
    try {
        fs.appendFileSync(logFile, message + '\n');
    } catch (e) {
        emitConsole('error', util.format('Error writing to log file:', e));
    }
}

/**
 * Main logger class
 */
class Logger {
    constructor(category = 'APP') {
        this.category = category;
    }
    
    /**
     * Check if log level is enabled
     * @param {string} level - Log level to check
     * @returns {boolean} True if level is enabled
     */
    isLevelEnabled(level) {
        const levels = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
        const configuredLevel = levels.indexOf(config.logLevel);
        const requestedLevel = levels.indexOf(level);
        return requestedLevel <= configuredLevel;
    }
    
    /**
     * Log error message — variadic, semantik identik console.error
     *   (`util.format`: substitusi %s/%j, util.inspect untuk objek, stack untuk Error).
     * @param {...*} args - Pesan + data
     */
    error(...args) {
        if (!this.isLevelEnabled(LogLevel.ERROR)) return;

        const formattedMessage = formatMessage(LogLevel.ERROR, this.category, util.format(...args));

        if (config.logToConsole) {
            emitConsole('error', formattedMessage);
        }

        writeToFile(formattedMessage);

        // Also write to error log
        if (config.logToFile) {
            const date = new Date();
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const errorLogFile = path.join(config.logDirectory, `error-${dateStr}.log`);
            try {
                fs.appendFileSync(errorLogFile, formattedMessage + '\n');
            } catch (e) {
                emitConsole('error', util.format('Error writing to error log file:', e));
            }
        }
    }
    
    /**
     * Log warning message — variadic, semantik identik console.warn.
     * @param {...*} args - Pesan + data
     */
    warn(...args) {
        if (!this.isLevelEnabled(LogLevel.WARN)) return;

        const formattedMessage = formatMessage(LogLevel.WARN, this.category, util.format(...args));

        if (config.logToConsole) {
            emitConsole('warn', formattedMessage);
        }

        writeToFile(formattedMessage);
    }
    
    /**
     * Log info message — variadic, semantik identik console.log.
     * @param {...*} args - Pesan + data
     */
    info(...args) {
        if (!this.isLevelEnabled(LogLevel.INFO)) return;

        const formattedMessage = formatMessage(LogLevel.INFO, this.category, util.format(...args));

        if (config.logToConsole) {
            emitConsole('log', formattedMessage);
        }

        writeToFile(formattedMessage);
    }
    
    /**
     * Log debug message — variadic, semantik identik console.debug.
     * @param {...*} args - Pesan + data
     */
    debug(...args) {
        if (!this.isLevelEnabled(LogLevel.DEBUG)) return;

        const formattedMessage = formatMessage(LogLevel.DEBUG, this.category, util.format(...args));

        if (config.logToConsole) {
            emitConsole('log', formattedMessage);
        }

        writeToFile(formattedMessage);
    }
    
    /**
     * Create a child logger with a new category
     * @param {string} category - Child category
     * @returns {Logger} New logger instance
     */
    child(category) {
        return new Logger(`${this.category}:${category}`);
    }
}

/**
 * Clean old log files
 * @param {number} daysToKeep - Number of days to keep logs
 */
function cleanOldLogs(daysToKeep = 7) {
    if (!config.logToFile) return;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    
    try {
        const files = fs.readdirSync(config.logDirectory);
        
        files.forEach(file => {
            const filePath = path.join(config.logDirectory, file);
            const stats = fs.statSync(filePath);
            
            if (stats.mtime < cutoffDate) {
                fs.unlinkSync(filePath);
                emitConsole('log', `[LOGGER] Deleted old log file: ${file}`);
            }
        });
    } catch (e) {
        emitConsole('error', util.format('[LOGGER] Error cleaning old logs:', e));
    }
}

// Export singleton instance and utilities
module.exports = {
    Logger,
    logger: new Logger(),
    LogLevel,
    config,
    cleanOldLogs,
    
    // Convenience methods — variadic, semantik console.*.
    error: (...args) => module.exports.logger.error(...args),
    warn: (...args) => module.exports.logger.warn(...args),
    info: (...args) => module.exports.logger.info(...args),
    debug: (...args) => module.exports.logger.debug(...args),

    // Internal — dibaca console-to-logger untuk passthrough emit internal.
    isEmittingToConsole,
    
    // Create category-specific logger
    create: (category) => new Logger(category)
};
