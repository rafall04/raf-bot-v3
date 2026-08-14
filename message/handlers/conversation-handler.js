"use strict";

/**
 * Header Doc
 * Purpose: Penyimpan & siklus hidup conversation state multi-langkah (in-memory, per pengirim).
 *          Menyediakan get/set/delete + varian ber-scope, kedaluwarsa otomatis 15 menit, serta DUA
 *          registry hook per `state.step` agar domain pemilik state bisa menutup dirinya sendiri:
 *          `registerStateTimeoutHandler` (sesi mati sendiri) dan `registerStateCancelHandler`
 *          (pemakai mengetik kata batal universal, yang dicegat lebih dulu di `message/raf.js`).
 * Caller: `message/raf.js`, `message/handlers/conversation-state-router.js`, seluruh state domain
 *         di `message/handlers/state-domains/*`.
 * Deps: `lib/templating` (templatesCache, untuk helper `format`).
 * MainFuncs: `getUserState`, `setUserState`, `updateUserState`, `deleteUserState`,
 *            `getScopedState`/`setScopedState`/`deleteScopedState`/`createScopedStateProxy`,
 *            `registerStateTimeoutHandler`, `registerStateCancelHandler`, `runCancelHandler`.
 * SideEffects: Menyimpan state di memori proses + timer kedaluwarsa; menjalankan handler domain
 *              (yang boleh mengirim WhatsApp / menulis draft ke disk). NEVER-THROW di jalur handler.
 */

const { templatesCache } = require("../../lib/templating");

// Helper untuk format template
const format = (key, data = {}) => {
    let template = templatesCache.responseTemplates[key]?.template || '';
    for (const placeholder in data) {
        const regex = new RegExp(`\\$\\{${placeholder}\\}`, 'g');
        template = template.replace(regex, data[placeholder]);
    }
    return template;
};

// Message templates
const mess = {
    get owner() { return format('mess_owner'); },
    get userNotRegister() { return format('mess_userNotRegister'); },
    get notRegister() { return format('mess_notRegister'); },
    get notProfile() { return format('mess_notProfile'); },
    get onlyMonthly() { return format('mess_onlyMonthly'); },
    get wrongFormat() { return format('mess_wrongFormat'); },
    get mustNumber() { return format('mess_mustNumber'); },
    get teknisiOrOwnerOnly() { return format('mess_teknisiOrOwnerOnly'); },
    get teknisiOnly() { return format('mess_teknisiOnly'); },
    get reportNotFound() { return format('mess_reportNotFound'); },
    get reportAlreadyDone() { return format('mess_reportAlreadyDone'); },
    get reportNotFound_detail() { return format('mess_reportNotFound_detail'); },
    get reportAlreadyDone_detail() { return format('mess_reportAlreadyDone_detail'); },
};

// Managed backing store for all conversation states.
const stateStore = Object.create(null);

// State timeout management
const STATE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const stateTimers = {};
const stateActivity = {}; // Track last activity time

// Registry handler timeout per `state.step`. Dipanggil sebelum state dihapus
// supaya domain (mis. reporting) bisa promote draft tiket → tiket asli, kirim
// notifikasi teknisi, dst. Handler boleh async; error ditelan tapi di-log.
const stateTimeoutHandlers = Object.create(null);

function registerStateTimeoutHandler(step, handler) {
    if (typeof handler !== 'function') return;
    stateTimeoutHandlers[step] = handler;
}

async function runTimeoutHandlerThenDelete(userId) {
    const state = stateStore[userId];
    if (state?.step && stateTimeoutHandlers[state.step]) {
        try {
            await stateTimeoutHandlers[state.step](userId, state);
        } catch (error) {
            console.error('[STATE_TIMEOUT_HANDLER_ERROR]', { userId, step: state.step, error: error?.message });
        }
    }
    console.log(`[AUTO-CLEANUP] Removing inactive state for user: ${userId}`);
    deleteUserState(userId);
}

// Registry handler PEMBATALAN per `state.step` — kembaran `stateTimeoutHandlers`.
// Alasannya: kata batal universal (`batal`/`cancel`/`ga jadi`/`gak jadi`) dicegat di `message/raf.js`
// JAUH sebelum `routeConversationState`, lalu langsung `deleteUserState` + balasan generik. Cabang
// BATAL milik domain karena itu TIDAK PERNAH jalan — jadi pembersihan miliknya (mis. draft PSB di
// disk) terlewat, dan pemakai menerima balasan umum yang tak menjelaskan nasib pekerjaannya.
// Terbukti asimetris: `gajadi` (tanpa spasi) tidak ada di daftar raf sehingga jatuh ke domain dan
// berperilaku BEDA dari `ga jadi` — perbedaan yang lahir hanya dari satu spasi.
// Handler mengembalikan `{ handled: true }` bila ia sudah membalas sendiri, supaya pemanggil tak
// mengirim balasan generik di atasnya (dua pesan untuk satu perintah).
const stateCancelHandlers = Object.create(null);

function registerStateCancelHandler(step, handler) {
    if (typeof handler !== 'function') return;
    stateCancelHandlers[step] = handler;
}

/**
 * Beri domain pemilik state kesempatan menutup dirinya sendiri sebelum state dihapus.
 * NEVER-THROW: kegagalan handler tak boleh menggagalkan pembatalan itu sendiri.
 * @returns {Promise<{handled: boolean}>} handled=true → domain sudah membalas.
 */
async function runCancelHandler(userId, deps = {}) {
    const state = stateStore[userId];
    const handler = state?.step ? stateCancelHandlers[state.step] : null;
    if (!handler) return { handled: false };
    try {
        const hasil = await handler(userId, state, deps);
        return { handled: !!(hasil && hasil.handled) };
    } catch (error) {
        console.error('[STATE_CANCEL_HANDLER_ERROR]', { userId, step: state.step, error: error?.message });
        return { handled: false };
    }
}

/**
 * Get user state from temporary storage
 * @param {string} userId - User ID
 * @returns {Object|null} User state or null if not found
 */
function inferFlow(step = '', scope = 'managed') {
    if (typeof step !== 'string' || !step) {
        return scope === 'teknisi' ? 'teknisi' : 'general';
    }

    if (step.startsWith('REPORT_') || step.startsWith('LAPOR_') || step.includes('GANGGUAN')) {
        return 'report';
    }
    if (step.startsWith('AGENT_')) {
        return 'agent';
    }
    if (step.startsWith('ASK_NEW_') || step.startsWith('SELECT_SSID') || step.startsWith('CONFIRM_GANTI_')) {
        return 'wifi';
    }
    if (step.includes('OTP') || step.includes('PHOTO') || step.includes('LOCATION') || step.includes('JOURNEY')) {
        return 'teknisi';
    }
    if (step.includes('TOPUP') || step.includes('SALDO') || step.includes('VOUCHER')) {
        return 'payment';
    }

    return scope === 'teknisi' ? 'teknisi' : 'general';
}

function inferOwnerType(step = '', scope = 'managed') {
    if (scope === 'teknisi') {
        return 'teknisi';
    }
    if (typeof step !== 'string') {
        return 'customer';
    }
    if (step.startsWith('AGENT_')) {
        return 'agent';
    }
    return 'customer';
}

function normalizeState(userId, state, options = {}) {
    const previousState = stateStore[userId] || null;
    const scope = options.scope || state._scope || previousState?._scope || 'managed';
    const now = new Date().toISOString();
    const createdAt = state.createdAt || previousState?.createdAt || now;
    const version = typeof previousState?.version === 'number' ? previousState.version + 1 : 1;
    const context = {
        ...(previousState?.context || {}),
        ...(state.context || {})
    };

    return {
        ...previousState,
        ...state,
        _scope: scope,
        flow: state.flow || previousState?.flow || inferFlow(state.step, scope),
        ownerType: state.ownerType || previousState?.ownerType || inferOwnerType(state.step, scope),
        createdAt,
        updatedAt: now,
        version,
        context
    };
}

function getUserState(userId) {
    if (stateStore[userId]) {
        // Update last activity time
        stateActivity[userId] = Date.now();
        // Reset timer on activity
        resetStateTimer(userId);
        const state = stateStore[userId];
        if (state && state._scope && state._scope !== 'managed') {
            console.warn('[legacyStateProxyRead]', {
                userId,
                scope: state._scope
            });
        }
    }
    return stateStore[userId] || null;
}

/**
 * Set user state in temporary storage with auto-cleanup
 * @param {string} userId - User ID
 * @param {Object} state - State object to store
 */
function setUserState(userId, state, options = {}) {
    // Clear existing timer if any
    if (stateTimers[userId]) {
        clearTimeout(stateTimers[userId]);
        delete stateTimers[userId];
    }
    
    stateStore[userId] = normalizeState(userId, state, options);
    stateActivity[userId] = Date.now();

    // Set auto cleanup timer — handler step (kalau ada) dipanggil dulu
    // supaya draft tiket bisa dipromosikan jadi tiket asli.
    stateTimers[userId] = setTimeout(() => runTimeoutHandlerThenDelete(userId), STATE_TIMEOUT);
}

function updateUserState(userId, updater, options = {}) {
    const currentState = stateStore[userId] || null;
    const nextState = typeof updater === 'function' ? updater(currentState) : updater;
    if (!nextState) {
        deleteUserState(userId);
        return null;
    }
    setUserState(userId, nextState, options);
    return getUserState(userId);
}

/**
 * Delete user state from temporary storage
 * @param {string} userId - User ID
 */
function deleteUserState(userId) {
    // Clear timer if exists
    if (stateTimers[userId]) {
        clearTimeout(stateTimers[userId]);
        delete stateTimers[userId];
    }
    
    delete stateStore[userId];
    delete stateActivity[userId];
}

function getScopedState(userId, scope) {
    const state = getUserState(userId);
    if (!state) {
        return null;
    }
    return state._scope === scope ? state : null;
}

function setScopedState(userId, state, scope) {
    setUserState(userId, state, { scope });
    return getScopedState(userId, scope);
}

function deleteScopedState(userId, scope) {
    const state = stateStore[userId];
    if (state && state._scope === scope) {
        deleteUserState(userId);
    }
}

function createScopedStateProxy(scope) {
    return new Proxy({}, {
        get(_target, prop) {
            if (prop === '__scope') return scope;
            if (prop === '__rawStore') return stateStore;
            if (prop === Symbol.toStringTag) return 'ScopedStateProxy';
            if (typeof prop !== 'string') return undefined;
            return getScopedState(prop, scope);
        },
        set(_target, prop, value) {
            if (typeof prop !== 'string') return false;
            console.warn('[legacyStateProxyWrite]', {
                userId: prop,
                scope
            });
            setScopedState(prop, value, scope);
            return true;
        },
        deleteProperty(_target, prop) {
            if (typeof prop !== 'string') return true;
            deleteScopedState(prop, scope);
            return true;
        },
        has(_target, prop) {
            if (typeof prop !== 'string') return false;
            return !!getScopedState(prop, scope);
        },
        ownKeys() {
            return Object.keys(stateStore).filter((userId) => stateStore[userId]?._scope === scope);
        },
        getOwnPropertyDescriptor(_target, prop) {
            if (typeof prop !== 'string') return undefined;
            const value = getScopedState(prop, scope);
            if (!value) return undefined;
            return {
                configurable: true,
                enumerable: true,
                value,
                writable: true
            };
        }
    });
}

/**
 * Reset state timer (called on user activity)
 * @param {string} userId - User ID
 */
function resetStateTimer(userId) {
    if (stateTimers[userId]) {
        clearTimeout(stateTimers[userId]);
        stateTimers[userId] = setTimeout(() => runTimeoutHandlerThenDelete(userId), STATE_TIMEOUT);
    }
}

/**
 * Check if user has active conversation state
 * @param {string} userId - User ID
 * @returns {boolean} True if user has active state
 */
function hasActiveState(userId) {
    return stateStore[userId] !== undefined;
}

/**
 * Clear all temporary states and timers
 */
function clearAllStates() {
    // Clear all timers first
    for (const userId in stateTimers) {
        clearTimeout(stateTimers[userId]);
    }
    
    // Clear all data
    Object.keys(stateStore).forEach(key => delete stateStore[key]);
    Object.keys(stateTimers).forEach(key => delete stateTimers[key]);
    Object.keys(stateActivity).forEach(key => delete stateActivity[key]);
}

/**
 * Get all active states (for debugging/monitoring)
 * @returns {Object} All active states with metadata
 */
function getAllStates() {
    const states = {};
    for (const userId in stateStore) {
        states[userId] = {
            state: stateStore[userId],
            lastActivity: stateActivity[userId] ? new Date(stateActivity[userId]).toISOString() : null,
            hasTimer: !!stateTimers[userId]
        };
    }
    return states;
}

/**
 * Get state statistics
 * @returns {Object} Statistics about active states
 */
function getStateStats() {
    return {
        activeStates: Object.keys(stateStore).length,
        activeTimers: Object.keys(stateTimers).length,
        oldestActivity: Math.min(...Object.values(stateActivity)) || null,
        newestActivity: Math.max(...Object.values(stateActivity)) || null
    };
}

module.exports = {
    getUserState,
    setUserState,
    updateUserState,
    deleteUserState,
    getScopedState,
    setScopedState,
    deleteScopedState,
    createScopedStateProxy,
    hasActiveState,
    clearAllStates,
    getAllStates,
    getStateStats,
    mess,
    format,
    STATE_TIMEOUT,
    registerStateTimeoutHandler,
    registerStateCancelHandler,
    runCancelHandler,
    // Aliases for compatibility
    setState: setUserState,
    updateState: updateUserState,
    clearState: deleteUserState,
    getState: getUserState
};
