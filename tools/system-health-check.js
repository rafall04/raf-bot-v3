#!/usr/bin/env node

/**
 * System Health Check Tool
 * Comprehensive diagnostic tool for RAF Bot v2
 * 
 * Usage: node tools/system-health-check.js [options]
 * Options:
 *   --full    Run full system check
 *   --wifi    Check WiFi subsystem only
 *   --db      Check database only
 *   --fix     Attempt to fix issues
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// Icons for status
const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    working: '🔄'
};

class SystemHealthCheck {
    constructor() {
        this.issues = [];
        this.warnings = [];
        this.successes = [];
        this.rootDir = path.join(__dirname, '..');
    }

    log(type, message) {
        const timestamp = new Date().toISOString();
        switch(type) {
            case 'success':
                console.log(`${colors.green}${icons.success} ${message}${colors.reset}`);
                this.successes.push({timestamp, message});
                break;
            case 'error':
                console.log(`${colors.red}${icons.error} ${message}${colors.reset}`);
                this.issues.push({timestamp, message, severity: 'error'});
                break;
            case 'warning':
                console.log(`${colors.yellow}${icons.warning} ${message}${colors.reset}`);
                this.warnings.push({timestamp, message});
                break;
            case 'info':
                console.log(`${colors.cyan}${icons.info} ${message}${colors.reset}`);
                break;
            case 'section':
                console.log(`\n${colors.blue}${'='.repeat(70)}${colors.reset}`);
                console.log(`${colors.blue}${message}${colors.reset}`);
                console.log(`${colors.blue}${'='.repeat(70)}${colors.reset}\n`);
                break;
        }
    }

    // Check if required files exist
    async checkRequiredFiles() {
        this.log('section', '📁 CHECKING REQUIRED FILES');
        
        const requiredFiles = [
            'config.json',
            'package.json',
            'message/raf.js',
            'lib/database.js',
            'lib/wifi.js',
            'lib/wifi-logger.js',
            'database/accounts.json',
            'database/wifi_templates.json',
            'AI_MAINTENANCE_GUIDE.md'
        ];

        for (const file of requiredFiles) {
            const filePath = path.join(this.rootDir, file);
            if (fs.existsSync(filePath)) {
                this.log('success', `File exists: ${file}`);
            } else {
                this.log('error', `Missing required file: ${file}`);
            }
        }
    }

    // Check WiFi subsystem
    async checkWiFiSystem() {
        this.log('section', '📡 CHECKING WIFI SUBSYSTEM');
        
        // Check WiFi handlers
        const wifiHandlers = [
            'message/handlers/wifi-management-handler.js',
            'message/handlers/wifi-check-handler.js',
            'message/handlers/wifi-history-handler.js',
            'message/handlers/states/wifi-name-state-handler.js',
            'message/handlers/states/wifi-password-state-handler.js'
        ];

        for (const handler of wifiHandlers) {
            const handlerPath = path.join(this.rootDir, handler);
            if (fs.existsSync(handlerPath)) {
                // Check for common issues
                const content = fs.readFileSync(handlerPath, 'utf8');
                
                // Check for getSSIDInfo usage
                if (content.includes('getSSIDInfo')) {
                    const matches = content.match(/getSSIDInfo\([^,)]+,[^)]+\)/g);
                    if (matches) {
                        this.log('warning', `${handler}: Found getSSIDInfo with 2 params (should be 1)`);
                    } else {
                        this.log('success', `${handler}: getSSIDInfo usage correct`);
                    }
                }
                
                // Check for [PROTECTED] in logs
                if (handler.includes('password') && content.includes('[PROTECTED]')) {
                    this.log('warning', `${handler}: Still using [PROTECTED] for passwords`);
                }
                
                // Check for logWifiChange
                if (handler.includes('password') && !content.includes('logWifiChange')) {
                    this.log('error', `${handler}: Missing logWifiChange for password changes`);
                }
            } else {
                this.log('error', `Missing WiFi handler: ${handler}`);
            }
        }

        // Check WiFi logs
        const logsPath = path.join(this.rootDir, 'database/wifi_change_logs.json');
        if (fs.existsSync(logsPath)) {
            try {
                const logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
                this.log('info', `WiFi logs found: ${logs.length} entries`);
                
                // Check for [object Object] issues
                const objectIssues = logs.filter(log => 
                    JSON.stringify(log).includes('[object Object]')
                );
                if (objectIssues.length > 0) {
                    this.log('warning', `Found ${objectIssues.length} logs with [object Object] issue`);
                }
            } catch (error) {
                this.log('error', `WiFi logs corrupted: ${error.message}`);
            }
        }
    }

    // Check database
    async checkDatabase() {
        this.log('section', '🗄️ CHECKING DATABASE');
        
        // All databases stored in database/ folder
        const dbPath = path.join(this.rootDir, 'database', 'database.sqlite');
        if (!fs.existsSync(dbPath)) {
            this.log('error', 'SQLite database not found');
            return;
        }

        return new Promise((resolve) => {
            const db = new sqlite3.Database(dbPath);
            
            // Check users table
            db.all("SELECT COUNT(*) as count FROM users", (err, rows) => {
                if (err) {
                    this.log('error', `Database error: ${err.message}`);
                } else {
                    this.log('success', `Users table: ${rows[0].count} records`);
                }
            });

            // Check for common issues
            db.all("SELECT * FROM users WHERE phone_number IS NULL OR phone_number = ''", (err, rows) => {
                if (!err && rows.length > 0) {
                    this.log('warning', `Found ${rows.length} users without phone numbers`);
                }
            });

            db.close(() => {
                resolve();
            });
        });
    }

    // Check for common code patterns that cause issues
    async checkCodePatterns() {
        this.log('section', '🔍 CHECKING COMMON CODE ISSUES');
        
        const patternsToCheck = [
            {
                pattern: /require\(['"]\.\.\/\.\.\/lib\/function['"]\)/g,
                issue: 'Invalid import: lib/function does not exist',
                fix: "Use: const convertRupiah = require('rupiah-format');"
            },
            {
                pattern: /logs\.forEach/g,
                issue: 'getWifiChangeLogs returns {logs: [], total: 0}, not array',
                fix: 'Use: const result = await getWifiChangeLogs(); const logs = result.logs || [];'
            },
            {
                pattern: /Modem akan restart otomatis/g,
                issue: 'Incorrect message: WiFi changes do not restart modem',
                fix: 'Use: WiFi akan terputus dari semua perangkat'
            }
        ];

        const handlersDir = path.join(this.rootDir, 'message/handlers');
        const files = this.getAllFiles(handlersDir, '.js');

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const relativePath = path.relative(this.rootDir, file);
            
            for (const check of patternsToCheck) {
                const matches = content.match(check.pattern);
                if (matches) {
                    this.log('warning', `${relativePath}: ${check.issue}`);
                    this.log('info', `  Fix: ${check.fix}`);
                }
            }
        }
    }

    // Get all files recursively
    getAllFiles(dirPath, extension) {
        const files = [];
        const items = fs.readdirSync(dirPath);
        
        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                files.push(...this.getAllFiles(fullPath, extension));
            } else if (item.endsWith(extension)) {
                files.push(fullPath);
            }
        }
        
        return files;
    }

    // Generate report
    generateReport() {
        this.log('section', '📊 HEALTH CHECK REPORT');
        
        console.log(`\n${colors.green}Successes: ${this.successes.length}${colors.reset}`);
        console.log(`${colors.yellow}Warnings: ${this.warnings.length}${colors.reset}`);
        console.log(`${colors.red}Issues: ${this.issues.length}${colors.reset}`);
        
        if (this.issues.length > 0) {
            console.log(`\n${colors.red}CRITICAL ISSUES TO FIX:${colors.reset}`);
            this.issues.forEach((issue, index) => {
                console.log(`${index + 1}. ${issue.message}`);
            });
        }
        
        if (this.warnings.length > 0) {
            console.log(`\n${colors.yellow}WARNINGS TO REVIEW:${colors.reset}`);
            this.warnings.forEach((warning, index) => {
                console.log(`${index + 1}. ${warning.message}`);
            });
        }
        
        // Save report to file
        const report = {
            timestamp: new Date().toISOString(),
            successes: this.successes,
            warnings: this.warnings,
            issues: this.issues,
            summary: {
                totalChecks: this.successes.length + this.warnings.length + this.issues.length,
                healthScore: Math.round((this.successes.length / (this.successes.length + this.issues.length)) * 100)
            }
        };
        
        const reportPath = path.join(this.rootDir, 'health-check-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n${colors.cyan}Full report saved to: health-check-report.json${colors.reset}`);
    }

    // Main run function
    async run(options = {}) {
        console.log(`${colors.magenta}${'='.repeat(70)}${colors.reset}`);
        console.log(`${colors.magenta}         RAF BOT V2 - SYSTEM HEALTH CHECK${colors.reset}`);
        console.log(`${colors.magenta}${'='.repeat(70)}${colors.reset}\n`);
        
        try {
            await this.checkRequiredFiles();
            
            if (options.wifi || options.full) {
                await this.checkWiFiSystem();
            }
            
            if (options.db || options.full) {
                await this.checkDatabase();
            }
            
            if (options.full) {
                await this.checkCodePatterns();
            }
            
            this.generateReport();
            
            // Return exit code based on issues
            process.exit(this.issues.length > 0 ? 1 : 0);
            
        } catch (error) {
            this.log('error', `Fatal error: ${error.message}`);
            process.exit(1);
        }
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
    full: args.includes('--full') || args.length === 0,
    wifi: args.includes('--wifi'),
    db: args.includes('--db'),
    fix: args.includes('--fix')
};

// Run health check
const healthCheck = new SystemHealthCheck();
healthCheck.run(options);
