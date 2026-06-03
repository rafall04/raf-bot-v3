function ensureAuthenticated(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ status: 401, message: 'Unauthorized' });
    }

    next();
}

function ensureAdmin(req, res, next) {
    if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
        return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
    }

    next();
}

function ensureAuthenticatedStaff(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ status: 401, message: 'Unauthorized' });
    }

    if (!['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
        return res.status(403).json({
            status: 403,
            message: 'Akses ditolak. Hanya teknisi dan admin yang dapat mengakses.'
        });
    }

    next();
}

function normalizeQueryStringParam(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const rawValue = Array.isArray(value) ? value[0] : value;
    const normalized = String(rawValue).trim();
    return normalized || null;
}

function redactPppoeFilter(value) {
    if (!value) {
        return null;
    }

    if (value.length <= 4) {
        return `${value[0]}***`;
    }

    return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function buildMikrotikSyncResult(status, message, extra = {}) {
    return {
        status,
        message,
        ...extra,
    };
}

module.exports = {
    ensureAuthenticated,
    ensureAdmin,
    ensureAuthenticatedStaff,
    normalizeQueryStringParam,
    redactPppoeFilter,
    buildMikrotikSyncResult,
};
