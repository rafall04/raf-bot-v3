/**
 * WifiService
 * 
 * Service untuk handle business logic terkait WiFi/SSID operations untuk customer.
 * 
 * Methods:
 * - getCustomerWifiInfo() - Get WiFi info untuk customer
 * - getConnectedDevices() - Get connected devices untuk customer WiFi
 * - updateCustomerWifiName() - Update WiFi name untuk customer
 * - updateCustomerWifiPassword() - Update WiFi password untuk customer
 * - updateCustomerWifi() - Update WiFi name dan/atau password untuk customer
 */

const BaseService = require('./base-service');
const { createError, ErrorTypes } = require('../error-handler');
const { getWifiInfo, setWifiCredentials, rebootDevice, getGenieAcsFeatureStatus } = require('../genieacs');
const { logWifiChange } = require('../wifi-logger');

/**
 * Tulis entry ke wifi_change_logs.json untuk mutasi dari portal pelanggan.
 * Idempotent terhadap failure: kalau write log error, mutasi tetap return sukses ke user
 * tapi error dicatat di console — audit-loss lebih baik daripada gagal request user.
 */
async function writeCustomerPortalWifiLog({ customer, ssidIndex, changeType, changes, req, fallbackReason = '' }) {
    try {
        const phone = (() => {
            const raw = customer.phone_number || customer.phone || '';
            const first = String(raw).split(/[|,]/)[0].trim();
            return first.replace('@s.whatsapp.net', '').replace('@lid', '') || 'N/A';
        })();
        await logWifiChange({
            userId: customer.id,
            deviceId: customer.device_id,
            customerName: customer.name || 'Customer',
            customerPhone: phone,
            changeType,
            changes,
            changedBy: 'customer',
            changeSource: 'web_customer',
            actorRole: 'customer',
            actorIdentifier: 'customer',
            actorPhone: phone,
            reason: `Perubahan via portal pelanggan (SSID ${ssidIndex})`,
            notes: fallbackReason,
            ipAddress: req?.ip || req?.connection?.remoteAddress || 'N/A',
            userAgent: (req?.get && req.get('User-Agent')) || req?.headers?.['user-agent'] || 'N/A'
        });
    } catch (logError) {
        console.error('[WIFI_LOGGING][web_customer] Gagal menulis audit log:', logError.message);
    }
}

class WifiService extends BaseService {
    static async ensureFeatureAvailable(feature, customer, statusCode = 503) {
        const featureStatus = await getGenieAcsFeatureStatus({
            feature,
            deviceId: customer?.device_id || null,
        });

        if (!featureStatus.available) {
            throw createError(
                featureStatus.errorCode === 'DEVICE_ID_REQUIRED' ? ErrorTypes.NOT_FOUND_ERROR : ErrorTypes.EXTERNAL_API_ERROR,
                featureStatus.reason,
                featureStatus.errorCode === 'DEVICE_ID_REQUIRED' ? 404 : statusCode,
                featureStatus
            );
        }

        return featureStatus;
    }

    /**
     * Get WiFi info untuk customer
     * 
     * @param {Object} customer - Customer user object
     * @param {Object} req - Express request object (optional)
     * @param {boolean} skipRefresh - Skip refresh untuk performa (default: true)
     * @returns {Promise<Object>} WiFi info data
     * @throws {Error} Jika device tidak ditemukan atau ada error
     */
    static async getCustomerWifiInfo(customer, req = null, skipRefresh = true) {
        if (!customer) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Customer tidak ditemukan",
                400
            );
        }

        // Validasi customer memiliki device
        if (!customer.device_id) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                "Device ID tidak ditemukan untuk akun Anda. Silakan hubungi admin.",
                404
            );
        }

        // Audit log: Data access
        this.logDataAccess('WifiService', 'getCustomerWifiInfo', customer.id, customer.device_id, true, req);

        try {
            const wifiInfoResult = await getWifiInfo(customer.device_id, {
                skipRefresh,
                context: { caller: 'wifi-service.getCustomerWifiInfo', deviceId: customer.device_id },
            });
            if (!wifiInfoResult.ok) {
                throw new Error(wifiInfoResult.message);
            }
            const wifiInfo = wifiInfoResult.data;

            // Filter SSIDs berdasarkan bulk/allowed_ssids dari database customer
            // bulk adalah array of strings/numbers yang berisi SSID indices yang diizinkan untuk customer
            let filteredSSIDs = wifiInfo.ssid || [];
            
            if (customer.bulk && Array.isArray(customer.bulk) && customer.bulk.length > 0) {
                // Convert bulk ke array of strings untuk matching (bulk bisa string atau number)
                const allowedSSIDIds = customer.bulk.map(ssidId => String(ssidId).trim()).filter(id => id);
                
                if (allowedSSIDIds.length > 0) {
                    // Filter SSID berdasarkan match id (id dari GenieACS adalah string seperti "1", "2", dll.)
                    filteredSSIDs = filteredSSIDs.filter(ssid => {
                        // ssid.id dari GenieACS adalah string, bulk juga string setelah conversion
                        const ssidId = String(ssid.id || ssid.index || '').trim();
                        return allowedSSIDIds.includes(ssidId);
                    });
                    
                    console.log(`[WifiService] Filtered SSIDs: ${filteredSSIDs.length} dari ${wifiInfo.ssid.length} total. Allowed: [${allowedSSIDIds.join(', ')}]`);
                }
            } else {
                // Jika customer tidak memiliki bulk, hanya return SSID 1 (default)
                filteredSSIDs = filteredSSIDs.filter(ssid => {
                    const ssidId = String(ssid.id || ssid.index || '').trim();
                    return ssidId === '1';
                });
                
                console.log(`[WifiService] Customer ${customer.id} tidak memiliki bulk, hanya return SSID 1`);
            }

            // SECURITY: Ensure no password is exposed in response
            // getSSIDInfo() dari lib/wifi.js sudah tidak return password, tapi untuk safety
            // kita filter lagi untuk memastikan tidak ada field password yang ter-expose
            filteredSSIDs = filteredSSIDs.map(ssid => {
                const { password: _password, ...ssidWithoutPassword } = ssid;
                // Map id to index untuk konsistensi (id dari GenieACS adalah string seperti "1", "2")
                // Convert ke number untuk konsistensi dengan frontend yang expect number
                const ssidIndex = parseInt(ssid.id || ssid.index || 1);
                return {
                    ...ssidWithoutPassword,
                    index: ssidIndex, // Index sebagai number untuk konsistensi
                    id: String(ssid.id || ssidIndex), // Keep id sebagai string juga untuk reference
                    transmitPower: ssid.transmitPower || "100%" // Default transmitPower jika tidak tersedia
                };
            });

            return {
                deviceId: customer.device_id,
                uptime: wifiInfo.uptime || "Tidak Tersedia",
                lastInform: wifiInfo.lastInform || null,
                ssid: filteredSSIDs,
                allowedSSIDs: customer.bulk || [],
                totalSSIDs: filteredSSIDs.length
            };
        } catch (error) {
            WifiService.logError('WifiService', 'getCustomerWifiInfo', error, {
                userId: customer.id,
                deviceId: customer.device_id
            });

            // Handle specific errors
            if (error.message && error.message.includes('Data perangkat tidak ditemukan')) {
                throw createError(
                    ErrorTypes.NOT_FOUND_ERROR,
                    "Device tidak ditemukan. Silakan hubungi admin.",
                    404
                );
            }

            throw createError(
                ErrorTypes.INTERNAL_ERROR,
                "Gagal mengambil informasi WiFi. Silakan coba lagi nanti.",
                500
            );
        }
    }

    /**
     * Get connected devices untuk customer WiFi
     * 
     * @param {Object} customer - Customer user object
     * @param {Object} req - Express request object (optional)
     * @param {boolean} skipRefresh - Skip refresh untuk performa (default: true)
     * @returns {Promise<Object>} Connected devices data per SSID
     * @throws {Error} Jika device tidak ditemukan atau ada error
     */
    static async getConnectedDevices(customer, req = null, skipRefresh = true) {
        if (!customer) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Customer tidak ditemukan",
                400
            );
        }

        // Validasi customer memiliki device
        if (!customer.device_id) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                "Device ID tidak ditemukan untuk akun Anda. Silakan hubungi admin.",
                404
            );
        }

        // Audit log: Data access
        this.logDataAccess('WifiService', 'getConnectedDevices', customer.id, customer.device_id, true, req);

        try {
            const wifiInfoResult = await getWifiInfo(customer.device_id, {
                skipRefresh,
                context: { caller: 'wifi-service.getConnectedDevices', deviceId: customer.device_id },
            });
            if (!wifiInfoResult.ok) {
                throw new Error(wifiInfoResult.message);
            }
            const wifiInfo = wifiInfoResult.data;

            // Filter SSIDs berdasarkan bulk/allowed_ssids dari database customer
            let filteredSSIDs = wifiInfo.ssid || [];
            
            if (customer.bulk && Array.isArray(customer.bulk) && customer.bulk.length > 0) {
                // Convert bulk ke array of strings untuk matching
                const allowedSSIDIds = customer.bulk.map(ssidId => String(ssidId).trim()).filter(id => id);
                
                if (allowedSSIDIds.length > 0) {
                    // Filter SSID berdasarkan match id
                    filteredSSIDs = filteredSSIDs.filter(ssid => {
                        const ssidId = String(ssid.id || ssid.index || '').trim();
                        return allowedSSIDIds.includes(ssidId);
                    });
                    
                    console.log(`[WifiService] Filtered SSIDs for connected devices: ${filteredSSIDs.length} dari ${wifiInfo.ssid.length} total. Allowed: [${allowedSSIDIds.join(', ')}]`);
                }
            } else {
                // Jika customer tidak memiliki bulk, hanya return SSID 1 (default)
                filteredSSIDs = filteredSSIDs.filter(ssid => {
                    const ssidId = String(ssid.id || ssid.index || '').trim();
                    return ssidId === '1';
                });
                
                console.log(`[WifiService] Customer ${customer.id} tidak memiliki bulk, hanya return SSID 1 untuk connected devices`);
            }

            // Format response dengan detail per SSID
            let totalDevices = 0;
            const ssidDevices = filteredSSIDs.map(ssid => {
                const ssidIndex = parseInt(ssid.id || ssid.index || 1);
                const associatedDevices = ssid.associatedDevices || [];
                const deviceCount = associatedDevices.length;
                totalDevices += deviceCount;

                // Format devices dengan informasi lengkap
                const devices = associatedDevices.map(device => ({
                    mac_address: device.mac || 'N/A',
                    ip_address: device.ip || 'N/A',
                    host_name: device.hostName || 'N/A',
                    signal_strength: device.signal !== 'N/A' ? parseInt(device.signal) : null,
                    signal_unit: device.signal !== 'N/A' ? 'dBm' : null
                }));

                return {
                    ssid_index: ssidIndex,
                    ssid_id: String(ssid.id || ssidIndex),
                    ssid_name: ssid.name || 'N/A',
                    device_count: deviceCount,
                    devices: devices
                };
            });

            // Support kedua format: grouped by SSID dan flat list
            const format = req.query.format || 'grouped'; // Default: grouped
            
            if (format === 'flat') {
                // Flat list format - semua devices dalam satu array
                const flatDevices = [];
                ssidDevices.forEach(ssidData => {
                    ssidData.devices.forEach(device => {
                        flatDevices.push({
                            ...device,
                            ssid_index: ssidData.ssid_index,
                            ssid_id: ssidData.ssid_id,
                            ssid_name: ssidData.ssid_name
                        });
                    });
                });
                
                return {
                    device_id: customer.device_id,
                    total_devices: totalDevices,
                    format: 'flat',
                    devices: flatDevices
                };
            } else {
                // Grouped format (default) - devices dikelompokkan per SSID
                return {
                    device_id: customer.device_id,
                    total_devices: totalDevices,
                    format: 'grouped',
                    ssid_devices: ssidDevices
                };
            }
        } catch (error) {
            WifiService.logError('WifiService', 'getConnectedDevices', error, {
                userId: customer.id,
                deviceId: customer.device_id
            });

            // Handle specific errors
            if (error.message && error.message.includes('Data perangkat tidak ditemukan')) {
                throw createError(
                    ErrorTypes.NOT_FOUND_ERROR,
                    "Device tidak ditemukan. Silakan hubungi admin.",
                    404
                );
            }

            throw createError(
                ErrorTypes.INTERNAL_ERROR,
                "Gagal mengambil data device terkoneksi. Silakan coba lagi nanti.",
                500
            );
        }
    }

    /**
     * Update WiFi name untuk customer
     * 
     * @param {Object} customer - Customer user object
     * @param {number} ssidIndex - SSID index (default: 1)
     * @param {string} newName - New WiFi name
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Object>} Update result
     * @throws {Error} Jika validasi gagal atau ada error
     */
    static async updateCustomerWifiName(customer, ssidIndex = 1, newName, req = null) {
        // Validasi input
        this.validateField(customer, 'customer');
        this.validateField(newName, 'newName');

        // Validasi panjang nama WiFi
        if (newName.length < 3 || newName.length > 32) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Nama WiFi harus antara 3-32 karakter.",
                400
            );
        }

        // Validasi format nama WiFi (huruf, angka, underscore, dash, spasi)
        if (!/^[a-zA-Z0-9_\- ]+$/.test(newName)) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Nama WiFi hanya boleh mengandung huruf, angka, underscore, dash, dan spasi.",
                400
            );
        }

        // Validasi SSID index (support dual band: 1-8, 4 untuk 2.4GHz dan 4 untuk 5GHz)
        const parsedIndex = parseInt(ssidIndex);
        if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).",
                400
            );
        }

        // Validasi customer memiliki device
        if (!customer.device_id) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                "Device ID tidak ditemukan untuk akun Anda.",
                404
            );
        }

        // Validasi SSID index berdasarkan bulk/allowed_ssids dari database customer
        if (customer.bulk && Array.isArray(customer.bulk) && customer.bulk.length > 0) {
            // Convert bulk ke array of numbers untuk comparison (bulk bisa string atau number)
            const allowedIndices = customer.bulk.map(ssidId => parseInt(String(ssidId))).filter(idx => !isNaN(idx) && idx >= 1 && idx <= 8);

            if (allowedIndices.length > 0 && !allowedIndices.includes(parsedIndex)) {
                throw createError(
                    ErrorTypes.AUTHORIZATION_ERROR,
                    `Anda tidak memiliki akses untuk mengubah SSID index ${parsedIndex}. SSID yang tersedia: ${allowedIndices.join(', ')}.`,
                    403
                );
            }
        } else {
            // Jika customer tidak memiliki bulk, hanya SSID 1 yang diizinkan
            if (parsedIndex !== 1) {
                throw createError(
                    ErrorTypes.AUTHORIZATION_ERROR,
                    `Anda tidak memiliki akses untuk mengubah SSID index ${parsedIndex}. Hanya SSID 1 yang tersedia untuk akun Anda.`,
                    403
                );
            }
        }

        // Audit log
        this.logDataAccess('WifiService', 'updateCustomerWifiName', customer.id, customer.device_id, true, req);

        try {
            await this.ensureFeatureAvailable('wifiManagement', customer);
            // Update via GenieACS
            const result = await this._updateWifiViaGenieACS(customer.device_id, parsedIndex, { newName });

            await writeCustomerPortalWifiLog({
                customer,
                ssidIndex: parsedIndex,
                changeType: 'ssid_name',
                changes: { oldSsidName: '(tidak dicatat)', newSsidName: newName, ssidId: String(parsedIndex) },
                req
            });

            return {
                deviceId: customer.device_id,
                ssidIndex: parsedIndex,
                newName: newName,
                updatedAt: new Date().toISOString(),
                taskId: result.taskId || null,
                // #b323: bawa status "sudah mendarat di perangkat?" ke pemanggil. applied===false = task
                // cuma diantre (202) / readback strict 15dtk timeout → BELUM terverifikasi; jalur portal
                // JANGAN klaim "berhasil" polos (setara jalur WA yang pakai wifi-apply-guard).
                applied: result.applied,
                pending: result.applied === false
            };
        } catch (error) {
            WifiService.logError('WifiService', 'updateCustomerWifiName', error, {
                userId: customer.id,
                deviceId: customer.device_id,
                ssidIndex: parsedIndex,
                newName: newName
            });

            // Handle specific errors
            if (error.response) {
                throw createError(
                    ErrorTypes.INTERNAL_ERROR,
                    "Gagal mengubah nama WiFi. Server GenieACS tidak merespons.",
                    500
                );
            }

            throw createError(
                ErrorTypes.INTERNAL_ERROR,
                "Gagal mengubah nama WiFi. Silakan coba lagi nanti.",
                500
            );
        }
    }

    /**
     * Update WiFi password untuk customer
     * 
     * @param {Object} customer - Customer user object
     * @param {number} ssidIndex - SSID index (default: 1)
     * @param {string} newPassword - New WiFi password
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Object>} Update result
     * @throws {Error} Jika validasi gagal atau ada error
     */
    static async updateCustomerWifiPassword(customer, ssidIndex = 1, newPassword, req = null) {
        // Validasi input
        this.validateField(customer, 'customer');
        this.validateField(newPassword, 'newPassword');

        // Validasi panjang password WiFi
        if (newPassword.length < 8 || newPassword.length > 63) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Password WiFi harus antara 8-63 karakter.",
                400
            );
        }

        // Validasi SSID index (support dual band: 1-8, 4 untuk 2.4GHz dan 4 untuk 5GHz)
        const parsedIndex = parseInt(ssidIndex);
        if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).",
                400
            );
        }

        // Validasi customer memiliki device
        if (!customer.device_id) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                "Device ID tidak ditemukan untuk akun Anda.",
                404
            );
        }

        // Validasi SSID index berdasarkan bulk/allowed_ssids dari database customer
        if (customer.bulk && Array.isArray(customer.bulk) && customer.bulk.length > 0) {
            // Convert bulk ke array of numbers untuk comparison (bulk bisa string atau number)
            const allowedIndices = customer.bulk.map(ssidId => parseInt(String(ssidId))).filter(idx => !isNaN(idx) && idx >= 1 && idx <= 8);

            if (allowedIndices.length > 0 && !allowedIndices.includes(parsedIndex)) {
                throw createError(
                    ErrorTypes.AUTHORIZATION_ERROR,
                    `Anda tidak memiliki akses untuk mengubah SSID index ${parsedIndex}. SSID yang tersedia: ${allowedIndices.join(', ')}.`,
                    403
                );
            }
        } else {
            // Jika customer tidak memiliki bulk, hanya SSID 1 yang diizinkan
            if (parsedIndex !== 1) {
                throw createError(
                    ErrorTypes.AUTHORIZATION_ERROR,
                    `Anda tidak memiliki akses untuk mengubah SSID index ${parsedIndex}. Hanya SSID 1 yang tersedia untuk akun Anda.`,
                    403
                );
            }
        }

        // Audit log
        this.logDataAccess('WifiService', 'updateCustomerWifiPassword', customer.id, customer.device_id, true, req);

        try {
            await this.ensureFeatureAvailable('wifiManagement', customer);
            // Update via GenieACS
            const result = await this._updateWifiViaGenieACS(customer.device_id, parsedIndex, { newPassword });

            await writeCustomerPortalWifiLog({
                customer,
                ssidIndex: parsedIndex,
                changeType: 'password',
                changes: { oldPassword: '[Previous]', newPassword, ssidId: String(parsedIndex), passwordChanged: true },
                req
            });

            return {
                deviceId: customer.device_id,
                ssidIndex: parsedIndex,
                updatedAt: new Date().toISOString(),
                taskId: result.taskId || null
            };
        } catch (error) {
            WifiService.logError('WifiService', 'updateCustomerWifiPassword', error, {
                userId: customer.id,
                deviceId: customer.device_id,
                ssidIndex: parsedIndex
            });

            // Handle specific errors
            if (error.response) {
                throw createError(
                    ErrorTypes.INTERNAL_ERROR,
                    "Gagal mengubah password WiFi. Server GenieACS tidak merespons.",
                    500
                );
            }

            throw createError(
                ErrorTypes.INTERNAL_ERROR,
                "Gagal mengubah password WiFi. Silakan coba lagi nanti.",
                500
            );
        }
    }

    /**
     * Update WiFi name dan/atau password untuk customer (combined)
     * 
     * @param {Object} customer - Customer user object
     * @param {number} ssidIndex - SSID index (default: 1)
     * @param {Object} updateData - { newName, newPassword }
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Object>} Update result
     * @throws {Error} Jika validasi gagal atau ada error
     */
    static async updateCustomerWifi(customer, ssidIndex = 1, updateData, req = null) {
        const { newName, newPassword } = updateData || {};

        // Validasi minimal ada satu field yang diupdate
        if (!newName && !newPassword) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Minimal harus ada nama WiFi atau password yang diubah.",
                400
            );
        }

        // Validasi newName jika ada
        if (newName) {
            if (typeof newName !== 'string' || newName.trim() === '') {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "Nama WiFi tidak boleh kosong.",
                    400
                );
            }

            if (newName.length < 3 || newName.length > 32) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "Nama WiFi harus antara 3-32 karakter.",
                    400
                );
            }

            if (!/^[a-zA-Z0-9_\- ]+$/.test(newName)) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "Nama WiFi hanya boleh mengandung huruf, angka, underscore, dash, dan spasi.",
                    400
                );
            }
        }

        // Validasi newPassword jika ada
        if (newPassword) {
            if (typeof newPassword !== 'string' || newPassword.trim() === '') {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "Password WiFi tidak boleh kosong.",
                    400
                );
            }

            if (newPassword.length < 8 || newPassword.length > 63) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    "Password WiFi harus antara 8-63 karakter.",
                    400
                );
            }
        }

        // Validasi SSID index (support dual band: 1-8, 4 untuk 2.4GHz dan 4 untuk 5GHz)
        const parsedIndex = parseInt(ssidIndex);
        if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).",
                400
            );
        }

        // Validasi customer memiliki device
        if (!customer.device_id) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                "Device ID tidak ditemukan untuk akun Anda.",
                404
            );
        }

        // Validasi SSID index berdasarkan bulk/allowed_ssids dari database customer
        if (customer.bulk && Array.isArray(customer.bulk) && customer.bulk.length > 0) {
            // Convert bulk ke array of numbers untuk comparison (bulk bisa string atau number)
            const allowedIndices = customer.bulk.map(ssidId => parseInt(String(ssidId))).filter(idx => !isNaN(idx) && idx >= 1 && idx <= 8);

            if (allowedIndices.length > 0 && !allowedIndices.includes(parsedIndex)) {
                throw createError(
                    ErrorTypes.AUTHORIZATION_ERROR,
                    `Anda tidak memiliki akses untuk mengubah SSID index ${parsedIndex}. SSID yang tersedia: ${allowedIndices.join(', ')}.`,
                    403
                );
            }
        } else {
            // Jika customer tidak memiliki bulk, hanya SSID 1 yang diizinkan
            if (parsedIndex !== 1) {
                throw createError(
                    ErrorTypes.AUTHORIZATION_ERROR,
                    `Anda tidak memiliki akses untuk mengubah SSID index ${parsedIndex}. Hanya SSID 1 yang tersedia untuk akun Anda.`,
                    403
                );
            }
        }

        // Audit log
        this.logDataAccess('WifiService', 'updateCustomerWifi', customer.id, customer.device_id, true, req);

        try {
            await this.ensureFeatureAvailable('wifiManagement', customer);
            // Update via GenieACS
            const result = await this._updateWifiViaGenieACS(customer.device_id, parsedIndex, { newName, newPassword });

            const combinedChangeType = newName && newPassword ? 'both' : (newName ? 'ssid_name' : 'password');
            const combinedChanges = {};
            if (newName) {
                combinedChanges.oldSsidName = '(tidak dicatat)';
                combinedChanges.newSsidName = newName;
            }
            if (newPassword) {
                combinedChanges.oldPassword = '[Previous]';
                combinedChanges.newPassword = newPassword;
                combinedChanges.passwordChanged = true;
            }
            combinedChanges.ssidId = String(parsedIndex);

            await writeCustomerPortalWifiLog({
                customer,
                ssidIndex: parsedIndex,
                changeType: combinedChangeType,
                changes: combinedChanges,
                req
            });

            return {
                deviceId: customer.device_id,
                ssidIndex: parsedIndex,
                newName: newName || null,
                updatedAt: new Date().toISOString(),
                taskId: result.taskId || null,
                // #b323: applied===false (202 antre / readback timeout) → BELUM terverifikasi di perangkat.
                applied: result.applied,
                pending: result.applied === false
            };
        } catch (error) {
            WifiService.logError('WifiService', 'updateCustomerWifi', error, {
                userId: customer.id,
                deviceId: customer.device_id,
                ssidIndex: parsedIndex,
                hasNewName: !!newName,
                hasNewPassword: !!newPassword
            });

            // Handle specific errors
            if (error.response) {
                throw createError(
                    ErrorTypes.INTERNAL_ERROR,
                    "Gagal mengubah WiFi. Server GenieACS tidak merespons.",
                    500
                );
            }

            throw createError(
                ErrorTypes.INTERNAL_ERROR,
                "Gagal mengubah WiFi. Silakan coba lagi nanti.",
                500
            );
        }
    }

    /**
     * Internal method untuk update WiFi via GenieACS
     * 
     * @private
     * @param {string} deviceId - Device ID
     * @param {number} ssidIndex - SSID index
     * @param {Object} updateData - { newName, newPassword }
     * @returns {Promise<Object>} GenieACS response
     * @throws {Error} Jika GenieACS request gagal
     */
    static async _updateWifiViaGenieACS(deviceId, ssidIndex, updateData) {
        const { newName, newPassword } = updateData;

        if (!newName && !newPassword) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Tidak ada parameter yang perlu diupdate.",
                400
            );
        }

        const response = await setWifiCredentials(deviceId, ssidIndex, newName, newPassword, {
            verifyApplied: true,
            context: { caller: 'wifi-service.updateCustomerWifi', deviceId, ssidIndex },
        });

        if (response.ok) {
            return {
                success: true,
                taskId: response.data?.taskId || null,
                status: response.applied === false ? 202 : 200,
                accepted: response.accepted,
                applied: response.applied
            };
        }

        throw createError(
            ErrorTypes.INTERNAL_ERROR,
            response.message || "Gagal memperbarui konfigurasi WiFi di GenieACS.",
            response.errorCode === 'NOT_FOUND' ? 404 : 500
        );
    }

    /**
     * Reboot router untuk customer
     * 
     * @param {Object} customer - Customer user object
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Object>} Reboot result
     * @throws {Error} Jika device tidak ditemukan atau ada error
     */
    static async rebootCustomerRouter(customer, req = null) {
        if (!customer) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Customer tidak ditemukan",
                400
            );
        }

        // Validasi customer memiliki device
        if (!customer.device_id) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                "Device ID tidak ditemukan untuk akun Anda. Silakan hubungi admin.",
                404
            );
        }

        // Audit log: Reboot operation
        this.logDataAccess('WifiService', 'rebootCustomerRouter', customer.id, customer.device_id, true, req);

        try {
            await this.ensureFeatureAvailable('customerReboot', customer);
            const result = await rebootDevice(customer.device_id, {
                context: { caller: 'wifi-service.rebootCustomerRouter', deviceId: customer.device_id },
            });
            
            if (!result.ok) {
                // Return user-friendly error message
                throw createError(
                    ErrorTypes.INTERNAL_ERROR,
                    result.message || "Gagal mengirim perintah reboot. Silakan coba lagi nanti.",
                    500
                );
            }

            return {
                deviceId: customer.device_id,
                message: "Perintah reboot berhasil dikirim. Router akan restart dalam beberapa detik.",
                rebootSent: true,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            WifiService.logError('WifiService', 'rebootCustomerRouter', error, {
                userId: customer.id,
                deviceId: customer.device_id
            });

            // Handle specific errors
            if (error.message && error.message.includes('Data perangkat tidak ditemukan')) {
                throw createError(
                    ErrorTypes.NOT_FOUND_ERROR,
                    "Device tidak ditemukan. Silakan hubungi admin.",
                    404
                );
            }

            // If error already has status code, re-throw it
            if (error.statusCode) {
                throw error;
            }

            throw createError(
                ErrorTypes.INTERNAL_ERROR,
                error.message || "Gagal mengirim perintah reboot. Silakan coba lagi nanti.",
                500
            );
        }
    }
}

module.exports = WifiService;

