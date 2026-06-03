const jwt = require('jsonwebtoken');
const { getCustomerTokenVerifyOptions } = require('./customer-token');

/**
 * Middleware to ensure a customer is authenticated via a JWT Bearer token.
 * It verifies the token and attaches the full user object to req.customer.
 *
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The Express next middleware function.
 */
function apiAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        // No token provided
        return res.status(401).json({ status: 401, message: "Unauthorized: No token provided." });
    }

    jwt.verify(token, global.config.jwt, getCustomerTokenVerifyOptions(), (err, decoded) => {
        if (err) {
            // SECURITY: Don't reveal specific error type (invalid vs expired) to prevent information disclosure
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    status: 401, 
                    message: "Sesi Anda telah berakhir. Silakan login kembali." 
                });
            }
            // Token is invalid
            return res.status(401).json({ 
                status: 401, 
                message: "Token tidak valid. Silakan login kembali." 
            });
        }

        // SECURITY: Validate token payload structure
        if (!decoded || !decoded.id) {
            return res.status(401).json({ 
                status: 401, 
                message: "Token tidak valid. Silakan login kembali." 
            });
        }

        // Find the user associated with the token
        const user = global.users.find(u => String(u.id) === String(decoded.id));

        if (!user) {
            // User from a valid token does not exist in our system anymore
            return res.status(401).json({ 
                status: 401, 
                message: "Akun tidak ditemukan. Silakan login kembali." 
            });
        }

        // Attach user object to the request for subsequent middleware or route handlers
        req.customer = user;
        next();
    });
}

module.exports = {
    apiAuth
};
