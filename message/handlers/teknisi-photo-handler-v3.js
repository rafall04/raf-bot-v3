/**
 * Teknisi Photo Upload Handler V3 - Fully Fixed Version
 * Properly handles concurrent uploads without hanging
 */

const fs = require('fs');
const path = require('path');

// Photo upload sessions
const uploadSessions = new Map();

/**
 * Get or create upload session
 */
function getSession(sender) {
    if (!uploadSessions.has(sender)) {
        uploadSessions.set(sender, {
            photos: [],
            pendingResolvers: [],
            batchTimeout: null,
            processingBatch: false,
            lastActivity: Date.now()
        });
    }
    return uploadSessions.get(sender);
}

/**
 * Process batch of photos
 */
async function processBatch(sender) {
    const session = getSession(sender);
    
    // Prevent duplicate processing
    if (session.processingBatch) {
        return;
    }
    
    session.processingBatch = true;
    
    try {
        // Clear batch timeout
        if (session.batchTimeout) {
            clearTimeout(session.batchTimeout);
            session.batchTimeout = null;
        }
        
        const photoCount = session.photos.length;
        console.log(`[PHOTO_BATCH] Processing batch for ${sender}: ${photoCount} photos`);
        
        // Update teknisi state
        if (global.teknisiStates && global.teknisiStates[sender]) {
            const state = global.teknisiStates[sender];
            if (!state.uploadedPhotos) {
                state.uploadedPhotos = [];
            }
            state.uploadedPhotos = [...session.photos];
        }
        
        // Generate response message
        const message = getResponseMessage(photoCount);
        
        // Resolve all pending promises
        const resolvers = [...session.pendingResolvers];
        session.pendingResolvers = [];
        
        // Find the last resolver that has a reply function
        let lastReplyIndex = -1;
        for (let i = resolvers.length - 1; i >= 0; i--) {
            if (resolvers[i].reply) {
                lastReplyIndex = i;
                break;
            }
        }
        
        // Send reply only once through the last resolver with reply
        if (lastReplyIndex >= 0 && message) {
            const resolver = resolvers[lastReplyIndex];
            if (resolver.reply) {
                await resolver.reply(message).catch(err => {
                    console.error('[PHOTO_REPLY_ERROR]', err);
                });
            }
        }
        
        // Resolve all promises
        resolvers.forEach(({ resolve }) => {
            resolve({
                success: true,
                photoCount: photoCount,
                message: null
            });
        });
        
        console.log(`[PHOTO_BATCH] Batch complete. Resolved ${resolvers.length} promises`);
        
    } catch (error) {
        console.error('[PHOTO_BATCH_ERROR]', error);
        
        // Resolve all with error
        session.pendingResolvers.forEach(({ resolve }) => {
            resolve({
                success: false,
                message: '❌ Error processing batch'
            });
        });
        session.pendingResolvers = [];
        
    } finally {
        session.processingBatch = false;
    }
}

/**
 * Get response message based on photo count
 */
function getResponseMessage(photoCount) {
    if (photoCount < 2) {
        return `✅ Foto ${photoCount} berhasil diterima!

📌 *STATUS UPLOAD:*
• Foto terupload: ${photoCount}/2 (minimum)
• Status: Perlu ${2 - photoCount} foto lagi

📌 *NEXT STEP:*
➡️ Kirim foto ke-${photoCount + 1}
   (minimal 2 foto dokumentasi)

💡 Tips: Ambil foto yang jelas menunjukkan:
• Kondisi perangkat/kabel
• Proses perbaikan yang dilakukan`;
        
    } else if (photoCount >= 2 && photoCount < 5) {
        return `✅ *${photoCount} FOTO DOKUMENTASI DITERIMA!*

📌 *STATUS:*
• Foto terupload: ${photoCount} ✅
• Minimum terpenuhi (2 foto)
• Siap lanjut ke tahap berikutnya

📌 *NEXT STEP:*
➡️ Ketik salah satu:
   • *done*
   • *lanjut* 
   • *next*

   Untuk melanjutkan ke pengisian catatan resolusi

💡 Atau kirim foto tambahan jika diperlukan (maks 5)`;
        
    } else {
        return `✅ *MAKSIMAL FOTO TERCAPAI (5)*

📌 *STATUS:*
• Total foto: ${photoCount} ✅
• Dokumentasi lengkap

📌 *LANJUT KE TAHAP BERIKUTNYA:*
➡️ Ketik salah satu:
   • *done*
   • *lanjut*
   • *next*

Untuk melanjutkan ke pengisian catatan perbaikan`;
    }
}

/**
 * Handle teknisi photo upload
 */
async function handleTeknisiPhotoUpload(sender, fileName, buffer, reply, canonicalId) {
    try {
        const stateKey = canonicalId || sender;
        // Check if teknisi is in correct state
        const state = global.teknisiStates && global.teknisiStates[stateKey];
        
        if (!state || state.step !== 'AWAITING_COMPLETION_PHOTOS') {
            return {
                success: false,
                message: null // Not in photo upload state
            };
        }
        
        const session = getSession(stateKey);
        
        // Add photo to session
        session.photos.push(fileName);
        session.lastActivity = Date.now();
        
        const currentCount = session.photos.length;
        console.log(`[PHOTO_UPLOAD] Photo added: ${currentCount} total for ${stateKey}`);
        
        // Check if we should process immediately (max photos reached)
        if (currentCount >= 5) {
            // Process immediately if max reached
            await processBatch(stateKey);
            return {
                success: true,
                photoCount: currentCount,
                message: null
            };
        }
        
        // For single photo, provide immediate response
        if (currentCount === 1) {
            // Send immediate response for first photo
            const immediateMessage = getResponseMessage(currentCount);
            if (reply) {
                await reply(immediateMessage).catch(err => {
                    console.error('[PHOTO_IMMEDIATE_REPLY_ERROR]', err);
                });
            }
        }
        
        // Create promise for this upload
        return new Promise((resolve) => {
            // Add to pending resolvers
            session.pendingResolvers.push({ resolve, reply });
            
            // Clear existing batch timeout
            if (session.batchTimeout) {
                clearTimeout(session.batchTimeout);
            }
            
            // Set new batch timeout (wait for more photos)
            session.batchTimeout = setTimeout(async () => {
                try {
                    await processBatch(stateKey);
                } catch (err) {
                    console.error('[PHOTO_TIMEOUT_ERROR]', err);
                }
            }, 1500); // Wait 1.5 seconds for batch
        });
        
    } catch (error) {
        console.error('[TEKNISI_PHOTO_ERROR]', error);
        return {
            success: false,
            message: '❌ Gagal menyimpan foto. Coba lagi.'
        };
    }
}

/**
 * Get photo upload status
 */
function getPhotoUploadStatus(sender) {
    const session = uploadSessions.get(sender);
    if (!session) {
        return {
            uploadedCount: 0,
            pendingCount: 0
        };
    }
    
    return {
        uploadedCount: session.photos.length,
        pendingCount: session.pendingResolvers.length
    };
}

/**
 * Clear upload session
 */
function clearUploadQueue(sender) {
    const session = uploadSessions.get(sender);
    if (session) {
        // Clear timeout
        if (session.batchTimeout) {
            clearTimeout(session.batchTimeout);
        }
        
        // Resolve any pending promises
        session.pendingResolvers.forEach(({ resolve }) => {
            resolve({
                success: true,
                photoCount: session.photos.length,
                message: null
            });
        });
        
        uploadSessions.delete(sender);
        console.log(`[PHOTO_SESSION] Cleared session for ${sender}`);
    }
}

/**
 * Get upload queue (for compatibility)
 */
function getUploadQueue(sender) {
    const session = getSession(sender);
    return {
        uploadedPhotos: session.photos,
        queue: [],
        processing: false
    };
}

/**
 * Cleanup old sessions
 */
function cleanupOldSessions() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes
    
    for (const [sender, session] of uploadSessions.entries()) {
        if (now - session.lastActivity > timeout) {
            clearUploadQueue(sender);
        }
    }
}

// Run cleanup every 10 minutes
setInterval(cleanupOldSessions, 10 * 60 * 1000);

module.exports = {
    handleTeknisiPhotoUpload,
    getPhotoUploadStatus,
    clearUploadQueue,
    getUploadQueue
};
