"use strict";

/**
 * Application Metrics and Monitoring
 * Tracks performance, usage, and health metrics
 */

const { logger } = require('./logger');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Metrics storage
const metrics = {
    commands: {},
    errors: {},
    performance: {},
    system: {},
    users: {},
    startTime: Date.now()
};

// Configuration
const config = {
    saveInterval: 60000,        // Save metrics every minute
    metricsFile: path.join(__dirname, '../database/metrics.json'),
    maxHistorySize: 1000,       // Max entries per metric type
    enableSystemMetrics: true,
    enablePerformanceMetrics: true
};

/**
 * Track command usage
 * @param {string} command - Command name
 * @param {string} userId - User ID
 * @param {Object} metadata - Additional metadata
 */
function trackCommand(command, userId, metadata = {}) {
    if (!metrics.commands[command]) {
        metrics.commands[command] = {
            count: 0,
            users: new Set(),
            lastUsed: null,
            history: []
        };
    }
    
    const commandMetric = metrics.commands[command];
    commandMetric.count++;
    commandMetric.users.add(userId);
    commandMetric.lastUsed = Date.now();
    
    // Add to history
    commandMetric.history.push({
        timestamp: Date.now(),
        userId: userId,
        ...metadata
    });
    
    // Limit history size
    if (commandMetric.history.length > config.maxHistorySize) {
        commandMetric.history = commandMetric.history.slice(-config.maxHistorySize);
    }
    
    logger.debug(`Command tracked: ${command}`, {
        count: commandMetric.count,
        uniqueUsers: commandMetric.users.size
    });
}

/**
 * Track error occurrence
 * @param {string} errorType - Error type
 * @param {Error} error - Error object
 * @param {Object} context - Error context
 */
function trackError(errorType, error, context = {}) {
    if (!metrics.errors[errorType]) {
        metrics.errors[errorType] = {
            count: 0,
            lastOccurred: null,
            messages: new Set(),
            history: []
        };
    }
    
    const errorMetric = metrics.errors[errorType];
    errorMetric.count++;
    errorMetric.lastOccurred = Date.now();
    errorMetric.messages.add(error.message);
    
    // Add to history
    errorMetric.history.push({
        timestamp: Date.now(),
        message: error.message,
        code: error.code,
        ...context
    });
    
    // Limit history size
    if (errorMetric.history.length > config.maxHistorySize) {
        errorMetric.history = errorMetric.history.slice(-config.maxHistorySize);
    }
    
    logger.debug(`Error tracked: ${errorType}`, {
        count: errorMetric.count,
        uniqueMessages: errorMetric.messages.size
    });
}

/**
 * Track performance metric
 * @param {string} operation - Operation name
 * @param {number} duration - Duration in milliseconds
 * @param {Object} metadata - Additional metadata
 */
function trackPerformance(operation, duration, metadata = {}) {
    if (!config.enablePerformanceMetrics) return;
    
    if (!metrics.performance[operation]) {
        metrics.performance[operation] = {
            count: 0,
            totalDuration: 0,
            minDuration: Infinity,
            maxDuration: 0,
            avgDuration: 0,
            history: []
        };
    }
    
    const perfMetric = metrics.performance[operation];
    perfMetric.count++;
    perfMetric.totalDuration += duration;
    perfMetric.minDuration = Math.min(perfMetric.minDuration, duration);
    perfMetric.maxDuration = Math.max(perfMetric.maxDuration, duration);
    perfMetric.avgDuration = perfMetric.totalDuration / perfMetric.count;
    
    // Add to history
    perfMetric.history.push({
        timestamp: Date.now(),
        duration: duration,
        ...metadata
    });
    
    // Limit history size
    if (perfMetric.history.length > config.maxHistorySize) {
        perfMetric.history = perfMetric.history.slice(-config.maxHistorySize);
    }
    
    // Log slow operations
    if (duration > 5000) {
        logger.warn(`Slow operation detected: ${operation}`, {
            duration: duration,
            metadata: metadata
        });
    }
}

/**
 * Start performance timer
 * @param {string} operation - Operation name
 * @returns {Function} Stop function
 */
function startTimer(operation) {
    const startTime = Date.now();
    
    return (metadata = {}) => {
        const duration = Date.now() - startTime;
        trackPerformance(operation, duration, metadata);
        return duration;
    };
}

/**
 * Track user activity
 * @param {string} userId - User ID
 * @param {string} activity - Activity type
 */
function trackUser(userId, activity = 'message') {
    if (!metrics.users[userId]) {
        metrics.users[userId] = {
            firstSeen: Date.now(),
            lastSeen: Date.now(),
            messageCount: 0,
            commandCount: 0,
            errorCount: 0
        };
    }
    
    const userMetric = metrics.users[userId];
    userMetric.lastSeen = Date.now();
    
    switch (activity) {
        case 'message':
            userMetric.messageCount++;
            break;
        case 'command':
            userMetric.commandCount++;
            break;
        case 'error':
            userMetric.errorCount++;
            break;
    }
}

/**
 * Get system metrics
 * @returns {Object} System metrics
 */
function getSystemMetrics() {
    if (!config.enableSystemMetrics) return {};
    
    const uptime = Date.now() - metrics.startTime;
    const memUsage = process.memoryUsage();
    
    return {
        uptime: uptime,
        uptimeHuman: formatDuration(uptime),
        memory: {
            rss: formatBytes(memUsage.rss),
            heapTotal: formatBytes(memUsage.heapTotal),
            heapUsed: formatBytes(memUsage.heapUsed),
            external: formatBytes(memUsage.external),
            percentUsed: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2) + '%'
        },
        cpu: {
            usage: process.cpuUsage(),
            loadAvg: os.loadavg()
        },
        system: {
            platform: os.platform(),
            arch: os.arch(),
            nodeVersion: process.version,
            totalMemory: formatBytes(os.totalmem()),
            freeMemory: formatBytes(os.freemem())
        }
    };
}

/**
 * Get metrics summary
 * @returns {Object} Metrics summary
 */
function getSummary() {
    const commandStats = {};
    for (const cmd in metrics.commands) {
        commandStats[cmd] = {
            count: metrics.commands[cmd].count,
            uniqueUsers: metrics.commands[cmd].users.size,
            lastUsed: metrics.commands[cmd].lastUsed
        };
    }
    
    const errorStats = {};
    for (const err in metrics.errors) {
        errorStats[err] = {
            count: metrics.errors[err].count,
            uniqueMessages: metrics.errors[err].messages.size,
            lastOccurred: metrics.errors[err].lastOccurred
        };
    }
    
    const performanceStats = {};
    for (const op in metrics.performance) {
        performanceStats[op] = {
            count: metrics.performance[op].count,
            avgDuration: Math.round(metrics.performance[op].avgDuration),
            minDuration: Math.round(metrics.performance[op].minDuration),
            maxDuration: Math.round(metrics.performance[op].maxDuration)
        };
    }
    
    return {
        system: getSystemMetrics(),
        commands: commandStats,
        errors: errorStats,
        performance: performanceStats,
        users: {
            total: Object.keys(metrics.users).length,
            active: Object.values(metrics.users).filter(u => 
                Date.now() - u.lastSeen < 3600000 // Active in last hour
            ).length
        },
        timestamp: Date.now()
    };
}

/**
 * Save metrics to file
 */
function saveMetrics() {
    try {
        const summary = getSummary();
        fs.writeFileSync(config.metricsFile, JSON.stringify(summary, null, 2));
        logger.debug('Metrics saved to file');
    } catch (error) {
        logger.error('Failed to save metrics', error);
    }
}

/**
 * Load metrics from file
 */
function loadMetrics() {
    try {
        if (fs.existsSync(config.metricsFile)) {
            const data = fs.readFileSync(config.metricsFile, 'utf8');
            const saved = JSON.parse(data);
            
            // Restore command metrics
            if (saved.commands) {
                for (const cmd in saved.commands) {
                    if (!metrics.commands[cmd]) {
                        metrics.commands[cmd] = {
                            count: saved.commands[cmd].count || 0,
                            users: new Set(),
                            lastUsed: saved.commands[cmd].lastUsed,
                            history: []
                        };
                    }
                }
            }
            
            logger.info('Metrics loaded from file');
        }
    } catch (error) {
        logger.error('Failed to load metrics', error);
    }
}

/**
 * Reset metrics
 * @param {string} type - Type of metrics to reset (optional)
 */
function resetMetrics(type = null) {
    if (type) {
        if (metrics[type]) {
            metrics[type] = {};
            logger.info(`Metrics reset: ${type}`);
        }
    } else {
        metrics.commands = {};
        metrics.errors = {};
        metrics.performance = {};
        metrics.users = {};
        metrics.startTime = Date.now();
        logger.info('All metrics reset');
    }
}

/**
 * Format bytes to human readable
 * @param {number} bytes - Bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format duration to human readable
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted string
 */
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// Auto-save metrics
if (config.saveInterval > 0) {
    setInterval(saveMetrics, config.saveInterval);
}

// Load existing metrics on startup
loadMetrics();

module.exports = {
    trackCommand,
    trackError,
    trackPerformance,
    trackUser,
    startTimer,
    getSystemMetrics,
    getSummary,
    saveMetrics,
    loadMetrics,
    resetMetrics,
    config,
    
    // Express middleware
    expressMiddleware: () => {
        return (req, res, next) => {
            const timer = startTimer(`HTTP ${req.method} ${req.path}`);
            
            // Override res.end to track response time
            const originalEnd = res.end;
            res.end = function(...args) {
                timer({
                    method: req.method,
                    path: req.path,
                    statusCode: res.statusCode
                });
                originalEnd.apply(res, args);
            };
            
            next();
        };
    }
};
