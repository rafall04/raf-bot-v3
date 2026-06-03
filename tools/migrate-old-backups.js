/**
 * Migrate Old Backups
 * Move old backup files from root directory to backups folder
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const backupsDir = path.join(rootDir, 'backups');

console.log('');
console.log('BACKUP FILE MIGRATION');
console.log('=' .repeat(60));
console.log('');

// Create backups directory if it doesn't exist
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
    console.log('✅ Created backups/ directory');
}

// Find old backup files in root directory
const rootFiles = fs.readdirSync(rootDir);
const oldBackupFiles = rootFiles.filter(file => 
    file.startsWith('database.backup.') && file.endsWith('.sqlite')
);

if (oldBackupFiles.length === 0) {
    console.log('✅ No old backup files found in root directory.');
    console.log('   All backups are properly organized!');
} else {
    console.log(`📁 Found ${oldBackupFiles.length} backup file(s) in root directory:`);
    console.log('');
    
    let movedCount = 0;
    let errorCount = 0;
    
    oldBackupFiles.forEach(file => {
        const oldPath = path.join(rootDir, file);
        const newPath = path.join(backupsDir, file);
        
        try {
            const stats = fs.statSync(oldPath);
            const size = (stats.size / 1024).toFixed(1);
            
            console.log(`  Moving: ${file} (${size} KB)`);
            
            // Check if file already exists in backups
            if (fs.existsSync(newPath)) {
                console.log(`    ⚠️  File already exists in backups/, skipping`);
            } else {
                // Move the file
                fs.renameSync(oldPath, newPath);
                console.log(`    ✅ Moved to backups/${file}`);
                movedCount++;
            }
        } catch (err) {
            console.error(`    ❌ Error moving ${file}: ${err.message}`);
            errorCount++;
        }
    });
    
    console.log('');
    console.log('-' .repeat(60));
    console.log('MIGRATION SUMMARY:');
    console.log(`  Files found: ${oldBackupFiles.length}`);
    console.log(`  Files moved: ${movedCount}`);
    if (errorCount > 0) {
        console.log(`  Errors: ${errorCount}`);
    }
}

// Show current backup structure
console.log('');
console.log('CURRENT BACKUP STRUCTURE:');
console.log('');

const backupFiles = fs.existsSync(backupsDir) ? 
    fs.readdirSync(backupsDir).filter(file => 
        file.startsWith('database.backup.') && file.endsWith('.sqlite')
    ) : [];

if (backupFiles.length > 0) {
    console.log(`📁 backups/ directory contains ${backupFiles.length} backup(s):`);
    
    // Sort by timestamp (newest first)
    backupFiles.sort((a, b) => {
        const timestampA = parseInt(a.match(/database\.backup\.(\d+)\.sqlite/)[1]);
        const timestampB = parseInt(b.match(/database\.backup\.(\d+)\.sqlite/)[1]);
        return timestampB - timestampA;
    });
    
    // Show first 5 backups
    backupFiles.slice(0, 5).forEach(file => {
        const filePath = path.join(backupsDir, file);
        const stats = fs.statSync(filePath);
        const timestamp = parseInt(file.match(/database\.backup\.(\d+)\.sqlite/)[1]);
        const date = new Date(timestamp);
        const size = (stats.size / 1024).toFixed(1);
        
        console.log(`  - ${file}`);
        console.log(`    Created: ${date.toLocaleString()} | Size: ${size} KB`);
    });
    
    if (backupFiles.length > 5) {
        console.log(`  ... and ${backupFiles.length - 5} more`);
    }
} else {
    console.log('📁 No backups found in backups/ directory');
}

console.log('');
console.log('✅ All future backups will be saved in the backups/ folder');
console.log('');
console.log('=' .repeat(60));
console.log('');
