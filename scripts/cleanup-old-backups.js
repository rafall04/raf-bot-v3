/**
 * Cleanup Old Backups Script
 * Removes backup files older than BACKUP_RETENTION_DAYS (default: 30 days)
 * Also removes duplicate backups from the same day, keeping only the latest 3
 */

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;

function cleanupOldBackups() {
    console.log(`[CLEANUP] Starting backup cleanup...`);
    console.log(`[CLEANUP] Retention period: ${RETENTION_DAYS} days`);
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    console.log(`[CLEANUP] Cutoff date: ${cutoffDate.toISOString().split('T')[0]}`);
    
    if (!fs.existsSync(BACKUP_DIR)) {
        console.log('[CLEANUP] Backup directory not found');
        return;
    }
    
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.sqlite'));
    console.log(`[CLEANUP] Found ${files.length} backup files`);
    
    let deletedCount = 0;
    let keptCount = 0;
    
    // Group files by date
    const filesByDate = {};
    
    for (const file of files) {
        // Extract date from filename (format: *_YYYY-MM-DD_HH-MM-SS.sqlite or *_DD-MM-YYYY_HH.MM.SS.sqlite)
        const match = file.match(/(\d{4}-\d{2}-\d{2})/);
        if (match) {
            const dateStr = match[1];
            if (!filesByDate[dateStr]) {
                filesByDate[dateStr] = [];
            }
            filesByDate[dateStr].push(file);
        }
    }
    
    // Process each date group
    for (const [dateStr, dateFiles] of Object.entries(filesByDate)) {
        const fileDate = new Date(dateStr);
        
        // Delete files older than retention period
        if (fileDate < cutoffDate) {
            for (const file of dateFiles) {
                try {
                    fs.unlinkSync(path.join(BACKUP_DIR, file));
                    deletedCount++;
                } catch (err) {
                    console.error(`[CLEANUP] Error deleting ${file}:`, err.message);
                }
            }
        } else {
            // For recent dates, keep only latest 3 per type per day
            const filesByType = {};
            for (const file of dateFiles) {
                const type = file.split('_backup_')[0] || file.split('_')[0];
                if (!filesByType[type]) {
                    filesByType[type] = [];
                }
                filesByType[type].push(file);
            }
            
            for (const [type, typeFiles] of Object.entries(filesByType)) {
                // Sort by timestamp (newest first)
                typeFiles.sort().reverse();
                
                // Keep only latest 3
                const toDelete = typeFiles.slice(3);
                for (const file of toDelete) {
                    try {
                        fs.unlinkSync(path.join(BACKUP_DIR, file));
                        deletedCount++;
                    } catch (err) {
                        console.error(`[CLEANUP] Error deleting ${file}:`, err.message);
                    }
                }
                keptCount += Math.min(typeFiles.length, 3);
            }
        }
    }
    
    console.log(`[CLEANUP] Deleted ${deletedCount} old/duplicate backup files`);
    console.log(`[CLEANUP] Kept ${keptCount} recent backup files`);
}

cleanupOldBackups();
