#!/usr/bin/env node

/**
 * Pre-Deployment Safety Check
 * Validates environment and configuration before deployment
 */

const fs = require('fs');
const path = require('path');

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
        success: `${colors.green}[OK]${colors.reset}`,
        warning: `${colors.yellow}[WARN]${colors.reset}`,
        error: `${colors.red}[ERROR]${colors.reset}`
    };
    console.log(`${prefix[type]} ${message}`);
}

// Check if file exists
function fileExists(filePath) {
    return fs.existsSync(filePath);
}

// Check if directory exists
function dirExists(dirPath) {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

// Validate configuration
function validateConfig() {
    log('Validating configuration...', 'info');
    const errors = [];
    const warnings = [];
    
    const baseDir = path.join(__dirname, '..');
    
    // Check if config.json exists
    const configPath = path.join(baseDir, 'config.json');
    if (!fileExists(configPath)) {
        errors.push('config.json not found!');
    } else {
        try {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            
            // Check critical fields
            if (!config.ownerNumber || config.ownerNumber.length === 0) {
                warnings.push('ownerNumber not configured');
            }
            if (!config.botName) {
                warnings.push('botName not configured');
            }
            if (!config.nama) {
                warnings.push('Company name (nama) not configured');
            }
            
            log('Configuration file is valid', 'success');
        } catch (e) {
            errors.push(`config.json is invalid JSON: ${e.message}`);
        }
    }
    
    return { errors, warnings };
}

// Validate environment
function validateEnvironment() {
    log('Validating environment...', 'info');
    const errors = [];
    const warnings = [];
    
    const NODE_ENV = process.env.NODE_ENV || 'production';
    log(`Environment: ${NODE_ENV}`, 'info');
    
    // Check database - all databases stored in database/ folder
    const baseDir = path.join(__dirname, '..');
    const dbDir = path.join(baseDir, 'database');
    const prodDbPath = path.join(dbDir, 'database.sqlite');
    const testDbPath = path.join(dbDir, 'database_test.sqlite');
    
    if (NODE_ENV === 'production') {
        // In production, production DB should exist
        if (!fileExists(prodDbPath)) {
            errors.push('Production database not found!');
        }
        
        // Warning if test database exists in production
        if (fileExists(testDbPath)) {
            warnings.push('Test database found in production mode - consider removing it');
        }
    } else {
        // In test/dev, use test database
        if (!fileExists(testDbPath) && !fileExists(prodDbPath)) {
            warnings.push('No database found - will be created on first run');
        }
    }
    
    return { errors, warnings };
}

// Validate required directories
function validateDirectories() {
    log('Validating directories...', 'info');
    const errors = [];
    const warnings = [];
    
    const baseDir = path.join(__dirname, '..');
    const requiredDirs = [
        'lib',
        'routes',
        'database',
        'uploads',
        'backups'
    ];
    
    for (const dir of requiredDirs) {
        const dirPath = path.join(baseDir, dir);
        if (!dirExists(dirPath)) {
            if (dir === 'backups' || dir === 'uploads') {
                // These can be created automatically
                warnings.push(`Directory '${dir}' doesn't exist - will be created`);
            } else {
                errors.push(`Required directory '${dir}' not found!`);
            }
        }
    }
    
    return { errors, warnings };
}

// Validate dependencies
function validateDependencies() {
    log('Validating dependencies...', 'info');
    const errors = [];
    const warnings = [];
    
    const baseDir = path.join(__dirname, '..');
    const packageJsonPath = path.join(baseDir, 'package.json');
    
    if (!fileExists(packageJsonPath)) {
        errors.push('package.json not found!');
        return { errors, warnings };
    }
    
    const nodeModulesPath = path.join(baseDir, 'node_modules');
    if (!dirExists(nodeModulesPath)) {
        errors.push('node_modules not found! Run npm install first.');
    }
    
    return { errors, warnings };
}

// Main validation
function runPreDeployCheck() {
    console.log('='.repeat(60));
    log('Pre-Deployment Safety Check', 'info');
    console.log('='.repeat(60));
    console.log('');
    
    let allErrors = [];
    let allWarnings = [];
    
    // Run all validations
    const configResult = validateConfig();
    allErrors.push(...configResult.errors);
    allWarnings.push(...configResult.warnings);
    
    const envResult = validateEnvironment();
    allErrors.push(...envResult.errors);
    allWarnings.push(...envResult.warnings);
    
    const dirResult = validateDirectories();
    allErrors.push(...dirResult.errors);
    allWarnings.push(...dirResult.warnings);
    
    const depResult = validateDependencies();
    allErrors.push(...depResult.errors);
    allWarnings.push(...depResult.warnings);
    
    // Print results
    console.log('');
    if (allWarnings.length > 0) {
        log('Warnings:', 'warning');
        allWarnings.forEach(w => log(`  - ${w}`, 'warning'));
        console.log('');
    }
    
    if (allErrors.length > 0) {
        log('Errors:', 'error');
        allErrors.forEach(e => log(`  - ${e}`, 'error'));
        console.log('');
        log('Pre-deployment check FAILED!', 'error');
        console.log('');
        process.exit(1);
    }
    
    log('Pre-deployment check PASSED!', 'success');
    console.log('');
    console.log('='.repeat(60));
    return true;
}

// Run check
runPreDeployCheck();

