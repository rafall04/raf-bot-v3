/**
 * Script to clean up corrupted/duplicated reports.json
 */

const fs = require('fs');
const path = require('path');

const reportsPath = path.join(__dirname, '../database/reports.json');
const backupPath = path.join(__dirname, '../database/reports.backup.json');

console.log('[CLEANUP] Starting reports.json cleanup...');

try {
    // Read current file
    const data = fs.readFileSync(reportsPath, 'utf8');
    const reports = JSON.parse(data);
    
    console.log(`[CLEANUP] Found ${reports.length} total entries`);
    
    // Remove duplicates based on ticketId
    const uniqueReports = [];
    const seenTickets = new Set();
    
    for (const report of reports) {
        if (report.ticketId && !seenTickets.has(report.ticketId)) {
            seenTickets.add(report.ticketId);
            uniqueReports.push(report);
        }
    }
    
    console.log(`[CLEANUP] Reduced to ${uniqueReports.length} unique entries`);
    
    // Keep only last 100 reports (most recent)
    const finalReports = uniqueReports.slice(-100);
    
    console.log(`[CLEANUP] Keeping last ${finalReports.length} reports`);
    
    // Backup old file
    fs.copyFileSync(reportsPath, backupPath);
    console.log(`[CLEANUP] Backup saved to ${backupPath}`);
    
    // Write cleaned data
    fs.writeFileSync(reportsPath, JSON.stringify(finalReports, null, 2));
    console.log(`[CLEANUP] Clean reports.json saved!`);
    
    // Show file size comparison
    const oldSize = fs.statSync(backupPath).size;
    const newSize = fs.statSync(reportsPath).size;
    console.log(`[CLEANUP] File size: ${(oldSize/1024/1024).toFixed(2)}MB -> ${(newSize/1024).toFixed(2)}KB`);
    
} catch (error) {
    console.error('[CLEANUP] Error:', error);
    process.exit(1);
}
