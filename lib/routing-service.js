/**
 * Routing Service
 * 
 * Service untuk mendapatkan route coordinates yang mengikuti jalan
 * menggunakan OpenRouteService API.
 * 
 * Features:
 * - Caching untuk mengurangi API calls
 * - Error handling dengan fallback ke straight line
 * - Support berbagai routing profiles
 */

const axios = require('axios');

// Config routing
const getRoutingConfig = () => {
    try {
        // Cek dari global config terlebih dahulu
        if (global.config && global.config.openRouteService) {
            return global.config.openRouteService;
        }
        
        // Fallback ke env variable
        const apiKey = process.env.OPENROUTE_SERVICE_API_KEY;
        if (apiKey) {
            return {
                apiKey: apiKey,
                enabled: true,
                baseUrl: 'https://api.openrouteservice.org/v2/directions',
                timeout: 5000, // 5 seconds timeout
                cacheDuration: 24 * 60 * 60 * 1000 // 24 jam
            };
        }
        
        // Default config (disabled)
        return {
            apiKey: null,
            enabled: false,
            baseUrl: 'https://api.openrouteservice.org/v2/directions',
            timeout: 5000,
            cacheDuration: 24 * 60 * 60 * 1000
        };
    } catch (error) {
        console.error('[ROUTING_SERVICE] Error loading config:', error);
        return {
            apiKey: null,
            enabled: false,
            baseUrl: 'https://api.openrouteservice.org/v2/directions',
            timeout: 5000,
            cacheDuration: 24 * 60 * 60 * 1000
        };
    }
};

// In-memory cache untuk route results
const routeCache = new Map();

/**
 * Cleanup expired cache entries (run setiap 1 jam)
 */
function cleanupExpiredCache() {
    const now = Date.now();
    const config = getRoutingConfig();
    const cacheDuration = config.cacheDuration || (24 * 60 * 60 * 1000);
    
    let cleanedCount = 0;
    for (const [key, value] of routeCache.entries()) {
        if (now - value.timestamp > cacheDuration) {
            routeCache.delete(key);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`[ROUTING_SERVICE] Cleaned up ${cleanedCount} expired cache entries.`);
    }
}

// Jalankan cleanup setiap 1 jam
setInterval(cleanupExpiredCache, 60 * 60 * 1000);

/**
 * Generate cache key untuk route
 * @param {number} startLat 
 * @param {number} startLng 
 * @param {number} endLat 
 * @param {number} endLng 
 * @param {string} profile 
 * @returns {string} Cache key
 */
function generateCacheKey(startLat, startLng, endLat, endLng, profile) {
    // Round coordinates untuk cache key (precision 5 decimal = ~1 meter)
    const precision = 5;
    const roundedStartLat = parseFloat(startLat.toFixed(precision));
    const roundedStartLng = parseFloat(startLng.toFixed(precision));
    const roundedEndLat = parseFloat(endLat.toFixed(precision));
    const roundedEndLng = parseFloat(endLng.toFixed(precision));
    
    return `${roundedStartLat},${roundedStartLng}-${roundedEndLat},${roundedEndLng}-${profile}`;
}

/**
 * Convert coordinates dari OpenRouteService format [lng, lat] ke Leaflet format [lat, lng]
 * @param {Array<Array<number>>} coordinates - Array of [lng, lat] coordinates
 * @returns {Array<Array<number>>} Array of [lat, lng] coordinates
 */
function convertCoordinatesToLeafletFormat(coordinates) {
    if (!Array.isArray(coordinates)) {
        return [];
    }
    
    return coordinates.map(coord => {
        if (Array.isArray(coord) && coord.length >= 2) {
            // OpenRouteService: [lng, lat]
            // Leaflet: [lat, lng]
            return [coord[1], coord[0]];
        }
        return coord;
    });
}

/**
 * Get route coordinates dari OpenRouteService API
 * @param {number} startLat - Latitude titik awal
 * @param {number} startLng - Longitude titik awal
 * @param {number} endLat - Latitude titik akhir
 * @param {number} endLng - Longitude titik akhir
 * @param {string} profile - Routing profile (default: 'driving-car')
 * @returns {Promise<Array<Array<number>>>} Array of [lat, lng] coordinates untuk Leaflet
 */
async function getRoute(startLat, startLng, endLat, endLng, profile = 'driving-car') {
    // Validasi input
    if (typeof startLat !== 'number' || typeof startLng !== 'number' || 
        typeof endLat !== 'number' || typeof endLng !== 'number') {
        console.warn('[ROUTING_SERVICE] Invalid coordinates, returning straight line');
        return [[startLat, startLng], [endLat, endLng]];
    }
    
    // Validasi koordinat (Indonesia range: lat -11 to 6, lng 95 to 141)
    if (startLat < -90 || startLat > 90 || startLng < -180 || startLng > 180 ||
        endLat < -90 || endLat > 90 || endLng < -180 || endLng > 180) {
        console.warn('[ROUTING_SERVICE] Coordinates out of valid range, returning straight line');
        return [[startLat, startLng], [endLat, endLng]];
    }
    
    // Get config
    const config = getRoutingConfig();
    
    // Jika routing disabled atau tidak ada API key, fallback ke straight line
    if (!config.enabled || !config.apiKey) {
        // Log warning hanya sekali untuk menghindari spam console
        if (!routeCache.has('_routing_disabled_warning')) {
            console.warn('[ROUTING_SERVICE] Routing disabled atau tidak ada API key. Garis akan menggunakan straight line.');
            console.warn('[ROUTING_SERVICE] Untuk mengaktifkan routing, set OPENROUTE_SERVICE_API_KEY di .env atau enable di config.json');
            routeCache.set('_routing_disabled_warning', { timestamp: Date.now() });
        }
        return [[startLat, startLng], [endLat, endLng]];
    }
    
    // Generate cache key
    const cacheKey = generateCacheKey(startLat, startLng, endLat, endLng, profile);
    
    // Check cache
    const cached = routeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < config.cacheDuration) {
        return cached.coordinates;
    }
    
    try {
        // Request route dari OpenRouteService
        const response = await axios.get(`${config.baseUrl}/${profile}`, {
            params: {
                api_key: config.apiKey,
                start: `${startLng},${startLat}`, // OpenRouteService format: lng,lat
                end: `${endLng},${endLat}`       // OpenRouteService format: lng,lat
            },
            timeout: config.timeout || 5000,
            headers: {
                'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8'
            }
        });
        
        // Parse response
        if (response.data && response.data.features && response.data.features.length > 0) {
            const feature = response.data.features[0];
            
            if (feature.geometry && feature.geometry.coordinates && Array.isArray(feature.geometry.coordinates)) {
                const coordinates = feature.geometry.coordinates;
                
                // Convert dari [lng, lat] ke [lat, lng] untuk Leaflet
                const leafletCoordinates = convertCoordinatesToLeafletFormat(coordinates);
                
                // Validasi hasil konversi
                if (leafletCoordinates.length >= 2) {
                    // Save to cache
                    routeCache.set(cacheKey, {
                        coordinates: leafletCoordinates,
                        timestamp: Date.now()
                    });
                    
                    return leafletCoordinates;
                }
            }
        }
        
        // Jika response tidak valid, fallback ke straight line
        console.warn('[ROUTING_SERVICE] Invalid response format, returning straight line');
        return [[startLat, startLng], [endLat, endLng]];
        
    } catch (error) {
        // Error handling dengan fallback ke straight line
        if (error.response) {
            // API responded with error status
            console.error('[ROUTING_SERVICE] API error:', {
                status: error.response.status,
                message: error.response.statusText,
                data: error.response.data
            });
        } else if (error.request) {
            // Network error atau timeout
            console.error('[ROUTING_SERVICE] Network error or timeout:', error.message);
        } else {
            // Other error
            console.error('[ROUTING_SERVICE] Error:', error.message);
        }
        
        // Fallback ke straight line
        return [[startLat, startLng], [endLat, endLng]];
    }
}

/**
 * Get route untuk multiple points (future enhancement)
 * @param {Array<Array<number>>} points - Array of [lat, lng] coordinates
 * @param {string} profile - Routing profile
 * @returns {Promise<Array<Array<number>>>} Combined route coordinates
 */
async function getRouteForMultiplePoints(points, profile = 'driving-car') {
    if (!Array.isArray(points) || points.length < 2) {
        return [];
    }
    
    const routeSegments = [];
    
    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        
        const segment = await getRoute(
            start[0], // lat
            start[1], // lng
            end[0],   // lat
            end[1],   // lng
            profile
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
 * Clear cache (untuk testing atau manual cleanup)
 */
function clearCache() {
    const count = routeCache.size;
    routeCache.clear();
    console.log(`[ROUTING_SERVICE] Cache cleared. Removed ${count} entries.`);
}

/**
 * Get cache statistics (untuk monitoring)
 * @returns {Object} Cache statistics
 */
function getCacheStats() {
    const now = Date.now();
    const config = getRoutingConfig();
    const cacheDuration = config.cacheDuration || (24 * 60 * 60 * 1000);
    
    let validEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, value] of routeCache.entries()) {
        if (now - value.timestamp < cacheDuration) {
            validEntries++;
        } else {
            expiredEntries++;
        }
    }
    
    return {
        total: routeCache.size,
        valid: validEntries,
        expired: expiredEntries,
        cacheDurationMs: cacheDuration,
        cacheDurationHours: Math.round(cacheDuration / (60 * 60 * 1000) * 100) / 100
    };
}

/**
 * Check if routing service is enabled
 * @returns {boolean} True jika routing enabled
 */
function isEnabled() {
    const config = getRoutingConfig();
    return config.enabled === true && config.apiKey && config.apiKey.trim() !== '';
}

module.exports = {
    getRoute,
    getRouteForMultiplePoints,
    clearCache,
    getCacheStats,
    isEnabled
};

