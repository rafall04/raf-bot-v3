/**
 * PSB Database Module
 * Database terpisah untuk menyimpan data PSB (Pasang Baru)
 * Database: database/psb_database.sqlite (production) atau database/psb_database_test.sqlite (test)
 * Tabel: psb_records
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Get NODE_ENV
const NODE_ENV = process.env.NODE_ENV || 'production';

// Debug flag - set to true for verbose logging
const DEBUG = process.env.PSB_DEBUG === 'true' || false;

// Path to PSB database - using environment-aware path
function getPSBDatabasePath() {
    try {
        const { getDatabasePath } = require('./env-config');
        return getDatabasePath('psb_database.sqlite');
    } catch (e) {
        // Fallback if env-config not available
        const dbDir = path.join(__dirname, '..', 'database');
        const dbName = (NODE_ENV === 'test' || NODE_ENV === 'development') ? 'psb_database_test.sqlite' : 'psb_database.sqlite';
        return path.join(dbDir, dbName);
    }
}

// Path to PSB database (will be set correctly based on environment)
const psbDbPath = getPSBDatabasePath();

// Global PSB database connection
let psbDb = null;

/**
 * Initialize PSB database and create table if not exists
 */
function initializePSBDatabase() {
    return new Promise((resolve, reject) => {
        // Initializing PSB database (silent)
        
        // Ensure database directory exists
        const dbDir = path.dirname(psbDbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
            // Directory created (silent)
        }
        
        // Verify PSB database path is in database/ folder (not root)
        if (!psbDbPath.includes(path.sep + 'database' + path.sep) && !psbDbPath.includes('/database/')) {
            console.warn(`[PSB_DB_INIT] WARNING: PSB database path is not in database/ folder: ${psbDbPath}`);
        }
        
        psbDb = new sqlite3.Database(psbDbPath, (err) => {
            if (err) {
                console.error('[PSB_DB_INIT] Error opening PSB database:', err.message);
                return reject(err);
            }
            
            // PSB database connected (silent)
            
            // Create psb_records table
            const createTableSql = `
                CREATE TABLE IF NOT EXISTS psb_records (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    phone_number TEXT NOT NULL,
                    address TEXT,
                    latitude REAL,
                    longitude REAL,
                    location_url TEXT,
                    psb_status TEXT NOT NULL,
                    psb_data TEXT,
                    psb_wifi_ssid TEXT,
                    psb_wifi_password TEXT,
                    odc_id TEXT,
                    odp_id TEXT,
                    installed_odc_id TEXT,
                    installed_odp_id TEXT,
                    port_number TEXT,
                    installation_notes TEXT,
                    subscription TEXT,
                    device_id TEXT,
                    pppoe_username TEXT,
                    pppoe_password TEXT,
                    created_at TEXT NOT NULL,
                    created_by TEXT,
                    updated_at TEXT,
                    phase1_completed_at TEXT,
                    phase2_completed_at TEXT,
                    phase3_completed_at TEXT
                )
            `;
            
            psbDb.run(createTableSql, (err) => {
                if (err) {
                    console.error('[PSB_DB_INIT] Error creating psb_records table:', err.message);
                    return reject(err);
                }
                
                // PSB table ready (silent)
                
                // Create indexes (nama konsisten dengan migration)
                psbDb.run('CREATE INDEX IF NOT EXISTS idx_psb_records_phone ON psb_records(phone_number)', () => {});
                psbDb.run('CREATE INDEX IF NOT EXISTS idx_psb_records_status ON psb_records(psb_status)', () => {});
                
                // Store in global
                global.psbDb = psbDb;
                
                resolve(psbDb);
            });
        });
    });
}

/**
 * Load all PSB records from database
 */
function loadPSBRecords() {
    return new Promise((resolve, reject) => {
        if (!psbDb) {
            return reject(new Error('PSB database not initialized'));
        }
        
        psbDb.all('SELECT * FROM psb_records ORDER BY id ASC', [], (err, rows) => {
            if (err) {
                console.error('[PSB_DB_LOAD] Error loading PSB records:', err.message);
                return reject(err);
            }
            
            // Transform data: parse psb_data from JSON string
            const transformedRecords = rows.map(record => ({
                ...record,
                psb_data: (() => {
                    try {
                        if (!record.psb_data) return null;
                        if (typeof record.psb_data === 'string') {
                            return JSON.parse(record.psb_data);
                        }
                        return record.psb_data;
                    } catch (e) {
                        console.error(`[PSB_DB_LOAD] Failed to parse psb_data for record ${record.id}:`, e.message);
                        return null;
                    }
                })()
            }));
            
            // Store in global
            global.psbRecords = transformedRecords;
            
            // PSB records loaded (silent)
            
            resolve(transformedRecords);
        });
    });
}

/**
 * Insert new PSB record
 */
function insertPSBRecord(record) {
    return new Promise((resolve, reject) => {
        if (!psbDb) {
            return reject(new Error('PSB database not initialized'));
        }
        
        const psbDataJson = JSON.stringify(record.psb_data || {});
        
        const insertSql = `
            INSERT INTO psb_records (
                id, name, phone_number, address, latitude, longitude, location_url,
                psb_status, psb_data, odc_id, odp_id,
                created_at, created_by, phase1_completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        psbDb.run(insertSql, [
            record.id,
            record.name,
            record.phone_number,
            record.address,
            record.latitude,
            record.longitude,
            record.location_url,
            record.psb_status,
            psbDataJson,
            record.odc_id || null,
            record.odp_id || null,
            record.created_at,
            record.created_by,
            record.phase1_completed_at || record.created_at
        ], function(err) {
            if (err) {
                console.error('[PSB_DB_INSERT] Error inserting PSB record:', err.message);
                return reject(err);
            }
            
            if (DEBUG) console.log(`[PSB_DB_INSERT] PSB record ${record.id} inserted successfully`);
            resolve(this.lastID);
        });
    });
}

/**
 * Update PSB record
 */
function updatePSBRecord(id, updates) {
    return new Promise((resolve, reject) => {
        if (!psbDb) {
            return reject(new Error('PSB database not initialized'));
        }
        
        // Build update query dynamically
        const updateFields = [];
        const updateValues = [];
        
        if (updates.name !== undefined) {
            updateFields.push('name = ?');
            updateValues.push(updates.name);
        }
        if (updates.phone_number !== undefined) {
            updateFields.push('phone_number = ?');
            updateValues.push(updates.phone_number);
        }
        if (updates.address !== undefined) {
            updateFields.push('address = ?');
            updateValues.push(updates.address);
        }
        if (updates.latitude !== undefined) {
            updateFields.push('latitude = ?');
            updateValues.push(updates.latitude);
        }
        if (updates.longitude !== undefined) {
            updateFields.push('longitude = ?');
            updateValues.push(updates.longitude);
        }
        if (updates.location_url !== undefined) {
            updateFields.push('location_url = ?');
            updateValues.push(updates.location_url);
        }
        if (updates.psb_status !== undefined) {
            updateFields.push('psb_status = ?');
            updateValues.push(updates.psb_status);
        }
        if (updates.psb_data !== undefined) {
            updateFields.push('psb_data = ?');
            updateValues.push(JSON.stringify(updates.psb_data));
        }
        if (updates.psb_wifi_ssid !== undefined) {
            updateFields.push('psb_wifi_ssid = ?');
            updateValues.push(updates.psb_wifi_ssid);
        }
        if (updates.psb_wifi_password !== undefined) {
            updateFields.push('psb_wifi_password = ?');
            updateValues.push(updates.psb_wifi_password);
        }
        if (updates.odc_id !== undefined) {
            updateFields.push('odc_id = ?');
            updateValues.push(updates.odc_id);
        }
        if (updates.odp_id !== undefined) {
            updateFields.push('odp_id = ?');
            updateValues.push(updates.odp_id);
        }
        if (updates.installed_odc_id !== undefined) {
            updateFields.push('installed_odc_id = ?');
            updateValues.push(updates.installed_odc_id);
        }
        if (updates.installed_odp_id !== undefined) {
            updateFields.push('installed_odp_id = ?');
            updateValues.push(updates.installed_odp_id);
        }
        if (updates.port_number !== undefined) {
            updateFields.push('port_number = ?');
            updateValues.push(updates.port_number);
        }
        if (updates.installation_notes !== undefined) {
            updateFields.push('installation_notes = ?');
            updateValues.push(updates.installation_notes);
        }
        if (updates.subscription !== undefined) {
            updateFields.push('subscription = ?');
            updateValues.push(updates.subscription);
        }
        if (updates.device_id !== undefined) {
            updateFields.push('device_id = ?');
            updateValues.push(updates.device_id);
        }
        if (updates.pppoe_username !== undefined) {
            updateFields.push('pppoe_username = ?');
            updateValues.push(updates.pppoe_username);
        }
        if (updates.pppoe_password !== undefined) {
            updateFields.push('pppoe_password = ?');
            updateValues.push(updates.pppoe_password);
        }
        if (updates.phase1_completed_at !== undefined) {
            updateFields.push('phase1_completed_at = ?');
            updateValues.push(updates.phase1_completed_at);
        }
        if (updates.phase2_completed_at !== undefined) {
            updateFields.push('phase2_completed_at = ?');
            updateValues.push(updates.phase2_completed_at);
        }
        if (updates.phase3_completed_at !== undefined) {
            updateFields.push('phase3_completed_at = ?');
            updateValues.push(updates.phase3_completed_at);
        }
        
        // Always update updated_at
        updateFields.push('updated_at = ?');
        updateValues.push(new Date().toISOString());
        
        // Add id for WHERE clause
        updateValues.push(id);
        
        if (updateFields.length === 0) {
            return resolve(); // No updates
        }
        
        const updateSql = `UPDATE psb_records SET ${updateFields.join(', ')} WHERE id = ?`;
        
        psbDb.run(updateSql, updateValues, function(err) {
            if (err) {
                console.error('[PSB_DB_UPDATE] Error updating PSB record:', err.message);
                return reject(err);
            }
            
            if (DEBUG) console.log(`[PSB_DB_UPDATE] PSB record ${id} updated successfully`);
            resolve(this.changes);
        });
    });
}

/**
 * Get PSB record by ID
 */
function getPSBRecord(id) {
    return new Promise((resolve, reject) => {
        if (!psbDb) {
            return reject(new Error('PSB database not initialized'));
        }
        
        psbDb.get('SELECT * FROM psb_records WHERE id = ?', [id], (err, row) => {
            if (err) {
                return reject(err);
            }
            
            if (!row) {
                return resolve(null);
            }
            
            // Parse psb_data
            try {
                if (row.psb_data && typeof row.psb_data === 'string') {
                    row.psb_data = JSON.parse(row.psb_data);
                }
            } catch (e) {
                console.error(`[PSB_DB_GET] Failed to parse psb_data for record ${id}:`, e.message);
                row.psb_data = null;
            }
            
            resolve(row);
        });
    });
}

/**
 * Get PSB records by status
 */
function getPSBRecordsByStatus(status) {
    return new Promise((resolve, reject) => {
        if (!psbDb) {
            return reject(new Error('PSB database not initialized'));
        }
        
        psbDb.all('SELECT * FROM psb_records WHERE psb_status = ? ORDER BY id DESC', [status], (err, rows) => {
            if (err) {
                return reject(err);
            }
            
            // Parse psb_data for each record
            const transformedRecords = rows.map(record => {
                try {
                    if (record.psb_data && typeof record.psb_data === 'string') {
                        record.psb_data = JSON.parse(record.psb_data);
                    }
                } catch (e) {
                    console.error(`[PSB_DB_GET_STATUS] Failed to parse psb_data for record ${record.id}:`, e.message);
                    record.psb_data = null;
                }
                return record;
            });
            
            resolve(transformedRecords);
        });
    });
}

/**
 * Delete PSB record (if needed)
 */
function deletePSBRecord(id) {
    return new Promise((resolve, reject) => {
        if (!psbDb) {
            return reject(new Error('PSB database not initialized'));
        }
        
        psbDb.run('DELETE FROM psb_records WHERE id = ?', [id], function(err) {
            if (err) {
                return reject(err);
            }
            
            if (DEBUG) console.log(`[PSB_DB_DELETE] PSB record ${id} deleted`);
            resolve(this.changes);
        });
    });
}

/**
 * Get next available user ID from database.sqlite
 * Finds gaps in ID sequence or returns next sequential ID
 * @returns {Promise<number>} Next available ID
 */
function getNextAvailableUserId() {
    return new Promise((resolve, reject) => {
        if (!global.db) {
            return reject(new Error('Database not initialized'));
        }
        
        // Get all existing IDs from database
        global.db.all('SELECT id FROM users ORDER BY id ASC', [], (err, dbRows) => {
            if (err) {
                console.error('[GET_NEXT_ID_ERROR] Database query failed:', err);
                reject(err);
                return;
            }
            
            // Get all IDs from both database AND memory
            const dbIds = (dbRows || []).map(row => parseInt(row.id)).filter(id => !isNaN(id));
            const memoryIds = (global.users || []).map(user => parseInt(user.id)).filter(id => !isNaN(id));
            
            // Combine and deduplicate all IDs, sort ascending
            const allIds = [...new Set([...dbIds, ...memoryIds])].sort((a, b) => a - b);
            
            if (DEBUG) {
                console.log(`[GET_NEXT_ID] Found ${dbIds.length} IDs in database, ${memoryIds.length} in memory`);
                console.log(`[GET_NEXT_ID] All existing IDs:`, allIds.length > 0 ? `[${allIds.slice(0, 10).join(', ')}${allIds.length > 10 ? '...' : ''}]` : '[]');
            }
            
            // If no users at all, start with ID 1
            if (allIds.length === 0) {
                if (DEBUG) console.log('[GET_NEXT_ID] No existing users, starting with ID 1');
                resolve(1);
                return;
            }
            
            // Find the first gap in the sequence
            let expectedId = 1;
            for (const id of allIds) {
                if (id > expectedId) {
                    // Found a gap, use this ID
                    if (DEBUG) console.log(`[GET_NEXT_ID] Found gap at ID ${expectedId} (before ${id})`);
                    resolve(expectedId);
                    return;
                }
                expectedId = id + 1;
            }
            
            // No gaps found, use the next ID after the last one
            const nextId = Math.max(...allIds) + 1;
            if (DEBUG) console.log(`[GET_NEXT_ID] No gaps found, using next sequential ID: ${nextId}`);
            resolve(nextId);
        });
    });
}

/**
 * Get next available PSB ID from psb_records table AND users table
 * Finds gaps in ID sequence or returns next sequential ID
 * IMPORTANT: PSB records and users share the same ID space since PSB records
 * are eventually moved to users table. So we need to check BOTH tables.
 * @returns {Promise<number>} Next available ID
 */
function getNextAvailablePSBId() {
    return new Promise((resolve, reject) => {
        if (!psbDb || !global.db) {
            return reject(new Error('Database not initialized'));
        }
        
        // Get all existing IDs from PSB records database
        psbDb.all('SELECT id FROM psb_records ORDER BY id ASC', [], (err, psbDbRows) => {
            if (err) {
                console.error('[GET_NEXT_PSB_ID_ERROR] PSB database query failed:', err);
                return reject(err);
            }
            
            // Get all existing IDs from users database
            global.db.all('SELECT id FROM users ORDER BY id ASC', [], (err, usersDbRows) => {
                if (err) {
                    console.error('[GET_NEXT_PSB_ID_ERROR] Users database query failed:', err);
                    return reject(err);
                }
                
                // Get all IDs from PSB database, PSB memory, users database, and users memory
                const psbDbIds = (psbDbRows || []).map(row => parseInt(row.id)).filter(id => !isNaN(id));
                const psbMemoryIds = (global.psbRecords || []).map(record => parseInt(record.id)).filter(id => !isNaN(id));
                const usersDbIds = (usersDbRows || []).map(row => parseInt(row.id)).filter(id => !isNaN(id));
                const usersMemoryIds = (global.users || []).map(user => parseInt(user.id)).filter(id => !isNaN(id));
                
                // Combine and deduplicate all IDs from BOTH tables, sort ascending
                const allIds = [...new Set([...psbDbIds, ...psbMemoryIds, ...usersDbIds, ...usersMemoryIds])].sort((a, b) => a - b);
                
                if (DEBUG) {
                    console.log(`[GET_NEXT_PSB_ID] Found ${psbDbIds.length} IDs in PSB database, ${psbMemoryIds.length} in PSB memory`);
                    console.log(`[GET_NEXT_PSB_ID] Found ${usersDbIds.length} IDs in users database, ${usersMemoryIds.length} in users memory`);
                    console.log(`[GET_NEXT_PSB_ID] All existing IDs:`, allIds.length > 0 ? `[${allIds.slice(0, 10).join(', ')}${allIds.length > 10 ? '...' : ''}]` : '[]');
                }
                
                // If no records at all, start with ID 1
                if (allIds.length === 0) {
                    if (DEBUG) console.log('[GET_NEXT_PSB_ID] No existing records, starting with ID 1');
                    resolve(1);
                    return;
                }
                
                // Find the first gap in the sequence
                let expectedId = 1;
                for (const id of allIds) {
                    if (id > expectedId) {
                        // Found a gap, use this ID
                        if (DEBUG) console.log(`[GET_NEXT_PSB_ID] Found gap at ID ${expectedId} (before ${id})`);
                        resolve(expectedId);
                        return;
                    }
                    expectedId = id + 1;
                }
                
                // No gaps found, use the next ID after the last one
                const nextId = Math.max(...allIds) + 1;
                if (DEBUG) console.log(`[GET_NEXT_PSB_ID] No gaps found, using next sequential ID: ${nextId}`);
                resolve(nextId);
            });
        });
    });
}

/**
 * Move completed PSB record to users table
 * Called when psb_status = 'completed'
 * PSB ID is temporary (queue number), final user gets new sequential ID from database.sqlite
 * @returns {Promise<number>} The new user ID assigned
 */
function movePSBToUsers(psbRecord) {
    return new Promise(async (resolve, reject) => {
        if (!psbDb || !global.db) {
            return reject(new Error('Database not initialized'));
        }
        
        try {
            // Get next available ID from database.sqlite (not using PSB ID)
            let newUserId = await getNextAvailableUserId();
            
            // VALIDASI: Cek apakah ID sudah ada di database (race condition protection)
            const idExists = await new Promise((resolveCheck, rejectCheck) => {
                global.db.get('SELECT id FROM users WHERE id = ?', [newUserId], (err, row) => {
                    if (err) {
                        console.error('[PSB_DB_MOVE] Error checking ID existence:', err);
                        rejectCheck(err);
                        return;
                    }
                    resolveCheck(!!row);
                });
            });
            
            if (idExists) {
                console.warn(`[PSB_DB_MOVE] ID ${newUserId} already exists in database! Getting new ID...`);
                // Cari ID baru dengan query MAX + 1 sebagai fallback
                newUserId = await new Promise((resolveMax, rejectMax) => {
                    global.db.get('SELECT MAX(id) as maxId FROM users', [], (err, row) => {
                        if (err) {
                            rejectMax(err);
                            return;
                        }
                        const nextId = (row && row.maxId ? row.maxId : 0) + 1;
                        if (DEBUG) console.log(`[PSB_DB_MOVE] Using fallback MAX+1 ID: ${nextId}`);
                        resolveMax(nextId);
                    });
                });
            }
            
            if (DEBUG) console.log(`[PSB_DB_MOVE] PSB record ID ${psbRecord.id} (temporary) will be assigned new user ID ${newUserId} (final)`);
            
            // Extract SSID indices from psb_data if available
            let bulkSSIDs = [];
            try {
                if (psbRecord.psb_data && typeof psbRecord.psb_data === 'string') {
                    const psbData = JSON.parse(psbRecord.psb_data);
                    if (psbData.ssid_indices && Array.isArray(psbData.ssid_indices)) {
                        bulkSSIDs = psbData.ssid_indices.map(idx => String(idx));
                    }
                } else if (psbRecord.psb_data && psbRecord.psb_data.ssid_indices) {
                    bulkSSIDs = psbRecord.psb_data.ssid_indices.map(idx => String(idx));
                }
            } catch (e) {
                console.warn(`[PSB_DB_MOVE] Failed to parse SSID indices from psb_data: ${e.message}`);
            }
            
            // Insert into users table with new ID
            const insertUserSql = `
                INSERT INTO users (
                    id, name, phone_number, address, latitude, longitude, location_url,
                    subscription, device_id, paid,
                    pppoe_username, pppoe_password, connected_odp_id, bulk,
                    send_invoice, is_corporate, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            global.db.run(insertUserSql, [
                newUserId, // Use new ID, not PSB ID
                psbRecord.name,
                psbRecord.phone_number,
                psbRecord.address,
                psbRecord.latitude,
                psbRecord.longitude,
                psbRecord.location_url,
                psbRecord.subscription,
                psbRecord.device_id,
                0, // paid
                psbRecord.pppoe_username,
                psbRecord.pppoe_password,
                psbRecord.installed_odp_id || psbRecord.odp_id,
                bulkSSIDs.length > 0 ? JSON.stringify(bulkSSIDs) : null, // Save SSID indices as JSON string array
                0, // send_invoice
                0, // is_corporate
                psbRecord.created_at,
                new Date().toISOString()
            ], function(insertErr) {
                if (insertErr) {
                    // Handle duplicate ID error (SQLITE_CONSTRAINT)
                    if (insertErr.message && insertErr.message.includes('UNIQUE constraint failed')) {
                        console.error(`[PSB_DB_MOVE] DUPLICATE ID ERROR: ID ${newUserId} already exists! This should not happen.`);
                        console.error('[PSB_DB_MOVE] Error details:', insertErr.message);
                        return reject(new Error(`ID ${newUserId} sudah ada di database. Silakan coba lagi.`));
                    }
                    console.error('[PSB_DB_MOVE] Error inserting user:', insertErr.message);
                    return reject(insertErr);
                }
                
                if (DEBUG) console.log(`[PSB_DB_MOVE] PSB record ${psbRecord.id} (temporary) moved to users table with new ID ${newUserId} (final)`);
                
                // Return the new user ID
                resolve(newUserId);
            });
        } catch (error) {
            console.error('[PSB_DB_MOVE] Error getting next available ID:', error);
            reject(error);
        }
    });
}

module.exports = {
    initializePSBDatabase,
    loadPSBRecords,
    insertPSBRecord,
    updatePSBRecord,
    getPSBRecord,
    getPSBRecordsByStatus,
    deletePSBRecord,
    getNextAvailableUserId,
    getNextAvailablePSBId,
    movePSBToUsers
};

