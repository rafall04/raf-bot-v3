/**
 * Map Routing Helper
 * 
 * Helper functions untuk mendapatkan route coordinates yang mengikuti jalan
 * menggunakan backend API routing service.
 * 
 * Features:
 * - Request route dari backend API
 * - Error handling dengan fallback ke straight line
 * - Support berbagai routing profiles
 * - Caching di frontend untuk mengurangi API calls
 */

// Frontend cache untuk route results (optional, untuk mengurangi API calls lebih lanjut)
const routeCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 jam

/**
 * Cleanup expired cache entries (run setiap 1 jam)
 */
function cleanupExpiredRouteCache() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, value] of routeCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            routeCache.delete(key);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`[MAP_ROUTING_HELPER] Cleaned up ${cleanedCount} expired cache entries.`);
    }
}

// Jalankan cleanup setiap 1 jam
setInterval(cleanupExpiredRouteCache, 60 * 60 * 1000);

/**
 * Generate cache key untuk route
 * @param {number} startLat 
 * @param {number} startLng 
 * @param {number} endLat 
 * @param {number} endLng 
 * @param {string} profile 
 * @returns {string} Cache key
 */
function generateRouteCacheKey(startLat, startLng, endLat, endLng, profile) {
    // Round coordinates untuk cache key (precision 5 decimal = ~1 meter)
    const precision = 5;
    const roundedStartLat = parseFloat(startLat.toFixed(precision));
    const roundedStartLng = parseFloat(startLng.toFixed(precision));
    const roundedEndLat = parseFloat(endLat.toFixed(precision));
    const roundedEndLng = parseFloat(endLng.toFixed(precision));
    
    return `${roundedStartLat},${roundedStartLng}-${roundedEndLat},${roundedEndLng}-${profile}`;
}

/**
 * Get route coordinates dari backend API
 * 
 * @param {number} startLat - Latitude titik awal
 * @param {number} startLng - Longitude titik awal
 * @param {number} endLat - Latitude titik akhir
 * @param {number} endLng - Longitude titik akhir
 * @param {string} profile - Routing profile (default: 'driving-car')
 * @param {Object} options - Optional options
 * @param {boolean} options.useCache - Gunakan frontend cache (default: true)
 * @param {number} options.timeout - Request timeout dalam milliseconds (default: 10000)
 * @returns {Promise<Array<Array<number>>>} Array of [lat, lng] coordinates untuk Leaflet
 */
async function getRouteCoordinates(startLat, startLng, endLat, endLng, profile = 'driving-car', options = {}) {
    const {
        useCache = true,
        timeout = 10000
    } = options;
    
    // Validasi input
    if (typeof startLat !== 'number' || typeof startLng !== 'number' || 
        typeof endLat !== 'number' || typeof endLng !== 'number') {
        console.warn('[MAP_ROUTING_HELPER] Invalid coordinates, returning straight line');
        return [[startLat, startLng], [endLat, endLng]];
    }
    
    // Validasi koordinat range
    if (startLat < -90 || startLat > 90 || startLng < -180 || startLng > 180 ||
        endLat < -90 || endLat > 90 || endLng < -180 || endLng > 180) {
        console.warn('[MAP_ROUTING_HELPER] Coordinates out of valid range, returning straight line');
        return [[startLat, startLng], [endLat, endLng]];
    }
    
    // Generate cache key
    const cacheKey = generateRouteCacheKey(startLat, startLng, endLat, endLng, profile);
    
    // Check frontend cache jika enabled
    if (useCache) {
        const cached = routeCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.coordinates;
        }
    }
    
    try {
        // Request route dari backend API
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch('/api/map/route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                startLat,
                startLng,
                endLat,
                endLng,
                profile
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Handle HTTP errors
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: response.statusText }));
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        
        // Parse response
        const result = await response.json();
        
        // Validasi response format
        if (result.status === 200 && result.data && result.data.coordinates && Array.isArray(result.data.coordinates)) {
            const coordinates = result.data.coordinates;
            
            // Validasi koordinat format
            if (coordinates.length >= 2) {
                // Save to frontend cache jika enabled
                if (useCache) {
                    routeCache.set(cacheKey, {
                        coordinates: coordinates,
                        timestamp: Date.now()
                    });
                }
                
                return coordinates;
            }
        }
        
        // Jika response tidak valid, fallback ke straight line
        console.warn('[MAP_ROUTING_HELPER] Invalid response format, returning straight line');
        return [[startLat, startLng], [endLat, endLng]];
        
    } catch (error) {
        // Error handling dengan fallback ke straight line
        if (error.name === 'AbortError') {
            console.error('[MAP_ROUTING_HELPER] Request timeout, returning straight line');
        } else if (error.message && error.message.includes('Failed to fetch')) {
            console.error('[MAP_ROUTING_HELPER] Network error, returning straight line:', error.message);
        } else {
            console.error('[MAP_ROUTING_HELPER] Error getting route:', error.message || error);
        }
        
        // Fallback ke straight line
        return [[startLat, startLng], [endLat, endLng]];
    }
}

/**
 * Get route coordinates untuk multiple points (future enhancement)
 * @param {Array<Array<number>>} points - Array of [lat, lng] coordinates
 * @param {string} profile - Routing profile
 * @param {Object} options - Optional options
 * @returns {Promise<Array<Array<number>>>} Combined route coordinates
 */
async function getRouteCoordinatesForMultiplePoints(points, profile = 'driving-car', options = {}) {
    if (!Array.isArray(points) || points.length < 2) {
        return [];
    }
    
    const routeSegments = [];
    
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        
        const segment = await getRouteCoordinates(
            start[0], // lat
            start[1], // lng
            end[0],   // lat
            end[1],   // lng
            profile,
            options
        );
        
        // Gabungkan segment (hilangkan titik akhir segment pertama untuk menghindari duplikasi)
        if (i === 0) {
            routeSegments.push(...segment);
        } else {
            routeSegments.push(...segment.slice(1)); // Skip first point (sama dengan last point previous segment)
        }
    }
    
    return routeSegments;
}

/**
 * Clear frontend cache (untuk testing atau manual cleanup)
 */
function clearRouteCache() {
    const count = routeCache.size;
    routeCache.clear();
    console.log(`[MAP_ROUTING_HELPER] Frontend cache cleared. Removed ${count} entries.`);
}

/**
 * Get cache statistics (untuk monitoring)
 * @returns {Object} Cache statistics
 */
function getRouteCacheStats() {
    const now = Date.now();
    
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, value] of routeCache.entries()) {
        if (now - value.timestamp < CACHE_DURATION) {
            validEntries++;
        } else {
            expiredEntries++;
        }
    }
    
    return {
        total: routeCache.size,
        valid: validEntries,
        expired: expiredEntries,
        cacheDurationMs: CACHE_DURATION,
        cacheDurationHours: Math.round(CACHE_DURATION / (60 * 60 * 1000) * 100) / 100
    };
}

/**
 * Check if routing is enabled (via API)
 * @returns {Promise<boolean>} True jika routing enabled
 */
async function isRoutingEnabled() {
    try {
        // Try to get a route (very short distance, will be cached)
        // Or we can create a separate endpoint for status check
        // For now, we'll assume it's enabled if API responds
        const response = await fetch('/api/map/route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                startLat: -7.2430309,
                startLng: 111.846867,
                endLat: -7.2430309,
                endLng: 111.846867,
                profile: 'driving-car'
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            return result.data && result.data.enabled === true;
        }
        
        return false;
    } catch (error) {
        console.warn('[MAP_ROUTING_HELPER] Error checking routing status:', error);
        return false;
    }
}

// Export functions untuk digunakan di map viewer
// Jika digunakan sebagai module (ES6), gunakan export
// Jika digunakan sebagai script tag, function akan tersedia secara global
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getRouteCoordinates,
        getRouteCoordinatesForMultiplePoints,
        clearRouteCache,
        getRouteCacheStats,
        isRoutingEnabled
    };
}

