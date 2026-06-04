const fs = require('fs').promises;
const path = require('path');

const WIFI_LOGS_FILE = path.join(__dirname, '../database/wifi_change_logs.json');
const WIFI_CHANGE_TYPES = new Set(['ssid_name', 'password', 'both', 'transmit_power']);
const WIFI_CHANGE_SOURCES = new Set(['web_admin', 'web_technician', 'wa_bot', 'api']);

function normalizeWhitespace(value) {
    return typeof value === 'string' ? value.trim() : value;
}

function pickCustomerPhone(customer = {}) {
    const candidates = [
        customer.phone_number,
        customer.phone,
        customer.canonicalJid,
        customer.whatsapp,
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        const normalized = String(candidate)
            .split(/[|,]/)[0]
            .trim()
            .replace('@s.whatsapp.net', '')
            .replace('@lid', '');
        if (normalized) {
            return normalized;
        }
    }

    return 'N/A';
}

function resolveWebWifiChangeSource(role) {
    return role === 'teknisi' ? 'web_technician' : 'web_admin';
}

function normalizeWifiChangeType(changeType) {
    if (changeType === 'name' || changeType === 'ssid') return 'ssid_name';
    if (WIFI_CHANGE_TYPES.has(changeType)) return changeType;
    return 'unknown';
}

function normalizeWifiChangeSource(changeSource, changedByRole = null) {
    if (!changeSource && changedByRole) {
        return resolveWebWifiChangeSource(changedByRole);
    }
    if (changeSource === 'web_teknisi') return 'web_technician';
    if (WIFI_CHANGE_SOURCES.has(changeSource)) return changeSource;
    return changedByRole ? resolveWebWifiChangeSource(changedByRole) : 'api';
}

function buildSsidChangeEntries(payload = {}, currentWifiInfo = {}) {
    const entries = [];
    const currentSsids = Array.isArray(currentWifiInfo?.ssid) ? currentWifiInfo.ssid : [];

    if (normalizeWhitespace(payload.ssid_name)) {
        const oldValue = normalizeWhitespace(currentWifiInfo?.ssid_name || '');
        const newValue = normalizeWhitespace(payload.ssid_name);
        if (oldValue !== newValue) {
            entries.push({
                ssidId: currentWifiInfo?.ssid_id || '1',
                oldValue: oldValue || '(belum ada)',
                newValue
            });
        }
    }

    Object.keys(payload)
        .filter((key) => key.startsWith('ssid_') && !key.includes('password'))
        .forEach((fieldName) => {
            const ssidId = fieldName.replace('ssid_', '');
            const newValue = normalizeWhitespace(payload[fieldName]);
            if (!newValue || isNaN(parseInt(ssidId, 10))) {
                return;
            }
            const currentSsid = currentSsids.find((entry) => String(entry.id) === String(ssidId));
            const oldValue = normalizeWhitespace(currentSsid?.name || '');
            if (oldValue === newValue) {
                return;
            }
            entries.push({
                ssidId,
                oldValue: oldValue || '(belum ada)',
                newValue
            });
        });

    return entries;
}

function buildPasswordChangeEntries(payload = {}) {
    const entries = [];

    if (normalizeWhitespace(payload.password)) {
        entries.push({
            ssidId: '1',
            newValue: normalizeWhitespace(payload.password)
        });
    }

    Object.keys(payload)
        .filter((key) => key.startsWith('ssid_password_'))
        .forEach((fieldName) => {
            const newValue = normalizeWhitespace(payload[fieldName]);
            if (!newValue) {
                return;
            }
            entries.push({
                ssidId: fieldName.replace('ssid_password_', ''),
                newValue
            });
        });

    return entries;
}

function buildTransmitPowerChange(payload = {}, currentWifiInfo = {}) {
    const newValue = normalizeWhitespace(payload.transmit_power);
    if (!newValue) {
        return null;
    }

    const oldValue = normalizeWhitespace(currentWifiInfo?.transmit_power || 'N/A');
    if (oldValue === newValue) {
        return null;
    }

    return {
        oldTransmitPower: oldValue,
        newTransmitPower: newValue
    };
}

function summarizeSsidChanges(entries = []) {
    if (!entries.length) return {};
    if (entries.length === 1) {
        return {
            oldSsidName: entries[0].oldValue,
            newSsidName: entries[0].newValue
        };
    }

    return {
        oldSsidName: 'Multiple SSIDs',
        newSsidName: entries.map((entry) => `SSID ${entry.ssidId}: "${entry.oldValue}" → "${entry.newValue}"`).join('; ')
    };
}

function summarizePasswordChanges(entries = []) {
    if (!entries.length) return {};

    return {
        oldPassword: 'ada',
        newPassword: entries.length === 1 ? entries[0].newValue : entries.map((entry) => entry.newValue).join(', '),
        detailPassword: entries.map((entry) => `SSID ${entry.ssidId} password: "${entry.newValue}"`).join('; '),
        passwordChanged: true
    };
}

const WIFI_ACTOR_ROLES = new Set(['customer', 'teknisi', 'admin', 'owner', 'system']);

function normalizeActorRole(actorRole) {
    if (typeof actorRole !== 'string') return null;
    const lower = actorRole.toLowerCase().trim();
    return WIFI_ACTOR_ROLES.has(lower) ? lower : null;
}

function normalizeLogData(logData = {}) {
    const normalizedChangeType = normalizeWifiChangeType(logData.changeType);
    const normalizedChangeSource = normalizeWifiChangeSource(logData.changeSource, logData.changedByRole);
    const normalizedChanges = { ...(logData.changes || {}) };

    if ((normalizedChangeType === 'password' || normalizedChangeType === 'both') && normalizedChanges) {
        normalizedChanges.passwordChanged = true;
    }

    return {
        ...logData,
        changeType: normalizedChangeType,
        changeSource: normalizedChangeSource,
        customerPhone: logData.customerPhone || 'N/A',
        changes: normalizedChanges,
        actorRole: normalizeActorRole(logData.actorRole),
        actorIdentifier: logData.actorIdentifier || null,
        actorPhone: logData.actorPhone || null
    };
}

function buildWebWifiLogPayload({
    customer,
    deviceId,
    payload,
    currentWifiInfo,
    staffUser,
    req,
    fallbackReason = ''
}) {
    const ssidEntries = buildSsidChangeEntries(payload, currentWifiInfo);
    const passwordEntries = buildPasswordChangeEntries(payload);
    const transmitPowerChange = buildTransmitPowerChange(payload, currentWifiInfo);

    let changeType = 'unknown';
    let changes = {};

    if (ssidEntries.length && passwordEntries.length) {
        changeType = 'both';
        changes = {
            ...summarizeSsidChanges(ssidEntries),
            ...summarizePasswordChanges(passwordEntries),
            ssidEntries,
            passwordEntries
        };
    } else if (ssidEntries.length) {
        changeType = 'ssid_name';
        changes = {
            ...summarizeSsidChanges(ssidEntries),
            ssidEntries
        };
    } else if (passwordEntries.length) {
        changeType = 'password';
        changes = {
            ...summarizePasswordChanges(passwordEntries),
            passwordEntries
        };
    } else if (transmitPowerChange) {
        changeType = 'transmit_power';
        changes = transmitPowerChange;
    }

    if (changeType === 'unknown') {
        return {
            shouldLog: false,
            skipReason: 'no_effective_change',
            metadata: {
                deviceId,
                customerId: customer?.id || 'unknown',
                staffRole: staffUser?.role || 'unknown',
                resolvedChangeSource: normalizeWifiChangeSource(null, staffUser?.role),
                changeType
            }
        };
    }

    const resolvedSource = normalizeWifiChangeSource(null, staffUser?.role);
    const normalizedCustomer = customer || {};

    // Attribution untuk audit trail web (admin/teknisi).
    // actorRole: dipetakan dari staffUser.role; actorIdentifier: username staff.
    // actorPhone: null karena aksi via web (bukan WA).
    const staffRoleRaw = (staffUser?.role || '').toLowerCase();
    const actorRole = WIFI_ACTOR_ROLES.has(staffRoleRaw) ? staffRoleRaw : (staffRoleRaw === 'superadmin' ? 'admin' : null);
    const actorIdentifier = staffUser?.username || null;

    return {
        shouldLog: true,
        changeType,
        changes,
        logData: {
            userId: normalizedCustomer.id || 'unknown',
            deviceId,
            customerName: normalizedCustomer.name || 'Unknown Customer',
            customerPhone: pickCustomerPhone(normalizedCustomer),
            changeType,
            changes,
            changedBy: staffUser?.username || 'unknown',
            changeSource: resolvedSource,
            actorRole,
            actorIdentifier,
            actorPhone: null,
            reason: payload.reason || 'Tidak ada keterangan',
            notes: fallbackReason || '',
            ipAddress: req?.ip || 'N/A',
            userAgent: req?.get ? (req.get('User-Agent') || 'N/A') : 'N/A'
        },
        metadata: {
            deviceId,
            customerId: normalizedCustomer.id || 'unknown',
            staffRole: staffUser?.role || 'unknown',
            resolvedChangeSource: resolvedSource,
            changeType
        }
    };
}

async function logWifiChange(logData) {
    try {
        const normalizedLogData = normalizeLogData(logData);
        const requiredFields = ['userId', 'deviceId', 'changeType', 'changes', 'changedBy', 'changeSource', 'customerName'];
        for (const field of requiredFields) {
            if (!normalizedLogData[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        if (!WIFI_CHANGE_TYPES.has(normalizedLogData.changeType)) {
            throw new Error(`Unsupported changeType: ${normalizedLogData.changeType}`);
        }
        if (!WIFI_CHANGE_SOURCES.has(normalizedLogData.changeSource)) {
            throw new Error(`Unsupported changeSource: ${normalizedLogData.changeSource}`);
        }

        const logEntry = {
            id: generateLogId(),
            timestamp: new Date().toISOString(),
            userId: normalizedLogData.userId,
            deviceId: normalizedLogData.deviceId,
            customerName: normalizedLogData.customerName,
            customerPhone: normalizedLogData.customerPhone || 'N/A',
            changeType: normalizedLogData.changeType,
            changes: normalizedLogData.changes,
            changedBy: normalizedLogData.changedBy,
            changeSource: normalizedLogData.changeSource,
            // Attribution detail — additive fields (entry lama tidak punya, UI fallback ke changedBy).
            // actorRole: 'customer' | 'teknisi' | 'admin' | 'owner' | 'system'
            // actorIdentifier: username staff / 'customer' / JID
            // actorPhone: nomor WA pelaku (sender), boleh beda dari customerPhone kalau staff triggered
            actorRole: normalizedLogData.actorRole || null,
            actorIdentifier: normalizedLogData.actorIdentifier || null,
            actorPhone: normalizedLogData.actorPhone || null,
            reason: normalizedLogData.reason || 'Tidak disebutkan',
            notes: normalizedLogData.notes || '',
            ipAddress: normalizedLogData.ipAddress || 'N/A',
            userAgent: normalizedLogData.userAgent || 'N/A'
        };

        let logs = [];
        try {
            const data = await fs.readFile(WIFI_LOGS_FILE, 'utf8');
            logs = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn('[WiFi Logger] Error reading existing logs:', error.message);
            }
            logs = [];
        }

        logs.push(logEntry);
        if (logs.length > 1000) {
            logs = logs.slice(-1000);
        }

        await fs.writeFile(WIFI_LOGS_FILE, JSON.stringify(logs, null, 2));

        console.log(`[WiFi Logger] Logged WiFi change for user ${normalizedLogData.userId}, device ${normalizedLogData.deviceId}, type: ${normalizedLogData.changeType}`);
        return logEntry;
    } catch (error) {
        console.error('[WiFi Logger] Error logging WiFi change:', error);
        throw error;
    }
}

async function getWifiChangeLogs(filters = {}) {
    try {
        let logs = [];
        try {
            const data = await fs.readFile(WIFI_LOGS_FILE, 'utf8');
            logs = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.warn('[WiFi Logger] Error reading logs:', error.message);
            }
            return { logs: [], total: 0 };
        }

        let filteredLogs = logs;

        if (filters.userId) {
            filteredLogs = filteredLogs.filter((log) => String(log.userId) === String(filters.userId));
        }
        if (filters.deviceId) {
            filteredLogs = filteredLogs.filter((log) => log.deviceId === filters.deviceId);
        }
        if (filters.changeType) {
            filteredLogs = filteredLogs.filter((log) => log.changeType === filters.changeType);
        }
        if (filters.changedBy) {
            filteredLogs = filteredLogs.filter((log) => String(log.changedBy || '').toLowerCase().includes(filters.changedBy.toLowerCase()));
        }
        if (filters.changeSource) {
            filteredLogs = filteredLogs.filter((log) => log.changeSource === filters.changeSource);
        }
        if (filters.dateFrom) {
            const fromDate = new Date(filters.dateFrom);
            filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) >= fromDate);
        }
        if (filters.dateTo) {
            const toDate = new Date(filters.dateTo);
            filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) <= toDate);
        }

        filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const total = filteredLogs.length;
        const limit = filters.limit || 100;
        const offset = filters.offset || 0;
        const paginatedLogs = filteredLogs.slice(offset, offset + limit);

        return {
            logs: paginatedLogs,
            total,
            limit,
            offset
        };
    } catch (error) {
        console.error('[WiFi Logger] Error getting WiFi logs:', error);
        throw error;
    }
}

async function getWifiChangeStats() {
    try {
        const { logs } = await getWifiChangeLogs();

        const stats = {
            totalChanges: logs.length,
            changesByType: {},
            changesBySource: {},
            changesByUser: {},
            recentChanges: logs.slice(0, 10),
            changesLast24h: 0,
            changesLast7d: 0,
            changesLast30d: 0
        };

        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        logs.forEach((log) => {
            const logDate = new Date(log.timestamp);
            stats.changesByType[log.changeType] = (stats.changesByType[log.changeType] || 0) + 1;
            stats.changesBySource[log.changeSource] = (stats.changesBySource[log.changeSource] || 0) + 1;
            stats.changesByUser[log.changedBy] = (stats.changesByUser[log.changedBy] || 0) + 1;
            if (logDate >= oneDayAgo) stats.changesLast24h++;
            if (logDate >= sevenDaysAgo) stats.changesLast7d++;
            if (logDate >= thirtyDaysAgo) stats.changesLast30d++;
        });

        return stats;
    } catch (error) {
        console.error('[WiFi Logger] Error getting WiFi stats:', error);
        throw error;
    }
}

function generateLogId() {
    return `wifi_log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function formatChangeDescription(log) {
    const { changeType, changes = {} } = log;

    switch (changeType) {
        case 'ssid_name':
            return changes.ssidEntries?.length
                ? changes.ssidEntries.map((entry) => `SSID ${entry.ssidId}: "${entry.oldValue}" → "${entry.newValue}"`).join(' | ')
                : `SSID: ${changes.newSsidName}`;
        case 'password':
            return changes.detailPassword || `Password: ${changes.newPassword}`;
        case 'both': {
            const ssidSummary = changes.ssidEntries?.length
                ? changes.ssidEntries.map((entry) => `SSID ${entry.ssidId}: "${entry.oldValue}" → "${entry.newValue}"`).join(' | ')
                : `SSID: ${changes.newSsidName}`;
            return `${ssidSummary} | ${changes.detailPassword || `Password: ${changes.newPassword}`}`;
        }
        case 'transmit_power':
            return `Transmit power: ${changes.oldTransmitPower || 'N/A'} → ${changes.newTransmitPower}`;
        default:
            return `Perubahan WiFi: ${changeType}`;
    }
}

function getChangeSourceDisplay(source) {
    const sourceMap = {
        web_admin: 'Web Admin',
        web_technician: 'Web Teknisi',
        wa_bot: 'WhatsApp Bot',
        api: 'API'
    };
    return sourceMap[source] || source;
}

module.exports = {
    logWifiChange,
    getWifiChangeLogs,
    getWifiChangeStats,
    formatChangeDescription,
    getChangeSourceDisplay,
    pickCustomerPhone,
    resolveWebWifiChangeSource,
    buildWebWifiLogPayload,
    normalizeLogData
};
