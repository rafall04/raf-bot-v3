/**
 * Header Doc
 * Purpose: Utility normalisasi JID WhatsApp dan resolusi LID ke nomor canonical untuk bot, saldo, database, dan pengiriman pesan.
 * Caller: Router/handler WhatsApp, service saldo/payment, dan test `lib/__tests__/jid-utils.test.js`.
 * Deps: `fs`, `path`, `database/lid-mappings.json`, dan cache `global.users` untuk fallback mapping legacy.
 * MainFuncs: `normalizeJid`, `toCanonicalJid`, `buildCanonicalContext`, `normalizePhoneToJid`, `extractPhoneFromJid`.
 * SideEffects: Memastikan file `database/lid-mappings.json` tersedia saat module load dan membaca mapping LID dari disk.
 */

const fs = require('fs');
const path = require('path');

const MAPPINGS_FILE = path.join(__dirname, '..', 'database', 'lid-mappings.json');
const WHATSAPP_SUFFIX = '@s.whatsapp.net';

/**
 * Ensure database/lid-mappings.json exists with default structure
 */
function ensureMappingsFile() {
    try {
        const dir = path.dirname(MAPPINGS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(MAPPINGS_FILE)) {
            fs.writeFileSync(MAPPINGS_FILE, JSON.stringify({ mappings: {} }, null, 2));
        }
    } catch (error) {
        console.error('[JID_UTILS] Failed to ensure mappings file:', error.message);
    }
}

// Call ensureMappingsFile at script init
ensureMappingsFile();

/**
 * Extract stored mapping by LID JID
 * @param {string} lidJid - LID JID to search
 * @returns {Object|null} { phoneNumber, pnJid } or null
 */
function getStoredMappingByLid(lidJid) {
    if (!lidJid || !lidJid.endsWith('@lid')) return null;
    
    const lidId = lidJid.split('@')[0];
    const mappings = loadMappings();
    
    // Method 1: Check mappings.mappings directly (if it stores PN)
    if (mappings.mappings && mappings.mappings[lidId]) {
        const value = mappings.mappings[lidId];
        
        // If it's already a PN JID string
        if (typeof value === 'string' && value.endsWith(WHATSAPP_SUFFIX)) {
            return {
                phoneNumber: extractPhoneFromJid(value),
                pnJid: resolveLegacyStoredMapping(value) || value
            };
        }
        
        // If it's a numeric/string ID (userId) from findUserWithLidSupport
        try {
            const users = global.users || [];
            if (users.length > 0) {
                const user = users.find(u => u.id === value || String(u.id) === String(value));
                if (user && user.phone_number) {
                    const normalized = getUserPhoneCandidates(user)[0];
                    
                    if (normalized && normalized.length >= 10 && normalized.length <= 15) {
                        return {
                            phoneNumber: normalized,
                            pnJid: `${normalized}${WHATSAPP_SUFFIX}`
                        };
                    }
                }
            }
        } catch (error) {
            console.warn(`[JID_UTILS] Error resolving @lid via stored userId:`, error.message);
        }
    }
    
    return null;
}

/**
 * Load stored LID mappings
 */
function loadMappings() {
    try {
        if (fs.existsSync(MAPPINGS_FILE)) {
            return JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf8'));
        }
    } catch (error) {
        console.warn('[JID_UTILS] Failed to load mappings:', error.message);
    }
    return { mappings: {} };
}

/**
 * Save LID mappings
 */
function saveMappings(data) {
    try {
        const dir = path.dirname(MAPPINGS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('[JID_UTILS] Failed to save mappings:', error.message);
    }
}

/**
 * Normalize phone number to standard format
 * @param {string} phone - Phone number (with or without +, 62, 0 prefix)
 * @returns {string} Normalized phone number (62xxxxxxxxxx)
 */
function normalizePhoneNumber(phone) {
    if (!phone) return null;
    
    let normalized = phone.replace(/[^0-9]/g, '');
    
    if (normalized.startsWith('0')) {
        normalized = '62' + normalized.substring(1);
    } else if (normalized.startsWith('+62')) {
        normalized = normalized.substring(1);
    } else if (!normalized.startsWith('62')) {
        normalized = '62' + normalized;
    }
    
    return normalized;
}

/**
 * Extract phone number from JID
 * @param {string} jid - JID (e.g., 6281234567890@s.whatsapp.net or 1234567890@lid)
 * @returns {string|null} Phone number without @s.whatsapp.net or @lid
 */
function extractPhoneFromJid(jid) {
    if (!jid) return null;
    
    // Remove @s.whatsapp.net, @lid, @g.us, :0 etc
    let phone = jid.split('@')[0].split(':')[0];
    
    return phone || null;
}

/**
 * Convert phone number to JID format
 * @param {string} phone - Phone number (various formats)
 * @returns {string} JID in format 62xxxxxxxx@s.whatsapp.net
 */
function normalizePhoneToJid(phone) {
    if (!phone) return null;
    
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return null;
    
    return `${normalized}${WHATSAPP_SUFFIX}`;
}

function maskPhoneNumber(phoneNumber) {
    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized || normalized.length < 6) return normalized;
    return `${normalized.slice(0, 4)}***${normalized.slice(-3)}`;
}

function logResolutionEvent(level, event, payload = {}) {
    const logger = console[level] || console.log;
    const sanitized = { ...payload };
    if (sanitized.phoneNumber) {
        sanitized.phoneNumber = maskPhoneNumber(sanitized.phoneNumber);
    }
    if (sanitized.canonicalJid) {
        sanitized.canonicalJid = sanitized.canonicalJid.replace(/^(\d{4})\d+(\@.*)$/, '$1***$2');
    }
    logger(`[JID_UTILS] ${event}`, sanitized);
}

function getUserPhoneCandidates(user) {
    if (!user || !user.phone_number) return [];

    const parts = user.phone_number.split('|').map((value) => value.trim()).filter(Boolean);
    const candidates = [];

    for (const part of parts) {
        if (part.endsWith('@lid')) continue;

        const extracted = part.includes('@') ? extractPhoneFromJid(part) : part;
        const normalized = normalizePhoneNumber(extracted);
        if (normalized) {
            candidates.push(normalized);
        }
    }

    return [...new Set(candidates)];
}

function findUserByCanonicalPhone(users, phoneNumber) {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) return null;

    return users.find((user) => getUserPhoneCandidates(user).includes(normalizedPhone)) || null;
}

function resolveLegacyStoredMapping(value) {
    if (typeof value === 'string' && value.endsWith(WHATSAPP_SUFFIX)) {
        return value;
    }

    return null;
}

/**
 * Extract preferred plain sender number from message metadata.
 * Prioritizes explicit phone-number JID fields when sender is @lid.
 * @param {Object} msg - WhatsApp message object
 * @param {string} sender - Sender JID
 * @returns {string|null} Plain phone number candidate
 */
function getPreferredPlainSenderNumber(msg, sender = null) {
    const fallback = sender && !sender.endsWith('@lid')
        ? sender.split('@')[0].split(':')[0]
        : null;

    if (!msg || !msg.key) {
        return fallback;
    }

    const candidates = [
        msg.key.remoteJidAlt,
        msg.key.participantAlt,
        msg.key.participant,
        msg.participant,
        msg.author,
        msg.userJid
    ];

    for (const candidate of candidates) {
        if (candidate && candidate.includes('@s.whatsapp.net')) {
            return candidate.split('@')[0].split(':')[0];
        }
    }

    return fallback;
}

/**
 * Check if JID is in @lid format
 * @param {string} jid - JID to check
 * @returns {boolean}
 */
function isLidJid(jid) {
    return jid && jid.endsWith('@lid');
}

/**
 * Check if JID is in @s.whatsapp.net format
 * @param {string} jid - JID to check
 * @returns {boolean}
 */
function isStandardJid(jid) {
    return jid && jid.endsWith('@s.whatsapp.net');
}

/**
 * MAIN FUNCTION: Normalize JID to @s.whatsapp.net format
 * 
 * @param {string} jid - JID to normalize (可以是 @lid, @s.whatsapp.net, phone number)
 * @param {Object} options - Options
 * @param {boolean} options.allowLid - Return @lid if normalization fails (default: false)
 * @param {Object} options.raf - WhatsApp socket for signalRepository access
 * @param {string} options.context - Debug context
 * @returns {Promise<string|null>} Normalized JID or null
 */
async function normalizeJid(jid, options = {}) {
    if (!jid) return null;
    
    const { 
        allowLid = false, 
        raf = null, 
        context = 'general' 
    } = options;

    const resolution = await resolveCanonicalCustomerContext({
        sender: jid,
        msg: options.msg || null,
        raf,
        users: options.users || global.users || [],
        flow: context
    });

    if (resolution.resolved && resolution.canonicalJid) {
        return resolution.canonicalJid;
    }

    if (allowLid && jid.endsWith('@lid')) {
        return jid;
    }

    if (!jid.includes('@')) {
        return normalizePhoneToJid(jid);
    }

    return jid.endsWith(WHATSAPP_SUFFIX) ? jid.split(':')[0] : null;
}

/**
 * Alias for normalizeJid - for backward compatibility
 */
async function normalizeJidForSaldo(jid, options = {}) {
    return normalizeJid(jid, { ...options, context: 'saldo' });
}

/**
 * Alias for sending messages
 */
async function normalizeJidForMessage(jid, options = {}) {
    return normalizeJid(jid, { ...options, context: 'message' });
}

/**
 * Alias for database operations
 */
async function normalizeJidForDb(jid, options = {}) {
    return normalizeJid(jid, { ...options, context: 'database' });
}

/**
 * Find user with @lid support
 * @param {Array} users - Users array
 * @param {Object} msg - WhatsApp message object
 * @param {string} plainSenderNumber - Plain phone number
 * @param {Object} raf - WhatsApp socket
 * @returns {Promise<Object|null>} Found user or null
 */
async function findUserWithLidSupport(users, msg, plainSenderNumber, raf = null) {
    const sender = msg?.key?.remoteJid || null;
    const resolution = await resolveCanonicalCustomerContext({
        sender,
        msg,
        raf,
        users,
        plainSenderNumber
    });
    return resolution.user || null;
}

/**
 * Resolve customer user using unified LID-aware lookup.
 * @param {Object} params - Resolve params
 * @param {Array} params.users - Users array
 * @param {string} params.sender - Sender JID
 * @param {Object|null} params.msg - WhatsApp message object
 * @param {string|null} params.plainSenderNumber - Optional precomputed plain sender number
 * @param {Object|null} params.raf - WhatsApp socket
 * @returns {Promise<{user: Object|null, plainSenderNumber: string|null}>}
 */
async function resolveCustomerBySender({ users, sender, msg = null, plainSenderNumber = null, raf = null }) {
    const resolution = await resolveCanonicalCustomerContext({
        users,
        sender,
        msg,
        plainSenderNumber,
        raf
    });

    return {
        user: resolution.user,
        plainSenderNumber: resolution.phoneNumber,
        phoneNumber: resolution.phoneNumber,
        canonicalJid: resolution.canonicalJid,
        resolved: resolution.resolved,
        resolutionSource: resolution.resolutionSource,
        transportJid: resolution.transportJid,
        rawSender: resolution.rawSender
    };
}

async function resolveCanonicalCustomerContext({
    sender,
    msg = null,
    raf = null,
    users = [],
    plainSenderNumber = null,
    flow = 'general'
}) {
    const rawSender = sender || msg?.key?.remoteJid || null;
    const normalizedUsers = Array.isArray(users) ? users : [];
    const result = {
        rawSender,
        canonicalJid: null,
        phoneNumber: null,
        user: null,
        resolutionSource: null,
        resolved: false,
        transportJid: rawSender,
        flow
    };

    if (!rawSender) {
        return result;
    }

    const assignResolution = (phoneNumber, source, user = null, transportJid = null) => {
        const normalizedPhone = normalizePhoneNumber(phoneNumber);
        if (!normalizedPhone) {
            return false;
        }

        result.phoneNumber = normalizedPhone;
        result.canonicalJid = normalizePhoneToJid(normalizedPhone);
        result.user = user || findUserByCanonicalPhone(normalizedUsers, normalizedPhone);
        result.resolutionSource = source;
        result.resolved = true;
        result.transportJid = transportJid || result.canonicalJid || rawSender;
        return true;
    };

    if (rawSender.endsWith(WHATSAPP_SUFFIX)) {
        assignResolution(extractPhoneFromJid(rawSender), 'standard_jid', findUserByCanonicalPhone(normalizedUsers, rawSender), rawSender);
        return result;
    }

    if (!rawSender.includes('@')) {
        assignResolution(rawSender, 'plain_phone', findUserByCanonicalPhone(normalizedUsers, rawSender), normalizePhoneToJid(rawSender));
        return result;
    }

    const metadataCandidate = normalizePhoneNumber(plainSenderNumber || getPreferredPlainSenderNumber(msg, rawSender));
    if (metadataCandidate && assignResolution(metadataCandidate, 'message_metadata')) {
        if (rawSender.endsWith('@lid')) {
            const lidId = rawSender.split('@')[0];
            const mappings = loadMappings();
            if (mappings.mappings[lidId] !== result.canonicalJid) {
                mappings.mappings[lidId] = result.canonicalJid;
                saveMappings(mappings);
            }
        }
        return result;
    }

    if (rawSender.endsWith('@lid') && raf?.signalRepository?.lidMapping?.getPNForLID) {
        try {
            const signalJid = await raf.signalRepository.lidMapping.getPNForLID(rawSender);
            if (signalJid && assignResolution(extractPhoneFromJid(signalJid), 'signal_repository', null, signalJid)) {
                const lidId = rawSender.split('@')[0];
                const mappings = loadMappings();
                if (mappings.mappings[lidId] !== result.canonicalJid) {
                    mappings.mappings[lidId] = result.canonicalJid;
                    saveMappings(mappings);
                }
                return result;
            }
        } catch (error) {
            logResolutionEvent('warn', 'signal_repository_failed', {
                rawSender,
                flow,
                reason: error.message
            });
        }
    }

    if (rawSender.endsWith('@lid')) {
        const stored = getStoredMappingByLid(rawSender);
        if (stored && assignResolution(stored.phoneNumber, 'stored_mapping', null, stored.pnJid)) {
            return result;
        }

        const mappings = loadMappings();
        const legacyValue = mappings.mappings ? mappings.mappings[rawSender.split('@')[0]] : null;
        if (legacyValue && !String(legacyValue).endsWith(WHATSAPP_SUFFIX)) {
            const mappedUser = normalizedUsers.find((user) => String(user.id) === String(legacyValue));
            if (mappedUser) {
                const mappedPhone = getUserPhoneCandidates(mappedUser)[0];
                if (assignResolution(mappedPhone, 'stored_mapping', mappedUser)) {
                    if (mappings.mappings[rawSender.split('@')[0]] !== result.canonicalJid) {
                        mappings.mappings[rawSender.split('@')[0]] = result.canonicalJid;
                        saveMappings(mappings);
                    }
                    return result;
                }
            }
        }

        const userByLid = normalizedUsers.find((user) => user && user.lid === rawSender) || null;
        if (userByLid) {
            const userPhone = getUserPhoneCandidates(userByLid)[0];
            if (assignResolution(userPhone, 'user_lid_field', userByLid)) {
                const lidId = rawSender.split('@')[0];
                const mappings = loadMappings();
                if (mappings.mappings[lidId] !== result.canonicalJid) {
                    mappings.mappings[lidId] = result.canonicalJid;
                    saveMappings(mappings);
                }
                return result;
            }
        }
    }

    const phoneCandidate = plainSenderNumber || extractPhoneFromJid(rawSender);
    const userByPhone = findUserByCanonicalPhone(normalizedUsers, phoneCandidate);
    if (userByPhone) {
        const matchedPhone = getUserPhoneCandidates(userByPhone)[0] || phoneCandidate;
        if (assignResolution(matchedPhone, 'user_phone_lookup', userByPhone)) {
            if (rawSender.endsWith('@lid')) {
                const lidId = rawSender.split('@')[0];
                const mappings = loadMappings();
                if (mappings.mappings[lidId] !== result.canonicalJid) {
                    mappings.mappings[lidId] = result.canonicalJid;
                    saveMappings(mappings);
                }
            }
            return result;
        }
    }

    logResolutionEvent('warn', 'customer_unresolved', {
        rawSender,
        flow
    });
    return result;
}

// Store temporary verification codes
const verificationCodes = new Map();

/**
 * Extract sender info from message object
 * @param {Object} msg - WhatsApp message object
 * @param {Boolean} isGroup - Whether message is from group
 * @returns {Object} Sender info
 */
function extractSenderInfo(msg, isGroup = false) {
    const result = {
        originalSender: msg.key.remoteJid,
        isLid: false,
        phoneNumber: null,
        pushname: msg.pushName || null,
        participant: null,
        method: 'direct'
    };
    
    const senderJid = isGroup ? 
        (msg.key.participant || msg.participant) : 
        msg.key.remoteJid;
    
    if (senderJid && senderJid.endsWith('@lid')) {
        result.isLid = true;
        result.originalSender = senderJid;
        
        if (!isGroup && msg.key.remoteJidAlt && msg.key.remoteJidAlt.includes('@s.whatsapp.net')) {
            result.phoneNumber = msg.key.remoteJidAlt.split('@')[0];
            result.participant = msg.key.remoteJidAlt;
            result.method = 'remoteJidAlt';
        } else if (isGroup && msg.key.participantAlt && msg.key.participantAlt.includes('@s.whatsapp.net')) {
            result.phoneNumber = msg.key.participantAlt.split('@')[0];
            result.participant = msg.key.participantAlt;
            result.method = 'participantAlt';
        } else if (msg.key.participant && msg.key.participant.includes('@s.whatsapp.net')) {
            result.phoneNumber = msg.key.participant.split('@')[0];
            result.participant = msg.key.participant;
            result.method = 'participant';
        } else if (msg.participant && msg.participant.includes('@s.whatsapp.net')) {
            result.phoneNumber = msg.participant.split('@')[0];
            result.participant = msg.participant;
            result.method = 'msg_participant';
        } else if (msg.author && msg.author.includes('@s.whatsapp.net')) {
            result.phoneNumber = msg.author.split('@')[0];
            result.participant = msg.author;
            result.method = 'author';
        } else if (msg.phoneNumber) {
            result.phoneNumber = msg.phoneNumber.replace(/[^0-9]/g, '');
            result.method = 'phone_field';
        } else if (msg.userJid && msg.userJid.includes('@s.whatsapp.net')) {
            result.phoneNumber = msg.userJid.split('@')[0];
            result.participant = msg.userJid;
            result.method = 'userJid';
        } else if (msg.verifiedBizName) {
            result.method = 'business';
        }
    } else if (msg.key.remoteJid && msg.key.remoteJid.includes('@s.whatsapp.net')) {
        result.phoneNumber = msg.key.remoteJid.split('@')[0];
        result.method = 'standard';
    }
    
    return result;
}

/**
 * Handle LID verification internally
 */
function handleLidVerification(lidId, userId, code = null) {
    if (!verificationCodes.has(lidId)) {
        return { valid: false, message: 'Tidak ada permintaan verifikasi' };
    }
    
    const verification = verificationCodes.get(lidId);
    
    if (verification.expiresAt < Date.now()) {
        verificationCodes.delete(lidId);
        return { valid: false, message: 'Kode verifikasi expired' };
    }
    
    if (code && code !== verification.code) {
        return { valid: false, message: 'Kode verifikasi salah' };
    }
    
    if (code) {
        verificationCodes.delete(lidId);
        return { valid: true, userId: verification.userId, message: 'Verifikasi berhasil' };
    }
    
    return { valid: true, pending: true };
}

/**
 * Create LID verification code
 * @param {string} lidId - LID ID
 * @param {Array} users - Users array
 * @returns {Object|null} Verification code info
 */
function createLidVerification(lidId, users) {
    const user = Array.isArray(users) ? users.find((u) => u && u.lid === `${lidId}@lid`) : null;
    
    if (!user) {
        return null;
    }
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    
    verificationCodes.set(lidId, {
        userId: user.id,
        code,
        expiresAt
    });
    
    return { code, expiresAt };
}

/**
 * Process LID verification
 * @param {string} lidId - LID ID
 * @param {string} input - User input (phone number or code)
 * @param {Array} users - Users array
 * @returns {Object} Verification result
 */
function processLidVerification(lidId, input, users) {
    const result = handleLidVerification(lidId, null, input);
    
    if (result.valid && result.userId) {
        const user = users.find(u => u.id === result.userId);
        
        if (user) {
            const mappings = loadMappings();
            mappings.mappings[lidId] = getUserPhoneCandidates(user)[0]
                ? normalizePhoneToJid(getUserPhoneCandidates(user)[0])
                : user.id;
            saveMappings(mappings);
            
            return {
                success: true,
                user,
                message: 'Nomor berhasil diverifikasi'
            };
        }
    }
    
    return {
        success: false,
        message: result.message
    };
}

/**
 * Extract phone number for sending messages (Baileys v7+ recommended format)
 * 
 * Baileys v7+ recommends using phone number WITHOUT @s.whatsapp.net suffix
 * This function extracts just the phone number for sendMessage()
 * 
 * @param {string} input - JID, phone number, or any identifier
 * @returns {Promise<string|null>} Phone number for sending (e.g., "6281234567890")
 */
async function extractPhoneForSending(input) {
    if (!input) return null;
    
    // If already just a phone number (no @)
    if (!input.includes('@')) {
        return normalizePhoneNumber(input);
    }
    
    // Extract from JID formats
    const phone = input.split('@')[0].split(':')[0];
    return normalizePhoneNumber(phone);
}

/**
 * ONE resolver to rule them all: toCanonicalJid
 * Converts any JID (LID or standard) to canonical HP JID
 * 
 * @param {string} jid - Original JID
 * @param {Object} msg - Message object for metadata lookup
 * @param {Object} raf - Raf instance for signalRepository
 * @returns {Promise<string|null>} Canonical JID or null
 */
async function toCanonicalJidLegacy(jid, msg = null, raf = null) {
    if (!jid) return null;

    // Non-LID: langsung normalize
    if (!isLidJid(jid)) return normalizePhoneToJid(extractPhoneFromJid(jid));

    // Step 1: cek stored mapping
    const stored = getStoredMappingByLid(jid);
    if (stored) return normalizePhoneToJid(stored.phoneNumber);

    // Step 2: cek metadata pesan
    const fromMeta = getPreferredPlainSenderNumber(msg, jid);
    if (fromMeta && !fromMeta.includes('@lid') && fromMeta.length >= 10) return normalizePhoneToJid(fromMeta);

    // Step 3: query Baileys signalRepository
    if (raf?.signalRepository?.lidMapping) {
        try {
            const pnJid = await raf.signalRepository.lidMapping.getPNForLID(jid);
            if (pnJid && !pnJid.includes('@lid') && pnJid.length >= 10) {
                // Save mapping for future use (compatible with findUserWithLidSupport)
                // We save as PN JID to be easily recognized by getStoredMappingByLid
                const lidId = jid.split('@')[0];
                const mappings = loadMappings();
                mappings.mappings[lidId] = pnJid;
                saveMappings(mappings);
                return pnJid;
            }
        } catch (error) {
            console.warn('[JID_UTILS] Error in getPNForLID:', error.message);
        }
    }

    // Step 4: fallback — tidak bisa dikonversi
    return null;
}

/**
 * Build canonical context for use in routers
 */
async function buildCanonicalContextLegacy(rawSender, msg, raf) {
    const canonicalId = await toCanonicalJid(rawSender, msg, raf);
    const phoneNumber = canonicalId ? extractPhoneFromJid(canonicalId) : null;
    
    return {
        canonicalId,
        phoneNumber,
        isResolved: !!canonicalId,
        isLid: isLidJid(rawSender),
        rawSender
    };
}

async function toCanonicalJid(jid, msg = null, raf = null) {
    const resolution = await resolveCanonicalCustomerContext({
        sender: jid,
        msg,
        raf,
        users: global.users || [],
        flow: 'canonical'
    });
    return resolution.canonicalJid;
}

async function buildCanonicalContext(rawSender, msg, raf) {
    const resolution = await resolveCanonicalCustomerContext({
        sender: rawSender,
        msg,
        raf,
        users: global.users || [],
        flow: 'router'
    });

    return {
        canonicalId: resolution.canonicalJid,
        phoneNumber: resolution.phoneNumber,
        isResolved: resolution.resolved,
        isLid: isLidJid(rawSender),
        rawSender,
        resolutionSource: resolution.resolutionSource,
        user: resolution.user,
        transportJid: resolution.transportJid
    };
}

async function inspectSenderResolution(sender, msg = null, raf = null, users = []) {
    return resolveCanonicalCustomerContext({
        sender,
        msg,
        raf,
        users,
        flow: 'diagnostic'
    });
}

module.exports = {
    // Main functions
    normalizeJid,
    normalizeJidForSaldo,
    normalizeJidForMessage,
    normalizeJidForDb,
    
    // Utility functions
    normalizePhoneNumber,
    normalizePhoneToJid,
    extractPhoneFromJid,
    getPreferredPlainSenderNumber,
    isLidJid,
    isStandardJid,
    
    // User lookup
    findUserWithLidSupport,
    resolveCustomerBySender,
    resolveCanonicalCustomerContext,
    
    // Sender info
    extractSenderInfo,
    
    // Verification
    createLidVerification,
    processLidVerification,
    
    // Phone for sending (new in Baileys v7+)
    extractPhoneForSending,
    toCanonicalJid,
    buildCanonicalContext,
    inspectSenderResolution,
    getStoredMappingByLid,
    ensureMappingsFile,
    maskPhoneNumber,

};
