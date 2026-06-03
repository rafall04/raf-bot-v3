/**
 * Script to clean photo buffer data from reports.json
 * This removes the buffer property from uploadedPhotos array
 */

const fs = require('fs');
const path = require('path');

const reportsPath = path.join(__dirname, '../database/reports.json');
const backupPath = path.join(__dirname, '../database/reports.backup-buffers.json');

console.log('[CLEAN] Cleaning photo buffers from reports.json...');

try {
    // Read current file
    const data = fs.readFileSync(reportsPath, 'utf8');
    const reports = JSON.parse(data);
    
    console.log(`[CLEAN] Found ${reports.length} reports to process...`);
    
    let buffersRemoved = 0;
    let photosProcessed = 0;
    
    // Clean uploadedPhotos in all reports
    for (const report of reports) {
        // Clean uploadedPhotos array
        if (report.uploadedPhotos && Array.isArray(report.uploadedPhotos)) {
            for (const photo of report.uploadedPhotos) {
                if (photo.buffer) {
                    delete photo.buffer;
                    photosProcessed++;
                }
            }
        }
        
        // Clean photoBuffers field
        if (report.photoBuffers) {
            delete report.photoBuffers;
            buffersRemoved++;
        }
    }
    
    console.log(`[CLEAN] Removed buffer data from ${photosProcessed} photos`);
    console.log(`[CLEAN] Removed photoBuffers from ${buffersRemoved} reports`);
    
    // Backup old file
    fs.copyFileSync(reportsPath, backupPath);
    console.log(`[CLEAN] Backup saved to ${backupPath}`);
    
    // Write cleaned data
    fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2));
    
    // Show file size comparison
    const oldSize = fs.statSync(backupPath).size;
    const newSize = fs.statSync(reportsPath).size;
    const reduction = ((oldSize - newSize) / oldSize * 100).toFixed(1);
    
    console.log(`[CLEAN] File size: ${(oldSize/1024/1024).toFixed(2)}MB -> ${(newSize/1024).toFixed(2)}KB`);
    console.log(`[CLEAN] Size reduction: ${reduction}%`);
    console.log('[CLEAN] Done! Reports.json is now clean.');
    
} catch (error) {
    console.error('[CLEAN] Error:', error);
    process.exit(1);
}
