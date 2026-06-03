/**
 * Database Reload Utility
 * Reload database from SQLite without restarting the application
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Reload users from SQLite database into memory
 * This updates global.users without needing to restart
 */
function reloadUsersFromDatabase() {
    return new Promise((resolve, reject) => {
        // All databases stored in database/ folder
        // Main customer database: users.sqlite
        const { getDatabasePath } = require('./env-config');
        const dbPath = getDatabasePath('users.sqlite');
        const db = new sqlite3.Database(dbPath);
        
        console.log('[DB_RELOAD] Starting database reload...');
        
        db.all("SELECT * FROM users ORDER BY id ASC", [], (err, rows) => {
            if (err) {
                console.error('[DB_RELOAD] Error loading users:', err);
                db.close();
                return reject(err);
            }
            
            // Transform the data to match application format
            const transformedUsers = rows.map(user => ({
                ...user,
                paid: user.paid === 1,
                send_invoice: user.send_invoice === 1,
                is_corporate: user.is_corporate === 1,
                // Handle phone numbers (might be pipe-separated)
                phone: user.phone_number,
                // Handle package/subscription alias
                package: user.subscription,
                // Ensure proper date formatting
                created_at: user.created_at || new Date().toISOString(),
                updated_at: user.updated_at || new Date().toISOString()
            }));
            
            // Store old user count for comparison
            const oldCount = global.users ? global.users.length : 0;
            const oldColumns = global.users && global.users[0] ? Object.keys(global.users[0]).length : 0;
            
            // Update global users
            global.users = transformedUsers;
            
            // Count new columns (if users exist)
            const newCount = global.users.length;
            const newColumns = global.users[0] ? Object.keys(global.users[0]).length : 0;
            
            console.log(`[DB_RELOAD] Successfully loaded and transformed ${newCount} users into memory.`);
            console.log(`[DB_RELOAD] Changes: ${oldCount} → ${newCount} users, ${oldColumns} → ${newColumns} fields`);
            
            db.close((closeErr) => {
                if (closeErr) {
                    console.error('[DB_RELOAD] Warning: Error closing database:', closeErr);
                }
                resolve({
                    success: true,
                    oldCount,
                    newCount,
                    oldColumns,
                    newColumns,
                    message: `Database reloaded: ${newCount} users`
                });
            });
        });
    });
}

/**
 * Reload all JSON databases (packages, odps, etc)
 * Optional - only if these might have changed
 */
function reloadJSONDatabases() {
    try {
        // Reload packages if needed
        if (global.packages) {
            delete require.cache[require.resolve('../database/packages.json')];
            global.packages = require('../database/packages.json');
            console.log('[DB_RELOAD] Reloaded packages.json');
        }
        
        // Reload ODPs if needed
        if (global.odps) {
            delete require.cache[require.resolve('../database/odps.json')];
            global.odps = require('../database/odps.json');
            console.log('[DB_RELOAD] Reloaded odps.json');
        }
        
        // Reload accounts if needed
        if (global.accounts) {
            delete require.cache[require.resolve('../database/accounts.json')];
            global.accounts = require('../database/accounts.json');
            console.log('[DB_RELOAD] Reloaded accounts.json');
        }
        
        return true;
    } catch (err) {
        console.error('[DB_RELOAD] Error reloading JSON databases:', err);
        return false;
    }
}

/**
 * Full database reload - both SQLite and JSON
 */
async function fullDatabaseReload() {
    try {
        console.log('[DB_RELOAD] Starting full database reload...');
        
        // Reload SQLite users
        const result = await reloadUsersFromDatabase();
        
        // Reload JSON databases
        reloadJSONDatabases();
        
        console.log('[DB_RELOAD] Full reload completed successfully');
        return result;
    } catch (err) {
        console.error('[DB_RELOAD] Full reload failed:', err);
        throw err;
    }
}

module.exports = {
    reloadUsersFromDatabase,
    reloadJSONDatabases,
    fullDatabaseReload
};
