/**
 * PSB Helper Functions
 * Helper functions untuk halaman PSB (Pasang Baru)
 */

/**
 * Parse Google Maps link untuk extract koordinat
 * Support format:
 * - https://maps.google.com/?q=lat,lng
 * - https://www.google.com/maps/place/.../@lat,lng
 * - https://maps.google.com/maps?q=lat,lng
 * @param {string} url - Google Maps URL
 * @returns {Object|null} - { latitude: number, longitude: number } atau null jika invalid
 */
function parseGoogleMapsLink(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }
    
    try {
        // Format 1: https://maps.google.com/?q=lat,lng atau https://maps.google.com/maps?q=lat,lng
        const qMatch = url.match(/[?&]q=([^&]+)/);
        if (qMatch) {
            const coords = qMatch[1].split(',');
            if (coords.length === 2) {
                const lat = parseFloat(coords[0].trim());
                const lng = parseFloat(coords[1].trim());
                if (!isNaN(lat) && !isNaN(lng) && 
                    lat >= -90 && lat <= 90 && 
                    lng >= -180 && lng <= 180) {
                    return { latitude: lat, longitude: lng };
                }
            }
        }
        
        // Format 2: https://www.google.com/maps/place/.../@lat,lng,zoom
        const placeMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (placeMatch) {
            const lat = parseFloat(placeMatch[1]);
            const lng = parseFloat(placeMatch[2]);
            if (!isNaN(lat) && !isNaN(lng) && 
                lat >= -90 && lat <= 90 && 
                lng >= -180 && lng <= 180) {
                return { latitude: lat, longitude: lng };
            }
        }
        
        // Format 3: https://maps.google.com/?ll=lat,lng
        const llMatch = url.match(/[?&]ll=([^&]+)/);
        if (llMatch) {
            const coords = llMatch[1].split(',');
            if (coords.length === 2) {
                const lat = parseFloat(coords[0].trim());
                const lng = parseFloat(coords[1].trim());
                if (!isNaN(lat) && !isNaN(lng) && 
                    lat >= -90 && lat <= 90 && 
                    lng >= -180 && lng <= 180) {
                    return { latitude: lat, longitude: lng };
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('[PARSE_GOOGLE_MAPS_ERROR]', error);
        return null;
    }
}

/**
 * Generate random password untuk PPPoE
 * @param {number} length - Panjang password (default: 12)
 * @returns {string} - Random password
 */
function generateRandomPassword(length = 12) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

/**
 * Validate koordinat
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {boolean} - True jika valid
 */
function validateCoordinates(latitude, longitude) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return false;
    }
    if (isNaN(latitude) || isNaN(longitude)) {
        return false;
    }
    if (latitude < -90 || latitude > 90) {
        return false;
    }
    if (longitude < -180 || longitude > 180) {
        return false;
    }
    return true;
}

/**
 * Generate Google Maps URL dari koordinat
 * @param {number} latitude - Latitude
 * @param {number} longitude - Longitude
 * @returns {string} - Google Maps URL
 */
function generateGoogleMapsUrl(latitude, longitude) {
    if (!validateCoordinates(latitude, longitude)) {
        return null;
    }
    return `https://maps.google.com/?q=${latitude},${longitude}`;
}

module.exports = {
    parseGoogleMapsLink,
    generateRandomPassword,
    validateCoordinates,
    generateGoogleMapsUrl
};

