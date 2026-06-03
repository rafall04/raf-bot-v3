/**
 * Deep clean all buffer data from reports.json
 * Removes buffers from customerPhotos, uploadedPhotos, and photoBuffers
 */

const fs = require('fs');
const path = require('path');

const reportsPath = path.join(__dirname, '../database/reports.json');
const backupPath = path.join(__dirname, '../database/reports.deep-backup.json');

console.log('[DEEP_CLEAN] Starting deep clean of all buffer data...');

try {
    // Read current file
    const data = fs.readFileSync(reportsPath, 'utf8');
    const reports = JSON.parse(data);
    
    console.log(`[DEEP_CLEAN] Processing ${reports.length} reports...`);
    
    let totalBuffersRemoved = 0;
    let fieldsCleanedCount = 0;
    
    // Clean all reports
    for (const report of reports) {
        // Clean customerPhotos
        if (report.customerPhotos && Array.isArray(report.customerPhotos)) {
            report.customerPhotos = report.customerPhotos.map(photo => {
                const cleaned = { ...photo };
                if (cleaned.buffer) {
                    delete cleaned.buffer;
                    totalBuffersRemoved++;
                }
                return cleaned;
            });
            fieldsCleanedCount++;
        }
        
        // Clean uploadedPhotos
        if (report.uploadedPhotos && Array.isArray(report.uploadedPhotos)) {
            report.uploadedPhotos = report.uploadedPhotos.map(photo => {
                const cleaned = { ...photo };
                if (cleaned.buffer) {
                    delete cleaned.buffer;
                    totalBuffersRemoved++;
                }
                return cleaned;
            });
            fieldsCleanedCount++;
        }
        
        // Remove photoBuffers field entirely
        if (report.photoBuffers) {
            delete report.photoBuffers;
            fieldsCleanedCount++;
        }
        
        // Clean photos field if it exists
        if (report.photos && Array.isArray(report.photos)) {
            report.photos = report.photos.map(photo => {
                if (typeof photo === 'object' && photo.buffer) {
                    delete photo.buffer;
                    totalBuffersRemoved++;
                    return photo;
                }
                return photo;
            });
        }
    }
    
    console.log(`[DEEP_CLEAN] Removed ${totalBuffersRemoved} buffer objects`);
    console.log(`[DEEP_CLEAN] Cleaned ${fieldsCleanedCount} fields`);
    
    // Backup old file
    fs.copyFileSync(reportsPath, backupPath);
    console.log(`[DEEP_CLEAN] Backup saved to ${backupPath}`);
    
    // Write cleaned data
    fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2));
    
    // Show file size comparison
    const oldSize = fs.statSync(backupPath).size;
    const newSize = fs.statSync(reportsPath).size;
    
    if (oldSize > 1024 * 1024) {
        console.log(`[DEEP_CLEAN] File size: ${(oldSize/1024/1024).toFixed(2)}MB -> ${(newSize/1024).toFixed(2)}KB`);
        const reduction = ((oldSize - newSize) / oldSize * 100).toFixed(1);
        console.log(`[DEEP_CLEAN] Size reduction: ${reduction}%`);
    } else {
        console.log(`[DEEP_CLEAN] File size: ${(oldSize/1024).toFixed(2)}KB -> ${(newSize/1024).toFixed(2)}KB`);
    }
    
    console.log('[DEEP_CLEAN] ✅ Complete! Database is now clean.');
    
} catch (error) {
    console.error('[DEEP_CLEAN] Error:', error);
    process.exit(1);
}
