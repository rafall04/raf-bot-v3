const { saveReports } = require('./database');
const { generateOTP } = require('./otp-generator');
const { generateTicketId } = require('./ticket-id');

const FINAL_STATUSES = new Set(['baru', 'process', 'otw', 'arrived', 'working', 'completed', 'cancelled']);
const LEGACY_STATUS_MAP = {
    selesai: 'completed',
    resolved: 'completed',
    'diproses teknisi': 'process'
};

const ALLOWED_TRANSITIONS = {
    baru: new Set(['process', 'cancelled']),
    process: new Set(['otw', 'arrived', 'working', 'completed', 'cancelled']),
    otw: new Set(['arrived', 'completed', 'cancelled']),
    arrived: new Set(['working', 'completed', 'cancelled']),
    working: new Set(['completed', 'cancelled']),
    completed: new Set([]),
    cancelled: new Set([])
};

function normalizeStatus(status) {
    if (!status) return 'baru';
    const normalized = String(status).trim().toLowerCase();
    if (FINAL_STATUSES.has(normalized)) {
        return normalized;
    }
    return LEGACY_STATUS_MAP[normalized] || normalized;
}

function ensureFinalStatus(status) {
    const normalized = normalizeStatus(status);
    if (!FINAL_STATUSES.has(normalized)) {
        return 'baru';
    }
    return normalized;
}

function normalizePrimaryPhone(phone) {
    if (!phone) return '';
    return String(phone).split('|').map((item) => item.trim()).filter(Boolean)[0] || '';
}

function toCustomerJid(phone) {
    const primaryPhone = normalizePrimaryPhone(phone).replace('@s.whatsapp.net', '');
    if (!primaryPhone) return '';
    return primaryPhone.includes('@') ? primaryPhone : `${primaryPhone}@s.whatsapp.net`;
}

function actorIdentifierCandidates(actor = {}) {
    return [
        actor.sender,
        actor.id,
        actor.username,
        actor.phoneJid,
        actor.phoneNumber
    ].filter(Boolean).map(String);
}

function matchesAssignedTechnician(ticket, actor) {
    const assigned = [
        ticket.teknisiId,
        ticket.processedByTeknisiId,
        ticket.processedByTeknisi
    ].filter(Boolean).map(String);

    if (!assigned.length) return true;

    const actorIds = actorIdentifierCandidates(actor);
    return assigned.some((value) => actorIds.includes(value));
}

function normalizePhotoEntry(photo, fallback = {}) {
    if (!photo) return null;

    const resolvePath = (value) => {
        if (!value) return '';
        if (String(value).startsWith('/')) return String(value);
        if (String(value).includes('/')) return String(value);
        return `/uploads/${value}`;
    };

    if (typeof photo === 'string') {
        return {
            fileName: photo,
            path: fallback.pathPrefix ? `${fallback.pathPrefix}/${photo}` : resolvePath(photo),
            uploadedAt: fallback.uploadedAt || new Date().toISOString(),
            uploadedBy: fallback.uploadedBy || 'unknown',
            category: fallback.category || null,
            categoryLabel: fallback.categoryLabel || null,
            source: fallback.source || 'legacy',
            order: fallback.order || 1
        };
    }

    const fileName = photo.fileName || photo.filename || photo.name || '';
    return {
        fileName,
        path: photo.path ? resolvePath(photo.path) : (fallback.pathPrefix && fileName ? `${fallback.pathPrefix}/${fileName}` : resolvePath(fileName)),
        uploadedAt: photo.uploadedAt || fallback.uploadedAt || new Date().toISOString(),
        uploadedBy: photo.uploadedBy || fallback.uploadedBy || 'unknown',
        category: photo.category || fallback.category || null,
        categoryLabel: photo.categoryLabel || fallback.categoryLabel || null,
        source: photo.source || fallback.source || 'legacy',
        order: photo.order || fallback.order || 1
    };
}

function normalizeCustomerPhotos(ticket) {
    const rawPhotos = Array.isArray(ticket.customerPhotos) ? ticket.customerPhotos : [];
    return rawPhotos
        .map((photo, index) => normalizePhotoEntry(photo, {
            uploadedBy: 'customer',
            source: 'customer',
            order: index + 1
        }))
        .filter(Boolean);
}

function normalizeTechnicianPhotos(ticket) {
    const teknisiPhotos = Array.isArray(ticket.teknisiPhotos) ? ticket.teknisiPhotos : [];
    const completionPhotos = Array.isArray(ticket.completionPhotos) ? ticket.completionPhotos : [];
    const legacyPhotos = Array.isArray(ticket.photos) ? ticket.photos : [];

    const merged = [...teknisiPhotos, ...completionPhotos, ...legacyPhotos]
        .map((photo, index) => normalizePhotoEntry(photo, {
            uploadedBy: ticket.teknisiName || ticket.processedByTeknisiName || 'teknisi',
            source: 'legacy',
            order: index + 1
        }))
        .filter((photo) => photo && photo.fileName);

    const unique = [];
    const seen = new Set();
    for (const photo of merged) {
        const key = `${photo.fileName}|${photo.path}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({
            ...photo,
            order: unique.length + 1
        });
    }
    return unique;
}

function ensureTicketShape(ticket) {
    const normalizedStatus = ensureFinalStatus(ticket.status);
    const customerPhotos = normalizeCustomerPhotos(ticket);
    const teknisiPhotos = normalizeTechnicianPhotos(ticket);

    ticket.ticketId = ticket.ticketId || ticket.id;
    ticket.user_id = ticket.user_id || ticket.pelangganUserId || ticket.pelangganDataSystem?.id || null;
    ticket.pelangganUserId = ticket.pelangganUserId || ticket.user_id || null;
    ticket.status = normalizedStatus;
    ticket.createdAt = ticket.createdAt || ticket.created_at || new Date().toISOString();
    ticket.processedAt = ticket.processedAt || ticket.processingStartedAt || null;
    ticket.completedAt = ticket.completedAt || ticket.resolvedAt || null;
    ticket.pelangganName = ticket.pelangganName || ticket.pelangganPushName || ticket.pelangganDataSystem?.name || 'Customer';
    ticket.pelangganPhone = ticket.pelangganPhone || ticket.pelangganDataSystem?.phone_number || '';
    ticket.pelangganId = ticket.pelangganId || toCustomerJid(ticket.pelangganPhone);
    ticket.teknisiId = ticket.teknisiId || ticket.processedByTeknisiId || ticket.processedByTeknisi || null;
    ticket.teknisiName = ticket.teknisiName || ticket.processedByTeknisiName || null;
    ticket.customerPhotos = customerPhotos;
    ticket.teknisiPhotos = teknisiPhotos;
    ticket.customerPhotoCount = customerPhotos.length;
    ticket.teknisiPhotoCount = teknisiPhotos.length;
    ticket.photoCount = customerPhotos.length + teknisiPhotos.length;
    ticket.resolutionNotes = ticket.resolutionNotes || null;
    ticket.photos = teknisiPhotos.map((photo) => ({
        fileName: photo.fileName,
        path: photo.path,
        uploadedAt: photo.uploadedAt,
        uploadedBy: photo.uploadedBy
    }));

    return ticket;
}

function normalizeAllTickets() {
    if (!Array.isArray(global.reports)) {
        global.reports = [];
    }
    global.reports = global.reports.map((ticket) => ensureTicketShape(ticket));
    return global.reports;
}

function persistReports() {
    normalizeAllTickets();
    saveReports();
}

function findTicketIndex(ticketId) {
    const normalizedId = String(ticketId || '').trim().toUpperCase();
    normalizeAllTickets();
    return global.reports.findIndex((ticket) => String(ticket.ticketId || ticket.id || '').trim().toUpperCase() === normalizedId);
}

function getTicketOrThrow(ticketId) {
    const ticketIndex = findTicketIndex(ticketId);
    if (ticketIndex === -1) {
        const error = new Error(`Ticket ${ticketId} tidak ditemukan`);
        error.code = 'NOT_FOUND';
        throw error;
    }
    return {
        ticketIndex,
        ticket: global.reports[ticketIndex]
    };
}

function assertTransition(ticket, nextStatus) {
    const currentStatus = ensureFinalStatus(ticket.status);
    const normalizedNext = ensureFinalStatus(nextStatus);
    if (currentStatus === normalizedNext) {
        return;
    }

    const allowed = ALLOWED_TRANSITIONS[currentStatus] || new Set();
    if (!allowed.has(normalizedNext)) {
        const error = new Error(`Invalid ticket transition ${currentStatus} -> ${normalizedNext}`);
        error.code = 'INVALID_TRANSITION';
        error.currentStatus = currentStatus;
        error.nextStatus = normalizedNext;
        throw error;
    }
}

function createBaseTicket({ user, laporanText, issueType, priority, createdBy, createdByRole, pelangganId, customerPhotos = [] }) {
    const ticketId = generateTicketId(7);
    const normalizedCustomerPhotos = customerPhotos
        .map((photo, index) => normalizePhotoEntry(photo, {
            uploadedBy: 'customer',
            source: 'customer',
            order: index + 1
        }))
        .filter(Boolean);

    const ticket = ensureTicketShape({
        ticketId,
        user_id: user.id,
        pelangganUserId: user.id,
        pelangganId: pelangganId || toCustomerJid(user.phone_number),
        pelangganName: user.name || user.username || 'Customer',
        pelangganPhone: user.phone_number || '',
        pelangganAddress: user.address || '',
        pelangganSubscription: user.subscription || 'Tidak terinfo',
        pelangganDataSystem: {
            id: user.id,
            name: user.name,
            address: user.address,
            subscription: user.subscription,
            pppoe_username: user.pppoe_username,
            phone_number: user.phone_number
        },
        laporanText,
        issueType: issueType || 'GENERAL',
        priority: priority || 'MEDIUM',
        status: 'baru',
        createdAt: new Date().toISOString(),
        createdBy: createdBy || 'system',
        createdByRole: createdByRole || 'system',
        customerPhotos: normalizedCustomerPhotos
    });

    global.reports.push(ticket);
    persistReports();
    return ticket;
}

function processTicket({ ticketId, actor }) {
    const { ticket } = getTicketOrThrow(ticketId);
    const normalizedStatus = ensureFinalStatus(ticket.status);

    if (['process', 'otw', 'arrived', 'working'].includes(normalizedStatus)) {
        const error = new Error(`Tiket sudah dalam proses atau sedang ditangani (Status: ${normalizedStatus})`);
        error.code = 'ALREADY_IN_PROGRESS';
        throw error;
    }
    if (normalizedStatus === 'completed') {
        const error = new Error('Tiket sudah selesai');
        error.code = 'ALREADY_COMPLETED';
        throw error;
    }

    assertTransition(ticket, 'process');

    const otp = generateOTP();
    ticket.status = 'process';
    ticket.teknisiId = actor.id || actor.sender || actor.username;
    ticket.processedByTeknisiId = ticket.teknisiId;
    ticket.processedByTeknisi = ticket.teknisiId;
    ticket.teknisiName = actor.name || actor.username || 'Teknisi';
    ticket.processedByTeknisiName = ticket.teknisiName;
    ticket.teknisiPhone = actor.phoneNumber || ticket.teknisiPhone || '';
    ticket.otp = otp;
    ticket.processedAt = new Date().toISOString();
    ticket.otpAttempts = 0;
    ticket.otpAttemptsResetAt = Date.now();

    ensureTicketShape(ticket);
    persistReports();
    return { ticket, otp };
}

function markTicketOtw({ ticketId, actor, location = null }) {
    const { ticket } = getTicketOrThrow(ticketId);
    if (!matchesAssignedTechnician(ticket, actor)) {
        const error = new Error('Anda bukan teknisi yang menangani tiket ini');
        error.code = 'FORBIDDEN';
        throw error;
    }

    const normalizedStatus = ensureFinalStatus(ticket.status);
    if (!['process'].includes(normalizedStatus)) {
        const error = new Error(`Status tiket tidak sesuai. Harus diproses dulu. Status saat ini: ${normalizedStatus}`);
        error.code = 'INVALID_STATUS';
        throw error;
    }

    assertTransition(ticket, 'otw');
    ticket.status = 'otw';
    ticket.otwAt = new Date().toISOString();
    if (location) {
        ticket.lastLocation = location;
    }
    ensureTicketShape(ticket);
    persistReports();
    return { ticket };
}

function markTicketArrived({ ticketId, actor }) {
    const { ticket } = getTicketOrThrow(ticketId);
    if (!matchesAssignedTechnician(ticket, actor)) {
        const error = new Error('Anda bukan teknisi yang menangani tiket ini');
        error.code = 'FORBIDDEN';
        throw error;
    }

    const normalizedStatus = ensureFinalStatus(ticket.status);
    if (!['otw', 'process'].includes(normalizedStatus)) {
        const error = new Error(`Status tiket tidak sesuai. Status saat ini: ${normalizedStatus}`);
        error.code = 'INVALID_STATUS';
        throw error;
    }

    ticket.status = 'arrived';
    ticket.arrivedAt = new Date().toISOString();
    if (!ticket.otp) {
        ticket.otp = generateOTP();
    }
    ensureTicketShape(ticket);
    persistReports();
    return { ticket };
}

function verifyTicketOtp({ ticketId, actor, otp }) {
    const { ticket } = getTicketOrThrow(ticketId);
    if (!matchesAssignedTechnician(ticket, actor)) {
        const error = new Error('Anda bukan teknisi yang menangani tiket ini');
        error.code = 'FORBIDDEN';
        throw error;
    }

    const normalizedStatus = ensureFinalStatus(ticket.status);
    if (normalizedStatus !== 'arrived') {
        const error = new Error(`Harus sampai di lokasi dulu. Status saat ini: ${normalizedStatus}`);
        error.code = 'INVALID_STATUS';
        throw error;
    }

    if (String(ticket.otp || '').trim() !== String(otp || '').trim()) {
        ticket.otpAttempts = (ticket.otpAttempts || 0) + 1;
        ticket.otpAttemptsResetAt = ticket.otpAttemptsResetAt || Date.now();
        persistReports();
        const error = new Error('Kode OTP salah! Minta kode yang benar ke pelanggan.');
        error.code = 'INVALID_OTP';
        throw error;
    }

    ticket.otpAttempts = 0;
    ticket.otpAttemptsResetAt = null;
    ticket.status = 'working';
    ticket.otpVerifiedAt = new Date().toISOString();
    ticket.workStartedAt = new Date().toISOString();
    ensureTicketShape(ticket);
    persistReports();
    return { ticket };
}

function appendTechnicianPhoto({ ticketId, actor, photo }) {
    const { ticket } = getTicketOrThrow(ticketId);
    if (!matchesAssignedTechnician(ticket, actor)) {
        const error = new Error('Anda bukan teknisi yang menangani tiket ini');
        error.code = 'FORBIDDEN';
        throw error;
    }

    const normalizedStatus = ensureFinalStatus(ticket.status);
    if (normalizedStatus !== 'working') {
        const error = new Error(`Harus verifikasi OTP dulu. Status saat ini: ${normalizedStatus}`);
        error.code = 'INVALID_STATUS';
        throw error;
    }

    const normalizedPhoto = normalizePhotoEntry(photo, {
        uploadedBy: actor.username || actor.name || 'teknisi',
        source: actor.channel === 'wa' ? 'wa_teknisi' : 'web_teknisi',
        order: (Array.isArray(ticket.teknisiPhotos) ? ticket.teknisiPhotos.length : 0) + 1
    });

    ticket.teknisiPhotos = normalizeTechnicianPhotos(ticket);
    ticket.teknisiPhotos.push({
        ...normalizedPhoto,
        source: normalizedPhoto.source || (actor.channel === 'wa' ? 'wa_teknisi' : 'web_teknisi'),
        order: ticket.teknisiPhotos.length + 1
    });
    ensureTicketShape(ticket);
    persistReports();
    return { ticket, photo: ticket.teknisiPhotos[ticket.teknisiPhotos.length - 1] };
}

function appendCustomerPhoto({ ticketId, actor, photo, maxPhotos = 3, allowedStatuses = ['baru', 'process'] }) {
    const { ticket } = getTicketOrThrow(ticketId);
    const normalizedStatus = ensureFinalStatus(ticket.status);
    if (!allowedStatuses.includes(normalizedStatus)) {
        const error = new Error(`Tidak bisa upload foto. Status tiket: ${normalizedStatus}`);
        error.code = 'INVALID_STATUS';
        throw error;
    }

    ticket.customerPhotos = normalizeCustomerPhotos(ticket);
    if (ticket.customerPhotos.length >= maxPhotos) {
        const error = new Error(`Maksimal ${maxPhotos} foto per laporan`);
        error.code = 'MAX_CUSTOMER_PHOTOS';
        throw error;
    }

    const normalizedPhoto = normalizePhotoEntry(photo, {
        uploadedBy: actor.username || actor.name || actor.id || 'customer',
        source: actor.source || 'customer',
        order: ticket.customerPhotos.length + 1
    });

    ticket.customerPhotos.push({
        ...normalizedPhoto,
        source: normalizedPhoto.source || actor.source || 'customer',
        order: ticket.customerPhotos.length + 1
    });
    ensureTicketShape(ticket);
    persistReports();
    return { ticket, photo: ticket.customerPhotos[ticket.customerPhotos.length - 1] };
}

function completeTicket({ ticketId, actor, resolutionNotes }) {
    const { ticket } = getTicketOrThrow(ticketId);
    if (!matchesAssignedTechnician(ticket, actor)) {
        const error = new Error('Anda bukan teknisi yang menangani tiket ini');
        error.code = 'FORBIDDEN';
        throw error;
    }

    const normalizedStatus = ensureFinalStatus(ticket.status);
    if (normalizedStatus !== 'working') {
        const error = new Error(`Tiket belum dalam status working. Status saat ini: ${normalizedStatus}`);
        error.code = 'INVALID_STATUS';
        throw error;
    }

    ticket.teknisiPhotos = normalizeTechnicianPhotos(ticket);
    if (ticket.teknisiPhotos.length < 2) {
        const error = new Error(`Minimal 2 foto diperlukan! Saat ini: ${ticket.teknisiPhotos.length} foto`);
        error.code = 'MIN_PHOTOS';
        throw error;
    }

    const completedAt = new Date();
    const workStartedAt = ticket.workStartedAt ? new Date(ticket.workStartedAt) : completedAt;
    const durationMinutes = Math.max(0, Math.floor((completedAt - workStartedAt) / 1000 / 60));

    ticket.status = 'completed';
    ticket.completedAt = completedAt.toISOString();
    ticket.completedBy = actor.sender || actor.username || actor.id || 'unknown';
    ticket.resolutionNotes = resolutionNotes || 'Selesai';
    ticket.workDuration = durationMinutes;
    ticket.resolvedAt = ticket.completedAt;
    ticket.resolvedBy = actor.username || actor.name || actor.id || 'unknown';

    ensureTicketShape(ticket);
    persistReports();
    return { ticket, durationMinutes };
}

function cancelTicket({ ticketId, actor = {}, reason, cancelledByType = 'system' }) {
    const { ticket } = getTicketOrThrow(ticketId);
    const normalizedStatus = ensureFinalStatus(ticket.status);

    if (normalizedStatus === 'completed') {
        const error = new Error('Tiket sudah selesai dan tidak bisa dibatalkan');
        error.code = 'ALREADY_COMPLETED';
        throw error;
    }

    if (normalizedStatus === 'cancelled') {
        const error = new Error('Tiket sudah dibatalkan');
        error.code = 'ALREADY_CANCELLED';
        throw error;
    }

    assertTransition(ticket, 'cancelled');

    const cancelledAt = new Date().toISOString();
    const actorId = actor.sender || actor.id || actor.username || 'unknown';
    const actorName = actor.name || actor.username || actor.sender || 'unknown';

    ticket.status = 'cancelled';
    ticket.cancelledAt = cancelledAt;
    ticket.cancelled_at = cancelledAt;
    ticket.cancellationReason = reason || 'Dibatalkan';
    ticket.cancellation_reason = ticket.cancellationReason;
    ticket.cancelledBy = {
        id: actorId,
        name: actorName,
        type: cancelledByType
    };
    ticket.cancelled_by = actorName;

    ensureTicketShape(ticket);
    persistReports();
    return { ticket };
}

function markWaitingCustomerConfirmation({ ticketId, actor, resolutionNotes, completionCode }) {
    const { ticket } = getTicketOrThrow(ticketId);
    if (!matchesAssignedTechnician(ticket, actor)) {
        const error = new Error('Anda bukan teknisi yang menangani tiket ini');
        error.code = 'FORBIDDEN';
        throw error;
    }
    const normalizedStatus = ensureFinalStatus(ticket.status);
    if (normalizedStatus !== 'working') {
        const error = new Error(`Tiket belum dalam status working. Status saat ini: ${normalizedStatus}`);
        error.code = 'INVALID_STATUS';
        throw error;
    }
    ticket.completionCode = completionCode;
    ticket.completionCodeCreatedAt = Date.now();
    ticket.resolutionNotes = resolutionNotes || ticket.resolutionNotes || 'Selesai';
    ticket.awaitingCustomerConfirmation = true;
    persistReports();
    return { ticket };
}

function finalizeCustomerConfirmation({ ticketId, completionCode, isFromCustomer = false }) {
    const { ticket } = getTicketOrThrow(ticketId);
    if (ticket.completionCode !== completionCode) {
        const error = new Error('Kode konfirmasi salah!');
        error.code = 'INVALID_CONFIRMATION_CODE';
        throw error;
    }
    const codeAge = Date.now() - ticket.completionCodeCreatedAt;
    if (codeAge > 2 * 60 * 60 * 1000) {
        const error = new Error('Kode konfirmasi sudah expired.');
        error.code = 'CONFIRMATION_CODE_EXPIRED';
        throw error;
    }
    ticket.status = 'completed';
    ticket.customerConfirmedAt = new Date().toISOString();
    ticket.confirmedByCustomer = isFromCustomer;
    ticket.awaitingCustomerConfirmation = false;
    const startTime = new Date(ticket.processingStartedAt || ticket.processedAt || ticket.createdAt);
    const endTime = new Date(ticket.customerConfirmedAt);
    ticket.resolutionDurationMinutes = Math.round((endTime - startTime) / (1000 * 60));
    persistReports();
    return { ticket, durationMinutes: ticket.resolutionDurationMinutes };
}

module.exports = {
    normalizeStatus,
    ensureTicketShape,
    normalizeAllTickets,
    toCustomerJid,
    createBaseTicket,
    processTicket,
    markTicketOtw,
    markTicketArrived,
    verifyTicketOtp,
    appendTechnicianPhoto,
    appendCustomerPhoto,
    completeTicket,
    cancelTicket,
    markWaitingCustomerConfirmation,
    finalizeCustomerConfirmation,
    findTicketIndex
};
