const fs = require('fs');
const path = require('path');

const voucherSentDbPath = path.join(__dirname, '../database/voucher_sent.json');

function loadVoucherSentHistory() {
    try {
        if (fs.existsSync(voucherSentDbPath)) {
            return JSON.parse(fs.readFileSync(voucherSentDbPath, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('[VOUCHER_DELIVERY] Error loading history:', error);
        return [];
    }
}

function saveVoucherSentHistory(data) {
    fs.writeFileSync(voucherSentDbPath, JSON.stringify(data, null, 2));
}

function appendVoucherSentHistory(entries) {
    const history = loadVoucherSentHistory();
    history.push(...entries);
    saveVoucherSentHistory(history);
    return history;
}

function resolveVoucherDeliveryStatus({ sendWhatsApp, requestedPhones, sentTo }) {
    if (!sendWhatsApp || requestedPhones.length === 0) {
        return 'generated';
    }

    if (sentTo.length === requestedPhones.length) {
        return 'sent';
    }

    if (sentTo.length > 0) {
        return 'partial_sent';
    }

    return 'failed';
}

function buildVoucherSentHistoryEntries({
    batchId,
    vouchers,
    profile,
    profileName,
    duration,
    notes,
    requestedPhones,
    sentTo,
    failedTo,
    createdBy,
    sentStatus,
    metadata = {}
}) {
    const timestamp = new Date().toISOString();

    return vouchers.map((voucher, index) => ({
        id: `VS${Date.now()}${index}`,
        batch_id: batchId,
        type: voucher.type || 'random',
        profile,
        profile_name: profileName,
        duration,
        username: voucher.username,
        password: voucher.password,
        phone: requestedPhones.length > 0 ? requestedPhones.join(', ') : null,
        notes,
        sent_status: sentStatus,
        total_requested: requestedPhones.length,
        total_sent: sentTo.length,
        sent_to: [...sentTo],
        failed_to: [...failedTo],
        transaction_context: metadata.transaction_context || 'direct_customer_sale',
        recipient_type: metadata.recipient_type || 'end_user',
        voucher_source: metadata.voucher_source || 'generated',
        price_snapshot: metadata.price_snapshot ?? null,
        price_type: metadata.price_type || null,
        voucher_profile_snapshot: metadata.voucher_profile_snapshot || null,
        agent_id: metadata.agent_id || null,
        customer_id: metadata.customer_id || null,
        financial_effect: metadata.financial_effect || 'none',
        reference_id: metadata.reference_id || null,
        created_at: timestamp,
        created_by: createdBy
    }));
}

function getVoucherSentStats(history) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCount = history.filter((item) => {
        const itemDate = new Date(item.created_at);
        itemDate.setHours(0, 0, 0, 0);
        return itemDate.getTime() === today.getTime();
    }).length;

    const breakdown = history.reduce((accumulator, item) => {
        const key = item.sent_status || 'generated';
        accumulator[key] = (accumulator[key] || 0) + 1;
        return accumulator;
    }, {});

    return {
        today: todayCount,
        total: history.length,
        sent: breakdown.sent || 0,
        partial_sent: breakdown.partial_sent || 0,
        generated: breakdown.generated || 0,
        failed: breakdown.failed || 0
    };
}

function findVoucherHistoryByReference(history, referenceId) {
    if (!referenceId) {
        return [];
    }

    return history.filter((item) => item.id === referenceId || item.batch_id === referenceId);
}

module.exports = {
    loadVoucherSentHistory,
    saveVoucherSentHistory,
    appendVoucherSentHistory,
    resolveVoucherDeliveryStatus,
    buildVoucherSentHistoryEntries,
    getVoucherSentStats,
    findVoucherHistoryByReference
};
