/**
 * Monitoring API Routes
 * Handles all monitoring-related API endpoints
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const { exec } = require('child_process');
const { getActivePPPoEUsers, getActiveHotspotUsers } = require('../lib/mikrotik');

const ACTIVE_USERS_CACHE_TTL_MS = 5000;
const ACTIVE_USERS_STALE_TTL_MS = 30000;
const activeUsersCache = new Map();

/**
 * Helper function to execute PHP files
 */
function executePHP(phpFile, req, res) {
    const phpPath = path.join(__dirname, '..', 'views', phpFile);
    
    // Build query string WITHOUT the leading '?' - PHP parse_str doesn't need it
    const queryString = Object.keys(req.query).length > 0 
        ? new URLSearchParams(req.query).toString() 
        : '';
    
    // Debug log (comment out after testing)
    // console.log(`[Monitoring API] Executing ${phpFile} with QUERY_STRING: "${queryString}"`);
    
    // Execute PHP file
    exec(`php "${phpPath}"`, {
        env: {
            ...process.env,
            QUERY_STRING: queryString,
            REQUEST_METHOD: req.method,
            CONTENT_TYPE: req.get('Content-Type') || '',
            HTTP_HOST: req.get('Host') || 'localhost'
        }
    }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Monitoring API] Error executing ${phpFile}:`, error);
            return res.status(500).json({
                status: 500,
                message: 'Internal server error',
                error: error.message
            });
        }
        
        // Only log actual PHP errors, filter out debug logs
        if (stderr && !stderr.includes('[API]')) {
            console.error(`[PHP Error]:`, stderr);
        }
        
        try {
            // Try to parse as JSON
            const data = JSON.parse(stdout);
            res.json(data);
        } catch (parseError) {
            // If not JSON, return as text
            res.send(stdout);
        }
    });
}

function readActiveUsersCache(key) {
    const cacheEntry = activeUsersCache.get(key);
    if (!cacheEntry) {
        return null;
    }

    return {
        ...cacheEntry,
        ageMs: Date.now() - cacheEntry.timestamp,
    };
}

function buildActiveUsersPayload({
    ok,
    sessions,
    message,
    errorCode = null,
    timingMs = 0,
    fromCache = false,
    stale = false,
    lastUpdatedAt = null,
}) {
    return {
        status: ok ? 200 : 503,
        ok,
        message,
        data: { sessions },
        errorCode,
        timingMs,
        fromCache,
        stale,
        last_updated_at: lastUpdatedAt,
    };
}

async function respondWithActiveUsers(req, res, key, fetcher, successMessage) {
    const startedAt = Date.now();
    const cached = readActiveUsersCache(key);
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1';

    if (!forceRefresh && cached && cached.ageMs <= ACTIVE_USERS_CACHE_TTL_MS) {
        return res.status(200).json(buildActiveUsersPayload({
            ok: true,
            sessions: cached.sessions,
            message: successMessage,
            timingMs: Date.now() - startedAt,
            fromCache: true,
            stale: false,
            lastUpdatedAt: cached.lastUpdatedAt,
        }));
    }

    const result = await fetcher({
        caller: `monitoring.${key}`,
        path: req.path,
    });

    if (result.ok === true) {
        const sessions = Array.isArray(result.data) ? result.data : [];
        const lastUpdatedAt = new Date().toISOString();

        activeUsersCache.set(key, {
            sessions,
            timestamp: Date.now(),
            lastUpdatedAt,
        });

        return res.status(200).json(buildActiveUsersPayload({
            ok: true,
            sessions,
            message: successMessage,
            timingMs: result.timingMs || (Date.now() - startedAt),
            fromCache: false,
            stale: false,
            lastUpdatedAt,
        }));
    }

    if (cached && cached.ageMs <= ACTIVE_USERS_STALE_TTL_MS) {
        return res.status(200).json(buildActiveUsersPayload({
            ok: true,
            sessions: cached.sessions,
            message: 'Menampilkan cache terbaru karena router lambat/tidak merespons.',
            errorCode: result.errorCode || null,
            timingMs: Date.now() - startedAt,
            fromCache: true,
            stale: true,
            lastUpdatedAt: cached.lastUpdatedAt,
        }));
    }

    return res.status(503).json(buildActiveUsersPayload({
        ok: false,
        sessions: [],
        message: result.message || 'Data user aktif tidak tersedia saat ini.',
        errorCode: result.errorCode || 'COMMAND_ERROR',
        timingMs: result.timingMs || (Date.now() - startedAt),
        fromCache: false,
        stale: false,
        lastUpdatedAt: null,
    }));
}

/**
 * GET /api/monitoring/live
 * Main live data endpoint
 */
router.get('/live', (req, res) => {
    executePHP('api-monitoring-live.php', req, res);
});

router.get('/pppoe-active-users', async (req, res) => {
    await respondWithActiveUsers(
        req,
        res,
        'pppoe-active-users',
        getActivePPPoEUsers,
        'Data PPPoE aktif berhasil diambil.'
    );
});

router.get('/hotspot-active-users', async (req, res) => {
    await respondWithActiveUsers(
        req,
        res,
        'hotspot-active-users',
        getActiveHotspotUsers,
        'Data hotspot aktif berhasil diambil.'
    );
});

/**
 * GET /api/monitoring/health
 * System health endpoint
 */
router.get('/health', (req, res) => {
    executePHP('api-system-health.php', req, res);
});

/**
 * GET /api/monitoring/traffic
 * Traffic statistics endpoint
 */
router.get('/traffic', (req, res) => {
    executePHP('api-traffic-stats.php', req, res);
});

/**
 * GET /api/monitoring/users
 * Users statistics endpoint
 */
router.get('/users', (req, res) => {
    executePHP('api-users-stats.php', req, res);
});

/**
 * GET /api/monitoring/history
 * Traffic history for charts
 */
router.get('/history', (req, res) => {
    executePHP('api-traffic-history.php', req, res);
});

/**
 * Backward compatibility endpoints
 */
router.get('/live-data', (req, res) => {
    executePHP('api-monitoring-live.php', req, res);
});

router.get('/traffic-history', (req, res) => {
    executePHP('api-traffic-history.php', req, res);
});

module.exports = router;
