/**
 * Database Backup Manager
 * Lists and manages database backup files
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const backupsDir = path.join(rootDir, 'backups');

console.log('');
console.log('DATABASE BACKUP MANAGER');
console.log('=' .repeat(60));
console.log('');

// Create backups directory if it doesn't exist
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

// Find all backup files in backups directory
const backupFiles = [];
if (fs.existsSync(backupsDir)) {
    const files = fs.readdirSync(backupsDir);
    files.filter(file => file.startsWith('database.backup.') && file.endsWith('.sqlite'))
         .forEach(file => backupFiles.push(file));
}

// Also check root directory for old backups (for backward compatibility)
const rootFiles = fs.readdirSync(rootDir);
const oldBackupFiles = rootFiles.filter(file => file.startsWith('database.backup.') && file.endsWith('.sqlite'));

if (oldBackupFiles.length > 0) {
    console.log(`⚠️  Found ${oldBackupFiles.length} old backup(s) in root directory.`);
    console.log('   These should be moved to the backups/ folder.');
    console.log('');
}

if (backupFiles.length === 0) {
    console.log('No backup files found.');
    process.exit(0);
}

// Sort by timestamp (newest first)
backupFiles.sort((a, b) => {
    const timestampA = parseInt(a.match(/database\.backup\.(\d+)\.sqlite/)[1]);
    const timestampB = parseInt(b.match(/database\.backup\.(\d+)\.sqlite/)[1]);
    return timestampB - timestampA;
});

console.log(`Found ${backupFiles.length} backup file(s):`);
console.log('');

backupFiles.forEach((file, index) => {
    const filePath = path.join(backupsDir, file);
    const stats = fs.statSync(filePath);
    const timestamp = parseInt(file.match(/database\.backup\.(\d+)\.sqlite/)[1]);
    const date = new Date(timestamp);
    const age = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    
    console.log(`${index + 1}. ${file}`);
    console.log(`   Created: ${date.toLocaleString()}`);
    console.log(`   Size: ${(stats.size / 1024).toFixed(1)} KB`);
    console.log(`   Age: ${age} day(s)`);
    console.log('');
});

// Restoration command
console.log('-' .repeat(60));
console.log('TO RESTORE A BACKUP:');
console.log('');
console.log('1. Stop the application (Ctrl+C)');
console.log('2. Choose a backup from above');
console.log('3. Run this command (replace with actual filename):');
console.log(`   copy backups\\${backupFiles[0]} database\\database.sqlite`);
console.log('4. Restart the application');
console.log('');

// Cleanup suggestion
const oldBackups = backupFiles.filter((file) => {
    const timestamp = parseInt(file.match(/database\.backup\.(\d+)\.sqlite/)[1]);
    const age = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
    return age > 7;
});

if (oldBackups.length > 0) {
    console.log('-' .repeat(60));
    console.log('⚠️  CLEANUP SUGGESTION:');
    console.log(`   ${oldBackups.length} backup(s) are older than 7 days`);
    console.log('   Consider deleting old backups to save disk space.');
    console.log('');
}

console.log('=' .repeat(60));
