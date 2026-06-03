#!/usr/bin/env node

/**
 * SAFE MD Files Cleanup Script
 * Move old/duplicate markdown files to archive
 * 
 * Usage:
 *   node tools/cleanup-md-files-safe.js          # Preview
 *   node tools/cleanup-md-files-safe.js --move    # Actually move
 */

const fs = require('fs');
const path = require('path');

// Old/duplicate docs to archive
const oldDocs = [
    // Refactoring docs (7 files - keep only 1 master)
    'RAF_JS_REFACTORING_COMPLETE.md',
    'REFACTORING_ANALYSIS.md',
    'REFACTORING_FINAL_SUMMARY_OCT_20.md',
    'REFACTORING_SUMMARY_OCT_20.md',
    'SAFE_REFACTORING_COMPLETE.md',
    'MIGRATION_COMPLETE_MAP.md',
    'ROLLBACK_FIX_AND_TEST.md',
    
    // Handler audit docs (4 files - redundant)
    'ACTION_ITEMS_HANDLERS_AUDIT.md',
    'COMPREHENSIVE_HANDLERS_AUDIT.md',
    'HANDLERS_STATUS_REPORT.md',
    'HANDLER_ANALYSIS_CUSTOMIZABLE.md',
    
    // Old bug fix docs (6 files - already applied)
    'COMMAND_DETECTION_BUG_FIX.md',
    'CHANGELOG_WIFI_KEYWORD_FIX.md',
    'CLEANUP_DUPLICATE_KEYWORDS_SUMMARY.md',
    'MULTIWORD_KEYWORD_FIX.md',
    'WIFI_HANDLER_FIX_COMPLETE.md',
    'WIFI_STEPS_SYNTAX_FIX.md',
    
    // Summary docs (4 files - multiple "final" summaries)
    'FINAL_FIX_SUMMARY.md',
    'FINAL_SUMMARY_ALL_FIXES.md',
    'SUMMARY_BUG_FIX.md',
    'DEPLOYMENT_SUCCESS.md',
    
    // Feature docs (3 files - outdated/integrated)
    'FEATURE_DEVICE_STATUS_IN_WIFI_INFO.md',
    'FIX_DEVICE_OFFLINE_ERROR_HANDLING.md',
    'ANALYSIS_GENIEACS_REFRESH_TIMING.md',
    
    // Misc old docs (6 files)
    'AGENT_HANDLER_MIGRATION.md',
    'AGENT_TRANSACTION_QUICKSTART.md',
    'SECURE_ERROR_HANDLING.md',
    'SECURITY_IMPROVEMENTS.md',
    'APPLY_DEVICE_CHECK_ALL_LOCATIONS.md',
    'QUICK_ANSWER.md',
    'TEST_REPORT_AGENT_SELF_SERVICE.md'
];

const moveMode = process.argv.includes('--move');

console.log('📄 MD FILES CLEANUP SCRIPT\n');
console.log(`Mode: ${moveMode ? '📦 MOVE MODE' : '👁️  PREVIEW MODE'}\n`);

let totalSize = 0;
let existingFiles = [];
let missingFiles = [];

// Analyze files
console.log('📋 Analyzing markdown files...\n');

oldDocs.forEach(file => {
    const fullPath = path.join(__dirname, '..', file);
    
    if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        totalSize += stats.size;
        
        existingFiles.push({
            name: file,
            path: fullPath,
            size: stats.size,
            sizeKB: sizeKB
        });
        
        console.log(`✅ ${file}`);
        console.log(`   Size: ${sizeKB} KB\n`);
    } else {
        missingFiles.push(file);
        console.log(`⚠️  ${file} - Not found\n`);
    }
});

// Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 SUMMARY:\n');
console.log(`Files found:     ${existingFiles.length}`);
console.log(`Files missing:   ${missingFiles.length}`);
console.log(`Total size:      ${(totalSize / 1024).toFixed(2)} KB`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (existingFiles.length === 0) {
    console.log('✅ No files to move. Already clean!\n');
    process.exit(0);
}

// If preview mode, stop here
if (!moveMode) {
    console.log('👁️  PREVIEW MODE - No files will be moved\n');
    console.log('📦 These files will be moved to: archive/old-docs-2025-10-21/\n');
    console.log('To actually move these files, run:');
    console.log('   node tools/cleanup-md-files-safe.js --move\n');
    console.log('💡 Benefit: Root directory will be cleaner');
    console.log('💡 Safety: Files can be restored from archive/\n');
    process.exit(0);
}

// Move mode - create archive
console.log('📦 MOVE MODE ACTIVE\n');

const archiveDir = path.join(__dirname, '..', 'archive', 'old-docs-2025-10-21');

try {
    if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
        console.log(`✅ Created archive: archive/old-docs-2025-10-21/\n`);
    }
} catch (error) {
    console.error('❌ Failed to create archive folder:', error.message);
    process.exit(1);
}

let movedCount = 0;
let errorCount = 0;

// Move files
console.log('📦 Moving files to archive...\n');

existingFiles.forEach(file => {
    try {
        const dest = path.join(archiveDir, file.name);
        fs.renameSync(file.path, dest);
        console.log(`✅ Moved: ${file.name} (${file.sizeKB} KB)`);
        movedCount++;
    } catch (error) {
        console.error(`❌ Error moving ${file.name}:`, error.message);
        errorCount++;
    }
});

// Final summary
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 FINAL SUMMARY:\n');
console.log(`✅ Moved:      ${movedCount} files`);
console.log(`❌ Errors:     ${errorCount} files`);
console.log(`📂 Location:   archive/old-docs-2025-10-21/`);
console.log(`💿 Size moved: ${(totalSize / 1024).toFixed(2)} KB`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (movedCount > 0) {
    console.log('✅ Cleanup complete!\n');
    console.log('📁 Root directory is now cleaner');
    console.log('📂 Old docs archived in: archive/old-docs-2025-10-21/');
    console.log('💡 You can restore them anytime if needed\n');
    
    console.log('📊 Active docs remaining in root:');
    console.log('   - Today\'s work (FITUR_BATAL_DAN_JAM_KERJA.md, etc)');
    console.log('   - Core documentation (ARCHITECTURE.md, README.md)');
    console.log('   - Active guides (SMART_REPORTING_SYSTEM_COMPLETE.md)\n');
}
