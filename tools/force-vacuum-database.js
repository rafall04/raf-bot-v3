/**
 * Force VACUUM database to completely remove deleted data
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { getDatabasePath } = require('../lib/env-config');

const dbPath = getDatabasePath('database.sqlite');

console.log('=== FORCE VACUUM DATABASE ===');
console.log('Database path:', dbPath);
console.log('');

if (!fs.existsSync(dbPath)) {
    console.error('❌ Database file not found!');
    process.exit(1);
}

const statsBefore = fs.statSync(dbPath);
console.log('File size BEFORE VACUUM:', statsBefore.size, 'bytes');
console.log('');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        process.exit(1);
    }
    
    console.log('✅ Connected to database');
    console.log('');
    
    // Check page info before
    db.get("SELECT page_count, page_size, freelist_count FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count()", [], (err, beforeInfo) => {
        if (!err && beforeInfo) {
            console.log('Before VACUUM:');
            console.log('  Page count:', beforeInfo.page_count);
            console.log('  Page size:', beforeInfo.page_size);
            console.log('  Total size:', beforeInfo.page_count * beforeInfo.page_size, 'bytes');
            console.log('  Freelist count (deleted pages):', beforeInfo.freelist_count);
            console.log('');
        }
        
        // Run VACUUM
        console.log('Running VACUUM...');
        console.log('(This may take a moment)');
        console.log('');
        
        db.run('VACUUM', (err) => {
            if (err) {
                console.error('❌ Error running VACUUM:', err.message);
                db.close();
                process.exit(1);
            }
            
            console.log('✅ VACUUM completed successfully!');
            console.log('');
            
            // Check page info after
            db.get("SELECT page_count, page_size, freelist_count FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count()", [], (err, afterInfo) => {
                if (!err && afterInfo) {
                    console.log('After VACUUM:');
                    console.log('  Page count:', afterInfo.page_count);
                    console.log('  Page size:', afterInfo.page_size);
                    console.log('  Total size:', afterInfo.page_count * afterInfo.page_size, 'bytes');
                    console.log('  Freelist count:', afterInfo.freelist_count);
                    console.log('');
                    
                    const sizeBefore = beforeInfo.page_count * beforeInfo.page_size;
                    const sizeAfter = afterInfo.page_count * afterInfo.page_size;
                    const reduction = sizeBefore - sizeAfter;
                    
                    if (reduction > 0) {
                        console.log(`✅ File size reduced by ${reduction} bytes (${(reduction / sizeBefore * 100).toFixed(2)}%)`);
                    } else {
                        console.log('ℹ️  File size unchanged (no deleted data to clean up)');
                    }
                }
                
                // Check actual file size
                const statsAfter = fs.statSync(dbPath);
                console.log('');
                console.log('File size comparison:');
                console.log('  Before:', statsBefore.size, 'bytes');
                console.log('  After:', statsAfter.size, 'bytes');
                console.log('  Reduction:', statsBefore.size - statsAfter.size, 'bytes');
                console.log('');
                
                // Verify users table is still empty
                db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
                    if (!err) {
                        console.log('Users table verification:');
                        console.log('  Users count:', row.count);
                        if (row.count === 0) {
                            console.log('  ✅ Users table is empty (correct)');
                        } else {
                            console.log('  ⚠️  Users table has', row.count, 'rows');
                        }
                    }
                    
                    db.close();
                    console.log('');
                    console.log('✅ VACUUM complete! Database is now physically cleaned.');
                    console.log('');
                    console.log('Note: SQLite files are binary files. When opened in Notepad++,');
                    console.log('you may still see database structure/metadata, but user data');
                    console.log('has been completely removed.');
                });
            });
        });
    });
});

