/**
 * Header Doc
 * Purpose: Melacak metrik sistem, kesehatan layanan, dan status koneksi runtime aplikasi termasuk WhatsApp.
 * Caller: Startup runtime, health dashboard, dan sistem observability internal.
 * Deps: `os`, `fs-extra`, `path`, `node-cron`, `sqlite3`, dan `./whatsapp-gateway`.
 * MainFuncs: `MonitoringService` dan helper pengecekan kesehatan layanan.
 * SideEffects: Menulis metrik ke SQLite dan membaca status runtime untuk health monitoring.
 */

const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const { getSocketDiagnostics, getConnectionState } = require('./whatsapp-gateway');

class MonitoringService {
    constructor() {
        this.metrics = {
            messages: { 
                sent: 0, 
                received: 0, 
                failed: 0,
                lastMinute: [],
                lastHour: []
            },
            errors: { 
                count: 0, 
                lastError: null,
                errorRate: 0,
                byType: {}
            },
            system: { 
                cpu: 0, 
                memory: 0, 
                uptime: 0,
                diskUsage: 0,
                processMemory: 0
            },
            connections: { 
                whatsapp: false, 
                database: false,
                internet: true,
                lastCheck: null
            },
            performance: {
                avgResponseTime: 0,
                commandsPerMinute: 0,
                activeUsers: new Set(),
                queueSize: 0
            },
            daily: {
                date: new Date().toDateString(),
                totalMessages: 0,
                totalErrors: 0,
                totalCommands: 0,
                uniqueUsers: new Set()
            }
        };
        
        this.metricsHistory = [];
        this.maxHistorySize = 1440; // 24 hours of minute data
        this.metricsDbPath = path.join(__dirname, '../database/monitoring_metrics.sqlite');
        
        // Initialize metrics database
        this.initializeDatabase();
        
        // Start collection intervals
        this.startMonitoring();
    }
    
    /**
     * Initialize SQLite database for metrics
     */
    async initializeDatabase() {
        try {
            // Ensure directory exists
            await fs.ensureDir(path.dirname(this.metricsDbPath));
            
            this.metricsDb = new sqlite3.Database(this.metricsDbPath);
            
            // Create tables if not exist
            this.metricsDb.serialize(() => {
                // Metrics history table
                this.metricsDb.run(`
                    CREATE TABLE IF NOT EXISTS metrics_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        messages_sent INTEGER,
                        messages_received INTEGER,
                        messages_failed INTEGER,
                        error_count INTEGER,
                        cpu_usage REAL,
                        memory_usage REAL,
                        active_users INTEGER,
                        queue_size INTEGER,
                        whatsapp_connected INTEGER,
                        database_connected INTEGER
                    )
                `);
                
                // Daily summaries table
                this.metricsDb.run(`
                    CREATE TABLE IF NOT EXISTS daily_summaries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date DATE UNIQUE,
                        total_messages INTEGER,
                        total_errors INTEGER,
                        total_commands INTEGER,
                        unique_users INTEGER,
                        avg_cpu REAL,
                        avg_memory REAL,
                        uptime_percentage REAL,
                        peak_users INTEGER
                    )
                `);
                
                // Error logs table
                this.metricsDb.run(`
                    CREATE TABLE IF NOT EXISTS error_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        error_type VARCHAR(100),
                        error_message TEXT,
                        error_stack TEXT,
                        context TEXT,
                        severity VARCHAR(20)
                    )
                `);
                
                // Create indexes
                this.metricsDb.run(`
                    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp 
                    ON metrics_history(timestamp)
                `);
                
                this.metricsDb.run(`
                    CREATE INDEX IF NOT EXISTS idx_errors_timestamp 
                    ON error_logs(timestamp)
                `);
            });
            
            // Monitoring database initialized (silent)
        } catch (error) {
            console.error('[MONITORING] Database initialization error:', error);
        }
    }
    
    /**
     * Start monitoring intervals
     */
    startMonitoring() {
        // Collect metrics every 30 seconds
        this.metricsInterval = setInterval(() => this.collectMetrics(), 30000);
        
        // Save to database every minute
        this.saveInterval = setInterval(() => this.saveMetricsToDatabase(), 60000);
        
        // Health check every 5 minutes
        this.healthInterval = setInterval(() => this.healthCheck(), 300000);
        
        // Daily report at 9 AM
        this.dailyReportJob = cron.schedule('0 9 * * *', () => this.sendDailyReport());
        
        // Hourly cleanup
        this.cleanupJob = cron.schedule('0 * * * *', () => this.cleanupOldData());
        
        // Initial collection
        this.collectMetrics();
        
            // Monitoring service started (silent)
    }
    
    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.metricsInterval) clearInterval(this.metricsInterval);
        if (this.saveInterval) clearInterval(this.saveInterval);
        if (this.healthInterval) clearInterval(this.healthInterval);
        if (this.dailyReportJob) this.dailyReportJob.stop();
        if (this.cleanupJob) this.cleanupJob.stop();
        
        if (this.metricsDb) {
            this.metricsDb.close();
        }
        
        console.log('[MONITORING] Service stopped');
    }
    
    /**
     * Collect system and application metrics
     */
    async collectMetrics() {
        try {
            const timestamp = Date.now();
            
            // System metrics
            this.metrics.system = {
                cpu: this.getCpuUsage(),
                memory: this.getMemoryUsage(),
                uptime: process.uptime(),
                diskUsage: await this.getDiskUsage(),
                processMemory: process.memoryUsage().heapUsed / 1024 / 1024 // MB
            };
            
            // Connection status
            this.metrics.connections = {
                whatsapp: this.checkWhatsAppConnection(),
                database: this.checkDatabaseConnection(),
                internet: await this.checkInternetConnection(),
                lastCheck: new Date().toISOString()
            };
            
            // Calculate rates
            this.calculateRates();
            
            // Update performance metrics
            this.metrics.performance.queueSize = this.getQueueSize();
            this.metrics.performance.commandsPerMinute = this.getCommandRate();
            
            // Add to history
            this.addToHistory({
                timestamp,
                ...this.metrics
            });
            
            // Check for alerts
            this.checkAlerts();
            
        } catch (error) {
            console.error('[MONITORING] Collection error:', error);
        }
    }
    
    /**
     * Get CPU usage percentage
     */
    getCpuUsage() {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        
        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        });
        
        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - ~~(100 * idle / total);
        
        return usage;
    }
    
    /**
     * Get memory usage percentage
     */
    getMemoryUsage() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const usage = Math.round((usedMem / totalMem) * 100);
        
        return usage;
    }
    
    /**
     * Get disk usage
     */
    async getDiskUsage() {
        try {
            // This is platform specific, simplified version
            const stats = await fs.statfs('./');
            const total = stats.blocks * stats.bsize;
            const free = stats.bavail * stats.bsize;
            const used = total - free;
            const usage = Math.round((used / total) * 100);
            
            return usage;
        } catch (error) {
            return 0;
        }
    }
    
    /**
     * Check WhatsApp connection status
     * Menggunakan multiple methods untuk akurasi maksimal
     */
    checkWhatsAppConnection() {
        if (getConnectionState() === 'logged_out') {
            return false;
        }

        const diagnostics = getSocketDiagnostics();
        if (diagnostics.connectionState === 'open' && diagnostics.hasSocket) return true;
        if (diagnostics.wsReadyState === 1) return true;
        return diagnostics.hasUser;
    }
    
    /**
     * Check database connection status
     */
    checkDatabaseConnection() {
        if (!global.db) return false;
        
        try {
            // Simple check - if db object exists and is open
            return global.db.open ? true : false;
        } catch {
            return false;
        }
    }
    
    /**
     * Check internet connection
     */
    async checkInternetConnection() {
        try {
            const dns = require('dns').promises;
            await dns.lookup('google.com');
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * Calculate message and error rates
     */
    calculateRates() {
        const now = Date.now();
        const oneMinute = 60000;
        const oneHour = 3600000;
        
        // Clean old entries
        this.metrics.messages.lastMinute = this.metrics.messages.lastMinute.filter(
            t => now - t < oneMinute
        );
        
        this.metrics.messages.lastHour = this.metrics.messages.lastHour.filter(
            t => now - t < oneHour
        );
        
        // Calculate error rate (errors per hour)
        const recentErrors = Object.values(this.metrics.errors.byType)
            .flat()
            .filter(t => now - t < oneHour);
        
        this.metrics.errors.errorRate = recentErrors.length;
    }
    
    /**
     * Get queue size
     */
    getQueueSize() {
        let totalSize = 0;
        
        if (global.messageQueue) {
            Object.values(global.messageQueue).forEach(queue => {
                if (Array.isArray(queue)) {
                    totalSize += queue.length;
                }
            });
        }
        
        return totalSize;
    }
    
    /**
     * Get command execution rate
     */
    getCommandRate() {
        return this.metrics.messages.lastMinute.length;
    }
    
    /**
     * Add metrics to history
     */
    addToHistory(snapshot) {
        this.metricsHistory.push(snapshot);
        
        // Trim if too large
        if (this.metricsHistory.length > this.maxHistorySize) {
            this.metricsHistory = this.metricsHistory.slice(-this.maxHistorySize / 2);
        }
    }
    
    /**
     * Save metrics to database
     */
    async saveMetricsToDatabase() {
        if (!this.metricsDb) return;
        
        try {
            const stmt = this.metricsDb.prepare(`
                INSERT INTO metrics_history (
                    messages_sent, messages_received, messages_failed,
                    error_count, cpu_usage, memory_usage,
                    active_users, queue_size,
                    whatsapp_connected, database_connected
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run(
                this.metrics.messages.sent,
                this.metrics.messages.received,
                this.metrics.messages.failed,
                this.metrics.errors.count,
                this.metrics.system.cpu,
                this.metrics.system.memory,
                this.metrics.performance.activeUsers.size,
                this.metrics.performance.queueSize,
                this.metrics.connections.whatsapp ? 1 : 0,
                this.metrics.connections.database ? 1 : 0
            );
            
            stmt.finalize();
        } catch (error) {
            console.error('[MONITORING] Database save error:', error);
        }
    }
    
    /**
     * Health check
     */
    async healthCheck() {
        const health = {
            status: 'healthy',
            issues: [],
            timestamp: new Date().toISOString()
        };
        
        // Check CPU
        if (this.metrics.system.cpu > 80) {
            health.issues.push({
                type: 'HIGH_CPU',
                value: this.metrics.system.cpu,
                severity: 'warning'
            });
        }
        
        // Check memory
        if (this.metrics.system.memory > 85) {
            health.issues.push({
                type: 'HIGH_MEMORY',
                value: this.metrics.system.memory,
                severity: 'warning'
            });
        }
        
        // Check connections
        if (!this.metrics.connections.whatsapp) {
            health.issues.push({
                type: 'WHATSAPP_DISCONNECTED',
                severity: 'critical'
            });
        }
        
        if (!this.metrics.connections.database) {
            health.issues.push({
                type: 'DATABASE_DISCONNECTED',
                severity: 'critical'
            });
        }
        
        // Check error rate
        if (this.metrics.errors.errorRate > 10) {
            health.issues.push({
                type: 'HIGH_ERROR_RATE',
                value: this.metrics.errors.errorRate,
                severity: 'warning'
            });
        }
        
        // Check queue size
        if (this.metrics.performance.queueSize > 100) {
            health.issues.push({
                type: 'QUEUE_BACKLOG',
                value: this.metrics.performance.queueSize,
                severity: 'warning'
            });
        }
        
        // Determine overall status
        const criticalIssues = health.issues.filter(i => i.severity === 'critical');
        const warningIssues = health.issues.filter(i => i.severity === 'warning');
        
        if (criticalIssues.length > 0) {
            health.status = 'critical';
        } else if (warningIssues.length > 2) {
            health.status = 'degraded';
        } else if (warningIssues.length > 0) {
            health.status = 'warning';
        }
        
        // Alert if unhealthy
        if (health.status !== 'healthy' && global.alertSystem) {
            await global.alertSystem.sendHealthAlert(health);
        }
        
        // Only log health issues, not successful checks
        if (health.status !== 'healthy') {
            console.log(`[MONITORING] Health check: ${health.status} (${health.issues.length} issues)`);
        }
        
        return health;
    }
    
    /**
     * Check for alert conditions
     */
    checkAlerts() {
        // Check for sudden spike in errors
        if (this.metrics.errors.errorRate > 20) {
            this.triggerAlert('ERROR_SPIKE', {
                rate: this.metrics.errors.errorRate,
                severity: 'high'
            });
        }
        
        // Check for resource issues
        if (this.metrics.system.cpu > 90) {
            this.triggerAlert('HIGH_CPU', {
                usage: this.metrics.system.cpu,
                severity: 'medium'
            });
        }
        
        if (this.metrics.system.memory > 90) {
            this.triggerAlert('HIGH_MEMORY', {
                usage: this.metrics.system.memory,
                severity: 'medium'
            });
        }
        
        // Check for disconnection
        if (!this.metrics.connections.whatsapp) {
            const connectionState = getConnectionState();
            if (connectionState === 'logged_out') {
                this.triggerAlert('WHATSAPP_LOGGED_OUT', {
                    severity: 'critical'
                });
            } else if (connectionState === 'temporary_disconnect') {
                this.triggerAlert('WHATSAPP_DISCONNECTED', {
                    severity: 'critical'
                });
            }
        }
    }
    
    /**
     * Trigger alert
     */
    async triggerAlert(type, details) {
        if (global.alertSystem) {
            await global.alertSystem.sendAlert('warning', type, details);
        }
    }
    
    /**
     * Send daily report
     */
    async sendDailyReport() {
        try {
            console.log('[MONITORING] Generating daily report...');
            
            // Calculate daily stats
            const report = await this.generateDailyReport();
            
            // Save to database
            await this.saveDailySummary(report);
            
            // Send to admins
            if (global.alertSystem) {
                await global.alertSystem.sendDailyReport(report);
            }
            
            // Reset daily metrics
            this.resetDailyMetrics();
            
            console.log('[MONITORING] Daily report sent');
        } catch (error) {
            console.error('[MONITORING] Daily report error:', error);
        }
    }
    
    /**
     * Generate daily report
     */
    async generateDailyReport() {
        return new Promise((resolve) => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const dateStr = yesterday.toISOString().split('T')[0];
            
            this.metricsDb.all(`
                SELECT 
                    COUNT(*) as total_records,
                    AVG(cpu_usage) as avg_cpu,
                    MAX(cpu_usage) as max_cpu,
                    AVG(memory_usage) as avg_memory,
                    MAX(memory_usage) as max_memory,
                    SUM(messages_sent) as total_sent,
                    SUM(messages_received) as total_received,
                    SUM(messages_failed) as total_failed,
                    SUM(error_count) as total_errors,
                    MAX(active_users) as peak_users,
                    AVG(queue_size) as avg_queue_size,
                    SUM(CASE WHEN whatsapp_connected = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as uptime_percentage
                FROM metrics_history
                WHERE DATE(timestamp) = ?
            `, [dateStr], (err, rows) => {
                if (err) {
                    console.error('[MONITORING] Report query error:', err);
                    resolve(null);
                    return;
                }
                
                const stats = rows[0] || {};
                
                const report = {
                    date: dateStr,
                    messages: {
                        sent: stats.total_sent || 0,
                        received: stats.total_received || 0,
                        failed: stats.total_failed || 0,
                        total: (stats.total_sent || 0) + (stats.total_received || 0)
                    },
                    errors: {
                        total: stats.total_errors || 0,
                        rate: Math.round((stats.total_errors || 0) / 24) // per hour
                    },
                    system: {
                        avgCpu: Math.round(stats.avg_cpu || 0),
                        maxCpu: Math.round(stats.max_cpu || 0),
                        avgMemory: Math.round(stats.avg_memory || 0),
                        maxMemory: Math.round(stats.max_memory || 0)
                    },
                    users: {
                        peak: stats.peak_users || 0,
                        unique: this.metrics.daily.uniqueUsers.size
                    },
                    performance: {
                        avgQueueSize: Math.round(stats.avg_queue_size || 0),
                        uptime: Math.round(stats.uptime_percentage || 0)
                    }
                };
                
                resolve(report);
            });
        });
    }
    
    /**
     * Save daily summary to database
     */
    async saveDailySummary(report) {
        if (!report || !this.metricsDb) return;
        
        try {
            const stmt = this.metricsDb.prepare(`
                INSERT OR REPLACE INTO daily_summaries (
                    date, total_messages, total_errors, total_commands,
                    unique_users, avg_cpu, avg_memory,
                    uptime_percentage, peak_users
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            stmt.run(
                report.date,
                report.messages.total,
                report.errors.total,
                this.metrics.daily.totalCommands,
                report.users.unique,
                report.system.avgCpu,
                report.system.avgMemory,
                report.performance.uptime,
                report.users.peak
            );
            
            stmt.finalize();
        } catch (error) {
            console.error('[MONITORING] Summary save error:', error);
        }
    }
    
    /**
     * Reset daily metrics
     */
    resetDailyMetrics() {
        this.metrics.daily = {
            date: new Date().toDateString(),
            totalMessages: 0,
            totalErrors: 0,
            totalCommands: 0,
            uniqueUsers: new Set()
        };
    }
    
    /**
     * Clean up old data
     */
    async cleanupOldData() {
        if (!this.metricsDb) return;
        
        try {
            // Keep only last 7 days of detailed metrics
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 7);
            
            this.metricsDb.run(
                'DELETE FROM metrics_history WHERE timestamp < ?',
                [cutoffDate.toISOString()]
            );
            
            // Keep only last 30 days of error logs
            cutoffDate.setDate(cutoffDate.getDate() - 23);
            
            this.metricsDb.run(
                'DELETE FROM error_logs WHERE timestamp < ?',
                [cutoffDate.toISOString()]
            );
            
            // Silent cleanup, only log errors
        } catch (error) {
            console.error('[MONITORING] Cleanup error:', error);
        }
    }
    
    /**
     * Update connection status
     */
    updateConnectionStatus(service, status) {
        if (this.metrics.connections.hasOwnProperty(service)) {
            this.metrics.connections[service] = status === 'open' || status === true;
        }
    }
    
    /**
     * Increment metric counter
     */
    incrementMetric(metric) {
        const parts = metric.split('.');
        let current = this.metrics;
        
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]]) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        
        const lastPart = parts[parts.length - 1];
        if (typeof current[lastPart] === 'number') {
            current[lastPart]++;
        }
        
        // Add to time-based tracking
        const now = Date.now();
        if (metric.includes('message')) {
            this.metrics.messages.lastMinute.push(now);
            this.metrics.messages.lastHour.push(now);
        }
    }
    
    /**
     * Log error to database
     */
    async logError(error, context, severity = 'error') {
        if (!this.metricsDb) return;
        
        try {
            const stmt = this.metricsDb.prepare(`
                INSERT INTO error_logs (
                    error_type, error_message, error_stack,
                    context, severity
                ) VALUES (?, ?, ?, ?, ?)
            `);
            
            stmt.run(
                error.code || 'UNKNOWN',
                error.message,
                error.stack,
                JSON.stringify(context),
                severity
            );
            
            stmt.finalize();
            
            // Update error metrics
            this.metrics.errors.count++;
            this.metrics.errors.lastError = {
                message: error.message,
                timestamp: new Date().toISOString()
            };
            
            // Track by type
            const errorType = error.code || 'UNKNOWN';
            if (!this.metrics.errors.byType[errorType]) {
                this.metrics.errors.byType[errorType] = [];
            }
            this.metrics.errors.byType[errorType].push(Date.now());
            
        } catch (dbError) {
            console.error('[MONITORING] Error log failed:', dbError);
        }
    }
    
    /**
     * Track active user
     */
    trackActiveUser(userId) {
        this.metrics.performance.activeUsers.add(userId);
        this.metrics.daily.uniqueUsers.add(userId);
        
        // Clean up inactive users after 5 minutes
        setTimeout(() => {
            this.metrics.performance.activeUsers.delete(userId);
        }, 300000);
    }
    
    /**
     * Track command execution
     */
    trackCommand(command, userId) {
        this.metrics.daily.totalCommands++;
        this.trackActiveUser(userId);
    }
    
    /**
     * Get current metrics snapshot
     */
    getMetricsSnapshot() {
        return {
            ...this.metrics,
            performance: {
                ...this.metrics.performance,
                activeUsers: this.metrics.performance.activeUsers.size
            },
            daily: {
                ...this.metrics.daily,
                uniqueUsers: this.metrics.daily.uniqueUsers.size
            }
        };
    }
    
    /**
     * Get metrics history for time range
     */
    async getMetricsHistory(hours = 24) {
        return new Promise((resolve) => {
            const cutoff = new Date();
            cutoff.setHours(cutoff.getHours() - hours);
            
            this.metricsDb.all(`
                SELECT * FROM metrics_history
                WHERE timestamp > ?
                ORDER BY timestamp DESC
            `, [cutoff.toISOString()], (err, rows) => {
                if (err) {
                    console.error('[MONITORING] History query error:', err);
                    resolve([]);
                    return;
                }
                
                resolve(rows);
            });
        });
    }
    
    /**
     * Restart monitoring service
     */
    async restart() {
        console.log('[MONITORING] Restarting service...');
        
        this.stopMonitoring();
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Reinitialize
        await this.initializeDatabase();
        this.startMonitoring();
    }
}

module.exports = MonitoringService;
