/**
 * Analyze database.sqlite file size - what's taking up space?
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { getDatabasePath } = require('../lib/env-config');

const dbPath = getDatabasePath('database.sqlite');

console.log('=== DATABASE FILE SIZE ANALYSIS ===');
console.log('Database path:', dbPath);
console.log('');

if (!fs.existsSync(dbPath)) {
    console.error('❌ Database file not found!');
    process.exit(1);
}

const stats = fs.statSync(dbPath);
console.log('📁 FILE INFORMATION:');
console.log('  File size:', stats.size, 'bytes (', (stats.size / 1024).toFixed(2), 'KB)');
console.log('');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error opening database:', err.message);
        process.exit(1);
    }
    
    console.log('✅ Connected to database');
    console.log('');
    
    // Get page information
    db.get("SELECT page_count, page_size, freelist_count FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count()", [], (err, pageInfo) => {
        if (err) {
            console.error('Error getting page info:', err.message);
            db.close();
            return;
        }
        
        console.log('📊 PAGE INFORMATION:');
        console.log('  Page size:', pageInfo.page_size, 'bytes');
        console.log('  Total pages:', pageInfo.page_count);
        console.log('  Total size:', pageInfo.page_count * pageInfo.page_size, 'bytes (', ((pageInfo.page_count * pageInfo.page_size) / 1024).toFixed(2), 'KB)');
        console.log('  Freelist count (deleted pages):', pageInfo.freelist_count);
        const usedPages = pageInfo.page_count - (pageInfo.freelist_count || 0);
        console.log('  Used pages:', usedPages);
        console.log('  Used size:', usedPages * pageInfo.page_size, 'bytes (', ((usedPages * pageInfo.page_size) / 1024).toFixed(2), 'KB)');
        console.log('');
        
        // Get all tables
        db.all("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, tables) => {
            if (err) {
                console.error('Error getting tables:', err.message);
                db.close();
                return;
            }
            
            console.log('📋 TABLES BREAKDOWN:');
            console.log('─'.repeat(70));
            
            let totalTableRows = 0;
            let tableIndex = 0;
            
            function analyzeNextTable() {
                if (tableIndex >= tables.length) {
                    console.log('─'.repeat(70));
                    console.log('📊 TOTAL ROWS IN ALL TABLES:', totalTableRows);
                    console.log('');
                    
                    // Get index information
                    db.all("SELECT name, sql FROM sqlite_master WHERE type='index' ORDER BY name", [], (err, indexes) => {
                        if (err) {
                            console.error('Error getting indexes:', err.message);
                            db.close();
                            return;
                        }
                        
                        console.log('📑 INDEXES:');
                        console.log('─'.repeat(70));
                        console.log('  Total indexes:', indexes.length);
                        indexes.forEach((idx, i) => {
                            const idxName = idx.sql ? idx.sql.substring(0, 80) : idx.name;
                            console.log(`  ${i + 1}. ${idx.name}`);
                            if (idx.sql) {
                                console.log(`     ${idx.sql.substring(0, 80)}${idx.sql.length > 80 ? '...' : ''}`);
                            }
                        });
                        console.log('');
                        
                        // Estimate space usage
                        console.log('💾 SPACE BREAKDOWN ESTIMATE:');
                        console.log('─'.repeat(70));
                        
                        const pageSize = pageInfo.page_size;
                        const totalPages = pageInfo.page_count;
                        const totalSize = totalPages * pageSize;
                        
                        // Each table schema takes space in sqlite_master
                        const schemaSpace = tables.length * 1024; // Rough estimate
                        
                        // Each index takes space
                        const indexSpace = indexes.length * 2048; // Rough estimate per index
                        
                        // Metadata and overhead
                        const metadataSpace = 8192; // SQLite header and metadata
                        
                        // Calculate data space
                        const calculatedSpace = schemaSpace + indexSpace + metadataSpace;
                        const remainingSpace = totalSize - calculatedSpace;
                        
                        console.log(`  📐 Page overhead: ${totalPages} pages × ${pageSize} bytes = ${totalSize} bytes`);
                        console.log(`  📋 Table schemas: ~${schemaSpace} bytes (${tables.length} tables)`);
                        console.log(`  📑 Index definitions: ~${indexSpace} bytes (${indexes.length} indexes)`);
                        console.log(`  🔧 Metadata & header: ~${metadataSpace} bytes`);
                        console.log(`  📊 Data space: ~${remainingSpace} bytes`);
                        console.log('');
                        console.log(`  TOTAL: ~${totalSize} bytes (${(totalSize / 1024).toFixed(2)} KB)`);
                        console.log('');
                        
                        console.log('📝 NOTES:');
                        console.log('  • SQLite uses fixed page size allocation');
                        console.log('  • Even empty tables reserve space in the file');
                        console.log('  • Indexes take up space even when empty');
                        console.log('  • Metadata (CREATE TABLE, CREATE INDEX) is stored in file');
                        console.log('  • File size doesn\'t shrink automatically - needs VACUUM');
                        console.log('');
                        
                        if (totalTableRows === 0 && remainingSpace > 50000) {
                            console.log('⚠️  WARNING: Large file with 0 data rows detected!');
                            console.log('  This is normal for SQLite - structure takes up space.');
                            console.log('  To minimize file size, you would need to:');
                            console.log('    1. Drop unused indexes');
                            console.log('    2. Drop and recreate tables');
                            console.log('    3. But this is NOT recommended for production!');
                            console.log('');
                        }
                        
                        db.close();
                        console.log('✅ Analysis complete!');
                    });
                    return;
                }
                
                const table = tables[tableIndex];
                
                // Get row count
                db.get(`SELECT COUNT(*) as count FROM ${table.name}`, [], (err, row) => {
                    if (err) {
                        console.error(`  ❌ Error counting ${table.name}:`, err.message);
                        tableIndex++;
                        analyzeNextTable();
                        return;
                    }
                    
                    const rowCount = row ? row.count : 0;
                    totalTableRows += rowCount;
                    
                    // Calculate estimated space per table
                    let estimatedSpace = 0;
                    if (rowCount > 0) {
                        // Rough estimate: 100-500 bytes per row depending on columns
                        const avgRowSize = 200; // Conservative estimate
                        estimatedSpace = rowCount * avgRowSize;
                    } else {
                        // Even empty tables have schema overhead
                        estimatedSpace = 512; // Schema definition in sqlite_master
                    }
                    
                    console.log(`  📊 ${table.name}:`);
                    console.log(`     Rows: ${rowCount}`);
                    console.log(`     Estimated space: ~${estimatedSpace} bytes`);
                    if (table.sql) {
                        // Count columns
                        const columnMatches = table.sql.match(/,\s*\w+/g);
                        const columnCount = columnMatches ? columnMatches.length + 1 : 1;
                        console.log(`     Columns: ${columnCount}`);
                    }
                    console.log('');
                    
                    tableIndex++;
                    analyzeNextTable();
                });
            }
            
            analyzeNextTable();
        });
    });
});

