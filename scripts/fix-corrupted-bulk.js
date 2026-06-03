/**
 * Script untuk memperbaiki data bulk yang corrupt di database
 * Menemukan dan memperbaiki user yang memiliki bulk = "[object Object]"
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'database', 'users.sqlite');

if (!fs.existsSync(dbPath)) {
    console.error(`[FIX_BULK] Database tidak ditemukan: ${dbPath}`);
    process.exit(1);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('[FIX_BULK] Error opening database:', err.message);
        process.exit(1);
    }
    console.log('[FIX_BULK] Connected to database');
});

// Cari semua user dengan bulk corrupt
db.all('SELECT id, name, phone_number, bulk FROM users WHERE bulk IS NOT NULL', [], (err, rows) => {
    if (err) {
        console.error('[FIX_BULK] Error querying database:', err.message);
        db.close();
        process.exit(1);
    }

    console.log(`[FIX_BULK] Found ${rows.length} users with bulk data`);
    
    let corruptedCount = 0;
    let fixedCount = 0;
    const corruptedUsers = [];

    rows.forEach((user) => {
        const bulk = user.bulk;
        
        // Cek apakah bulk corrupt
        if (typeof bulk === 'string') {
            const trimmed = bulk.trim();
            if (trimmed === '[object Object]' || trimmed.startsWith('[object')) {
                corruptedUsers.push({
                    id: user.id,
                    name: user.name,
                    phone_number: user.phone_number,
                    corruptedBulk: trimmed
                });
                corruptedCount++;
            }
        } else if (bulk && typeof bulk === 'object' && !Array.isArray(bulk)) {
            // Jika bulk adalah object (bukan array), juga dianggap corrupt
            corruptedUsers.push({
                id: user.id,
                name: user.name,
                phone_number: user.phone_number,
                corruptedBulk: '[object Object] (object type)'
            });
            corruptedCount++;
        }
    });

    if (corruptedCount === 0) {
        console.log('[FIX_BULK] ✅ Tidak ada data bulk yang corrupt');
        db.close();
        process.exit(0);
    }

    console.log(`[FIX_BULK] ⚠️  Found ${corruptedCount} users with corrupted bulk data:`);
    corruptedUsers.forEach(u => {
        console.log(`  - User ID ${u.id}: ${u.name} (${u.phone_number}) - "${u.corruptedBulk}"`);
    });

    // Fix corrupted data
    console.log('\n[FIX_BULK] Memperbaiki data corrupt...');
    
    corruptedUsers.forEach((user) => {
        // Set bulk ke default: ['1'] atau null
        const defaultBulk = JSON.stringify(['1']);
        
        db.run('UPDATE users SET bulk = ? WHERE id = ?', [defaultBulk, user.id], function(err) {
            if (err) {
                console.error(`[FIX_BULK] ❌ Error fixing user ${user.id}:`, err.message);
            } else {
                fixedCount++;
                console.log(`[FIX_BULK] ✅ Fixed user ${user.id}: ${user.name} - set bulk to default ['1']`);
            }

            // Close database setelah semua fix selesai
            if (fixedCount === corruptedCount) {
                console.log(`\n[FIX_BULK] ✅ Selesai! Fixed ${fixedCount} users`);
                db.close((err) => {
                    if (err) {
                        console.error('[FIX_BULK] Error closing database:', err.message);
                    } else {
                        console.log('[FIX_BULK] Database closed');
                    }
                    process.exit(0);
                });
            }
        });
    });
});

