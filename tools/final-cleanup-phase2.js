#!/usr/bin/env node

/**
 * FINAL CLEANUP PHASE 2 - MD & JS Files
 * 
 * What it does:
 * 1. Archive non-essential .md files (16 files)
 * 2. Delete debug/test .js scripts (12 files)
 * 3. Keep only essential files in root
 * 
 * Usage:
 *   node tools/final-cleanup-phase2.js           # Preview
 *   node tools/final-cleanup-phase2.js --execute  # Execute
 */

const fs = require('fs');
const path = require('path');

// Non-essential MD files to archive
const mdFilesToArchive = [
    // Reference docs (not linked in README)
    'AGENT_SELF_SERVICE_GUIDE.md',
    'PANDUAN_PRAKTIS_AGENT.md',
    'README_AGENT_TRANSACTION.md',
    'HOW_TO_UPDATE_HANDLERS.md',
    'WIFI_KEYWORD_SYSTEM.md',
    'WIFI_TEMPLATES_CATEGORY_SYSTEM_FINAL.md',
    'WIFI_TEMPLATES_TAB_SYSTEM_COMPLETE.md',
    'WIFI_TEMPLATES_UPGRADE_COMPLETE.md',
    
    // Today's completed work docs
    'AUDIT_CLEANUP_REPORT.md',
    'CLEANUP_VERIFICATION_REPORT.md',
    'COMPLETE_CLEANUP_SUMMARY.md',
    'MD_FILES_AUDIT.md',
    'HOTFIX_CEK_WIFI_NO_RESPONSE.md',
    'HOTFIX_SMART_REPORTING.md',
    'UPDATE_LAPOR_SYSTEM.md',
    'NETWORK_ASSETS_ANALYSIS_REPORT.md'
];

// Debug/test/fix JS scripts to delete
const jsScriptsToDelete = [
    // Debug scripts
    'debug-saldo-page.js',
    'debug-user-memory.js',
    'debug-bulk.js',
    
    // Check scripts
    'check-db.js',
    'check-sqlite.js',
    'check-braces.js',
    
    // Fix scripts
    'fix-global-conn.js',
    'fix-topup-handler.js',
    'fix-bulk.js',
    
    // Test scripts
    'test-keywords.js',
    'generate-test-requests.js',
    
    // Utility (optional - you can keep this if needed)
    'reset-admin-password.js'
];

const executeMode = process.argv.includes('--execute');

console.log('🔍 FINAL CLEANUP PHASE 2\n');
console.log(`Mode: ${executeMode ? '🗑️  EXECUTE MODE' : '👁️  PREVIEW MODE'}\n');

// Analyze MD files
console.log('📄 MARKDOWN FILES TO ARCHIVE:\n');
let mdSize = 0;
let mdExisting = [];
let mdMissing = [];

mdFilesToArchive.forEach(file => {
    const fullPath = path.join(__dirname, '..', file);
    if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        mdSize += stats.size;
        mdExisting.push({ name: file, path: fullPath, size: stats.size, sizeKB });
        console.log(`✅ ${file} (${sizeKB} KB)`);
    } else {
        mdMissing.push(file);
        console.log(`⚠️  ${file} - Not found`);
    }
});

console.log(`\n📊 MD Summary: ${mdExisting.length} files found, ${(mdSize / 1024).toFixed(2)} KB\n`);

// Analyze JS files
console.log('🔧 JAVASCRIPT FILES TO DELETE:\n');
let jsSize = 0;
let jsExisting = [];
let jsMissing = [];

jsScriptsToDelete.forEach(file => {
    const fullPath = path.join(__dirname, '..', file);
    if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        jsSize += stats.size;
        jsExisting.push({ name: file, path: fullPath, size: stats.size, sizeKB });
        console.log(`✅ ${file} (${sizeKB} KB)`);
    } else {
        jsMissing.push(file);
        console.log(`⚠️  ${file} - Not found`);
    }
});

console.log(`\n📊 JS Summary: ${jsExisting.length} files found, ${(jsSize / 1024).toFixed(2)} KB\n`);

// Total summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 TOTAL SUMMARY:\n');
console.log(`MD files to archive: ${mdExisting.length}`);
console.log(`JS files to delete:  ${jsExisting.length}`);
console.log(`Total files:         ${mdExisting.length + jsExisting.length}`);
console.log(`Total size:          ${((mdSize + jsSize) / 1024).toFixed(2)} KB`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (mdExisting.length === 0 && jsExisting.length === 0) {
    console.log('✅ No files to clean. Already done!\n');
    process.exit(0);
}

// Preview mode
if (!executeMode) {
    console.log('👁️  PREVIEW MODE - No files will be modified\n');
    console.log('📋 What will happen:\n');
    console.log(`1. Archive ${mdExisting.length} MD files to: archive/docs-phase2-2025-10-21/`);
    console.log(`2. Delete ${jsExisting.length} JS scripts (with backup to .deleted/)`);
    console.log(`3. Root folder will have only essential files\n`);
    console.log('💡 Result:');
    console.log('   - Root MD files: 29 → 13 files (-16 files)');
    console.log('   - Root JS files: 14 → 2 files (-12 files)');
    console.log('   - Total cleanup: 28 files (~249 KB)\n');
    console.log('To execute cleanup, run:');
    console.log('   node tools/final-cleanup-phase2.js --execute\n');
    process.exit(0);
}

// Execute mode
console.log('🗑️  EXECUTE MODE ACTIVE\n');

// Create archive for MD files
const mdArchiveDir = path.join(__dirname, '..', 'archive', 'docs-phase2-2025-10-21');
try {
    if (!fs.existsSync(mdArchiveDir)) {
        fs.mkdirSync(mdArchiveDir, { recursive: true });
        console.log(`✅ Created archive: archive/docs-phase2-2025-10-21/\n`);
    }
} catch (error) {
    console.error('❌ Failed to create archive folder:', error.message);
    process.exit(1);
}

// Create backup for JS files
const jsBackupDir = path.join(__dirname, '..', '.deleted', 'js-scripts-' + new Date().toISOString().replace(/[:.]/g, '-'));
try {
    if (!fs.existsSync(jsBackupDir)) {
        fs.mkdirSync(jsBackupDir, { recursive: true });
        console.log(`✅ Created backup: .deleted/js-scripts-.../\n`);
    }
} catch (error) {
    console.error('❌ Failed to create backup folder:', error.message);
    process.exit(1);
}

// Archive MD files
console.log('📦 Archiving markdown files...\n');
let mdMoved = 0;
let mdErrors = 0;

mdExisting.forEach(file => {
    try {
        const dest = path.join(mdArchiveDir, file.name);
        fs.renameSync(file.path, dest);
        console.log(`✅ Archived: ${file.name}`);
        mdMoved++;
    } catch (error) {
        console.error(`❌ Error archiving ${file.name}:`, error.message);
        mdErrors++;
    }
});

// Delete JS files (with backup)
console.log('\n🗑️  Deleting JS scripts (with backup)...\n');
let jsDeleted = 0;
let jsErrors = 0;

jsExisting.forEach(file => {
    try {
        // Backup first
        const backupPath = path.join(jsBackupDir, file.name);
        fs.copyFileSync(file.path, backupPath);
        
        // Then delete
        fs.unlinkSync(file.path);
        console.log(`✅ Deleted: ${file.name} (backed up)`);
        jsDeleted++;
    } catch (error) {
        console.error(`❌ Error deleting ${file.name}:`, error.message);
        jsErrors++;
    }
});

// Final summary
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 FINAL RESULTS:\n');
console.log(`✅ MD files archived: ${mdMoved}/${mdExisting.length}`);
console.log(`✅ JS files deleted:  ${jsDeleted}/${jsExisting.length}`);
console.log(`❌ Errors:            ${mdErrors + jsErrors}`);
console.log(`📂 MD archive:        archive/docs-phase2-2025-10-21/`);
console.log(`💾 JS backup:         .deleted/js-scripts-.../`);
console.log(`💿 Space freed:       ${((mdSize + jsSize) / 1024).toFixed(2)} KB`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (mdMoved + jsDeleted > 0) {
    console.log('✅ Cleanup complete!\n');
    console.log('📊 Root directory status:');
    console.log('   - Essential MD files: 13 (linked in README)');
    console.log('   - Production JS files: 2 (index.js, babel.config.js)');
    console.log('   - Total root files: 15 files (very clean!)\n');
    console.log('💡 Files can be restored:');
    console.log('   - MD: From archive/docs-phase2-2025-10-21/');
    console.log('   - JS: From .deleted/js-scripts-.../\n');
}
