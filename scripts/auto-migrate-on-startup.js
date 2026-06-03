#!/usr/bin/env node

/**
 * Auto Migration on Startup
 * 
 * Script ini dijalankan otomatis saat aplikasi start untuk:
 * - Check schema version
 * - Auto-migrate jika diperlukan
 * - Create backup sebelum migration
 * - Log semua migration activities
 */

const DatabaseMigrationManager = require('../lib/database-migration-manager');

async function runAutoMigration() {
    console.log('[AUTO_MIGRATION] Starting automatic database migration...');
    
    const migrationManager = new DatabaseMigrationManager();
    
    try {
        const results = await migrationManager.migrateAll();
        
        let hasChanges = false;
        let hasErrors = false;
        
        for (const [dbName, result] of Object.entries(results)) {
            if (result.skipped) {
                console.log(`[AUTO_MIGRATION] ${dbName}: Skipped (not found)`);
            } else if (result.error) {
                console.error(`[AUTO_MIGRATION] ${dbName}: ERROR - ${result.error}`);
                hasErrors = true;
            } else if (result.migrated) {
                console.log(`[AUTO_MIGRATION] ${dbName}: Migrated from v${result.currentVersion} to v${result.targetVersion}`);
                hasChanges = true;
            } else {
                console.log(`[AUTO_MIGRATION] ${dbName}: Already at version ${result.currentVersion}`);
            }
        }
        
        if (hasErrors) {
            console.warn('[AUTO_MIGRATION] Some migrations failed. Check logs above. Application will continue.');
            // Jangan exit(1) karena beberapa database mungkin tidak perlu migration
            // Biarkan aplikasi tetap jalan, hanya log warning
        } else if (hasChanges) {
            console.log('[AUTO_MIGRATION] All migrations completed successfully.');
        } else {
            console.log('[AUTO_MIGRATION] All databases are up to date.');
        }
        
        return results;
        
    } catch (error) {
        console.error('[AUTO_MIGRATION] Fatal error:', error);
        process.exit(1);
    }
}

// Run jika dipanggil langsung
if (require.main === module) {
    runAutoMigration()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('[AUTO_MIGRATION] Failed:', error);
            process.exit(1);
        });
}

module.exports = { runAutoMigration };

