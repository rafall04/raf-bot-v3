/**
 * MikroTik Data Cache Manager
 * Handles caching of MikroTik data to prevent slow loading when connection fails
 */

const fs = require('fs');
const path = require('path');

class MikrotikCache {
    constructor() {
        this.cacheDir = path.join(__dirname, '..', 'database', 'cache');
        this.pppCacheFile = path.join(this.cacheDir, 'ppp_active.json');
        this.cacheDuration = 60000; // 1 minute cache
        this.fallbackDuration = 3600000; // 1 hour for fallback when MikroTik is down
        
        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Get PPP active users from cache or fetch new data
     * @param {Function} fetchFunction - Function to fetch fresh data from MikroTik
     * @returns {Object} Cache result with data and metadata
     */
    async getPPPActiveUsers(fetchFunction) {
        try {
            // Check if cache exists and is valid
            const cache = this.readCache(this.pppCacheFile);
            
            if (cache && this.isCacheValid(cache, this.cacheDuration)) {
                return {
                    data: cache.data,
                    fromCache: true,
                    cacheAge: Date.now() - cache.timestamp,
                    status: 'success'
                };
            }

            // Try to fetch fresh data with timeout
            try {
                const freshData = await this.fetchWithTimeout(fetchFunction, 3000); // 3 second timeout
                
                // Save to cache
                this.saveCache(this.pppCacheFile, freshData);
                
                return {
                    data: freshData,
                    fromCache: false,
                    status: 'success'
                };
            } catch (fetchError) {
                console.error('[MIKROTIK_CACHE] Failed to fetch fresh data:', fetchError.message);
                
                // If fetch fails, use stale cache if available (up to 1 hour old)
                if (cache && this.isCacheValid(cache, this.fallbackDuration)) {
                    return {
                        data: cache.data,
                        fromCache: true,
                        cacheAge: Date.now() - cache.timestamp,
                        status: 'fallback',
                        error: 'Using cached data due to MikroTik connection failure'
                    };
                }
                
                // No cache available, return empty data
                return {
                    data: [],
                    fromCache: false,
                    status: 'error',
                    error: fetchError.message
                };
            }
        } catch (error) {
            console.error('[MIKROTIK_CACHE] Unexpected error:', error);
            return {
                data: [],
                fromCache: false,
                status: 'error',
                error: error.message
            };
        }
    }

    /**
     * Execute function with timeout
     * @param {Function} func - Function to execute
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise} Result or timeout error
     */
    fetchWithTimeout(func, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Operation timed out'));
            }, timeout);

            func()
                .then(result => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    /**
     * Read cache from file
     * @param {string} cacheFile - Path to cache file
     * @returns {Object|null} Cache data or null if not exists
     */
    readCache(cacheFile) {
        try {
            if (fs.existsSync(cacheFile)) {
                const data = fs.readFileSync(cacheFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('[MIKROTIK_CACHE] Error reading cache:', error);
        }
        return null;
    }

    /**
     * Save data to cache
     * @param {string} cacheFile - Path to cache file
     * @param {any} data - Data to cache
     */
    saveCache(cacheFile, data) {
        try {
            const cacheData = {
                timestamp: Date.now(),
                data: data
            };
            fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2));
        } catch (error) {
            console.error('[MIKROTIK_CACHE] Error saving cache:', error);
        }
    }

    /**
     * Check if cache is still valid
     * @param {Object} cache - Cache object with timestamp
     * @param {number} maxAge - Maximum age in milliseconds
     * @returns {boolean} True if cache is valid
     */
    isCacheValid(cache, maxAge) {
        if (!cache || !cache.timestamp) return false;
        return (Date.now() - cache.timestamp) < maxAge;
    }

    /**
     * Clear all cache files
     */
    clearCache() {
        try {
            if (fs.existsSync(this.pppCacheFile)) {
                fs.unlinkSync(this.pppCacheFile);
            }
            console.log('[MIKROTIK_CACHE] Cache cleared successfully');
        } catch (error) {
            console.error('[MIKROTIK_CACHE] Error clearing cache:', error);
        }
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        const stats = {
            pppCache: null
        };

        const pppCache = this.readCache(this.pppCacheFile);
        if (pppCache) {
            stats.pppCache = {
                age: Date.now() - pppCache.timestamp,
                size: pppCache.data ? pppCache.data.length : 0,
                isValid: this.isCacheValid(pppCache, this.cacheDuration),
                isFallbackValid: this.isCacheValid(pppCache, this.fallbackDuration)
            };
        }

        return stats;
    }
}

module.exports = new MikrotikCache();
