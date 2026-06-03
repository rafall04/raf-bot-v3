/**
 * HTTPS Enforcement Middleware
 * 
 * Memastikan semua request di production menggunakan HTTPS.
 * Redirect HTTP ke HTTPS untuk keamanan.
 */

/**
 * Middleware untuk enforce HTTPS di production
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function enforceHTTPS(req, res, next) {
    // Skip HTTPS enforcement di development
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }

    // Skip HTTPS enforcement untuk localhost (development/testing)
    const hostname = req.hostname || req.header('host') || '';
    const isLocalhost = 
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.startsWith('localhost:') ||
        hostname.startsWith('127.0.0.1:') ||
        hostname.startsWith('[::1]:');

    if (isLocalhost) {
        return next();
    }

    // Check if request is already HTTPS
    // Support untuk reverse proxy (Nginx, Apache, Cloudflare, dll.)
    const isHTTPS = 
        req.secure || // Direct HTTPS connection
        req.header('x-forwarded-proto') === 'https' || // Behind reverse proxy
        req.header('x-forwarded-ssl') === 'on'; // Alternative header

    if (isHTTPS) {
        return next();
    }

    // Redirect HTTP ke HTTPS
    const host = req.header('host') || req.hostname;
    const url = req.originalUrl || req.url;
    const httpsUrl = `https://${host}${url}`;

    // 301 Permanent Redirect
    return res.redirect(301, httpsUrl);
}

module.exports = enforceHTTPS;

