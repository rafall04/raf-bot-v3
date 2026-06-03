/**
 * Header Doc
 * Purpose: Queue manager upload foto yang mempertahankan state antar batch untuk tiket/teknisi.
 * Caller: Handler foto teknisi/pelanggan dan flow batch upload dari router bot.
 * Deps: `path`, `fs`, dan `./template-helpers` (renderResponseTemplate).
 * MainFuncs: `PhotoUploadQueue.addPhoto`, `.processBatch`, `.checkRateLimit`, `.updateLastReplyTime`.
 * SideEffects: Menyimpan batch foto di memori, mengirim reply error/acknowledgment ke user, membatasi rate.
 */

const path = require('path');
const fs = require('fs');
const { renderResponseTemplate } = require('./template-helpers');

// Queue configuration
const CONFIG = {
    BATCH_COLLECT_TIME: 2000,      // 2 seconds to collect photos
    MIN_REPLY_INTERVAL: 1500,      // Minimum 1.5 sec between replies
    MAX_PHOTOS_PER_BATCH: 10,      // Max photos to process at once
    ACKNOWLEDGMENT_DELAY: 500,     // Delay before first acknowledgment
    QUEUE_PROCESS_DELAY: 1000,     // Delay between queue processing
    MAX_CONCURRENT_BATCHES: 3,     // Max concurrent batch processing
    SESSION_TIMEOUT: 1800000       // 30 minutes session timeout
};

// Global queue manager
class PhotoUploadQueue {
    constructor() {
        this.userQueues = new Map();
        this.lastReplyTime = new Map();
        this.processingCount = 0;
        this.userSessions = new Map(); // Track user sessions
    }
    
    /**
     * Get or create session for user
     */
    getOrCreateSession(sender, ticketId) {
        if (!this.userSessions.has(sender)) {
            this.userSessions.set(sender, {
                ticketId: ticketId,
                totalPhotosUploaded: 0,
                startTime: Date.now(),
                lastActivity: Date.now()
            });
        }
        
        const session = this.userSessions.get(sender);
        
        // Check if same ticket
        if (session.ticketId !== ticketId) {
            // New ticket, reset session
            this.userSessions.set(sender, {
                ticketId: ticketId,
                totalPhotosUploaded: 0,
                startTime: Date.now(),
                lastActivity: Date.now()
            });
            return this.userSessions.get(sender);
        }
        
        // Update last activity
        session.lastActivity = Date.now();
        
        // Check timeout
        if (Date.now() - session.startTime > CONFIG.SESSION_TIMEOUT) {
            // Session expired, create new one
            this.userSessions.set(sender, {
                ticketId: ticketId,
                totalPhotosUploaded: 0,
                startTime: Date.now(),
                lastActivity: Date.now()
            });
        }
        
        return this.userSessions.get(sender);
    }
    
    /**
     * Add photo to queue with smart batching
     */
    async addPhoto({
        sender,
        buffer,
        state,
        teknisiName,
        ticketId,
        reply
    }) {
        try {
            // Get or create session
            const session = this.getOrCreateSession(sender, ticketId);
            
            // Initialize queue for user if not exists
            if (!this.userQueues.has(sender)) {
                this.userQueues.set(sender, {
                    photos: [],
                    timer: null,
                    ticketId: ticketId,
                    state: state,
                    reply: reply,
                    teknisiName: teknisiName,
                    isProcessing: false,
                    acknowledged: false,
                    startTime: Date.now()
                });
            }
            
            const queue = this.userQueues.get(sender);
            
            // Check if different ticket
            if (queue.ticketId !== ticketId) {
                // Process old queue first if has photos
                if (queue.photos.length > 0) {
                    await this.processQueue(sender, false); // false = don't clear session
                }
                
                // Reset queue for new ticket
                queue.photos = [];
                queue.timer = null;
                queue.ticketId = ticketId;
                queue.state = state;
                queue.reply = reply;
                queue.teknisiName = teknisiName;
                queue.isProcessing = false;
                queue.acknowledged = false;
                queue.startTime = Date.now();
            }
            
            // Generate filename with session count
            const timestamp = Date.now();
            const photoNumber = session.totalPhotosUploaded + queue.photos.length + 1;
            const fileName = `photo_${teknisiName}_${photoNumber}_${timestamp}.jpg`;
            
            // Add photo to queue
            queue.photos.push({
                buffer: buffer,
                fileName: fileName,
                timestamp: timestamp,
                size: buffer.length,
                photoNumber: photoNumber
            });
            
            // Update queue info
            queue.state = state;
            queue.reply = reply;
            
            // Determine if this is first photo in SESSION (not just queue)
            const isFirstInSession = session.totalPhotosUploaded === 0 && queue.photos.length === 1;
            
            // Smart acknowledgment - only for first photo in session
            if (isFirstInSession && !queue.acknowledged) {
                queue.acknowledged = true;
                
                // Check rate limit
                const canReply = await this.checkRateLimit(sender);
                
                if (canReply) {
                    // Delayed acknowledgment to prevent instant flood
                    setTimeout(async () => {
                        try {
                            const minPhotos = state.otpVerifiedAt ? 2 : 1;
                            const { getPhotoResponse } = require('./photo-workflow-handler');
                            const message = getPhotoResponse(1, minPhotos, true);
                            await reply(message);
                            this.updateLastReplyTime(sender);
                        } catch (err) {
                            console.error('[QUEUE_ACK_ERROR]', err);
                        }
                    }, CONFIG.ACKNOWLEDGMENT_DELAY);
                }
            }
            
            // Clear existing timer
            if (queue.timer) {
                clearTimeout(queue.timer);
            }
            
            // Set timer for batch processing
            queue.timer = setTimeout(async () => {
                await this.processQueue(sender, false); // Don't clear session after process
            }, CONFIG.BATCH_COLLECT_TIME);
            
            // If reached max photos, schedule processing
            if (queue.photos.length >= CONFIG.MAX_PHOTOS_PER_BATCH) {
                clearTimeout(queue.timer);
                // Don't process immediately, schedule it
                queue.timer = setTimeout(async () => {
                    await this.processQueue(sender, false);
                }, CONFIG.QUEUE_PROCESS_DELAY);
            }
            
            // Log current status
            const totalInSession = session.totalPhotosUploaded + queue.photos.length;
            console.log(`[PHOTO_QUEUE] Photo ${totalInSession} queued for ${sender} (${queue.photos.length} in current batch)`);
            
            return {
                success: true,
                queued: true,
                count: queue.photos.length,
                totalInSession: totalInSession,
                willProcess: queue.photos.length >= CONFIG.MAX_PHOTOS_PER_BATCH
            };
            
        } catch (error) {
            console.error('[QUEUE_ADD_ERROR]', error);
            return {
                success: false,
                message: 'Failed to queue photo'
            };
        }
    }
    
    /**
     * Process queued photos with rate limiting
     * @param {boolean} clearSession - Whether to clear session after processing
     */
    async processQueue(sender, clearSession = false) {
        const queue = this.userQueues.get(sender);
        if (!queue || queue.photos.length === 0 || queue.isProcessing) {
            return;
        }
        
        // Check concurrent processing limit
        if (this.processingCount >= CONFIG.MAX_CONCURRENT_BATCHES) {
            // Reschedule
            queue.timer = setTimeout(async () => {
                await this.processQueue(sender, clearSession);
            }, CONFIG.QUEUE_PROCESS_DELAY);
            return;
        }
        
        queue.isProcessing = true;
        this.processingCount++;
        
        const { photos, ticketId, state, reply, teknisiName } = queue;
        const session = this.userSessions.get(sender);
        
        try {
            console.log(`[QUEUE_PROCESS] Processing ${photos.length} photos for ${sender}`);
            
            // Create upload directory
            const date = new Date();
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const uploadDir = path.join(__dirname, '../../uploads/tickets', String(year), month, ticketId);
            
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            
            // Process photos with slight delay between saves
            const successfulUploads = [];
            const failedUploads = [];
            
            for (let i = 0; i < photos.length; i++) {
                const photo = photos[i];
                try {
                    const filePath = path.join(uploadDir, photo.fileName);
                    
                    // Add small delay between file writes to prevent I/O flooding
                    if (i > 0) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    
                    fs.writeFileSync(filePath, photo.buffer);
                    
                    successfulUploads.push({
                        fileName: photo.fileName,
                        path: filePath,
                        uploadedAt: new Date(photo.timestamp).toISOString(),
                        uploadedBy: teknisiName,
                        size: photo.size,
                        verified: state.otpVerifiedAt ? true : false,
                        photoNumber: photo.photoNumber
                    });
                    
                } catch (err) {
                    console.error(`[QUEUE_SAVE_ERROR] ${photo.fileName}:`, err);
                    failedUploads.push(photo.fileName);
                }
            }
            
            // Update session count
            if (session) {
                session.totalPhotosUploaded += successfulUploads.length;
            }
            
            // Update state - ACCUMULATE photos, don't replace
            state.uploadedPhotos = state.uploadedPhotos || [];
            state.uploadedPhotos.push(...successfulUploads);
            
            // Save state - CRITICAL: Keep state alive
            const { setUserState } = require('./conversation-handler');
            setUserState(sender, state);
            
            // Check rate limit before reply
            const canReply = await this.checkRateLimit(sender);
            
            if (canReply) {
                // Use better workflow handler for response
                const { handlePhotoUploadComplete } = require('./photo-workflow-handler');
                
                const totalPhotos = state.uploadedPhotos.length;
                const minPhotos = state.otpVerifiedAt ? 2 : 1;
                
                // Send response with delay
                setTimeout(async () => {
                    try {
                        await handlePhotoUploadComplete({
                            sender,
                            successCount: successfulUploads.length,
                            failedCount: failedUploads.length,
                            totalPhotos: totalPhotos,
                            minPhotos: minPhotos,
                            reply
                        });
                        this.updateLastReplyTime(sender);
                    } catch (err) {
                        console.error('[QUEUE_REPLY_ERROR]', err);
                    }
                }, CONFIG.QUEUE_PROCESS_DELAY);
            }
            
            console.log(`[QUEUE_PROCESS] Completed: ${successfulUploads.length}/${photos.length} photos. Total in session: ${session?.totalPhotosUploaded || 0}`);
            
            // Clear processed photos from queue
            queue.photos = [];
            queue.isProcessing = false;
            
            // Reset acknowledgment for next batch
            queue.acknowledged = false;
            
        } catch (error) {
            console.error('[QUEUE_PROCESS_ERROR]', error);
            
            // Try to send error message with rate limit check
            const canReply = await this.checkRateLimit(sender);
            if (canReply) {
                try {
                    await reply(renderResponseTemplate(
                        'photo_queue_process_error',
                        '❌ Error memproses foto. Silakan coba lagi.'
                    ));
                    this.updateLastReplyTime(sender);
                } catch (err) {
                    console.error('[QUEUE_ERROR_REPLY]', err);
                }
            }
            
            queue.isProcessing = false;
            
        } finally {
            // Reduce counter
            this.processingCount--;
            
            // Only clear queue if explicitly requested (e.g., after "done" command)
            if (clearSession) {
                this.userQueues.delete(sender);
                this.userSessions.delete(sender);
                console.log(`[QUEUE_CLEANUP] Session cleared for ${sender}`);
            } else {
                // Keep queue alive but mark as not processing
                queue.isProcessing = false;
            }
        }
    }
    
    /**
     * Check if we can reply (rate limiting)
     */
    async checkRateLimit(sender) {
        const lastReply = this.lastReplyTime.get(sender) || 0;
        const timeSinceLastReply = Date.now() - lastReply;
        
        // Allow reply if enough time has passed
        return timeSinceLastReply >= CONFIG.MIN_REPLY_INTERVAL;
    }
    
    /**
     * Update last reply time
     */
    updateLastReplyTime(sender) {
        this.lastReplyTime.set(sender, Date.now());
        
        // Clean old entries after 1 minute
        setTimeout(() => {
            const age = Date.now() - (this.lastReplyTime.get(sender) || 0);
            if (age > 60000) {
                this.lastReplyTime.delete(sender);
            }
        }, 60000);
    }
    
    /**
     * Get queue status
     */
    getQueueStatus(sender) {
        const queue = this.userQueues.get(sender);
        const session = this.userSessions.get(sender);
        
        if (!queue && !session) return null;
        
        return {
            photoCount: queue?.photos?.length || 0,
            ticketId: queue?.ticketId || session?.ticketId,
            isProcessing: queue?.isProcessing || false,
            timeInQueue: queue ? Date.now() - queue.startTime : 0,
            totalInSession: session?.totalPhotosUploaded || 0,
            sessionActive: !!session
        };
    }
    
    /**
     * Force process queue
     */
    async forceProcess(sender, clearSession = false) {
        const queue = this.userQueues.get(sender);
        if (queue && queue.timer) {
            clearTimeout(queue.timer);
        }
        await this.processQueue(sender, clearSession);
    }
    
    /**
     * Clear queue and session
     */
    clearQueue(sender) {
        const queue = this.userQueues.get(sender);
        if (queue && queue.timer) {
            clearTimeout(queue.timer);
        }
        this.userQueues.delete(sender);
        this.userSessions.delete(sender);
        this.lastReplyTime.delete(sender);
        console.log(`[QUEUE_CLEAR] Cleared all data for ${sender}`);
    }
    
    /**
     * Get session info
     */
    getSessionInfo(sender) {
        return this.userSessions.get(sender);
    }
}

// Singleton instance
const uploadQueue = new PhotoUploadQueue();

module.exports = {
    uploadQueue,
    addPhotoToQueue: (params) => uploadQueue.addPhoto(params),
    getQueueStatus: (sender) => uploadQueue.getQueueStatus(sender),
    forceProcessQueue: (sender, clearSession) => uploadQueue.forceProcess(sender, clearSession),
    clearUploadQueue: (sender) => uploadQueue.clearQueue(sender),
    getSessionInfo: (sender) => uploadQueue.getSessionInfo(sender)
};
