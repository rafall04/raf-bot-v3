/**
 * Script to remove photoBuffers from reports.json
 * Photo buffers should not be stored in JSON (causes huge file size)
 */

const fs = require('fs');
const path = require('path');

const reportsPath = path.join(__dirname, '../database/reports.json');

console.log('[FIX] Removing photoBuffers from reports.json...');

try {
    // Read current file
    const data = fs.readFileSync(reportsPath, 'utf8');
    const reports = JSON.parse(data);
    
    console.log(`[FIX] Processing ${reports.length} reports...`);
    
    let buffersRemoved = 0;
    
    // Remove photoBuffers from all reports
    for (const report of reports) {
        if (report.photoBuffers) {
            delete report.photoBuffers;
            buffersRemoved++;
        }
    }
    
    console.log(`[FIX] Removed photoBuffers from ${buffersRemoved} reports`);
    
    // Write cleaned data
    fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2));
    
    // Show file size
    const fileSize = fs.statSync(reportsPath).size;
    console.log(`[FIX] File size now: ${(fileSize/1024).toFixed(2)}KB`);
    console.log('[FIX] Done!');
    
} catch (error) {
    console.error('[FIX] Error:', error);
    process.exit(1);
}
