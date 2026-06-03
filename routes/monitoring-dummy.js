/**
 * Dummy Monitoring Data for Testing
 * Returns realistic monitoring data without actual MikroTik connection
 */

const express = require('express');
const router = express.Router();

// Generate realistic random data
function getRandomInRange(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * GET /api/monitoring/live-data
 * Returns live monitoring data for dashboard
 */
router.get('/live-data', (req, res) => {
    const now = new Date();
    
    res.json({
        status: 200,
        data: {
            systemHealth: {
                score: getRandomInRange(85, 100),
                status: 'healthy',
                checks: {
                    whatsapp: true,
                    mikrotik: true,
                    database: true,
                    api: true
                }
            },
            whatsapp: {
                connected: true,
                uptime: '4h 23m',
                messagesProcessed: getRandomInRange(150, 200),
                queueSize: getRandomInRange(0, 5)
            },
            mikrotik: {
                cpu: getRandomInRange(15, 45),
                temperature: getRandomInRange(45, 65),
                memory: getRandomInRange(30, 60),
                disk: getRandomInRange(20, 40),
                interfaces: {
                    wan: {
                        rxRate: getRandomInRange(10, 50) * 1024 * 1024, // in bits
                        txRate: getRandomInRange(5, 30) * 1024 * 1024   // in bits
                    }
                }
            },
            traffic: {
                download: {
                    current: getRandomInRange(10, 80), // Mbps
                    total: getRandomInRange(100, 500)  // GB
                },
                upload: {
                    current: getRandomInRange(5, 40),   // Mbps
                    total: getRandomInRange(50, 250)    // GB
                }
            },
            alerts: {
                active: getRandomInRange(0, 3),
                recent: [
                    { 
                        level: 'warning', 
                        message: 'CPU usage above 80%',
                        time: new Date(now - 600000).toISOString()
                    }
                ]
            },
            users: {
                hotspot: {
                    active: getRandomInRange(10, 30),
                    total: 45
                },
                pppoe: {
                    active: getRandomInRange(20, 50),
                    total: 75
                }
            },
            resources: {
                cpu: getRandomInRange(20, 60),
                memory: getRandomInRange(40, 70),
                disk: getRandomInRange(30, 50),
                messageQueue: getRandomInRange(0, 10)
            },
            timestamp: now.toISOString()
        }
    });
});

/**
 * GET /api/monitoring/traffic-history
 * Returns traffic history data for charts
 */
router.get('/traffic-history', (req, res) => {
    const points = 20;
    const history = [];
    const now = Date.now();
    
    for (let i = points - 1; i >= 0; i--) {
        history.push({
            time: new Date(now - (i * 60000)).toISOString(),
            download: getRandomInRange(10, 80),
            upload: getRandomInRange(5, 40)
        });
    }
    
    res.json({
        status: 200,
        data: history
    });
});

/**
 * WebSocket simulation for real-time updates
 */
router.get('/ws-test', (req, res) => {
    res.json({
        status: 200,
        message: 'WebSocket endpoint active',
        url: 'ws://localhost:3100'
    });
});

module.exports = router;
