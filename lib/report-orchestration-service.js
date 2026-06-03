const { createBaseTicket, appendCustomerPhoto, ensureTicketShape } = require('./ticket-workflow');
const { notifyNewReport } = require('./report-notification-service');

function toCustomerPhoto(photo, index = 0, uploadedBy = 'customer') {
    if (!photo) return null;
    if (typeof photo === 'string') {
        return {
            fileName: photo,
            path: photo,
            uploadedAt: new Date().toISOString(),
            uploadedBy,
            source: 'customer',
            order: index + 1
        };
    }
    return {
        fileName: photo.fileName || photo.filename || photo.name || '',
        path: photo.path || photo.fileName || photo.filename || photo.name || '',
        uploadedAt: photo.uploadedAt || new Date().toISOString(),
        size: photo.size,
        uploadedBy: photo.uploadedBy || uploadedBy,
        source: 'customer',
        order: index + 1
    };
}

async function createCustomerReportTicket({
    user,
    sender,
    laporanText,
    issueType,
    priority,
    createdBy,
    createdByRole,
    customerPhotos = [],
    photoBuffers = [],
    notifyAdmins = true,
    additionalFields = {}
}) {
    const normalizedPhotos = customerPhotos.map((photo, index) => toCustomerPhoto(photo, index, sender)).filter(Boolean);
    const ticket = createBaseTicket({
        user,
        pelangganId: sender,
        laporanText,
        issueType,
        priority,
        createdBy: createdBy || sender,
        createdByRole: createdByRole || 'customer_wa',
        customerPhotos: normalizedPhotos
    });

    Object.assign(ticket, additionalFields || {});
    ensureTicketShape(ticket);
    await notifyNewReport(ticket, { photoBuffers, notifyAdmins });
    return ticket;
}

async function appendCustomerReportPhoto({ ticketId, actor, photo, maxPhotos = 3, allowedStatuses }) {
    return appendCustomerPhoto({
        ticketId,
        actor,
        photo: toCustomerPhoto(photo, 0, actor.username || actor.name || actor.id || 'customer'),
        maxPhotos,
        allowedStatuses
    });
}

module.exports = {
    createCustomerReportTicket,
    appendCustomerReportPhoto,
    toCustomerPhoto
};
