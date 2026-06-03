#!/usr/bin/env node

/**
 * Database Backup Script
 * Creates backup of database with timestamp
 */

const fs = require('fs');
const path = require('path');
const { getDatabasePath, getEnvironmentInfo } = require('../lib/env-config');

// Colors
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m'
};

function log(message, type = 'info') {
    const prefix = {
        info: `${colors.blue}[INFO]${colors.reset}`,
        success: `${colors.green}[SUCCESS]${colors.reset}`,
        warning: `${colors.yellow}[WARNING]${colors.reset}`,
        error: `${colors.red}[ERROR]${colors.reset}`
    };
    console.log(`${prefix[type]} ${message}`);
}

// Create backup
function createBackup() {
    try {
        // Get environment info
        const envInfo = getEnvironmentInfo();
        const dbPath = envInfo.databasePath;
        
        log(`Environment: ${envInfo.NODE_ENV}`, 'info');
        log(`Database path: ${dbPath}`, 'info');
        
        // Check if database exists
        if (!fs.existsSync(dbPath)) {
            log(`Database not found: ${dbPath}`, 'error');
            process.exit(1);
        }
        
        // Create backup directory
        const backupDir = path.join(__dirname, '..', 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
            log(`Created backup directory: ${backupDir}`, 'info');
        }
        
        // Generate backup filename with timestamp
        const now = new Date();
        const timestamp = now.toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .split('.')[0];
        
        const dbName = path.basename(dbPath, '.sqlite');
        const backupName = `${dbName}_backup_${timestamp}.sqlite`;
        const backupPath = path.join(backupDir, backupName);
        
        // Copy database
        log(`Creating backup...`, 'info');
        fs.copyFileSync(dbPath, backupPath);
        
        // Get file sizes
        const dbSize = fs.statSync(dbPath).size;
        const backupSize = fs.statSync(backupPath).size;
        
        // Format file size
        const formatSize = (bytes) => {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        };
        
        log(`Backup created successfully!`, 'success');
        log(`  Source: ${dbPath} (${formatSize(dbSize)})`, 'info');
        log(`  Backup: ${backupPath} (${formatSize(backupSize)})`, 'info');
        
        // Verify backup
        if (dbSize === backupSize) {
            log(`Backup verified: File sizes match`, 'success');
        } else {
            log(`Warning: File sizes don't match!`, 'warning');
        }
        
        // Clean old backups (older than 90 days)
        log(`Cleaning old backups...`, 'info');
        cleanOldBackups(backupDir, 90);
        
        return backupPath;
        
    } catch (error) {
        log(`Failed to create backup: ${error.message}`, 'error');
        process.exit(1);
    }
}

// Clean old backups
function cleanOldBackups(backupDir, daysOld = 90) {
    try {
        const files = fs.readdirSync(backupDir);
        const now = Date.now();
        const maxAge = daysOld * 24 * 60 * 60 * 1000; // days to milliseconds
        let deletedCount = 0;
        
        files.forEach(file => {
            if (file.endsWith('.sqlite')) {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                const age = now - stats.mtimeMs;
                
                if (age > maxAge) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                    log(`  Deleted old backup: ${file}`, 'info');
                }
            }
        });
        
        if (deletedCount > 0) {
            log(`Cleaned ${deletedCount} old backup(s)`, 'success');
        } else {
            log(`No old backups to clean`, 'info');
        }
    } catch (error) {
        log(`Failed to clean old backups: ${error.message}`, 'warning');
    }
}

// Main
console.log('='.repeat(60));
log('Database Backup Tool', 'info');
console.log('='.repeat(60));
console.log('');

createBackup();

console.log('');
console.log('='.repeat(60));
log('Backup completed!', 'success');
console.log('='.repeat(60));

