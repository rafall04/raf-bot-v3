"use strict";

/**
 * Rate Limiter Module
 * Prevents spam and abuse by limiting message frequency
 */

const { logger } = require('./logger');

// Rate limit configurations
const rateLimits = {};
const blacklist = {};

// Configuration
const config = {
    defaultLimit: 10,           // messages per window
    defaultWindow: 60000,       // 1 minute in milliseconds
    blacklistDuration: 300000,  // 5 minutes blacklist
    warningThreshold: 0.8,      // Warn at 80% of limit
    
    // Command-specific limits
    commandLimits: {
        'lapor': { limit: 3, window: 300000 },      // 3 reports per 5 minutes
        'ganti nama': { limit: 5, window: 300000 }, // 5 changes per 5 minutes
        'ganti sandi': { limit: 5, window: 300000 },// 5 changes per 5 minutes
        'request': { limit: 5, window: 300000 },    // 5 requests per 5 minutes
        'broadcast': { limit: 1, window: 600000 },  // 1 broadcast per 10 minutes
    },
    
    // Role-based multipliers
    roleMultipliers: {
        owner: 10,      // Owners get 10x the limit
        admin: 5,       // Admins get 5x the limit
        teknisi: 3,     // Teknisi get 3x the limit
        customer: 1     // Regular users get standard limit
    }
};

/**
 * Get user rate limit key
 * @param {string} userId - User ID
 * @param {string} command - Optional command
 * @returns {string} Rate limit key
 */
function getRateLimitKey(userId, command = null) {
    return command ? `${userId}:${command}` : userId;
}

/**
 * Get rate limit configuration
 * @param {string} command - Command name
 * @param {string} role - User role
 * @returns {Object} Rate limit configuration
 */
function getRateLimitConfig(command = null, role = 'customer') {
    let limit = config.defaultLimit;
    let window = config.defaultWindow;
    
    // Check for command-specific limits
    if (command && config.commandLimits[command]) {
        limit = config.commandLimits[command].limit;
        window = config.commandLimits[command].window;
    }
    
    // Apply role multiplier
    const multiplier = config.roleMultipliers[role] || 1;
    limit = Math.floor(limit * multiplier);
    
    return { limit, window };
}

/**
 * Check if user is blacklisted
 * @param {string} userId - User ID
 * @returns {boolean} True if blacklisted
 */
function isBlacklisted(userId) {
    if (!blacklist[userId]) return false;
    
    const now = Date.now();
    if (now > blacklist[userId].until) {
        delete blacklist[userId];
        logger.info(`User removed from blacklist: ${userId}`);
        return false;
    }
    
    return true;
}

/**
 * Add user to blacklist
 * @param {string} userId - User ID
 * @param {string} reason - Blacklist reason
 */
function addToBlacklist(userId, reason = 'Rate limit exceeded') {
    const until = Date.now() + config.blacklistDuration;
    blacklist[userId] = {
        reason: reason,
        until: until,
        timestamp: Date.now()
    };
    
    logger.warn(`User added to blacklist: ${userId}`, {
        reason: reason,
        duration: config.blacklistDuration
    });
}

/**
 * Check rate limit for user
 * @param {string} userId - User ID
 * @param {Object} options - Options
 * @returns {Object} Rate limit check result
 */
function checkRateLimit(userId, options = {}) {
    const { command = null, role = 'customer' } = options;
    
    // Check blacklist first
    if (isBlacklisted(userId)) {
        const blacklistInfo = blacklist[userId];
        const remainingTime = Math.ceil((blacklistInfo.until - Date.now()) / 1000);
        
        return {
            allowed: false,
            blacklisted: true,
            reason: blacklistInfo.reason,
            retryAfter: remainingTime,
            message: `⛔ Anda diblokir sementara karena ${blacklistInfo.reason}. Silakan tunggu ${remainingTime} detik.`
        };
    }
    
    const key = getRateLimitKey(userId, command);
    const { limit, window } = getRateLimitConfig(command, role);
    const now = Date.now();
    
    // Initialize or get rate limit data
    if (!rateLimits[key]) {
        rateLimits[key] = {
            count: 0,
            resetTime: now + window,
            warned: false
        };
    }
    
    const rateLimit = rateLimits[key];
    
    // Reset if window has passed
    if (now > rateLimit.resetTime) {
        rateLimit.count = 0;
        rateLimit.resetTime = now + window;
        rateLimit.warned = false;
    }
    
    // Check if limit exceeded
    if (rateLimit.count >= limit) {
        const remainingTime = Math.ceil((rateLimit.resetTime - now) / 1000);
        
        // Add to blacklist if repeatedly hitting limit
        if (rateLimit.violations >= 3) {
            addToBlacklist(userId, 'Repeated rate limit violations');
        }
        
        rateLimit.violations = (rateLimit.violations || 0) + 1;
        
        return {
            allowed: false,
            blacklisted: false,
            limit: limit,
            remaining: 0,
            resetTime: rateLimit.resetTime,
            retryAfter: remainingTime,
            message: `⚠️ Anda terlalu sering mengirim pesan. Silakan tunggu ${remainingTime} detik sebelum mencoba lagi.`
        };
    }
    
    // Increment counter
    rateLimit.count++;
    
    const remaining = limit - rateLimit.count;
    const percentUsed = rateLimit.count / limit;
    
    // DISABLED: Warning message removed per user request
    // Users find this annoying, only block if actually exceeded
    let warning = null;
    // if (!rateLimit.warned && percentUsed >= config.warningThreshold) {
    //     rateLimit.warned = true;
    //     warning = `⚠️ Peringatan: Anda hampir mencapai batas. Tersisa ${remaining} pesan lagi.`;
    // }
    
    return {
        allowed: true,
        blacklisted: false,
        limit: limit,
        remaining: remaining,
        resetTime: rateLimit.resetTime,
        warning: warning  // Always null now
    };
}

/**
 * Reset rate limit for user
 * @param {string} userId - User ID
 * @param {string} command - Optional command
 */
function resetRateLimit(userId, command = null) {
    const key = getRateLimitKey(userId, command);
    delete rateLimits[key];
    logger.info(`Rate limit reset for: ${key}`);
}

/**
 * Remove user from blacklist
 * @param {string} userId - User ID
 */
function removeFromBlacklist(userId) {
    if (blacklist[userId]) {
        delete blacklist[userId];
        logger.info(`User manually removed from blacklist: ${userId}`);
    }
}

/**
 * Get rate limit statistics
 * @returns {Object} Statistics
 */
function getStatistics() {
    const now = Date.now();
    
    // Clean up expired entries
    const activeRateLimits = {};
    for (const key in rateLimits) {
        if (rateLimits[key].resetTime > now) {
            activeRateLimits[key] = rateLimits[key];
        }
    }
    
    // Clean up expired blacklists
    const activeBlacklist = {};
    for (const userId in blacklist) {
        if (blacklist[userId].until > now) {
            activeBlacklist[userId] = blacklist[userId];
        }
    }
    
    return {
        activeRateLimits: Object.keys(activeRateLimits).length,
        blacklistedUsers: Object.keys(activeBlacklist).length,
        totalTracked: Object.keys(rateLimits).length,
        details: {
            rateLimits: activeRateLimits,
            blacklist: activeBlacklist
        }
    };
}

/**
 * Clean up expired entries
 */
function cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean rate limits
    for (const key in rateLimits) {
        if (rateLimits[key].resetTime < now) {
            delete rateLimits[key];
            cleaned++;
        }
    }
    
    // Clean blacklist
    for (const userId in blacklist) {
        if (blacklist[userId].until < now) {
            delete blacklist[userId];
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        logger.debug(`Rate limiter cleanup: removed ${cleaned} expired entries`);
    }
}

// Run cleanup every 5 minutes
setInterval(cleanup, 5 * 60 * 1000);

module.exports = {
    checkRateLimit,
    resetRateLimit,
    isBlacklisted,
    addToBlacklist,
    removeFromBlacklist,
    getStatistics,
    cleanup,
    config,
    
    // Middleware for Express routes
    expressMiddleware: (options = {}) => {
        return (req, res, next) => {
            const userId = req.user?.id || req.ip;
            const command = options.command || req.path;
            const role = req.user?.role || 'customer';
            
            const result = checkRateLimit(userId, { command, role });
            
            if (!result.allowed) {
                return res.status(429).json({
                    success: false,
                    message: result.message,
                    retryAfter: result.retryAfter
                });
            }
            
            // Add rate limit headers
            res.set({
                'X-RateLimit-Limit': result.limit,
                'X-RateLimit-Remaining': result.remaining,
                'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
            });
            
            next();
        };
    }
};
