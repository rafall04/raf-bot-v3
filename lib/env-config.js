/**
 * Environment Configuration Manager
 * Manages environment-specific settings (production vs test/development)
 * Ensures production database is never overwritten by test data
 */

const fs = require('fs');
const path = require('path');

// Get environment (default to production for safety)
// PENTING: Pastikan NODE_ENV tidak di-set ke 'test' atau 'development' di production
// Jika tidak di-set, default ke 'production'
const NODE_ENV = process.env.NODE_ENV || 'production';

const shouldLogEnvBootstrap = () => (
    NODE_ENV === 'development' ||
    process.env.ENV_CONFIG_VERBOSE_BOOT === '1'
);

    // Log environment hanya jika test/dev
    if ((NODE_ENV === 'test' || NODE_ENV === 'development') && shouldLogEnvBootstrap()) {
        console.warn(`[ENV] ⚠️  ${NODE_ENV} mode - using test database`);
    }

// Environment-specific database paths
// NOTE: SEMUA database (SQLite dan JSON) disimpan di folder database/ untuk organisasi yang rapi
// Setiap domain/fitur memiliki database terpisah untuk maintenance yang lebih mudah
// Database utama untuk pelanggan: users.sqlite
// Saldo management: saldo.sqlite (terpisah)
// Log login/logout: activity_logs.sqlite (terpisah)
// Database PSB: psb_database.sqlite (terpisah)
const getDatabasePath = (dbName = 'users.sqlite') => {
    const baseDir = path.join(__dirname, '..');
    const dbDir = path.join(baseDir, 'database');
    
    // All databases go in database/ folder
    if (NODE_ENV === 'test' || NODE_ENV === 'development') {
        // Test/Dev: Use separate database with _test suffix. Pertahankan ekstensi ASLI (.sqlite /
        // .json) supaya store non-sqlite (mis. topup_requests.json) IKUT terisolasi dari data prod
        // — bukan jadi "namafile.json_test.sqlite". Nama tanpa ekstensi tetap jatuh ke .sqlite (kompat).
        const ext = path.extname(dbName);
        const base = ext ? dbName.slice(0, -ext.length) : dbName;
        return path.join(dbDir, `${base}_test${ext || '.sqlite'}`);
    }
    
    // Production: Use original database name in database/ folder
    return path.join(dbDir, dbName);
};

// Environment-specific config file
const getConfigPath = () => {
    const baseDir = path.join(__dirname, '..');
    
    if (NODE_ENV === 'test' || NODE_ENV === 'development') {
        // Try test-specific config first
        const testConfig = path.join(baseDir, 'config.test.json');
        if (fs.existsSync(testConfig)) {
            return testConfig;
        }
    }
    
    // Default to production config
    const prodConfig = path.join(baseDir, 'config.json');
    if (!fs.existsSync(prodConfig)) {
        // Fallback to example
        const exampleConfig = path.join(baseDir, 'config.example.json');
        if (fs.existsSync(exampleConfig)) {
            console.warn(`[ENV_CONFIG] config.json not found, using config.example.json`);
            return exampleConfig;
        }
    }
    
    return prodConfig;
};

// Auto-bootstrap: salin config.example.json -> config.json bila config.json belum ada.
// config.json memang di-gitignore (berisi rahasia/PII), jadi tidak ikut saat git clone.
// Ini membuat aplikasi tetap bisa start setelah clone, dengan peringatan untuk mengisi kredensial.
const ensureConfigFromExample = () => {
    // Jangan auto-bikin config.json saat test (bisa mengganggu fixture/assertion).
    if (NODE_ENV === 'test') {
        return false;
    }

    const baseDir = path.join(__dirname, '..');
    const prodConfig = path.join(baseDir, 'config.json');
    const exampleConfig = path.join(baseDir, 'config.example.json');

    if (fs.existsSync(prodConfig) || !fs.existsSync(exampleConfig)) {
        return false;
    }

    fs.copyFileSync(exampleConfig, prodConfig);

    // Ganti placeholder jwt dengan secret acak yang unik per-instalasi.
    // Penting: template config.example.json bersifat publik, jadi nilai "ISI_JWT"
    // tidak boleh dipakai menandatangani token (siapa pun bisa memalsukan sesi).
    try {
        const crypto = require('crypto');
        const fresh = JSON.parse(fs.readFileSync(prodConfig, 'utf8'));
        if (typeof fresh.jwt !== 'string' || fresh.jwt.startsWith('ISI_') || fresh.jwt.trim() === '') {
            fresh.jwt = crypto.randomBytes(48).toString('hex');
            fs.writeFileSync(prodConfig, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
        }
    } catch (e) {
        console.warn(`[CONFIG_BOOTSTRAP] Gagal generate jwt acak: ${e.message}`);
    }

    const line = '='.repeat(72);
    console.warn(line);
    console.warn('[CONFIG_BOOTSTRAP] config.json tidak ditemukan saat startup.');
    console.warn('[CONFIG_BOOTSTRAP] File dibuat otomatis dari config.example.json.');
    console.warn('[CONFIG_BOOTSTRAP] (jwt secret acak sudah di-generate otomatis)');
    console.warn('[CONFIG_BOOTSTRAP] >> WAJIB isi kredensial asli (ipaymu, tokopay, bank,');
    console.warn('[CONFIG_BOOTSTRAP]    ownerNumber, olt, telegramBackup, genieacs, dll) di');
    console.warn('[CONFIG_BOOTSTRAP]    config.json sebelum dipakai di produksi.');
    console.warn(line);
    return true;
};

// Load configuration with environment awareness
const loadConfig = () => {
    ensureConfigFromExample();
    const configPath = getConfigPath();
    
    try {
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(configData);
            
            // Add environment info to config
            config.environment = NODE_ENV;
            config.isProduction = NODE_ENV === 'production';
            config.isTest = NODE_ENV === 'test' || NODE_ENV === 'development';
            
            // Log hanya jika bukan production
            if (NODE_ENV !== 'production' && shouldLogEnvBootstrap()) {
                console.log(`[ENV] ${NODE_ENV} mode - DB: ${getDatabasePath()}`);
            }

            // Guard: jangan jalan dengan jwt placeholder (token jadi bisa dipalsukan)
            if (typeof config.jwt !== 'string' || config.jwt.startsWith('ISI_') || config.jwt.trim() === '') {
                const line = '='.repeat(72);
                console.error(line);
                console.error('[CONFIG_SECURITY] config.jwt masih placeholder/kosong!');
                console.error('[CONFIG_SECURITY] Token sesi BISA DIPALSUKAN. Isi config.jwt');
                console.error('[CONFIG_SECURITY] dengan secret acak yang panjang sebelum produksi.');
                console.error(line);
            }

            return config;
        } else {
            throw new Error(`Configuration file not found: ${configPath}`);
        }
    } catch (error) {
        console.error(`[ENV_CONFIG_ERROR] Failed to load config:`, error.message);
        throw error;
    }
};

const parseBooleanEnv = (value) => {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return null;
};

const getMonitoringConfig = (config = null) => {
    const resolvedConfig = config || loadConfig();
    const envValue = parseBooleanEnv(process.env.MONITORING_ENABLED);

    if (envValue !== null) {
        return {
            enabled: envValue,
            source: 'env.MONITORING_ENABLED'
        };
    }

    if (resolvedConfig && resolvedConfig.monitoring && typeof resolvedConfig.monitoring.enabled === 'boolean') {
        return {
            enabled: resolvedConfig.monitoring.enabled,
            source: 'config.json:monitoring.enabled'
        };
    }

    return {
        enabled: false,
        source: 'default:false'
    };
};

// Validate environment setup
const validateEnvironment = () => {
    const errors = [];
    const warnings = [];
    
    // Check if we're in production mode
    if (NODE_ENV === 'production') {
        const prodDbPath = getDatabasePath('users.sqlite');
        const testDbPath = getDatabasePath('users_test.sqlite');
        
        // Informational only: test DB file may coexist on disk and does not affect production path resolution
        if (fs.existsSync(testDbPath)) {
            console.info(`[ENV_CONFIG_INFO] Test database file present but production DB path remains active: ${testDbPath}`);
        }
        
        // Verify database path is in database/ folder (not root)
        if (!prodDbPath.includes(path.sep + 'database' + path.sep) && !prodDbPath.includes('/database/')) {
            errors.push(`Database path is not in database/ folder: ${prodDbPath}`);
        }
        
        // Check if production database exists in correct location (database/ folder)
        // Note: Allow database.sqlite for backward compatibility (will be migrated)
        const oldDbPath = prodDbPath.replace('users.sqlite', 'database.sqlite');
        if (!fs.existsSync(prodDbPath) && !fs.existsSync(oldDbPath)) {
            warnings.push(`Production database not found: ${prodDbPath} (will be created on first run)`);
        }
        
        // Check PSB database
        const psbDbPath = getDatabasePath('psb_database.sqlite');
        if (!psbDbPath.includes(path.sep + 'database' + path.sep) && !psbDbPath.includes('/database/')) {
            errors.push(`PSB database path is not in database/ folder: ${psbDbPath}`);
        }
    }
    
    // Check if config file exists
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
        errors.push(`Configuration file not found: ${configPath}`);
    }
    
    // Log warnings and errors
    if (warnings.length > 0) {
        console.warn(`[ENV_CONFIG_WARN]`, warnings);
    }
    
    if (errors.length > 0) {
        console.error(`[ENV_CONFIG_ERROR]`, errors);
        throw new Error(`Environment validation failed: ${errors.join(', ')}`);
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
};

// Get environment info
const getEnvironmentInfo = () => {
    return {
        NODE_ENV,
        isProduction: NODE_ENV === 'production',
        isTest: NODE_ENV === 'test' || NODE_ENV === 'development',
        databasePath: getDatabasePath(),
        configPath: getConfigPath()
    };
};

module.exports = {
    NODE_ENV,
    getDatabasePath,
    getConfigPath,
    ensureConfigFromExample,
    loadConfig,
    getMonitoringConfig,
    validateEnvironment,
    getEnvironmentInfo
};

