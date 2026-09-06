/**
 * Header Doc
 * Purpose: Kunci per-resource in-memory (serialisasi) untuk cegah race check-then-act — dipakai jalur
 *   uang (partial-payment, /advance prabayar, callback Tripay/Mayar) agar operasi sama tak diproses
 *   dua kali (double-credit / pemasukan hantu). Single-instance: cukup Map in-memory.
 * Caller: `routes/partial-payment.js`, `routes/payment-status.js`, `routes/bill-payment.js`.
 * Deps: — (murni).
 * MainFuncs: `acquireLock`, `releaseLock`, `withLock`, `cleanupStaleLocks`.
 * SideEffects: `setInterval` cleanup lock basi (>30s) tiap 10s (di-unref → tak menahan proses).
 */
// Request locking mechanism to prevent race conditions
const locks = new Map();

/**
 * Acquire a lock for a specific resource
 * @param {string} resourceId - The resource to lock
 * @param {number} timeout - Maximum time to wait for lock (ms)
 * @returns {Promise<boolean>} - True if lock acquired, false if timeout
 */
async function acquireLock(resourceId, timeout = 5000) {
    const startTime = Date.now();
    
    while (locks.has(resourceId)) {
        if (Date.now() - startTime > timeout) {
            console.log(`[LOCK_TIMEOUT] Failed to acquire lock for ${resourceId} after ${timeout}ms`);
            return false;
        }
        // Wait a bit before trying again
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    locks.set(resourceId, {
        acquiredAt: Date.now(),
        holder: process.pid
    });
    
    console.log(`[LOCK_ACQUIRED] Lock acquired for ${resourceId}`);
    return true;
}

/**
 * Release a lock for a specific resource
 * @param {string} resourceId - The resource to unlock
 */
function releaseLock(resourceId) {
    if (locks.has(resourceId)) {
        locks.delete(resourceId);
        console.log(`[LOCK_RELEASED] Lock released for ${resourceId}`);
    }
}

/**
 * Execute a function with lock protection
 * @param {string} resourceId - The resource to lock
 * @param {Function} fn - The function to execute
 * @param {number} timeout - Maximum time to wait for lock (ms)
 * @returns {Promise<any>} - Result of the function
 */
async function withLock(resourceId, fn, timeout = 5000) {
    const lockAcquired = await acquireLock(resourceId, timeout);
    
    if (!lockAcquired) {
        throw new Error(`Could not acquire lock for ${resourceId}`);
    }
    
    try {
        const result = await fn();
        return result;
    } finally {
        releaseLock(resourceId);
    }
}

/**
 * Clean up stale locks (run periodically)
 */
function cleanupStaleLocks() {
    const now = Date.now();
    const maxAge = 30000; // 30 seconds
    
    for (const [resourceId, lockInfo] of locks.entries()) {
        if (now - lockInfo.acquiredAt > maxAge) {
            console.log(`[LOCK_CLEANUP] Removing stale lock for ${resourceId}`);
            locks.delete(resourceId);
        }
    }
}

// Run cleanup every 10 seconds. unref() supaya timer ini TIDAK menahan proses tetap hidup
// (jest bisa keluar bersih; di prod cleanup tetap jalan selama event-loop aktif).
const _staleLockTimer = setInterval(cleanupStaleLocks, 10000);
if (_staleLockTimer && typeof _staleLockTimer.unref === 'function') _staleLockTimer.unref();

module.exports = {
    acquireLock,
    releaseLock,
    withLock,
    cleanupStaleLocks
};
