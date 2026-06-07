/**
 * Header Doc
 * Purpose: Factory router API PSB untuk intake calon pelanggan, provisioning, transisi PSB ke users, dan utilitas device PSB.
 * Caller: `routes/api.js` melalui dependency injection.
 * Deps: Express, helper PSB/provisioning, service PSB, runtime repository/state, dan helper upload foto.
 * MainFuncs: `createApiPsbRouter`.
 * SideEffects: Menulis record PSB, memindahkan pelanggan ke users, mengakses DB PSB/users, dan mengirim notifikasi operasional.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { getSSIDInfo } = require('../lib/wifi');
const { getAllPPPoESecrets, getMikrotikDiagnostics } = require('../lib/mikrotik');
const { createApiPsbRepository } = require('../repositories/api-psb.repository');
const { createApiPsbService } = require('../services/api-psb.service');

function createApiPsbRouter(deps) {
    const {
        comparePassword,
        addPPPoEUser,
        checkPPPoEUserExists,
        assertMikrotikResult,
        getProfileBySubscription,
        validatePhoneNumbers,
        normalizePhone,
        parseGoogleMapsLink,
        validateCoordinates,
        generateRandomPassword,
        sendPSBPhase1Notification,
        sendPSBPhase2Notification,
        sendPSBTeknisiMeluncurNotification,
        sendPSBInstallationCompleteNotification,
        logActivity,
        insertPSBRecord,
        updatePSBRecord,
        getPSBRecord,
        getPSBRecordsByStatus,
        movePSBToUsers,
        getNextAvailablePSBId,
        getNextAvailableUserId,
        logWifiChange,
        rateLimit,
        withLock,
        findPsbDevice,
        listPsbDevices,
        updatePsbDeviceConfig,
        testPsbConnections,
        getGenieAcsConfig,
        getGenieAcsFeatureStatus = async () => ({
            available: true,
            configured: true,
            enabled: true,
            reachable: null,
            customerRebootEnabled: true,
            adminRebootEnabled: true,
            wifiManagementEnabled: true,
            psbProvisioningEnabled: true,
            reason: null,
            errorCode: null,
        }),
        normalizeQueryStringParam,
        redactPppoeFilter,
        ensureAuthenticatedStaff,
        ensureAdmin,
        psbService,
    } = deps;

    const router = express.Router();

    function getRuntime() {
        return deps.runtime || global.__appRuntime || null;
    }

    function getRuntimeStateValue(key, fallbackValue) {
        const runtime = getRuntime();
        if (runtime?.state?.has?.(key)) {
            return runtime.state.get(key);
        }
        if (typeof global[key] !== 'undefined') {
            return global[key];
        }
        return fallbackValue;
    }

    function getDb() {
        return getRuntime()?.getDb?.() || getRuntimeStateValue('db', null);
    }

    function getPsbDb() {
        return getRuntime()?.repositories?.psbDb?.get() || getRuntimeStateValue('psbDb', null);
    }

    function getUsers() {
        return getRuntime()?.repositories?.users?.getAll() || getRuntimeStateValue('users', []);
    }

    function updateUsers(updater) {
        const usersRepo = getRuntime()?.repositories?.users || null;
        if (usersRepo) {
            return usersRepo.update(updater);
        }
        const nextUsers = typeof updater === 'function' ? updater(getUsers()) : updater;
        global['users'] = nextUsers;
        return nextUsers;
    }

    function getPackages() {
        return getRuntime()?.repositories?.packages?.getAll() || getRuntimeStateValue('packages', []);
    }

    function getAccounts() {
        return getRuntime()?.repositories?.accounts?.getAll() || getRuntimeStateValue('accounts', []);
    }

    function getConfig() {
        return getRuntime()?.getConfig?.() || getRuntimeStateValue('config', {}) || {};
    }

    function getCronConfig() {
        return getRuntime()?.repositories?.cronConfig?.get() || getRuntimeStateValue('cronConfig', {}) || {};
    }

    function getPsbRecords() {
        return getRuntime()?.repositories?.psbRecords?.getAll() || getRuntimeStateValue('psbRecords', []);
    }

    function setPsbRecords(nextRecords) {
        const psbRepo = getRuntime()?.repositories?.psbRecords || null;
        if (psbRepo) {
            return psbRepo.setAll(nextRecords);
        }
        global['psbRecords'] = nextRecords;
        return nextRecords;
    }

    function updatePsbRecords(updater) {
        const psbRepo = getRuntime()?.repositories?.psbRecords || null;
        if (psbRepo) {
            return psbRepo.update(updater);
        }
        const nextRecords = typeof updater === 'function' ? updater(getPsbRecords()) : updater;
        global['psbRecords'] = nextRecords;
        return nextRecords;
    }

const apiPsbRepository = createApiPsbRepository({
    runtime: getRuntime()
});
const apiPsbService = createApiPsbService({
    repository: apiPsbRepository,
    addPPPoEUser,
    assertMikrotikResult,
    comparePassword,
    getProfileBySubscription,
    validatePhoneNumbers,
    parseGoogleMapsLink,
    validateCoordinates,
    generateRandomPassword,
    getSSIDInfo,
    getNextAvailablePSBId,
    insertPSBRecord,
    sendPSBPhase1Notification,
    sendPSBPhase2Notification,
    updatePSBRecord,
    movePSBToUsers,
    sendPSBTeknisiMeluncurNotification,
    sendPSBInstallationCompleteNotification,
    logActivity,
    logWifiChange,
    updatePsbDeviceConfig,
    withLock,
    fs,
    path,
    logger: console
});

function buildPsbProvisioningUnavailableResponse(res, featureStatus) {
    return res.status(503).json({
        status: 503,
        message: featureStatus.reason || 'Fitur provisioning GenieACS tidak tersedia.',
        errorCode: featureStatus.errorCode || 'GENIEACS_FEATURE_DISABLED',
        featureStatus,
    });
}
// Multer storage untuk PSB photo upload
// Struktur: uploads/psb/YEAR/MONTH/tempId/ktp_photo.jpg dan house_photo.jpg
// Catatan: req.body mungkin belum tersedia saat destination dipanggil untuk multipart/form-data
// Solusi: Gunakan query parameter atau simpan di req sebelum multer
const psbStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Coba ambil tempId dari berbagai sumber (body, query, atau header)
        // Untuk multipart/form-data, body mungkin belum terisi saat destination dipanggil
        let tempId = req.body?.tempId || req.query?.tempId || req.headers['x-temp-id'];
        
        // Jika masih belum ada, coba parse dari fieldname atau buat fallback
        // Tapi lebih baik pastikan frontend mengirim via query parameter
        if (!tempId) {
            // Fallback: buat tempId baru (tidak ideal, tapi mencegah error)
            tempId = 'TEMP_' + Date.now();
            console.warn(`[PSB_UPLOAD_WARN] tempId tidak ditemukan, menggunakan fallback: ${tempId}`);
        }
        
        const year = String(new Date().getFullYear()); // Convert to string
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        // Satu folder per request pelanggan: uploads/psb/YEAR/MONTH/tempId/
        const uploadDir = path.join(__dirname, '../uploads/psb', year, month, tempId);
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        // Simpan tempId di req untuk digunakan di filename function
        req._psbTempId = tempId;
        
        // Coba ambil fieldname dari query parameter juga (untuk memastikan tersedia)
        const fieldname = req.query?.fieldname || req.body?.fieldname;
        if (fieldname) {
            req._psbFieldname = fieldname;
        }
        
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Gunakan fieldname dari berbagai sumber
        // Query parameter lebih reliable untuk multipart/form-data
        let fieldname = req._psbFieldname || req.query?.fieldname || req.body?.fieldname;
        
        // Jika masih belum ada, coba deteksi dari file.fieldname atau gunakan default
        if (!fieldname) {
            // file.fieldname biasanya adalah nama field di FormData ('photo')
            // Tapi kita butuh 'ktp_photo' atau 'house_photo'
            // Fallback: gunakan 'photo' dan akan diperbaiki saat submit
            fieldname = 'photo';
            console.warn(`[PSB_UPLOAD_WARN] fieldname tidak ditemukan, menggunakan fallback: ${fieldname}`);
        }
        
        const ext = path.extname(file.originalname) || '.jpg';
        // Nama file: ktp_photo.jpg atau house_photo.jpg
        cb(null, `${fieldname}${ext}`);
    }
});

const psbUpload = multer({
    storage: psbStorage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        // Accept images only
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Hanya file gambar yang diperbolehkan'), false);
        }
        cb(null, true);
    }
});

// POST /api/psb/upload-photo - Upload foto untuk PSB (KTP atau rumah)
router.post('/psb/upload-photo', ensureAuthenticatedStaff, rateLimit('psb-upload-photo', 20, 60000), psbUpload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 400,
                message: 'File foto harus diupload'
            });
        }
        
        // Ambil tempId dari berbagai sumber (body, query, atau yang disimpan di req)
        // Body mungkin sudah terisi setelah multer memproses
        const tempId = req.body?.tempId || req.query?.tempId || req._psbTempId;
        
        // Validasi tempId harus ada
        if (!tempId) {
            return res.status(400).json({
                status: 400,
                message: 'tempId harus disediakan. Satu tempId untuk satu request pelanggan. Pastikan tempId dikirim via query parameter atau form data.'
            });
        }
        
        const year = String(new Date().getFullYear()); // Convert to string
        const month = String(new Date().getMonth() + 1).padStart(2, '0');
        
        // Path relatif untuk web access
        // Struktur: /uploads/psb/YEAR/MONTH/tempId/ktp_photo.jpg atau house_photo.jpg
        const webPath = `/uploads/psb/${year}/${month}/${tempId}/${req.file.filename}`;
        
        // Full storage path for reference
        const fullStoragePath = path.join(__dirname, '../uploads/psb', year, month, tempId, req.file.filename);
        
        // Log untuk debugging
        const fieldnameUsed = req._psbFieldname || req.query?.fieldname || req.body?.fieldname || 'not found';
        console.log(`[PSB_UPLOAD_SUCCESS] File uploaded: ${req.file.filename}`);
        console.log(`[PSB_UPLOAD_SUCCESS] fieldname used: ${fieldnameUsed}`);
        console.log(`[PSB_UPLOAD_SUCCESS] tempId: ${tempId} (satu folder untuk 2 foto: KTP + Rumah)`);
        console.log(`[PSB_UPLOAD_SUCCESS] Web path: ${webPath}`);
        console.log(`[PSB_UPLOAD_SUCCESS] Storage path: ${fullStoragePath}`);
        
        return res.json({
            status: 200,
            message: 'Foto berhasil diupload',
            data: {
                path: webPath,
                filename: req.file.filename,
                size: req.file.size,
                tempId: tempId,
                storagePath: `uploads/psb/${year}/${month}/${tempId}/${req.file.filename}`,
                year: year,
                month: month
            }
        });
    } catch (error) {
        console.error('[PSB_UPLOAD_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal upload foto',
            error: error.message
        });
    }
});

// POST /api/psb/submit-phase1 - Submit data awal PSB (sebelum instalasi)
router.post('/psb/submit-phase1', ensureAuthenticatedStaff, rateLimit('psb-submit-phase1', 5, 60000), async (req, res) => {
    try {
        const result = await apiPsbService.submitPhase1({
            ...req.body,
            userContext: req.user,
            requestMeta: {
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent'],
                baseDir: path.join(__dirname, '..')
            }
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[PSB_PHASE1_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal menyimpan data awal PSB',
            error: error.message
        });
    }
});

// POST /api/psb/find-device - Cari device di GenieACS
router.post('/psb/find-device', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const { deviceId } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({
                status: 400,
                message: 'Device ID harus diisi'
            });
        }

        const featureStatus = await getGenieAcsFeatureStatus({ feature: 'psbProvisioning' });
        if (!featureStatus.available) {
            return buildPsbProvisioningUnavailableResponse(res, featureStatus);
        }
        
        const response = await findPsbDevice(deviceId, {
            timeoutMs: 10000,
            operation: 'api.psb.findDevice',
        });
        
        if (response.ok && response.data) {
            return res.json({
                status: 200,
                message: 'Device ditemukan',
                data: response.data
            });
        } else {
            return res.status(404).json({
                status: 404,
                message: 'Device tidak ditemukan di GenieACS'
            });
        }
    } catch (error) {
        console.error('[PSB_FIND_DEVICE_ERROR]', error);
        console.error('[PSB_FIND_DEVICE_ERROR] Stack:', error.stack);
        
        // Handle specific error cases
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return res.status(503).json({
                status: 503,
                message: 'GenieACS tidak dapat dijangkau. Pastikan server GenieACS berjalan.',
                error: error.message
            });
        }
        
        if (error.response) {
            return res.status(error.response.status || 500).json({
                status: error.response.status || 500,
                message: 'Error dari GenieACS',
                error: error.response.data || error.message
            });
        }
        
        return res.status(500).json({
            status: 500,
            message: 'Error mencari device',
            error: error.message
        });
    }
});

// GET /api/psb/list-customers - List PSB customers berdasarkan status
router.get('/psb/list-customers', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const result = await apiPsbService.listPsbRecordsByStatus({
            status: req.query.status
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[PSB_LIST_CUSTOMERS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal mengambil data customers',
            error: error.message
        });
    }
});

// GET /api/psb/list-devices - List devices dengan berbagai filter
// Query params: filter (default|new|by-sn|by-pppoe), serialNumber (optional), pppoeUsername (optional)
router.get('/psb/list-devices', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const featureStatus = await getGenieAcsFeatureStatus({ feature: 'psbProvisioning' });
        if (!featureStatus.available) {
            return buildPsbProvisioningUnavailableResponse(res, featureStatus);
        }

        const psbFilterType = normalizeQueryStringParam(req.query.filter) || 'default';
        const psbAllowedFilters = new Set(['default', 'new', 'by-sn', 'by-pppoe']);
        const psbSerialNumberFilter = normalizeQueryStringParam(req.query.serialNumber);
        const psbPppoeUsernameFilter = normalizeQueryStringParam(req.query.pppoeUsername);

        if (!psbAllowedFilters.has(psbFilterType)) {
            return res.status(400).json({
                status: 400,
                message: 'Filter device tidak valid.',
                error: 'Invalid filter type'
            });
        }

        if (psbFilterType === 'by-sn' && !psbSerialNumberFilter) {
            return res.status(400).json({
                status: 400,
                message: 'Filter "By SN" memerlukan Serial Number. Silakan masukkan Serial Number terlebih dahulu.',
                error: 'Serial Number required for by-sn filter'
            });
        }

        if (psbFilterType === 'by-pppoe' && !psbPppoeUsernameFilter) {
            return res.status(400).json({
                status: 400,
                message: 'Filter "By PPPoE" memerlukan PPPoE Username.',
                error: 'PPPoE Username required for by-pppoe filter'
            });
        }

        const psbProjectionFields = '_id,Device.DeviceInfo,InternetGatewayDevice.DeviceInfo,VirtualParameters,InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1,Device.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1,Events.Registered,_lastInform';
        const psbResult = await listPsbDevices({
            filterType: psbFilterType,
            serialNumberFilter: psbSerialNumberFilter,
            pppoeUsernameFilter: psbPppoeUsernameFilter,
            now: Date.now(),
        }, {
            pageSize: 500,
            maxDevices: 5000,
            timeoutMs: 30000,
            operation: 'api.psb.listDevices',
        });

        if (!psbResult.ok) {
            throw new Error(psbResult.message || 'Gagal mengambil list devices dari GenieACS');
        }

        const psbFilteredDevices = Array.isArray(psbResult.data) ? psbResult.data : [];
        const psbSummary = psbResult.summary || {};
        const psbTruncated = psbResult.truncated === true;

        console.log('[PSB_LIST_DEVICES]', {
            filterType: psbFilterType,
            serialNumberFilter: psbSerialNumberFilter || null,
            pppoeUsernameFilter: redactPppoeFilter(psbPppoeUsernameFilter),
            fetchedCount: psbResult.fetchedCount || 0,
            normalizedCount: psbResult.normalizedCount || 0,
            filteredCount: psbFilteredDevices.length,
            withoutPppoeUsername: psbSummary.withoutPppoeUsername || 0,
            withoutRegisteredDate: psbSummary.withoutRegisteredDate || 0,
            truncated: psbTruncated
        });

        if (psbFilterType === 'new' && psbSummary.withoutRegisteredDate === (psbResult.normalizedCount || 0) && (psbResult.normalizedCount || 0) > 0) {
            console.warn('[PSB_LIST_DEVICES] Events.Registered tidak ditemukan pada seluruh device saat filter new.');
        }

        if (psbTruncated) {
            console.warn('[PSB_LIST_DEVICES] Device fetch terpotong karena mencapai batas maxDevices.', {
                maxDevices: psbResult.fetchedCount || 0
            });
        }

        if ((psbResult.normalizedCount || 0) > 0 && psbFilteredDevices.length > 0) {
            return res.json({
                status: 200,
                message: `Devices berhasil diambil (filter: ${psbFilterType})`,
                data: psbFilteredDevices,
                filter: psbFilterType,
                count: psbFilteredDevices.length
            });
        }

        return res.status(404).json({
            status: 404,
            message: 'Tidak ada device ditemukan di GenieACS'
        });

    } catch (error) {
        console.error('[PSB_LIST_DEVICES_ERROR]', error);
        console.error('[PSB_LIST_DEVICES_ERROR] Stack:', error.stack);
        
        // Handle specific error cases
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return res.status(503).json({
                status: 503,
                message: 'GenieACS tidak dapat dijangkau. Pastikan server GenieACS berjalan.',
                error: error.message
            });
        }
        
        if (error.response) {
            return res.status(error.response.status || 500).json({
                status: error.response.status || 500,
                message: 'Error dari GenieACS',
                error: error.response.data || error.message
            });
        }
        
        return res.status(500).json({
            status: 500,
            message: 'Gagal mengambil list devices dari GenieACS',
            error: error.message
        });
    }
});

// POST /api/psb/update-device-config - Update konfigurasi device di GenieACS (PPP & WiFi)
router.post('/psb/update-device-config', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const featureStatus = await getGenieAcsFeatureStatus({
            feature: 'psbProvisioning',
            deviceId: req.body?.deviceId || null,
        });
        if (!featureStatus.available) {
            return buildPsbProvisioningUnavailableResponse(res, featureStatus);
        }

        const { deviceId, pppUsername, pppPassword, wifiSSID, wifiPassword, ssidIndex = 1 } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({
                status: 400,
                message: 'Device ID harus diisi'
            });
        }
        
        if (!pppUsername && !pppPassword && !wifiSSID && !wifiPassword) {
            return res.status(400).json({
                status: 400,
                message: 'Tidak ada parameter yang perlu diupdate. Minimal harus ada salah satu: pppUsername, pppPassword, wifiSSID, atau wifiPassword'
            });
        }
        
        const response = await updatePsbDeviceConfig(deviceId, {
            pppUsername,
            pppPassword,
            wifiSSID,
            wifiPassword,
            ssidIndex,
        }, {
            timeoutMs: 30000,
            operation: 'api.psb.updateDeviceConfig',
        });
        
        if (response.ok && response.accepted) {
            return res.json({
                status: 200,
                message: 'Konfigurasi device berhasil diupdate',
                data: {
                    deviceId: deviceId,
                    updatedParameters: response.data?.updatedParameters || 0,
                    parameters: response.data?.parameters || []
                }
            });
        }

        throw new Error(response.message || 'Task GenieACS tidak diterima');
        
    } catch (error) {
        console.error('[UPDATE_DEVICE_CONFIG_ERROR]', error);
        
        // Handle specific error cases
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return res.status(503).json({
                status: 503,
                message: 'GenieACS tidak dapat dijangkau. Pastikan server GenieACS berjalan.',
                error: error.message
            });
        }
        
        if (error.response) {
            return res.status(error.response.status || 500).json({
                status: error.response.status || 500,
                message: 'Error dari GenieACS saat update konfigurasi',
                error: error.response.data || error.message
            });
        }
        
        return res.status(500).json({
            status: 500,
            message: 'Gagal update konfigurasi device',
            error: error.message
        });
    }
});

// POST /api/psb/update-status - Update status PSB (untuk teknisi meluncur, dll)
router.post('/psb/update-status', ensureAuthenticatedStaff, rateLimit('psb-update-status', 10, 60000), async (req, res) => {
    try {
        const result = await apiPsbService.updatePsbStatus({
            customerId: req.body.customerId,
            status: req.body.status,
            userContext: req.user,
            requestMeta: {
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            }
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[PSB_UPDATE_STATUS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal update status',
            error: error.message
        });
    }
});

// GET /api/psb/validate-pppoe-username - Pre-validate PPPoE username sebelum submit Phase 3
router.get('/psb/validate-pppoe-username', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username || typeof username !== 'string' || username.trim() === '') {
            return res.status(400).json({
                status: 400,
                message: 'Username tidak boleh kosong',
                available: false
            });
        }
        
        const usernameTrimmed = username.trim();
        
        // Check if username already exists in MikroTik
        try {
            const existsResult = await checkPPPoEUserExists(usernameTrimmed, { caller: 'api.psb.validate-pppoe-username' });
            if (!existsResult.ok) {
                throw new Error(existsResult.message);
            }
            const exists = existsResult.data?.exists === true;
            
            return res.status(200).json({
                status: 200,
                available: !exists,
                message: exists 
                    ? `Username "${usernameTrimmed}" sudah ada di MikroTik. Silakan gunakan username lain.`
                    : `Username "${usernameTrimmed}" tersedia.`
            });
        } catch (mikrotikError) {
            // If MikroTik connection error, still allow but warn
            console.warn('[PSB_VALIDATE_USERNAME] MikroTik check failed:', mikrotikError.message);
            return res.status(200).json({
                status: 200,
                available: true, // Allow if check fails (MikroTik might be down)
                message: `Tidak dapat mengecek username (${mikrotikError.message}). Silakan coba lagi.`,
                warning: true
            });
        }
    } catch (error) {
        console.error('[PSB_VALIDATE_USERNAME_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal mengecek username',
            available: false,
            error: error.message
        });
    }
});

// GET /api/users/validate-pppoe-exists - Validate PPPoE username exists in MikroTik (for Import Mode)
// Returns profile info if exists, error if not found
router.get('/users/validate-pppoe-exists', ensureAdmin, async (req, res) => {
    try {
        const { username } = req.query;
        
        if (!username || typeof username !== 'string' || username.trim() === '') {
            return res.status(400).json({
                status: 400,
                exists: false,
                message: 'Username PPPoE tidak boleh kosong'
            });
        }
        
        const usernameTrimmed = username.trim();
        
        // Check if username already exists in local database
        const existingUser = getUsers().find(u => 
            u.pppoe_username && u.pppoe_username.toLowerCase() === usernameTrimmed.toLowerCase()
        );
        
        if (existingUser) {
            return res.status(400).json({
                status: 400,
                exists: false,
                message: `Username "${usernameTrimmed}" sudah terdaftar di database (${existingUser.name}). Tidak dapat import ulang.`,
                conflictUser: {
                    id: existingUser.id,
                    name: existingUser.name
                }
            });
        }
        
        // Check if username exists in MikroTik and get profile
        try {
            const secretsResult = await getAllPPPoESecrets({ caller: 'api.users.validate-pppoe-exists' });
            assertMikrotikResult(secretsResult);
            const secrets = secretsResult.data?.secrets || [];
            
            const mikrotikUser = secrets.find(s => 
                s.name && s.name.toLowerCase() === usernameTrimmed.toLowerCase()
            );
            
            if (!mikrotikUser) {
                return res.status(404).json({
                    status: 404,
                    exists: false,
                    message: `Username "${usernameTrimmed}" tidak ditemukan di MikroTik. Pastikan username sudah ada di router.`
                });
            }
            
            // Find matching package based on profile
            let matchedPackage = null;
            if (mikrotikUser.profile && getPackages().length > 0) {
                matchedPackage = getPackages().find(p => 
                    p.profile && p.profile.toLowerCase() === mikrotikUser.profile.toLowerCase()
                );
            }
            
            return res.status(200).json({
                status: 200,
                exists: true,
                message: `Username "${usernameTrimmed}" ditemukan di MikroTik`,
                data: {
                    username: mikrotikUser.name,
                    password: mikrotikUser.password || '', // Include password from MikroTik
                    profile: mikrotikUser.profile,
                    disabled: mikrotikUser.disabled === 'true' || mikrotikUser.disabled === true,
                    comment: mikrotikUser.comment || '',
                    matchedPackage: matchedPackage ? {
                        name: matchedPackage.name,
                        profile: matchedPackage.profile,
                        price: matchedPackage.price
                    } : null
                }
            });
            
        } catch (mikrotikError) {
            console.error('[VALIDATE_PPPOE_EXISTS] MikroTik error:', mikrotikError.message);
            return res.status(500).json({
                status: 500,
                exists: false,
                message: `Gagal mengecek MikroTik: ${mikrotikError.message}`
            });
        }
        
    } catch (error) {
        console.error('[VALIDATE_PPPOE_EXISTS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            exists: false,
            message: 'Gagal memvalidasi username PPPoE',
            error: error.message
        });
    }
});

// GET /api/psb/test-connections - Test koneksi ke GenieACS dan MikroTik
router.get('/psb/test-connections', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const genieAcsConfig = getGenieAcsConfig();
        const genieAcsFeatureStatus = await getGenieAcsFeatureStatus({
            feature: 'psbProvisioning',
            includeDiagnostics: genieAcsConfig.valid,
            deviceId: req.query.deviceId || null,
            caller: 'api.psb.testConnections',
        });
        const results = {
            genieacs: { connected: false, message: '', diagnostics: null, featureStatus: genieAcsFeatureStatus },
            mikrotik: { connected: false, message: '' },
            device: { online: false, message: '', deviceId: req.query.deviceId || null }
        };
        
        // Test GenieACS connection
        if (genieAcsFeatureStatus.enabled && genieAcsConfig.valid) {
            try {
                const diagnostics = await testPsbConnections(req.query.deviceId || undefined, {
                    timeoutMs: 5000,
                    context: 'api.psb.testConnections',
                });
                results.genieacs.connected = diagnostics.data?.basicConnected === true;
                results.genieacs.message = diagnostics.message;
                results.genieacs.diagnostics = diagnostics.data || null;
            } catch (error) {
                results.genieacs.message = `GenieACS tidak dapat dijangkau: ${error.message}`;
            }
        } else {
            results.genieacs.message = genieAcsFeatureStatus.reason || 'GenieACS URL tidak dikonfigurasi';
        }
        
        // Test MikroTik connection (try to get PPP profiles)
        try {
            const mikrotikDiagnostic = await getMikrotikDiagnostics({ caller: 'api.health-check' });
            results.mikrotik.connected = mikrotikDiagnostic.ok;
            results.mikrotik.message = mikrotikDiagnostic.message;
        } catch (error) {
            results.mikrotik.message = `MikroTik tidak dapat dijangkau: ${error.message}`;
        }
        
        // Test device online (if deviceId provided)
        if (req.query.deviceId && genieAcsFeatureStatus.available) {
            try {
                const deviceDiagnostics = await testPsbConnections(req.query.deviceId, {
                    timeoutMs: 5000,
                    context: 'api.psb.testConnections.deviceProbe',
                });
                const deviceFound = deviceDiagnostics.data?.capabilityReady === true;

                results.device.online = deviceFound;
                results.device.message = deviceFound
                    ? 'Device siap dioperasikan melalui GenieACS'
                    : 'Device belum siap untuk operasi GenieACS';
            } catch (error) {
                results.device.message = `Device tidak dapat dijangkau: ${error.message}`;
            }
        } else if (req.query.deviceId) {
            results.device.message = genieAcsFeatureStatus.reason || 'GenieACS URL tidak dikonfigurasi';
        } else {
            results.device.message = 'Device ID tidak disediakan';
        }
        
        const allOk = results.genieacs.connected && results.mikrotik.connected && 
                     (!req.query.deviceId || results.device.online);
        
        return res.status(200).json({
            status: 200,
            allOk: allOk,
            results: results,
            message: allOk 
                ? 'Semua koneksi OK'
                : 'Beberapa koneksi bermasalah. Periksa detail di bawah.'
        });
    } catch (error) {
        console.error('[PSB_TEST_CONNECTIONS_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal mengetes koneksi',
            error: error.message
        });
    }
});

// POST /api/psb/submit-phase2 - Submit proses pemasangan PSB
router.post('/psb/submit-phase2', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const result = await apiPsbService.submitPhase2({
            customerId: req.body.customerId,
            installed_odc_id: req.body.installed_odc_id,
            installed_odp_id: req.body.installed_odp_id,
            port_number: req.body.port_number,
            installation_notes: req.body.installation_notes,
            userContext: req.user,
            requestMeta: {
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            }
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[PSB_PHASE2_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal menyimpan data pemasangan',
            error: error.message
        });
    }
});

// POST /api/psb/submit-phase3 - Submit setup awal pelanggan PSB (konfigurasi modem)
router.post('/psb/submit-phase3', ensureAuthenticatedStaff, async (req, res) => {
    try {
        const result = await apiPsbService.submitPhase3({
            customerId: req.body.customerId,
            pppoe_username: req.body.pppoe_username,
            pppoe_password: req.body.pppoe_password,
            subscription: req.body.subscription,
            device_id: req.body.device_id,
            wifi_ssid: req.body.wifi_ssid,
            wifi_password: req.body.wifi_password,
            ssid_index: req.body.ssid_index,
            ssid_indices: req.body.ssid_indices,
            userContext: req.user,
            requestMeta: {
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            }
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[PSB_PHASE3_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal menyelesaikan PSB Phase 3',
            error: error.message
        });
    }
});
// POST /api/psb/delete-all - Delete all PSB records with password verification
router.post('/psb/delete-all', ensureAdmin, async (req, res) => {
    try {
        const result = await apiPsbService.deleteAllPsbRecords({
            password: req.body.password,
            userContext: req.user,
            requestMeta: {
                ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
                userAgent: req.headers['user-agent']
            }
        });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[PSB_DELETE_ALL_ERROR]', error);
        return res.status(500).json({
            status: 500,
            message: 'Gagal menghapus data PSB',
            error: error.message
        });
    }
});

    return router;
}

module.exports = createApiPsbRouter;
