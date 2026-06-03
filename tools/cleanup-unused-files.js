#!/usr/bin/env node

/**
 * Cleanup Script - Remove Unused/Backup Files
 * Run with: node tools/cleanup-unused-files.js
 */

const fs = require('fs');
const path = require('path');

const filesToDelete = [
    // Old files
    'message/raf-old.js',
    'views/sb-admin/saldo-management-old.php',
    
    // Backup files
    'index.js.backup',
    'message/raf.js.backup',
    'message/raf.js.backup-1760775365630',
    'message/raf.js.backup-20251021-010736',
    'database/wifi_templates.json.backup-20251021-010736'
];

console.log('🧹 Starting cleanup...\n');

let deletedCount = 0;
let notFoundCount = 0;
let errorCount = 0;

filesToDelete.forEach(relativePath => {
    const fullPath = path.join(__dirname, '..', relativePath);
    
    try {
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            console.log(`✅ Deleted: ${relativePath}`);
            deletedCount++;
        } else {
            console.log(`⚠️  Not found: ${relativePath}`);
            notFoundCount++;
        }
    } catch (error) {
        console.error(`❌ Error deleting ${relativePath}:`, error.message);
        errorCount++;
    }
});

console.log('\n📊 Summary:');
console.log(`   Deleted: ${deletedCount} files`);
console.log(`   Not Found: ${notFoundCount} files`);
console.log(`   Errors: ${errorCount} files`);

console.log('\n✅ Cleanup complete!');
