const { loadJSON } = require('./database');

/**
 * Authentication Cache Manager
 * Cache layer untuk mempercepat proses authentication dan login
 * 
 * Fitur:
 * - Cache hasil pencarian account/user (Map cache)
 * - Cache hasil JWT verification (short-lived cache)
 * - Debounce/throttle untuk reload accounts.json
 * 
 * Dapat di-disable dengan mengatur ENABLE_AUTH_CACHE = false
 */

// Flag untuk enable/disable cache (mudah di-rollback)
const ENABLE_AUTH_CACHE = process.env.ENABLE_AUTH_CACHE !== 'false';

// Cache configuration
const CACHE_CONFIG = {
    // TTL untuk account/user lookup cache (5 menit)
    ACCOUNT_LOOKUP_TTL: 5 * 60 * 1000,
    // TTL untuk JWT verification cache (1 menit)
    JWT_VERIFY_TTL: 60 * 1000,
    // Debounce time untuk reload accounts.json (10 detik)
    RELOAD_DEBOUNCE: 10 * 1000
};

class AuthCache {
    constructor() {
        this.enabled = ENABLE_AUTH_CACHE;
        
        // Cache untuk account lookup by username
        this.accountByUsernameCache = new Map();
        
        // Cache untuk account lookup by id
        this.accountByIdCache = new Map();
        
        // Cache untuk user lookup by id
        this.userByIdCache = new Map();
        
        // Cache untuk JWT verification
        this.jwtCache = new Map();
        
        // Track last reload time untuk debounce
        this.lastReloadTime = 0;
        this.reloadInProgress = false;
        
        // Cleanup interval untuk expired cache entries
        this.startCleanupInterval();
    }
    
    /**
     * Start cleanup interval untuk menghapus expired cache entries
     */
    startCleanupInterval() {
        if (!this.enabled) return;
        
        // Cleanup setiap 1 menit
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 60 * 1000);
    }
    
    /**
     * Cleanup expired cache entries
     */
    cleanupExpiredCache() {
        const now = Date.now();
        
        // Cleanup account by username cache
        for (const [key, value] of this.accountByUsernameCache.entries()) {
            if (value.expiresAt < now) {
                this.accountByUsernameCache.delete(key);
            }
        }
        
        // Cleanup account by id cache
        for (const [key, value] of this.accountByIdCache.entries()) {
            if (value.expiresAt < now) {
                this.accountByIdCache.delete(key);
            }
        }
        
        // Cleanup user by id cache
        for (const [key, value] of this.userByIdCache.entries()) {
            if (value.expiresAt < now) {
                this.userByIdCache.delete(key);
            }
        }
        
        // Cleanup JWT cache
        for (const [key, value] of this.jwtCache.entries()) {
            if (value.expiresAt < now) {
                this.jwtCache.delete(key);
            }
        }
    }
    
    /**
     * Get account by username dengan cache
     * @param {string} username - Username untuk dicari
     * @param {Function} findFunction - Function untuk mencari account jika tidak ada di cache
     * @returns {Object|null} Account object atau null
     */
    getAccountByUsername(username, findFunction) {
        if (!this.enabled) {
            return findFunction();
        }
        
        const cacheKey = username.toLowerCase();
        const cached = this.accountByUsernameCache.get(cacheKey);
        
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        
        const account = findFunction();
        
        if (account) {
            this.accountByUsernameCache.set(cacheKey, {
                data: account,
                expiresAt: Date.now() + CACHE_CONFIG.ACCOUNT_LOOKUP_TTL
            });
        }
        
        return account;
    }
    
    /**
     * Get account by id dengan cache
     * @param {string|number} id - Account ID untuk dicari
     * @param {Function} findFunction - Function untuk mencari account jika tidak ada di cache
     * @returns {Object|null} Account object atau null
     */
    getAccountById(id, findFunction) {
        if (!this.enabled) {
            return findFunction();
        }
        
        const cacheKey = String(id);
        const cached = this.accountByIdCache.get(cacheKey);
        
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        
        const account = findFunction();
        
        if (account) {
            this.accountByIdCache.set(cacheKey, {
                data: account,
                expiresAt: Date.now() + CACHE_CONFIG.ACCOUNT_LOOKUP_TTL
            });
        }
        
        return account;
    }
    
    /**
     * Get user by id dengan cache
     * @param {string|number} id - User ID untuk dicari
     * @param {Function} findFunction - Function untuk mencari user jika tidak ada di cache
     * @returns {Object|null} User object atau null
     */
    getUserById(id, findFunction) {
        if (!this.enabled) {
            return findFunction();
        }
        
        const cacheKey = String(id);
        const cached = this.userByIdCache.get(cacheKey);
        
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        
        const user = findFunction();
        
        if (user) {
            this.userByIdCache.set(cacheKey, {
                data: user,
                expiresAt: Date.now() + CACHE_CONFIG.ACCOUNT_LOOKUP_TTL
            });
        }
        
        return user;
    }
    
    /**
     * Get JWT verification result dengan cache
     * @param {string} token - JWT token
     * @param {Function} verifyFunction - Function untuk verify JWT jika tidak ada di cache
     * @returns {Object|null} Decoded token atau null
     */
    getJWTVerification(token, verifyFunction) {
        if (!this.enabled) {
            return verifyFunction();
        }
        
        // Gunakan hash sederhana dari token untuk cache key (ambil 50 karakter pertama)
        const cacheKey = token.substring(0, 50);
        const cached = this.jwtCache.get(cacheKey);
        
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        
        try {
            const decoded = verifyFunction();
            
            if (decoded) {
                this.jwtCache.set(cacheKey, {
                    data: decoded,
                    expiresAt: Date.now() + CACHE_CONFIG.JWT_VERIFY_TTL
                });
            }
            
            return decoded;
        } catch (err) {
            // Jangan cache error
            return null;
        }
    }
    
    /**
     * Reload accounts.json dengan debounce
     * @returns {Promise<Array>} Array of accounts
     */
    async reloadAccounts() {
        if (!this.enabled) {
            return Promise.resolve(loadJSON("accounts.json"));
        }
        
        const now = Date.now();
        const timeSinceLastReload = now - this.lastReloadTime;
        
        // Debounce: hanya reload jika sudah lebih dari RELOAD_DEBOUNCE ms sejak reload terakhir
        if (timeSinceLastReload < CACHE_CONFIG.RELOAD_DEBOUNCE) {
            // Return cached accounts jika ada
            if (global.accounts && Array.isArray(global.accounts) && global.accounts.length > 0) {
                return Promise.resolve(global.accounts);
            }
        }
        
        // Jika sedang reload, tunggu
        if (this.reloadInProgress) {
            // Wait max 2 seconds
            let waitCount = 0;
            while (this.reloadInProgress && waitCount < 20) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
            
            if (global.accounts && Array.isArray(global.accounts) && global.accounts.length > 0) {
                return Promise.resolve(global.accounts);
            }
        }
        
        // Start reload
        this.reloadInProgress = true;
        this.lastReloadTime = now;
        
        try {
            // loadJSON adalah synchronous function
            const accounts = loadJSON("accounts.json");
            
            // Clear cache untuk account lookup
            this.accountByUsernameCache.clear();
            this.accountByIdCache.clear();
            
            return Promise.resolve(accounts);
        } catch (err) {
            console.error(`[AUTH_CACHE] Failed to reload accounts.json:`, err);
            this.reloadInProgress = false;
            return Promise.reject(err);
        } finally {
            this.reloadInProgress = false;
        }
    }
    
    /**
     * Invalidate cache untuk account tertentu
     * @param {string|number} id - Account ID
     * @param {string} username - Username (optional)
     */
    invalidateAccount(id, username = null) {
        if (!this.enabled) return;
        
        const idKey = String(id);
        this.accountByIdCache.delete(idKey);
        
        if (username) {
            const usernameKey = username.toLowerCase();
            this.accountByUsernameCache.delete(usernameKey);
        }
    }
    
    /**
     * Invalidate cache untuk user tertentu
     * @param {string|number} id - User ID
     */
    invalidateUser(id) {
        if (!this.enabled) return;
        
        const idKey = String(id);
        this.userByIdCache.delete(idKey);
    }
    
    /**
     * Clear semua cache
     */
    clearAll() {
        this.accountByUsernameCache.clear();
        this.accountByIdCache.clear();
        this.userByIdCache.clear();
        this.jwtCache.clear();
    }
    
    /**
     * Get cache statistics (untuk debugging)
     */
    getStats() {
        return {
            enabled: this.enabled,
            accountByUsernameCacheSize: this.accountByUsernameCache.size,
            accountByIdCacheSize: this.accountByIdCache.size,
            userByIdCacheSize: this.userByIdCache.size,
            jwtCacheSize: this.jwtCache.size
        };
    }
}

// Export singleton instance
const authCache = new AuthCache();

module.exports = {
    authCache,
    AuthCache
};

