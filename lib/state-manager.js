/**
 * Header Doc
 * Purpose: Mengunci pemrosesan pesan per sender agar pesan paralel dari nomor sama tidak diproses bersamaan.
 * Caller: Router bot WhatsApp dan test state manager.
 * Deps: Timer Node.js dan Map in-memory.
 * MainFuncs: `isProcessing`, `setProcessing`, `clearProcessing`, `clearAll`, `getStats`.
 * SideEffects: Menyimpan lock in-memory dan memasang timer auto-cleanup yang tidak menahan process exit.
 * Catatan: `LOCK_TIMEOUT` adalah JARING DARURAT anti-deadlock (2 menit), BUKAN perkiraan lama
 *          kerja. Pelepasan normal lewat `clearProcessing` di `finally` milik router.
 */

const stateLocks = new Map();

// !! JARING DARURAT ANTI-DEADLOCK — BUKAN "perkiraan lama kerja".
// Kunci normalnya dilepas `clearProcessing` di blok `finally` milik router; angka ini HANYA
// berlaku kalau proses mati/menggantung di tengah jalan sehingga `finally` tak pernah jalan.
//
// Dulu 10 detik, dan itu menghasilkan kerusakan nyata (#b251): satu putaran provisioning PSB
// terukur ±21 detik, jadi kuncinya melepas diri di TENGAH kerja dan pemicu kedua dari teknisi
// pada detik ke-11 lolos — dua provisioning berjalan paralel, saling menabrak, dan teknisi
// diberi tahu "gagal" padahal pelanggannya sudah jadi. Ambang darurat WAJIB jauh lebih lama
// daripada operasi I/O terlama yang dilindunginya (PSB: MikroTik + GenieACS), bukan lebih pendek.
const LOCK_TIMEOUT = 120000; // 2 menit — jaring anti-deadlock, bukan batas kerja normal
const DEBUG = false; // Set to true for debugging

/**
 * Check if a sender is currently being processed
 * @param {string} sender - Sender ID to check
 * @returns {boolean} True if currently processing
 */
function isProcessing(sender) {
    if (!sender) return false;
    
    const lock = stateLocks.get(sender);
    if (!lock) return false;
    
    // Check if lock expired
    if (Date.now() - lock.timestamp > LOCK_TIMEOUT) {
        if (DEBUG) {
            console.log(`[STATE_MANAGER] Lock expired for ${sender}, clearing`);
        }
        stateLocks.delete(sender);
        return false;
    }
    
    if (DEBUG) {
        console.log(`[STATE_MANAGER] ${sender} is already being processed`);
    }
    return true;
}

/**
 * Set processing lock for a sender
 * @param {string} sender - Sender ID to lock
 * @returns {boolean} True if lock acquired, false if already locked
 */
function setProcessing(sender) {
    if (!sender) return false;
    
    if (isProcessing(sender)) {
        return false; // Already processing
    }
    
    stateLocks.set(sender, {
        timestamp: Date.now(),
        count: (stateLocks.get(sender)?.count || 0) + 1
    });
    
    if (DEBUG) {
        console.log(`[STATE_MANAGER] Lock acquired for ${sender}`);
    }
    
    // Auto cleanup after timeout
    const cleanupTimer = setTimeout(() => {
        if (stateLocks.has(sender)) {
            const lock = stateLocks.get(sender);
            if (Date.now() - lock.timestamp >= LOCK_TIMEOUT) {
                if (DEBUG) {
                    console.log(`[STATE_MANAGER] Auto-clearing expired lock for ${sender}`);
                }
                stateLocks.delete(sender);
            }
        }
    }, LOCK_TIMEOUT + 1000);
    if (typeof cleanupTimer.unref === 'function') {
        cleanupTimer.unref();
    }
    
    return true;
}

/**
 * Clear processing lock for a sender
 * @param {string} sender - Sender ID to unlock
 */
function clearProcessing(sender) {
    if (!sender) return;
    
    if (stateLocks.has(sender)) {
        if (DEBUG) {
            const lock = stateLocks.get(sender);
            const duration = Date.now() - lock.timestamp;
            console.log(`[STATE_MANAGER] Lock cleared for ${sender} after ${duration}ms`);
        }
        stateLocks.delete(sender);
    }
}

/**
 * Clear all locks (for cleanup)
 */
function clearAll() {
    const size = stateLocks.size;
    stateLocks.clear();
    if (DEBUG) {
        console.log(`[STATE_MANAGER] Cleared ${size} locks`);
    }
}

/**
 * Get statistics about current locks
 * @returns {object} Statistics
 */
function getStats() {
    const now = Date.now();
    const stats = {
        totalLocks: stateLocks.size,
        activeLocks: [],
        expiredLocks: []
    };
    
    stateLocks.forEach((lock, sender) => {
        const age = now - lock.timestamp;
        const lockInfo = {
            sender: sender.substring(0, 10) + '...', // Privacy
            age,
            count: lock.count
        };
        
        if (age > LOCK_TIMEOUT) {
            stats.expiredLocks.push(lockInfo);
        } else {
            stats.activeLocks.push(lockInfo);
        }
    });
    
    return stats;
}

module.exports = {
    isProcessing,
    setProcessing,
    clearProcessing,
    clearAll,
    getStats,
    LOCK_TIMEOUT
};
