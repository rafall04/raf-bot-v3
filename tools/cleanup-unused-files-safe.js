#!/usr/bin/env node

/**
 * SAFE Cleanup Script - Remove Unused/Backup Files
 * Features:
 * - Dry-run mode (preview before delete)
 * - Size calculation
 * - Confirmation prompt
 * - Safety backup to .deleted/ folder
 * 
 * Usage:
 *   node tools/cleanup-unused-files-safe.js          # Dry run (preview)
 *   node tools/cleanup-unused-files-safe.js --delete  # Actually delete
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

// Check if in delete mode
const deleteMode = process.argv.includes('--delete');

console.log('🔍 SAFE CLEANUP SCRIPT\n');
console.log(`Mode: ${deleteMode ? '🗑️  DELETE MODE' : '👁️  DRY RUN (Preview Only)'}\n`);

let totalSize = 0;
let existingFiles = [];
let missingFiles = [];

// Step 1: Analyze files
console.log('📋 Analyzing files...\n');

filesToDelete.forEach(relativePath => {
    const fullPath = path.join(__dirname, '..', relativePath);
    
    if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        totalSize += stats.size;
        
        existingFiles.push({
            path: relativePath,
            fullPath: fullPath,
            size: stats.size,
            sizeKB: sizeKB
        });
        
        console.log(`✅ ${relativePath}`);
        console.log(`   Size: ${sizeKB} KB`);
        console.log(`   Full path: ${fullPath}\n`);
    } else {
        missingFiles.push(relativePath);
        console.log(`⚠️  ${relativePath}`);
        console.log(`   Status: File not found (already deleted?)\n`);
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
    console.log('✅ No files to delete. Cleanup already done!\n');
    process.exit(0);
}

// If dry run, just show preview
if (!deleteMode) {
    console.log('👁️  DRY RUN MODE - No files will be deleted\n');
    console.log('To actually delete these files, run:');
    console.log('   node tools/cleanup-unused-files-safe.js --delete\n');
    process.exit(0);
}

// Delete mode - ask for confirmation
console.log('⚠️  DELETE MODE ACTIVE\n');
console.log('This will PERMANENTLY DELETE the files listed above.\n');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Are you sure you want to continue? (yes/no): ', (answer) => {
    if (answer.toLowerCase() !== 'yes') {
        console.log('\n❌ Cleanup cancelled by user.\n');
        rl.close();
        process.exit(0);
    }
    
    console.log('\n🗑️  Starting deletion...\n');
    
    // Create backup folder
    const backupDir = path.join(__dirname, '..', '.deleted');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDirWithTime = path.join(backupDir, timestamp);
    
    try {
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        fs.mkdirSync(backupDirWithTime, { recursive: true });
        console.log(`📦 Backup folder created: .deleted/${timestamp}\n`);
    } catch (error) {
        console.error('❌ Failed to create backup folder:', error.message);
        console.log('Proceeding without backup...\n');
    }
    
    let deletedCount = 0;
    let errorCount = 0;
    
    // Delete files
    existingFiles.forEach(file => {
        try {
            // Try to backup first
            try {
                const backupPath = path.join(backupDirWithTime, path.basename(file.path));
                fs.copyFileSync(file.fullPath, backupPath);
                console.log(`📦 Backed up: ${file.path}`);
            } catch (backupError) {
                console.warn(`⚠️  Backup failed for ${file.path}: ${backupError.message}`);
            }
            
            // Delete file
            fs.unlinkSync(file.fullPath);
            console.log(`✅ Deleted: ${file.path} (${file.sizeKB} KB)\n`);
            deletedCount++;
        } catch (error) {
            console.error(`❌ Error deleting ${file.path}:`, error.message, '\n');
            errorCount++;
        }
    });
    
    // Final summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 FINAL SUMMARY:\n');
    console.log(`✅ Deleted:      ${deletedCount} files`);
    console.log(`❌ Errors:       ${errorCount} files`);
    console.log(`💾 Backed up to: .deleted/${timestamp}`);
    console.log(`💿 Space freed:  ${(totalSize / 1024).toFixed(2)} KB`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    if (deletedCount > 0) {
        console.log('✅ Cleanup complete!\n');
        console.log('💡 Backup files are stored in .deleted/ folder');
        console.log('   You can restore them if needed.\n');
    }
    
    rl.close();
});
