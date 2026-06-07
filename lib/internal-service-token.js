/**
 * Header Doc
 * Purpose: Token layanan internal untuk panggilan server-to-server (Node -> endpoint `.php`
 *          aplikasi sendiri, mis. lib/mikrotik.js -> views/*.php) agar lolos guard auth `.php`
 *          TANPA cookie browser dan TANPA mengekspos JWT secret. Token = hash turunan JWT secret,
 *          sehingga hanya proses yang tahu JWT secret (server ini) yang bisa membuatnya.
 * Caller: lib/http-auth-bootstrap.js (verifikasi), lib/mikrotik.js (pengirim).
 * MainFuncs: getInternalServiceToken, verifyInternalServiceToken.
 * SideEffects: Tidak ada.
 */
"use strict";

const crypto = require("crypto");

const SALT = "php-internal-service:v1";
const INTERNAL_SERVICE_HEADER = "x-internal-service-token";

function getInternalServiceToken(jwtSecret) {
    return crypto.createHash("sha256").update(String(jwtSecret || "") + SALT).digest("hex");
}

function verifyInternalServiceToken(provided, jwtSecret) {
    if (typeof provided !== "string" || provided.length === 0) {
        return false;
    }
    const expected = getInternalServiceToken(jwtSecret);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
        return false;
    }
    return crypto.timingSafeEqual(a, b);
}

module.exports = {
    getInternalServiceToken,
    verifyInternalServiceToken,
    INTERNAL_SERVICE_HEADER,
};
