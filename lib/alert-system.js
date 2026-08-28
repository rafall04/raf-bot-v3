/**
 * Header Doc
 * Purpose: Mengelola alert sistem, histori notifikasi, dan pengiriman pemberitahuan admin.
 * Caller: Monitoring runtime, watchdog internal, dan alur error handling aplikasi.
 * Deps: `fs-extra`, `path`, `./whatsapp-delivery-service`, `./whatsapp-gateway`, dan `./template-service`.
 * MainFuncs: `AlertSystem` dan metode internal queue/notifikasi admin.
 * SideEffects: Menulis histori alert dan mengirim notifikasi WhatsApp ke admin.
 */

const fs = require('fs-extra');
const path = require('path');
const { sendMessage } = require('./whatsapp-delivery-service');
const { hasAuthenticatedSession, isReady } = require('./whatsapp-gateway');
const { renderResponseTemplateSafe } = require('./template-service');

function renderResponseTemplate(key, data = {}) {
    // Jaring pengaman terpusat (#b302): buang ${slot} tak terisi + peringatkan, jangan bocor mentah.
    return renderResponseTemplateSafe(key, data);
}

class AlertSystem {
    constructor() {
        this.alertQueue = [];
        this.rateLimiter = new Map();
        this.alertHistory = [];
        this.maxHistorySize = 1000;
        this.alertCooldowns = new Map();
        
        // Alert configurations
        this.config = {
            rateLimits: {
                info: { max: 10, window: 3600000 },      // 10 per hour
                warning: { max: 5, window: 3600000 },     // 5 per hour
                error: { max: 3, window: 3600000 },       // 3 per hour
                critical: { max: 10, window: 3600000 }     // 10 per hour (no real limit for critical)
            },
            cooldowns: {
                ERROR_SPIKE: 600000,         // 10 minutes
                HIGH_CPU: 300000,            // 5 minutes
                HIGH_MEMORY: 300000,         // 5 minutes
                WHATSAPP_DISCONNECTED: 60000, // 1 minute
                WHATSAPP_LOGGED_OUT: 300000, // 5 minutes
                DATABASE_ERROR: 300000,       // 5 minutes
                QUEUE_BACKLOG: 600000        // 10 minutes
            },
            priorities: {
                info: 1,
                warning: 2,
                error: 3,
                critical: 4
            }
        };
        
        // Alert templates
        this.templates = this.loadTemplates();
        
        // Initialize alert log
        this.alertLogPath = path.join(__dirname, '../logs/alerts.log');
        this.ensureLogDirectory();
    }
    
    /**
     * Load alert message templates
     */
    loadTemplates() {
        return {
            ERROR_SPIKE: {
                icon: '📈',
                titleKey: 'alert_system_title_error_spike',
                templateKey: 'alert_system_detail_error_spike'
            },
            HIGH_CPU: {
                icon: '🔥',
                titleKey: 'alert_system_title_high_cpu',
                templateKey: 'alert_system_detail_high_cpu'
            },
            HIGH_MEMORY: {
                icon: '💾',
                titleKey: 'alert_system_title_high_memory',
                templateKey: 'alert_system_detail_high_memory'
            },
            WHATSAPP_DISCONNECTED: {
                icon: '📱',
                titleKey: 'alert_system_title_whatsapp_disconnected',
                templateKey: 'alert_system_detail_whatsapp_disconnected'
            },
            WHATSAPP_LOGGED_OUT: {
                icon: '📵',
                titleKey: 'alert_system_title_whatsapp_logged_out',
                templateKey: 'alert_system_detail_whatsapp_logged_out'
            },
            DATABASE_ERROR: {
                icon: '🗄️',
                titleKey: 'alert_system_title_database_error',
                templateKey: 'alert_system_detail_database_error'
            },
            QUEUE_BACKLOG: {
                icon: '📬',
                titleKey: 'alert_system_title_queue_backlog',
                templateKey: 'alert_system_detail_queue_backlog'
            },
            SERVICE_RECOVERED: {
                icon: '✅',
                titleKey: 'alert_system_title_service_recovered',
                templateKey: 'alert_system_detail_service_recovered'
            },
            DAILY_REPORT: {
                icon: '📊',
                titleKey: 'alert_system_title_daily_report',
                templateKey: 'alert_system_detail_daily_report'
            },
            HEALTH_WARNING: {
                icon: '⚠️',
                titleKey: 'alert_system_title_health_warning',
                templateKey: 'alert_system_detail_health_warning'
            },
            CRITICAL_ERROR: {
                icon: '🚨',
                titleKey: 'alert_system_title_critical_error',
                templateKey: 'alert_system_detail_critical_error'
            }
        };
    }
    
    /**
     * Ensure log directory exists
     */
    ensureLogDirectory() {
        const logsDir = path.dirname(this.alertLogPath);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
    }
    
    /**
     * Send alert
     */
    async sendAlert(level, type, details = {}) {
        try {
            // Check if alert is in cooldown
            if (this.isInCooldown(type)) {
                console.log(`[ALERT] ${type} is in cooldown`);
                return false;
            }
            
            // Check rate limit
            if (this.isRateLimited(level)) {
                console.log(`[ALERT] Rate limit exceeded for ${level} alerts`);
                return false;
            }
            
            // Create alert object
            const alert = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                level,
                type,
                details,
                priority: this.config.priorities[level] || 0
            };
            
            // Add to queue
            this.alertQueue.push(alert);
            
            // Process queue
            await this.processAlertQueue();
            
            // Set cooldown
            this.setCooldown(type);
            
            // Update rate limiter
            this.updateRateLimit(level);
            
            return true;
        } catch (error) {
            console.error('[ALERT] Send error:', error);
            return false;
        }
    }
    
    /**
     * Process alert queue
     */
    async processAlertQueue() {
        // Sort by priority
        this.alertQueue.sort((a, b) => b.priority - a.priority);
        
        while (this.alertQueue.length > 0) {
            const alert = this.alertQueue.shift();
            
            try {
                // Format message
                const message = this.formatAlertMessage(alert);
                
                // Send via WhatsApp
                await this.sendWhatsAppAlert(message, alert.level);
                
                // Log alert
                this.logAlert(alert, message);
                
                // Add to history
                this.addToHistory(alert);
                
                console.log(`[ALERT] Sent ${alert.level} alert: ${alert.type}`);
            } catch (error) {
                console.error(`[ALERT] Failed to send alert:`, error);
                
                // Re-queue if critical
                if (alert.level === 'critical' && !alert.retried) {
                    alert.retried = true;
                    this.alertQueue.push(alert);
                }
            }
        }
    }
    
    /**
     * Format alert message
     */
    formatAlertMessage(alert) {
        const template = this.templates[alert.type] || {
            icon: '📢',
            titleKey: 'alert_system_title_default',
            templateKey: 'alert_system_detail_default'
        };
        
        const timestamp = new Date().toLocaleString('id-ID', { 
            timeZone: 'Asia/Jakarta',
            dateStyle: 'short',
            timeStyle: 'medium'
        });
        
        const title = renderResponseTemplate(template.titleKey, { type: alert.type });
        let message = `${template.icon} *${title}*\n\n`;
        
        // Add level indicator
        const levelIcons = {
            info: 'ℹ️',
            warning: '⚠️',
            error: '❌',
            critical: '🚨'
        };
        
        const details = renderResponseTemplate(template.templateKey, alert.details);
        
        message += renderResponseTemplate('alert_system_message', {
            levelIcon: levelIcons[alert.level] || '',
            level: alert.level.toUpperCase(),
            timestamp,
            details
        });
        
        // Add recommendations based on type
        const recommendation = this.getRecommendation(alert.type, alert.details);
        if (recommendation) {
            message += `💡 *Recommendation:*\n${recommendation}\n`;
        }
        
        // Add system stats for critical alerts
        if (alert.level === 'critical' || alert.level === 'error') {
            const stats = this.getSystemStats();
            if (stats) {
                message += stats;
            }
        }
        
        return message;
    }
    
    /**
     * Get recommendation for alert type
     */
    getRecommendation(type, details) {
        const recommendations = {
            ERROR_SPIKE: 'alert_system_recommendation_error_spike',
            HIGH_CPU: 'alert_system_recommendation_high_cpu',
            HIGH_MEMORY: 'alert_system_recommendation_high_memory',
            WHATSAPP_DISCONNECTED: 'alert_system_recommendation_whatsapp_disconnected',
            WHATSAPP_LOGGED_OUT: 'alert_system_recommendation_whatsapp_logged_out',
            DATABASE_ERROR: 'alert_system_recommendation_database_error',
            QUEUE_BACKLOG: 'alert_system_recommendation_queue_backlog',
            SERVICE_RECOVERED: 'alert_system_recommendation_service_recovered',
        };
        
        return recommendations[type] ? renderResponseTemplate(recommendations[type], details) : null;
    }
    
    /**
     * Get system stats for alert
     */
    getSystemStats() {
        try {
            if (!global.monitoring) return null;
            
            const metrics = global.monitoring.getMetricsSnapshot();
            
            return renderResponseTemplate('alert_system_stats', {
                cpu: metrics.system.cpu,
                memory: metrics.system.memory,
                uptimeHours: Math.floor(metrics.system.uptime / 3600),
                activeUsers: metrics.performance.activeUsers,
                queueSize: metrics.performance.queueSize,
                whatsappStatus: metrics.connections.whatsapp ? 'OK' : 'DOWN',
                databaseStatus: metrics.connections.database ? 'OK' : 'DOWN'
            });
        } catch {
            return null;
        }
    }
    
    /**
     * Send WhatsApp alert
     */
    async sendWhatsAppAlert(message, _level) {
        try {
            // Check if WhatsApp is connected
            if (!hasAuthenticatedSession()) {
                console.log('[ALERT] WhatsApp not connected, queuing alert');
                // Could implement email fallback here
                return false;
            }
            
            // Get admin numbers from config
            const admins = global.config?.admin_numbers || [];
            
            if (admins.length === 0) {
                console.log('[ALERT] No admin numbers configured');
                return false;
            }
            
            // Send to all admins
            // PENTING: Cek connection state dan gunakan error handling sesuai rules untuk multiple recipients
            const sendPromises = admins.map(async (adminNumber) => {
                const jid = adminNumber.includes('@') 
                    ? adminNumber 
                    : `${adminNumber}@s.whatsapp.net`;
                
                if (isReady()) {
                    try {
                        const delivery = await sendMessage(jid, { text: message });
                        if (!delivery.sent) {
                            throw new Error(delivery.warning || delivery.errorCode || 'SEND_FAILED');
                        }
                        console.log(`[ALERT] Sent to admin: ${adminNumber}`);
                        return true;
                    } catch (error) {
                        console.error('[SEND_MESSAGE_ERROR]', {
                            jid,
                            error: error.message
                        });
                        console.error(`[ALERT] Failed to send to ${adminNumber}:`, error);
                        return false;
                    }
                } else {
                    console.warn('[SEND_MESSAGE_SKIP] WhatsApp not connected, skipping send to admin', adminNumber);
                    return false;
                }
            });
            
            const results = await Promise.allSettled(sendPromises);
            const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
            
            return successCount > 0;
        } catch (error) {
            console.error('[ALERT] WhatsApp send error:', error);
            return false;
        }
    }
    
    /**
     * Send health alert
     */
    async sendHealthAlert(health) {
        const level = health.status === 'critical' ? 'critical' : 
                     health.status === 'degraded' ? 'error' : 'warning';
        
        await this.sendAlert(level, 'HEALTH_WARNING', {
            status: health.status,
            issues: health.issues.length
        });
        
        // Send detailed issues for critical
        if (health.status === 'critical') {
            for (const issue of health.issues) {
                if (issue.severity === 'critical') {
                    await this.sendAlert('critical', issue.type, issue);
                }
            }
        }
    }
    
    /**
     * Send daily report
     */
    async sendDailyReport(report) {
        if (!report) return;
        
        const message = this.formatDailyReport(report);
        
        // Send as info level
        await this.sendWhatsAppAlert(message, 'info');
        
        console.log('[ALERT] Daily report sent');
    }
    
    /**
     * Format daily report
     */
    formatDailyReport(report) {
        const health = report.performance.uptime >= 99 ? '🟢 Excellent' :
                      report.performance.uptime >= 95 ? '🟡 Good' :
                      report.performance.uptime >= 90 ? '🟠 Fair' : '🔴 Poor';

        return renderResponseTemplate('alert_system_daily_report', {
            date: report.date,
            messagesSent: report.messages.sent,
            messagesReceived: report.messages.received,
            messagesFailed: report.messages.failed,
            messagesTotal: report.messages.total,
            errorsTotal: report.errors.total,
            errorsRate: report.errors.rate,
            avgCpu: report.system.avgCpu,
            maxCpu: report.system.maxCpu,
            avgMemory: report.system.avgMemory,
            maxMemory: report.system.maxMemory,
            usersUnique: report.users.unique,
            usersPeak: report.users.peak,
            uptime: report.performance.uptime,
            avgQueueSize: report.performance.avgQueueSize,
            health
        });
    }
    
    /**
     * Check if alert type is in cooldown
     */
    isInCooldown(type) {
        const lastAlert = this.alertCooldowns.get(type);
        if (!lastAlert) return false;
        
        const cooldownPeriod = this.config.cooldowns[type] || 300000; // Default 5 min
        const now = Date.now();
        
        return (now - lastAlert) < cooldownPeriod;
    }
    
    /**
     * Set cooldown for alert type
     */
    setCooldown(type) {
        this.alertCooldowns.set(type, Date.now());
    }
    
    /**
     * Check rate limit for alert level
     */
    isRateLimited(level) {
        const limit = this.config.rateLimits[level];
        if (!limit) return false;
        
        const now = Date.now();
        const key = `${level}_alerts`;
        
        if (!this.rateLimiter.has(key)) {
            this.rateLimiter.set(key, []);
        }
        
        const alerts = this.rateLimiter.get(key);
        
        // Clean old entries
        const validAlerts = alerts.filter(timestamp => 
            (now - timestamp) < limit.window
        );
        
        this.rateLimiter.set(key, validAlerts);
        
        return validAlerts.length >= limit.max;
    }
    
    /**
     * Update rate limit counter
     */
    updateRateLimit(level) {
        const key = `${level}_alerts`;
        
        if (!this.rateLimiter.has(key)) {
            this.rateLimiter.set(key, []);
        }
        
        this.rateLimiter.get(key).push(Date.now());
    }
    
    /**
     * Log alert to file
     */
    logAlert(alert, message) {
        try {
            const logEntry = {
                timestamp: alert.timestamp,
                level: alert.level,
                type: alert.type,
                details: alert.details,
                message: message.replace(/[*_`]/g, '') // Remove markdown
            };
            
            const logLine = JSON.stringify(logEntry) + '\n';
            
            fs.appendFileSync(this.alertLogPath, logLine);
        } catch (error) {
            console.error('[ALERT] Log write error:', error);
        }
    }
    
    /**
     * Add alert to history
     */
    addToHistory(alert) {
        this.alertHistory.push({
            ...alert,
            sentAt: Date.now()
        });
        
        // Trim if too large
        if (this.alertHistory.length > this.maxHistorySize) {
            this.alertHistory = this.alertHistory.slice(-this.maxHistorySize / 2);
        }
    }
    
    /**
     * Get alert statistics
     */
    getAlertStats() {
        const now = Date.now();
        const hour = 3600000;
        const day = 86400000;
        
        const recentAlerts = this.alertHistory.filter(a => 
            now - a.sentAt < day
        );
        
        const hourlyAlerts = recentAlerts.filter(a => 
            now - a.sentAt < hour
        );
        
        const byLevel = {};
        const byType = {};
        
        recentAlerts.forEach(alert => {
            // By level
            byLevel[alert.level] = (byLevel[alert.level] || 0) + 1;
            
            // By type
            byType[alert.type] = (byType[alert.type] || 0) + 1;
        });
        
        return {
            total: this.alertHistory.length,
            lastDay: recentAlerts.length,
            lastHour: hourlyAlerts.length,
            byLevel,
            byType,
            queueSize: this.alertQueue.length
        };
    }
    
    /**
     * Clear alert queue
     */
    clearQueue() {
        const cleared = this.alertQueue.length;
        this.alertQueue = [];
        console.log(`[ALERT] Cleared ${cleared} pending alerts`);
        return cleared;
    }
    
    /**
     * Test alert system
     */
    async testAlert() {
        console.log('[ALERT] Running test alert...');
        
        const testAlert = await this.sendAlert('info', 'TEST_ALERT', {
            message: renderResponseTemplate('alert_system_test_message'),
            timestamp: new Date().toISOString()
        });
        
        return testAlert;
    }
}

module.exports = AlertSystem;
