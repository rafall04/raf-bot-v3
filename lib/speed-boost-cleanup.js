/**
 * Header Doc
 * Purpose: Perapihan periodik `database/speed_requests.json` — buang 'pending' tua (>7 hari) &
 *   rapikan 'reverted' tua → 'completed'. TIDAK menyentuh 'active': revert profil MikroTik adalah
 *   tanggung jawab cron speed-revert (satu-satunya penulis yang benar-benar mengembalikan profil).
 * Caller: `lib/app-runtime.js` (scheduleSpeedBoostCleanup — jalan seketika saat boot + tiap jam).
 * Deps: `fs`, `path`. Berbagi file `speed_requests.json` dengan `lib/cron/jobs/speed-revert.js`.
 * MainFuncs: `cleanupSpeedBoostRequests`, `scheduleSpeedBoostCleanup`.
 * SideEffects: Baca/tulis `database/speed_requests.json`; sinkron `global.speed_requests` (sinkron,
 *   tanpa await → tak ada titik-yield yang bisa menggilas penambahan konkuren).
 */

const fs = require('fs');
const path = require('path');

/**
 * Clean up expired and old speed boost requests
 */
function cleanupSpeedBoostRequests() {
    try {
        const speedRequestsPath = path.join(__dirname, '..', 'database', 'speed_requests.json');
        
        if (!fs.existsSync(speedRequestsPath)) {
            // No speed requests file (silent)
            return;
        }
        
        const speedRequests = JSON.parse(fs.readFileSync(speedRequestsPath, 'utf8'));
        const now = new Date();
        let cleanedCount = 0;
        
        speedRequests.forEach(request => {
            // #b320: JANGAN sentuh request 'active' di sini. Dulu blok ini menstempel active+lewat-tempo
            // menjadi 'expired' TANPA revert profil MikroTik, sedangkan cron speed-revert (SATU-SATUNYA
            // yang benar-benar mengembalikan profil PPPoE) HANYA memproses status 'active'. Akibatnya
            // begitu di-stempel 'expired', speed-revert melewatinya selamanya → pelanggan menikmati
            // profil boost GRATIS permanen. Cleanup ini berjalan SEKETIKA saat boot (app-runtime.js)
            // SEBELUM speed-revert terjadwal, jadi tiap restart (7-13x/hari) dulu mempreempt semua boost
            // yang kadaluarsa-saat-mati. Biarkan speed-revert menuntaskan 'active' (revert + tandai);
            // cleanup hanya membuang 'pending' tua & merapikan 'reverted' tua.

            // Clean old pending requests (older than 7 days)
            if (request.status === 'pending' && request.createdAt) {
                const createdDate = new Date(request.createdAt);
                const daysSinceCreated = (now - createdDate) / (1000 * 60 * 60 * 24);
                
                if (daysSinceCreated > 7) {
                    request.status = 'cancelled_auto';
                    request.cancelledAt = now.toISOString();
                    request.cancelReason = 'Expired after 7 days';
                    cleanedCount++;
                    // Request cancelled (silent)
                }
            }
            
            // Clean reverted requests that are still marked as active
            if (request.status === 'reverted' && request.revertedAt) {
                // Already reverted, ensure it's not counted as active
                const revertedDate = new Date(request.revertedAt);
                const hoursSinceReverted = (now - revertedDate) / (1000 * 60 * 60);
                
                // If reverted more than 1 hour ago but still causing issues
                if (hoursSinceReverted > 1) {
                    request.status = 'completed';
                    request.completedAt = request.revertedAt;
                    cleanedCount++;
                    // Request completed (silent)
                }
            }
        });
        
        if (cleanedCount > 0) {
            // Save cleaned data
            fs.writeFileSync(speedRequestsPath, JSON.stringify(speedRequests, null, 2));
            // Cleaned requests (silent)
            
            // Update global if exists
            if (global.speed_requests) {
                global.speed_requests = speedRequests;
            }
        }
        // No cleanup needed (silent)
        
        return cleanedCount;
    } catch (error) {
        console.error('[SPEED_BOOST_CLEANUP_ERROR]', error);
        return 0;
    }
}

/**
 * Schedule periodic cleanup (every hour)
 */
function scheduleSpeedBoostCleanup() {
    // Run immediately on start
    cleanupSpeedBoostRequests();
    
    // Then run every hour
    setInterval(() => {
        // Running scheduled cleanup (silent)
        cleanupSpeedBoostRequests();
    }, 60 * 60 * 1000); // Every hour
}

module.exports = {
    cleanupSpeedBoostRequests,
    scheduleSpeedBoostCleanup
};
