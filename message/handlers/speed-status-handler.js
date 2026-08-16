/**
 * Header Doc
 * Purpose: Menyusun dan mengirim ringkasan status Speed Boost pelanggan atau target admin via WhatsApp.
 * Caller: Flow bot Speed Boost dan command admin terkait.
 * Deps: `rupiah-format`, `../../lib/template-service`, dan `../../lib/whatsapp-delivery-service`.
 * MainFuncs: `checkSpeedBoostStatus`.
 * SideEffects: Membaca `global.speed_requests`/`global.users` dan mengirim pesan WhatsApp.
 */

const convertRupiah = require('rupiah-format');
const { sendMessage } = require('../../lib/whatsapp-delivery-service');
const { renderCategoryTemplate } = require('../../lib/template-service');

function renderResponseTemplate(key, data = {}) {
    const result = renderCategoryTemplate('responseTemplates', key, data);
    return result.found && result.text.trim() ? result.text : key;
}


async function deliverText(recipient, text, options = {}) {
    return sendMessage(recipient, { text }, options);
}

function buildAdminUserInfo(checkUser) {
    return renderResponseTemplate('speed_status_admin_user_info', {
        customerName: checkUser.name,
        customerPhone: checkUser.phone_number,
        userId: checkUser.id
    });
}

function buildActiveSection(activeRequest) {
    if (!activeRequest) return '';

    let expirationSection = '';
    if (activeRequest.expirationDate) {
        const expDate = new Date(activeRequest.expirationDate);
        const now = new Date();
        const hoursLeft = Math.max(0, (expDate - now) / (1000 * 60 * 60));
        expirationSection = renderResponseTemplate('speed_status_active_expiration_section', {
            endsAt: formatDate(activeRequest.expirationDate),
            hoursLeft: hoursLeft.toFixed(1),
            expiredWarning: hoursLeft <= 0 ? renderResponseTemplate('speed_status_active_expired_warning') : ''
        });
    } else {
        expirationSection = renderResponseTemplate('speed_status_active_no_expiration_section');
    }

    // Slot `profile` SENGAJA tidak dioper: isinya nama profil MikroTik, bukan kecepatan yang
    // dibeli pelanggan. Handler ini tak bergerbang matrix Speed on Demand — yang menahan
    // selama ini cuma belum adanya request berstatus aktif. Nama paket + durasi sudah cukup.
    return renderResponseTemplate('speed_status_active_section', {
        requestId: activeRequest.id,
        packageName: activeRequest.requestedPackageName,
        duration: activeRequest.durationLabel,
        price: convertRupiah.convert(activeRequest.price),
        startedAt: formatDate(activeRequest.activatedAt || activeRequest.createdAt),
        expirationSection
    });
}

function buildPendingSection(pendingRequest) {
    if (!pendingRequest) return '';

    const createdDate = new Date(pendingRequest.createdAt);
    const daysSinceCreated = (new Date() - createdDate) / (1000 * 60 * 60 * 24);
    const waitingText = daysSinceCreated > 5
        ? renderResponseTemplate('speed_status_waiting_auto_cancel', {
            daysLeft: (7 - daysSinceCreated).toFixed(1)
        })
        : renderResponseTemplate(
            pendingRequest.paymentMethod === 'transfer'
                ? 'speed_status_waiting_transfer'
                : 'speed_status_waiting_admin_approval'
        );

    return renderResponseTemplate('speed_status_pending_section', {
        requestId: pendingRequest.id,
        packageName: pendingRequest.requestedPackageName,
        duration: pendingRequest.durationLabel,
        price: convertRupiah.convert(pendingRequest.price),
        paymentMethod: getPaymentMethodLabel(pendingRequest.paymentMethod),
        paymentStatus: getPaymentStatusLabel(pendingRequest.paymentStatus),
        createdAt: formatDate(pendingRequest.createdAt),
        waitingSection: renderResponseTemplate('speed_status_pending_waiting_section', { waitingText })
    });
}

function buildHistorySection(userRequests) {
    const historyItems = userRequests.slice(0, 3).map((req, index) => renderResponseTemplate('speed_status_history_item', {
        index: index + 1,
        statusIcon: getStatusEmoji(req.status),
        statusLabel: String(req.status || '').toUpperCase(),
        packageName: req.requestedPackageName,
        duration: req.durationLabel || '-',
        createdAt: formatDate(req.createdAt)
    })).join('\n\n');

    return renderResponseTemplate('speed_status_history_section', { historyItems });
}

function buildAdminCommands(checkUserId) {
    return renderResponseTemplate('speed_status_admin_commands', { userId: checkUserId });
}

/**
 * Check speed boost status for user
 */
async function checkSpeedBoostStatus(msg, user, sender, isAdmin = false, targetUserId = null) {
    try {
        // Determine which user to check
        const checkUserId = targetUserId || user.id;
        const checkUser = targetUserId ? 
            global.users?.find(u => u.id == targetUserId) : 
            user;
        
        if (!checkUser) {
            await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_status_user_not_found'));
            return;
        }
        
        // Get all speed requests for this user
        const userRequests = global.speed_requests?.filter(req => 
            req.userId == checkUserId
        ) || [];
        
        if (userRequests.length === 0) {
            await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_status_no_history', {
                subject: isAdmin ? `User ${checkUser.name}` : 'Anda'
            }));
            return;
        }
        
        // Sort by date (newest first)
        userRequests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Find active/pending requests
        const activeRequest = userRequests.find(r => r.status === 'active');
        const pendingRequest = userRequests.find(r => r.status === 'pending');

        const statusMsg = renderResponseTemplate('speed_status_summary', {
            adminUserInfo: isAdmin ? buildAdminUserInfo(checkUser) : '',
            activeSection: buildActiveSection(activeRequest),
            pendingSection: buildPendingSection(pendingRequest),
            emptyActivePendingSection: !activeRequest && !pendingRequest
                ? renderResponseTemplate('speed_status_no_active_pending')
                : '',
            historySection: buildHistorySection(userRequests),
            adminCommands: isAdmin ? buildAdminCommands(checkUserId) : ''
        });
        
        await deliverText(msg.key.remoteJid, statusMsg);
        
    } catch (error) {
        console.error('[CHECK_SPEED_STATUS_ERROR]', error);
        await deliverText(msg.key.remoteJid, renderResponseTemplate('speed_status_check_error'));
    }
}

/**
 * Format date to readable string
 */
function formatDate(dateStr) {
    if (!dateStr) return '-';
    
    const date = new Date(dateStr);
    const options = {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
    };
    
    return date.toLocaleString('id-ID', options);
}

/**
 * Get payment method label
 */
function getPaymentMethodLabel(method) {
    const key = `speed_status_payment_method_${method}`;
    const rendered = renderResponseTemplate(key);
    return rendered === key ? method : rendered;
}

/**
 * Get payment status label
 */
function getPaymentStatusLabel(status) {
    const key = `speed_status_payment_${status}`;
    const rendered = renderResponseTemplate(key);
    return rendered === key ? status : rendered;
}

/**
 * Get status emoji
 */
function getStatusEmoji(status) {
    const key = `speed_status_icon_${status}`;
    const rendered = renderResponseTemplate(key);
    return rendered === key ? '-' : rendered;
}

module.exports = {
    checkSpeedBoostStatus
};
