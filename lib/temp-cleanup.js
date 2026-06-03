/**
 * Temp Folder Cleanup Utility
 * Cleans up old temporary upload files
 */

const fs = require('fs');
const path = require('path');

function cleanupTempFolder() {
    const tempDir = path.join(__dirname, '..', 'temp');
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        return;
    }
    
    try {
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // 1 hour
        
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            try {
                const stats = fs.statSync(filePath);
                const age = now - stats.mtimeMs;
                
                // Skip directories and only delete old files
                if (stats.isDirectory()) {
                    // Skip directories like topup_proofs
                    return;
                }
                
                // Delete files older than 1 hour
                if (age > maxAge && stats.isFile()) {
                    fs.unlinkSync(filePath);
                    console.log(`[TEMP_CLEANUP] Deleted old temp file: ${file}`);
                }
            } catch (err) {
                // File might be locked or already deleted
                if (err.code !== 'ENOENT' && err.code !== 'EBUSY' && err.code !== 'EISDIR') {
                    console.error(`[TEMP_CLEANUP] Error processing ${file}:`, err.message);
                }
            }
        });
    } catch (err) {
        console.error('[TEMP_CLEANUP] Error cleaning temp folder:', err.message);
    }
}

// Run cleanup on startup
cleanupTempFolder();

// Schedule cleanup every hour
setInterval(cleanupTempFolder, 60 * 60 * 1000);

module.exports = { cleanupTempFolder };
