/**
 * Header Doc
 * Purpose: Memuat ulang data dari SQLite/JSON ke memori (`global.users`, `global.packages`, dll)
 *   tanpa merestart proses bot.
 * Caller: Route admin yang mengubah data massal + utilitas maintenance.
 * Deps: `./env-config` (getDatabasePath), `./sqlite-shared-reader` (koneksi baca bersama),
 *   `database/*.json` via require-cache.
 * MainFuncs: `reloadUsersFromDatabase`, `reloadJSONDatabases`.
 * SideEffects: Menimpa state `global.*` in-memory dan membuang require-cache JSON database.
 */

/**
 * Reload users from SQLite database into memory
 * This updates global.users without needing to restart
 */
function reloadUsersFromDatabase() {
    return new Promise((resolve, reject) => {
        // All databases stored in database/ folder
        // Main customer database: users.sqlite
        const { getDatabasePath } = require('./env-config');
        const { normalizeUserRow } = require('./user-row-normalizer');
        const { getSharedReader } = require('./sqlite-shared-reader');
        const dbPath = getDatabasePath('users.sqlite');
        // Koneksi baca BERSAMA — dulu di sini dibuka koneksi baru lalu ditutup, pola yang
        // me-yatimkan `-wal`/`-shm` users.sqlite. Lihat lib/sqlite-shared-reader.
        const db = getSharedReader(dbPath);

        console.log('[DB_RELOAD] Starting database reload...');

        db.all("SELECT * FROM users ORDER BY id ASC", [], (err, rows) => {
            if (err) {
                console.error('[DB_RELOAD] Error loading users:', err);
                return reject(err);
            }
            
            // Transform the data to match application format
            // Lewat normalizer BERSAMA. Transform inline sebelumnya tak mem-parse `bulk` sama
            // sekali, sehingga setelah admin menekan Reload di halaman Database nilainya jadi
            // TEKS mentah (string `"[1,5]"`, bukan array `[1,5]`) — beda dengan pemuatan awal
            // di lib/database.js. Kode yang mengiterasi indeks SSID lalu memperlakukan string
            // itu sebagai daftar karakter: SSID kedua pelanggan berhenti ikut diubah, dan
            // gejalanya baru terlihat saat ganti nama/sandi WiFi massal tak berpengaruh pada
            // sebagian pelanggan.
            const transformedUsers = rows.map((user) => normalizeUserRow(user));
            
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
            
            // Koneksi TIDAK ditutup — dipakai bersama & sengaja berumur panjang.
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
