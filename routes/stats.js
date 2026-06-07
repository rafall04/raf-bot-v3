/**
 * Header Doc
 * Purpose: Menyajikan endpoint status bot, statistik operasional, dan diagnostik integrasi untuk dashboard admin.
 * Caller: Panel admin/web monitoring dan health endpoint internal.
 * Deps: Express router, helper jaringan/diagnostik, `../lib/whatsapp-gateway`, dan `../lib/whatsapp-bootstrap`.
 * MainFuncs: Endpoint status bot (`start`, `stop`, `sync-status`, `bot-status`, `stats`) dan diagnostik jaringan.
 * SideEffects: Dapat memicu start/reconnect bot dan menutup socket aktif lewat gateway runtime.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const { getSSIDInfo: _getSSIDInfo, rebootRouter } = require('../lib/wifi');
const { getGenieAcsDiagnostics, getWifiInfo } = require('../lib/genieacs');
const { getPppStats, getHotspotStats, getMikrotikDiagnostics } = require('../lib/mikrotik');
const { getStatusSnapshot, canReconnect, closeActiveSocket } = require('../lib/whatsapp-gateway');
const { triggerWhatsAppReconnect } = require('../lib/whatsapp-bootstrap');

const router = express.Router();
const execPromise = util.promisify(exec);

// Debug flag for verbose logging
const DEBUG = process.env.STATS_DEBUG === 'true' || false;

// OPTIMASI: Perpanjang cache time untuk mengurangi API calls
const statusCache = {
    genieacs: null,
    mikrotik: null,
    ppp: null,
    hotspot: null,
    cacheTime: 0,
    TTL: 60000 // 60 detik (diperpanjang dari 30 detik)
};

function withTimeout(promise, timeoutMs, defaultValue = null) {
    return Promise.race([
        promise,
        new Promise((resolve) => {
            setTimeout(() => resolve(defaultValue), timeoutMs);
        })
    ]);
}

function execPHPWithTimeout(scriptPath, timeoutMs = 2000) {
    return withTimeout(
        execPromise(`php "${scriptPath}"`, { maxBuffer: 1024 * 1024 }),
        timeoutMs,
        { error: true, connected: false, message: 'Timeout', timeout: true }
    ).then(({ stdout, stderr }) => {
        if (stderr && !stdout) {
            throw new Error(stderr);
        }
        try {
            const parsed = JSON.parse(stdout || '{}');
            if (parsed.connected === undefined) {
                parsed.connected = false;
            }
            return parsed;
        } catch (_e) {
            return { error: true, connected: false, message: 'Invalid JSON response', raw: stdout };
        }
    }).catch(e => {
        return { error: true, connected: false, message: e.message || 'Execution failed' };
    });
}

function ensureAuthenticated(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ status: 401, message: "Unauthorized" });
    }
    next();
}

router.get('/me', ensureAuthenticated, (req, res) => {
    if (req.user && req.user.username) {
        // Cari account dari global.accounts untuk mendapatkan field 'name'
        let account = null;
        if (global.accounts && Array.isArray(global.accounts)) {
            account = global.accounts.find(acc => String(acc.id) === String(req.user.id));
        }
        
        res.json({
            status: 200,
            message: "User details fetched successfully.",
            data: {
                id: req.user.id,
                username: req.user.username,
                name: account && account.name ? account.name : (req.user.name || req.user.username),
                role: req.user.role
            }
        });
    } else {
        res.status(401).json({ status: 401, message: "Not authenticated or user details not found." });
    }
});

router.get('/stats/config', async (req, res) => {
    try {
        let mainConfig = global.config || {};
        let cronConfig = global.cronConfig || {};
        
        try {
            // Try to read from file to get latest config
            const mainConfigPath = path.join(__dirname, '..', 'config.json');
            if (fs.existsSync(mainConfigPath)) {
                mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
            }
        } catch (err) {
            console.warn('[STATS_CONFIG] Failed to read config.json, using global.config:', err.message);
        }
        
        try {
            // Try to read from file to get latest cron config
            const cronConfigPath = path.join(__dirname, '..', 'database', 'cron.json');
            if (fs.existsSync(cronConfigPath)) {
                cronConfig = JSON.parse(fs.readFileSync(cronConfigPath, 'utf8'));
            }
        } catch (err) {
            console.warn('[STATS_CONFIG] Failed to read cron.json, using global.cronConfig:', err.message);
        }
        
        // Merge configs: mainConfig first, then cronConfig (cronConfig can override)
        // But accessLimit should be in mainConfig, so we prioritize mainConfig for accessLimit
        const mergedConfig = { ...mainConfig, ...cronConfig };
        // Ensure accessLimit from mainConfig is preserved if it exists
        if (mainConfig?.accessLimit !== undefined) {
            mergedConfig.accessLimit = mainConfig.accessLimit;
        }
        
        return res.json({ data: mergedConfig });
    } catch (err) {
        console.error('[STATS_CONFIG_ERROR]', err);
        return res.status(500).json({ status: 500, message: 'Gagal mengambil konfigurasi.', error: err.message });
    }
});

// GET /api/:type/:id?
router.get('/:type/:id?', async (req, res) => {
    const { type, id } = req.params;
    try {
        switch(type){
            case "start": {
                const startSnapshot = getStatusSnapshot({ reconcileState: true });
                if (!startSnapshot.botStatus && canReconnect()) {
                    await triggerWhatsAppReconnect();
                }
                return res.json({ message: startSnapshot.botStatus ? 'bot is online' : 'starting bot'});
            }
            
            case "stop":
                await closeActiveSocket({ nextState: 'close' });
                return res.json({ message: 'Bot is offline' });
            
            case "sync-status":
                // Manual sync of WhatsApp connection state
                try {
                    // Check actual connection status
                    const status = getStatusSnapshot({ reconcileState: true });
                    let actualState = status.connectionState;
                    
                    if (status.hasUser) {
                        actualState = 'open';
                    } else if (status.connectionState !== 'logged_out') {
                        actualState = 'temporary_disconnect';
                    }
                    
                    // Update global state if different
                    if (status.connectionState !== actualState) {
                        const oldState = status.connectionState;
                        if (DEBUG) console.log(`[SYNC] State updated: ${oldState} → ${actualState}`);
                    }
                    
                    return res.json({
                        success: true,
                        message: 'WhatsApp state synchronized',
                        status: {
                            connectionState: actualState,
                            requiresReauth: actualState === 'logged_out',
                            hasRaf: status.hasRaf,
                            hasConn: status.hasConn,
                            hasUser: status.hasUser
                        }
                    });
                } catch (error) {
                    return res.json({
                        success: false,
                        error: error.message
                    });
                }
            
            case "bot-status":
                try {
                    return res.json(getStatusSnapshot({ reconcileState: true }));
                } catch (error) {
                    const snapshot = getStatusSnapshot();
                    return res.json({
                        error: error.message,
                        botStatus: false,
                        connectionState: snapshot.connectionState
                    });
                }
            
            case "stats":
                try {
                    // Get whitelisted package names (packages with whitelist: true are free/gratis)
                    const whitelistedPackages = (global.packages || [])
                        .filter(pkg => pkg.whitelist === true)
                        .map(pkg => pkg.name);
                    
                    // Exclude whitelist users from total count for payment statistics
                    const payableUsers = global.users.filter(user => !whitelistedPackages.includes(user.subscription));
                    const totalUsers = payableUsers.length;
                    const paidUsersCount = payableUsers.filter(user => user.paid === true || user.paid === 1).length;
                    const unpaidUsers = totalUsers - paidUsersCount;
                    
                    // PENTING: Pastikan botStatus selalu boolean (true/false), bukan undefined
                    // Gunakan monitoring service sebagai primary check karena lebih akurat
                    let botStatus = false;
                    
                    // Method 1: Gunakan monitoring service (lebih akurat, cek multiple conditions)
                    if (global.monitoring && typeof global.monitoring.checkWhatsAppConnection === 'function') {
                        botStatus = global.monitoring.checkWhatsAppConnection();
                    } else {
                        botStatus = getStatusSnapshot({ reconcileState: true }).botStatus;
                    }
                    
                    // Final check: Pastikan selalu boolean
                    botStatus = !!botStatus;
                    
                    let totalRevenue = 0;
                    if (global.users && global.packages) {
                        // Only count revenue from payable users (exclude whitelist packages)
                        const paidPayableUsers = payableUsers.filter(user => user.paid === true || user.paid === 1);
                        paidPayableUsers.forEach(user => {
                            const userPackage = global.packages.find(pkg => pkg.name === user.subscription);
                            if (userPackage && userPackage.price) {
                                const price = parseFloat(userPackage.price);
                                if (!isNaN(price)) {
                                    totalRevenue += price;
                                }
                            }
                        });
                    }
                    
                    // OPTIMASI: Gunakan cache yang lebih agresif (60 detik) untuk mengurangi API calls
                    const now = Date.now();
                    const useCache = (now - statusCache.cacheTime) < (statusCache.TTL * 2); // Double cache time
                    
                    // Fungsi untuk mendapatkan status dengan caching
                    const getCachedOrFetch = async (key, fetchFn) => {
                        if (useCache && statusCache[key]) {
                            return statusCache[key];
                        }
                        const result = await fetchFn();
                        statusCache[key] = result;
                        statusCache.cacheTime = now;
                        return result;
                    };
                    
                    // OPTIMASI: Kurangi timeout untuk response lebih cepat
                    const pppPromise = getCachedOrFetch('ppp', () =>
                        getPppStats({ caller: 'stats.dashboard.ppp' }).then((result) => {
                            return result.ok ? { data: result.data } : { error: true };
                        }).catch(() => ({ error: true }))
                    );
                    
                    const hotspotPromise = getCachedOrFetch('hotspot', () =>
                        getHotspotStats({ caller: 'stats.dashboard.hotspot' }).then((result) => {
                            return result.ok ? { data: result.data } : { error: true };
                        }).catch(() => ({ error: true }))
                    );
                    
                    const mikrotikPromise = getCachedOrFetch('mikrotik', () =>
                        getMikrotikDiagnostics({ caller: 'stats.dashboard.mikrotik' }).then((result) => ({
                            connected: result.ok,
                            message: result.message,
                        })).catch((e) => ({
                            error: true,
                            connected: false,
                            message: e.message,
                        }))
                    );
                    
                    const genieAcsPromise = getCachedOrFetch('genieacs', () =>
                        getGenieAcsDiagnostics({ caller: 'stats.dashboard.genieacs', mode: 'basic' }).then((result) => ({
                            connected: result.ok,
                            message: result.message,
                            errorCode: result.errorCode,
                        })).catch((error) => ({
                            connected: false,
                            message: error.message || 'Request Failed',
                            errorCode: 'CONNECT_ERROR',
                        }))
                    );
                    
                    // OPTIMASI: Gunakan Promise.allSettled dengan timeout lebih agresif
                    const results = await Promise.allSettled([pppPromise, hotspotPromise, mikrotikPromise, genieAcsPromise]);
                    
                    const pppResult = results[0].status === 'fulfilled' ? results[0].value : { error: true };
                    const hotspotResult = results[1].status === 'fulfilled' ? results[1].value : { error: true };
                    const mikrotikResult = results[2].status === 'fulfilled' ? results[2].value : { error: true, connected: false, message: 'Check failed' };
                    const genieAcsResult = results[3].status === 'fulfilled' ? results[3].value : { connected: false, message: 'Check failed' };
                    
                    const normalizedMikrotikResult = {
                        connected: typeof mikrotikResult.connected === 'boolean' 
                            ? mikrotikResult.connected 
                            : (mikrotikResult.connected === true || mikrotikResult.connected === 'true' || mikrotikResult.connected === 1),
                        message: mikrotikResult.message || mikrotikResult.status || (mikrotikResult.connected ? 'Connected' : 'Offline')
                    };
                    
                    const normalizedGenieAcsResult = {
                        connected: typeof genieAcsResult.connected === 'boolean' 
                            ? genieAcsResult.connected 
                            : (genieAcsResult.connected === true || genieAcsResult.connected === 'true' || genieAcsResult.connected === 1),
                        message: genieAcsResult.message || (genieAcsResult.connected ? 'Connected' : 'Offline')
                    };
                    
                    return res.json({
                        users: totalUsers,
                        paidUsers: paidUsersCount,
                        unpaidUsers: unpaidUsers,
                        totalRevenue: totalRevenue,
                        botStatus: botStatus,
                        pppStats: pppResult.error ? { online: 'N/A', offline: 'N/A' } : (pppResult.data || pppResult),
                        hotspotStats: hotspotResult.error ? { total: 'N/A', active: 'N/A' } : (hotspotResult.data || hotspotResult),
                        mikrotikStatus: normalizedMikrotikResult,
                        genieAcsStatus: normalizedGenieAcsResult,
                    });
                } catch (e) {
                    console.error("[STATS_API_FATAL_ERROR] A critical error occurred while fetching dashboard stats:", e);
                    return res.status(500).json({ status: 500, message: "A critical error occurred on the server while gathering dashboard statistics." });
                }
            
            case "ssid":
                const wifiInfoResult = await getWifiInfo(id, { skipRefresh: true, context: { caller: 'stats.ssid', id } });
                return res.status(wifiInfoResult.ok ? 200 : 500).json({
                    data: wifiInfoResult.data || null,
                    message: wifiInfoResult.message,
                    accepted: wifiInfoResult.accepted,
                    applied: wifiInfoResult.applied,
                    errorCode: wifiInfoResult.errorCode,
                });
            
            case "reboot":
                const rebootResult = await rebootRouter(req.params.id, { context: { caller: 'stats.reboot', id: req.params.id } });
                if (rebootResult.success) {
                    if (DEBUG) console.log(`[API_REBOOT] Perintah reboot untuk device ID ${req.params.id} berhasil dikirim.`);
                    return res.status(200).json({
                        status: 200,
                        message: rebootResult.message,
                        accepted: rebootResult.accepted,
                        applied: rebootResult.applied,
                    });
                }
                return res.status(500).json({
                    status: 500,
                    message: rebootResult.message || `Gagal mengirim perintah reboot untuk device ${req.params.id}.`,
                    accepted: rebootResult.accepted,
                    applied: rebootResult.applied,
                    errorCode: rebootResult.errorCode,
                });
            
            case "requests":
                const currentRequestsFromFile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database/requests.json'), 'utf8'));
                let requestsToFilter = currentRequestsFromFile;
                if (req.user && req.user.role === 'teknisi') {
                    requestsToFilter = currentRequestsFromFile.filter(request => request && String(request.requested_by_teknisi_id) === String(req.user.id));
                }
                const validAndMappedRequests = requestsToFilter.reduce((acc, v) => {
                    if (!v || !v.userId) {
                        console.warn(`[API_REQUESTS_SKIP] Melewatkan item permintaan karena tidak valid atau tidak memiliki userId. Item:`, v);
                        return acc;
                    }
                    const findUserPelanggan = global.users.find(u => String(u.id) === String(v.userId));
                    if (!findUserPelanggan) {
                        console.warn(`[API_REQUESTS_SKIP] Melewatkan permintaan ID ${v.id} karena pengguna terkait ID ${v.userId} tidak ditemukan.`);
                        return acc;
                    }
                    const findTeknisiRequestor = global.accounts.find(acc => String(acc.id) === String(v.requested_by_teknisi_id));
                    const findPackageInfo = global.packages.find(p => p.name == findUserPelanggan.subscription);
                    let packagePrice = 0;
                    if (findPackageInfo && findPackageInfo.price && findPackageInfo.price !== "N/A" && !isNaN(parseFloat(findPackageInfo.price))) {
                        packagePrice = parseFloat(findPackageInfo.price);
                    }
                    const mappedRequest = {
                        ...v,
                        requestorName: findTeknisiRequestor?.username || "Teknisi Tidak Diketahui",
                        userName: v.userName || findUserPelanggan.name,
                        packageName: findPackageInfo?.name || "Unknown",
                        packagePrice: packagePrice,
                        updated_by_name: global.accounts.find(adminAcc => String(adminAcc.id) === String(v.updated_by))?.username || "-",
                    };
                    acc.push(mappedRequest);
                    return acc;
                }, []);
                return res.json({ data: validAndMappedRequests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) });
            
            case "config":
                // Read config directly from file to ensure we get the latest value
                // This is important because global.config might not be updated after save
                // Note: path and fs are already required at the top of the file
                let mainConfig = global.config || {};
                let cronConfig = global.cronConfig || {};
                
                try {
                    // Try to read from file to get latest config
                    const mainConfigPath = path.join(__dirname, '..', 'config.json');
                    if (fs.existsSync(mainConfigPath)) {
                        mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
                    }
                } catch (err) {
                    console.warn('[STATS_CONFIG] Failed to read config.json, using global.config:', err.message);
                }
                
                try {
                    // Try to read from file to get latest cron config
                    const cronConfigPath = path.join(__dirname, '..', 'database', 'cron.json');
                    if (fs.existsSync(cronConfigPath)) {
                        cronConfig = JSON.parse(fs.readFileSync(cronConfigPath, 'utf8'));
                    }
                } catch (err) {
                    console.warn('[STATS_CONFIG] Failed to read cron.json, using global.cronConfig:', err.message);
                }
                
                // Merge configs: mainConfig first, then cronConfig (cronConfig can override)
                // But accessLimit should be in mainConfig, so we prioritize mainConfig for accessLimit
                const mergedConfig = { ...mainConfig, ...cronConfig };
                // Ensure accessLimit from mainConfig is preserved if it exists
                if (mainConfig?.accessLimit !== undefined) {
                    mergedConfig.accessLimit = mainConfig.accessLimit;
                }
                
                // Debug logging
                if (DEBUG) {
                    console.log('[STATS_CONFIG] mainConfig.accessLimit:', mainConfig?.accessLimit, 'type:', typeof mainConfig?.accessLimit);
                    console.log('[STATS_CONFIG] mergedConfig.accessLimit:', mergedConfig.accessLimit, 'type:', typeof mergedConfig.accessLimit);
                }
                console.log('[STATS_CONFIG] mergedConfig keys count:', Object.keys(mergedConfig).length);
                
                return res.json({ data: mergedConfig });
            
            case "speed-requests":
                if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
                    return res.status(403).json({ data: [], message: "Akses ditolak." });
                }
                const sortedRequests = [...global.speed_requests].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                return res.json({ data: sortedRequests });
            
            case "invoice-settings":
                if (!req.user || !['admin', 'owner', 'superadmin'].includes(req.user.role)) {
                    return res.status(403).json({ message: "Akses ditolak." });
                }
                return res.json(global.config);
            
            case "tickets": {
                let ticketsToReturn = [...global.reports];
                const { status } = req.query;

                if (status) {
                    const allowedStatuses = status.split(',').map(s => s.trim());
                    ticketsToReturn = ticketsToReturn.filter(ticket => allowedStatuses.includes(ticket.status));
                }

                ticketsToReturn.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                return res.json({ status: 200, message: "Data tiket berhasil diambil.", data: ticketsToReturn });
            }
            
            default:
                return res.json({ data: type == 'users' ? global.users : type == 'packages' ? global.packages : type == 'payment' ? global.payment : type == 'payment-method' ? global.paymentMethod : type == 'statik' ? global.statik : type == 'voucher' ? global.voucher : type == 'atm' ? global.atm : type == 'cron' ? global.cronConfig : type == 'accounts' ? global.accounts : [] })
        }
    } catch (e){
        console.log(e);
        res.json({ status: 500, message: "Internal server error" });
    }
});

module.exports = router;
