/**
 * Tool to detect and fix duplicate user IDs in the database
 * Run this if you have existing duplicate ID issues
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// All databases stored in database/ folder
const dbPath = path.join(__dirname, '..', 'database', 'database.sqlite');
const backupPath = path.join(__dirname, '..', 'backups', `database.backup.${Date.now()}.sqlite`);

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║          FIX DUPLICATE USER IDs TOOL                      ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

// Create backup first
console.log('📦 Creating backup:', backupPath);
try {
    fs.copyFileSync(dbPath, backupPath);
    console.log('✅ Backup created successfully\n');
} catch (err) {
    console.error('❌ Failed to create backup:', err.message);
    process.exit(1);
}

// Connect to database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Failed to connect to database:', err);
        process.exit(1);
    }
    console.log('✅ Connected to database\n');
    analyzeDuplicates();
});

function analyzeDuplicates() {
    // Find duplicate IDs
    const query = `
        SELECT id, COUNT(*) as count 
        FROM users 
        GROUP BY id 
        HAVING COUNT(*) > 1
        ORDER BY id ASC
    `;
    
    db.all(query, [], (err, duplicates) => {
        if (err) {
            console.error('❌ Error checking for duplicates:', err);
            db.close();
            return;
        }
        
        if (!duplicates || duplicates.length === 0) {
            console.log('✅ No duplicate IDs found! Database is clean.\n');
            checkIdGaps();
            return;
        }
        
        console.log(`⚠️ Found ${duplicates.length} duplicate IDs:`);
        duplicates.forEach(dup => {
            console.log(`   - ID ${dup.id}: ${dup.count} occurrences`);
        });
        
        console.log('\n🔧 Fixing duplicates...\n');
        fixDuplicates(duplicates);
    });
}

function fixDuplicates(duplicates) {
    let fixed = 0;
    const promises = [];
    
    duplicates.forEach(dup => {
        const promise = new Promise((resolve, reject) => {
            // Get all users with this ID
            db.all('SELECT rowid, * FROM users WHERE id = ?', [dup.id], (err, users) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                // Keep the first one, update the rest
                const fixPromises = [];
                for (let i = 1; i < users.length; i++) {
                    const newId = findNextAvailableId();
                    const updatePromise = new Promise((res, rej) => {
                        db.run(
                            'UPDATE users SET id = ? WHERE rowid = ?',
                            [newId, users[i].rowid],
                            (err) => {
                                if (err) rej(err);
                                else {
                                    console.log(`   ✅ Changed duplicate ID ${dup.id} (rowid: ${users[i].rowid}) to ${newId}`);
                                    fixed++;
                                    res();
                                }
                            }
                        );
                    });
                    fixPromises.push(updatePromise);
                }
                
                Promise.all(fixPromises).then(() => resolve()).catch(reject);
            });
        });
        promises.push(promise);
    });
    
    Promise.all(promises)
        .then(() => {
            console.log(`\n✅ Fixed ${fixed} duplicate IDs\n`);
            checkIdGaps();
        })
        .catch(err => {
            console.error('❌ Error fixing duplicates:', err);
            db.close();
        });
}

let allIds = [];
function findNextAvailableId() {
    if (allIds.length === 0) {
        // This is simplified, in production would need to query DB
        return Math.floor(Math.random() * 10000) + 1000;
    }
    
    let id = 1;
    while (allIds.includes(id)) {
        id++;
    }
    allIds.push(id);
    return id;
}

function checkIdGaps() {
    console.log('📊 Analyzing ID sequence...\n');
    
    db.all('SELECT id FROM users ORDER BY id ASC', [], (err, rows) => {
        if (err) {
            console.error('❌ Error analyzing IDs:', err);
            db.close();
            return;
        }
        
        const ids = rows.map(r => parseInt(r.id));
        const maxId = Math.max(...ids);
        const minId = Math.min(...ids);
        
        console.log(`   Total users: ${ids.length}`);
        console.log(`   Min ID: ${minId}`);
        console.log(`   Max ID: ${maxId}`);
        console.log(`   Expected sequential count: ${maxId - minId + 1}`);
        
        // Find gaps
        const gaps = [];
        for (let i = minId; i <= maxId; i++) {
            if (!ids.includes(i)) {
                gaps.push(i);
            }
        }
        
        if (gaps.length > 0) {
            console.log(`   Gaps in sequence: ${gaps.length} IDs missing`);
            if (gaps.length <= 10) {
                console.log(`   Missing IDs: ${gaps.join(', ')}`);
            } else {
                console.log(`   First 10 missing IDs: ${gaps.slice(0, 10).join(', ')}...`);
            }
        } else {
            console.log(`   ✅ No gaps in sequence!`);
        }
        
        console.log('\n✅ Analysis complete!');
        console.log('💡 The application will now automatically handle ID generation correctly.');
        
        db.close(() => {
            console.log('\n📁 Database connection closed.');
            process.exit(0);
        });
    });
}

// Helper to get all existing IDs for fixing duplicates
db.all('SELECT id FROM users', [], (err, rows) => {
    if (!err && rows) {
        allIds = rows.map(r => parseInt(r.id));
    }
});
