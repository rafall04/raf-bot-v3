/**
 * Header Doc
 * Purpose: Menyediakan endpoint dashboard monitoring, health metrics, dan operasi restart service admin.
 * Caller: Panel monitoring web/admin.
 * Deps: `express`, service monitoring global, dan `../lib/whatsapp-bootstrap`.
 * MainFuncs: Endpoint metrics/status dan restart service termasuk reconnect WhatsApp.
 * SideEffects: Membaca status runtime monitoring dan dapat memicu reconnect layanan.
 */

const express = require('express');
const { triggerWhatsAppReconnect } = require('../lib/whatsapp-bootstrap');
const router = express.Router();

/**
 * Middleware to check admin authentication
 */
function requireAdmin(req, res, next) {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'owner')) {
        return res.status(403).json({ 
            status: 403, 
            message: 'Admin access required' 
        });
    }
    next();
}

/**
 * GET /api/monitoring/metrics
 * Get current system metrics
 */
router.get('/metrics', requireAdmin, async (req, res) => {
    try {
        if (!global.monitoring) {
            return res.status(503).json({
                status: 503,
                message: 'Monitoring service not available'
            });
        }
        
        const metrics = global.monitoring.getMetricsSnapshot();
        
        res.json({
            status: 200,
            data: metrics
        });
    } catch (error) {
        console.error('[MONITORING_API] Error fetching metrics:', error);
        res.status(500).json({
            status: 500,
            message: 'Failed to fetch metrics'
        });
    }
});

/**
 * GET /api/monitoring/health
 * Get system health status
 */
router.get('/health', requireAdmin, async (req, res) => {
    try {
        if (!global.monitoring) {
            return res.status(503).json({
                status: 503,
                message: 'Monitoring service not available'
            });
        }
        
        const health = await global.monitoring.healthCheck();
        
        res.json({
            status: 200,
            data: health
        });
    } catch (error) {
        console.error('[MONITORING_API] Error checking health:', error);
        res.status(500).json({
            status: 500,
            message: 'Failed to check health'
        });
    }
});

/**
 * GET /api/monitoring/history
 * Get metrics history
 */
router.get('/history', requireAdmin, async (req, res) => {
    try {
        if (!global.monitoring) {
            return res.status(503).json({
                status: 503,
                message: 'Monitoring service not available'
            });
        }
        
        const hours = parseInt(req.query.hours) || 24;
        const history = await global.monitoring.getMetricsHistory(hours);
        
        res.json({
            status: 200,
            data: history
        });
    } catch (error) {
        console.error('[MONITORING_API] Error fetching history:', error);
        res.status(500).json({
            status: 500,
            message: 'Failed to fetch history'
        });
    }
});

/**
 * GET /api/monitoring/errors
 * Get error statistics
 */
router.get('/errors', requireAdmin, async (req, res) => {
    try {
        if (!global.errorRecovery) {
            return res.status(503).json({
                status: 503,
                message: 'Error recovery service not available'
            });
        }
        
        const errorStats = global.errorRecovery.getErrorStats();
        
        res.json({
            status: 200,
            data: errorStats
        });
    } catch (error) {
        console.error('[MONITORING_API] Error fetching error stats:', error);
        res.status(500).json({
            status: 500,
            message: 'Failed to fetch error statistics'
        });
    }
});

/**
 * GET /api/monitoring/alerts
 * Get alert statistics
 */
router.get('/alerts', requireAdmin, async (req, res) => {
    try {
        if (!global.alertSystem) {
            return res.status(503).json({
                status: 503,
                message: 'Alert system not available'
            });
        }
        
        const alertStats = global.alertSystem.getAlertStats();
        
        res.json({
            status: 200,
            data: alertStats
        });
    } catch (error) {
        console.error('[MONITORING_API] Error fetching alert stats:', error);
        res.status(500).json({
            status: 500,
            message: 'Failed to fetch alert statistics'
        });
    }
});

/**
 * POST /api/monitoring/test-alert
 * Test the alert system
 */
router.post('/test-alert', requireAdmin, async (req, res) => {
    try {
        if (!global.alertSystem) {
            return res.status(503).json({
                status: 503,
                message: 'Alert system not available'
            });
        }
        
        const result = await global.alertSystem.testAlert();
        
        res.json({
            status: 200,
            message: 'Test alert sent',
            success: result
        });
    } catch (error) {
        console.error('[MONITORING_API] Error sending test alert:', error);
        res.status(500).json({
            status: 500,
            message: 'Failed to send test alert'
        });
    }
});

/**
 * POST /api/monitoring/clear-errors
 * Clear error logs
 */
router.post('/clear-errors', requireAdmin, async (req, res) => {
    try {
        if (!global.errorRecovery) {
            return res.status(503).json({
                status: 503,
                message: 'Error recovery service not available'
            });
        }
        
        // Clear error logs
        global.errorRecovery.errorLog = [];
        global.errorRecovery.retryAttempts.clear();
        
        res.json({
            status: 200,
            message: 'Error logs cleared'
        });
    } catch (error) {
        console.error('[MONITORING_API] Error clearing logs:', error);
        res.status(500).json({
            status: 500,
            message: 'Failed to clear error logs'
        });
    }
});

/**
 * POST /api/monitoring/restart-service
 * Restart a specific service
 */
router.post('/restart-service', requireAdmin, async (req, res) => {
    try {
        const { service } = req.body;
        
        if (!service) {
            return res.status(400).json({
                status: 400,
                message: 'Service name required'
            });
        }
        
        let success = false;
        
        switch(service) {
            case 'whatsapp':
                await triggerWhatsAppReconnect();
                success = true;
                break;
                
            case 'monitoring':
                if (global.monitoring) {
                    await global.monitoring.restart();
                    success = true;
                }
                break;
                
            case 'database':
                if (global.errorRecovery) {
                    success = await global.errorRecovery.resetDatabase();
                }
                break;
                
            default:
                return res.status(400).json({
                    status: 400,
                    message: 'Unknown service'
                });
        }
        
        res.json({
            status: 200,
            message: `Service ${service} restart initiated`,
            success
        });
    } catch (error) {
        console.error('[MONITORING_API] Error restarting service:', error);
        res.status(500).json({
            status: 500,
            message: 'Failed to restart service'
        });
    }
});

module.exports = router;
