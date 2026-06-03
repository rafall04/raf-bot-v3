/**
 * Header Doc
 * Purpose: Menangani business logic customer portal seperti profil, nomor telepon, akun, dan permintaan perubahan paket.
 * Caller: Route/service customer web.
 * Deps: `./base-service`, validator nomor, persistence package change, `../template-service`, `../whatsapp-delivery-service`, dan `../whatsapp-gateway`.
 * MainFuncs: `getProfile`, `getPhoneNumbers`, `addPhoneNumber`, `removePhoneNumber`, `updateAccount`, `requestPackageChange`.
 * SideEffects: Membaca/menulis data customer dan mengirim notifikasi owner untuk request perubahan paket.
 */

const BaseService = require('./base-service');
const { createError, ErrorTypes } = require('../error-handler');
const { comparePassword, hashPassword } = require('../password');
const { savePackageChangeRequests } = require('../database');
const { validatePhoneNumbers, normalizePhone, isValidPhoneFormat } = require('../phone-validator');
const convertRupiah = require('rupiah-format');
const { sendMessageToMany } = require('../whatsapp-delivery-service');
const { hasAuthenticatedSession } = require('../whatsapp-gateway');
const { renderCategoryTemplate } = require('../template-service');

function renderResponseTemplate(key, data = {}) {
    return renderCategoryTemplate('responseTemplates', key, data).text;
}

class CustomerService extends BaseService {
    /**
     * Get customer profile dengan package information
     * 
     * @param {Object} customer - Customer user object
     * @returns {Promise<Object>} Customer profile data
     * @throws {Error} Jika package tidak ditemukan atau ada error
     */
    static async getProfile(customer, req = null) {
        if (!customer) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Customer tidak ditemukan",
                400
            );
        }

        // Audit log: Data access
        this.logDataAccess('CustomerService', 'getProfile', customer.id, null, true, req);

        // Find user package
        const userPackage = this.findPackageByName(customer.subscription);
        
        if (!userPackage) {
            CustomerService.logError('CustomerService', 'getProfile', new Error('Package not found'), {
                userId: customer.id,
                packageName: customer.subscription
            });
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                `Konfigurasi untuk paket Anda (${customer.subscription}) tidak ditemukan.`,
                404
            );
        }

        // Validate price format
        const monthlyBill = parseFloat(userPackage.price);
        if (isNaN(monthlyBill)) {
            CustomerService.logError('CustomerService', 'getProfile', new Error('Invalid price format'), {
                userId: customer.id,
                packageName: userPackage.name,
                price: userPackage.price
            });
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Format harga tidak valid untuk paket '${userPackage.name}'.`,
                500
            );
        }

        // Calculate due date
        const dueDay = (global.config && parseInt(global.config.tanggal_batas_bayar)) || 10;
        const now = new Date();
        let dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay, 23, 59, 59, 999);
        
        // If the due date for this month has already passed, show next month's due date
        if (now > dueDate) {
            dueDate.setMonth(dueDate.getMonth() + 1);
        }

        // Check config untuk visibility payment status dan due date
        const showPaymentStatus = global.config?.showPaymentStatus !== false; // Default: true
        const showDueDate = global.config?.showDueDate !== false; // Default: true

        // Build profile data dengan formatted fields untuk frontend
        const profileData = {
            name: customer.name || null,
            username: customer.username || null,
            package: userPackage.name, // Alias untuk packageName (untuk kompatibilitas)
            packageName: userPackage.name,
            monthlyBill: monthlyBill, // Number format
            monthlyBillFormatted: convertRupiah.convert(monthlyBill), // String format dengan "Rp"
            address: customer.address || null,
            phone_number: customer.phone_number || null,
            allowed_ssids: customer.bulk || []
        };

        // Tambahkan due date hanya jika showDueDate = true
        if (showDueDate) {
            profileData.dueDate = dueDate.toISOString(); // ISO string format
            profileData.dueDateFormatted = dueDate.toLocaleDateString('id-ID', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            }); // Formatted date untuk display
        } else {
            profileData.dueDate = null;
            profileData.dueDateFormatted = null;
        }

        // Tambahkan payment status hanya jika showPaymentStatus = true
        if (showPaymentStatus) {
            profileData.paymentStatus = customer.paid ? "PAID" : "UNPAID";
        } else {
            profileData.paymentStatus = null;
        }

        return profileData;
    }

    /**
     * Update customer account (username/password)
     * 
     * @param {Object} customer - Customer user object
     * @param {Object} updateData - { currentPassword, newUsername, newPassword }
     * @returns {Promise<Object>} Update result
     * @throws {Error} Jika validasi gagal atau ada error
     */
    static async updateAccount(customer, updateData, req = null) {
        const { currentPassword, newUsername, newPassword } = updateData;

        // Audit log: Data access attempt
        this.logDataAccess('CustomerService', 'updateAccount', customer.id, customer.id, true, req);

        // Validation
        this.validateField(currentPassword, 'currentPassword');
        
        if (!newUsername && !newPassword) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Tidak ada data untuk diubah. Harap berikan username baru atau password baru.",
                400
            );
        }

        // Verify current password
        const isPasswordValid = await comparePassword(currentPassword, customer.password);
        if (!isPasswordValid) {
            throw createError(
                ErrorTypes.AUTHENTICATION_ERROR,
                "Password saat ini yang Anda masukkan salah.",
                403
            );
        }

        let updates = [];
        let params = [];
        let cacheUpdates = {};

        // Handle username change
        if (newUsername && newUsername !== customer.username) {
            // Check if new username is already taken
            const existingUser = global.users.find(
                u => u.username && 
                u.username.toLowerCase() === newUsername.toLowerCase() && 
                u.id !== customer.id
            );
            
            if (existingUser) {
                throw createError(
                    ErrorTypes.VALIDATION_ERROR,
                    `Username '${newUsername}' sudah digunakan. Silakan pilih yang lain.`,
                    409
                );
            }
            
            updates.push("username = ?");
            params.push(newUsername);
            cacheUpdates.username = newUsername;
        }

        // Handle password change
        if (newPassword) {
            const hashedPassword = await hashPassword(newPassword);
            updates.push("password = ?");
            params.push(hashedPassword);
            cacheUpdates.password = hashedPassword;
        }

        if (updates.length === 0) {
            return { message: "Tidak ada perubahan yang dilakukan." };
        }

        // Update database
        const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        params.push(customer.id);

        await new Promise((resolve, reject) => {
            global.db.run(sql, params, function(err) {
                if (err) {
                    CustomerService.logError('CustomerService', 'updateAccount', err, {
                        userId: customer.id
                    });
                    return reject(new Error("Gagal memperbarui akun Anda."));
                }
                if (this.changes === 0) {
                    return reject(new Error("User tidak ditemukan di database saat pembaruan."));
                }
                resolve();
            });
        });

        // Update in-memory cache on success
        Object.assign(customer, cacheUpdates);

        return { message: "Akun Anda telah berhasil diperbarui." };
    }

    /**
     * Request package change
     * 
     * @param {Object} customer - Customer user object
     * @param {string} targetPackageName - Target package name
     * @returns {Promise<Object>} Request result
     * @throws {Error} Jika validasi gagal atau ada error
     */
    static async requestPackageChange(customer, targetPackageName, req = null) {
        // Audit log: Data access
        this.logDataAccess('CustomerService', 'requestPackageChange', customer.id, null, true, req);

        // Validation
        this.validateField(targetPackageName, 'targetPackageName');

        // Check for existing pending request
        const existingRequest = global.packageChangeRequests.find(
            r => r.userId === customer.id && r.status === 'pending'
        );
        
        if (existingRequest) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Anda sudah memiliki permintaan perubahan paket yang sedang diproses. Mohon tunggu hingga selesai.",
                409
            );
        }

        // Validate target package exists
        const requestedPackage = this.findPackageByName(targetPackageName);
        if (!requestedPackage) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                `Paket tujuan "${targetPackageName}" tidak ditemukan.`,
                404
            );
        }

        // Check if already using the package
        if (customer.subscription === targetPackageName) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Anda sudah menggunakan paket "${targetPackageName}".`,
                400
            );
        }

        // Create new request
        const newRequest = {
            id: `pkgchange_${Date.now()}_${customer.id}`,
            userId: customer.id,
            userName: customer.name,
            currentPackageName: customer.subscription,
            requestedPackageName: targetPackageName,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: null,
            approvedBy: null
        };

        // Save to database
        global.packageChangeRequests.unshift(newRequest);
        savePackageChangeRequests();

        // Send notification to owners (fire-and-forget)
        CustomerService._sendPackageChangeNotification(customer, targetPackageName).catch(err => {
            CustomerService.logError('CustomerService', 'requestPackageChange', err, {
                userId: customer.id,
                targetPackage: targetPackageName
            });
        });

        return { message: "Permintaan perubahan paket Anda telah berhasil dikirim dan menunggu persetujuan admin." };
    }

    /**
     * Get package change request history untuk customer
     * 
     * @param {Object} customer - Customer user object
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Array>} Array of package change requests
     */
    static async getPackageChangeHistory(customer, req = null) {
        if (!customer || !customer.id) {
            return [];
        }

        // Audit log: Data access
        this.logDataAccess('CustomerService', 'getPackageChangeHistory', customer.id, null, true, req);

        // CRITICAL: Strict ownership check - only return requests owned by this customer
        const customerRequests = global.packageChangeRequests?.filter(
            r => String(r.userId) === String(customer.id)
        ) || [];

        // Sort by created date (newest first)
        const sortedRequests = customerRequests.sort(
            (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );

        // Format requests dengan informasi package
        return sortedRequests.map(request => {
            const requestedPackage = this.findPackageByName(request.requestedPackageName);
            const currentPackage = this.findPackageByName(request.currentPackageName);
            
            return {
                id: request.id,
                currentPackageName: request.currentPackageName,
                currentPackagePrice: currentPackage?.price || 0,
                requestedPackageName: request.requestedPackageName,
                requestedPackagePrice: requestedPackage?.price || request.requestedPackagePrice || 0,
                status: request.status, // 'pending', 'approved', 'rejected', 'cancelled'
                createdAt: request.createdAt,
                updatedAt: request.updatedAt,
                approvedBy: request.approvedBy,
                notes: request.notes || null
            };
        });
    }

    /**
     * Get phone numbers untuk customer
     * 
     * @param {Object} customer - Customer user object
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Object>} Phone numbers data dengan limit info
     */
    static async getPhoneNumbers(customer, req = null) {
        if (!customer) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Customer tidak ditemukan",
                400
            );
        }

        // Audit log: Data access
        this.logDataAccess('CustomerService', 'getPhoneNumbers', customer.id, null, true, req);

        // Parse phone numbers dari database (format: "phone1|phone2|phone3")
        const phoneNumbers = customer.phone_number 
            ? customer.phone_number.split('|').map(p => p.trim()).filter(p => p)
            : [];

        // Get access limit dari config
        let maxAllowed = 3; // Default
        const configAccessLimit = global.config?.accessLimit;
        const cronAccessLimit = global.cronConfig?.accessLimit;
        
        if (configAccessLimit !== undefined && configAccessLimit !== null) {
            maxAllowed = parseInt(configAccessLimit) || 3;
        } else if (cronAccessLimit !== undefined && cronAccessLimit !== null) {
            maxAllowed = parseInt(cronAccessLimit) || 3;
        }

        return {
            phone_numbers: phoneNumbers,
            max_allowed: maxAllowed,
            current_count: phoneNumbers.length,
            can_add_more: phoneNumbers.length < maxAllowed
        };
    }

    /**
     * Tambah nomor HP baru untuk customer
     * 
     * @param {Object} customer - Customer user object
     * @param {string} phoneNumber - Phone number baru
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Object>} Add result
     * @throws {Error} Jika validasi gagal atau ada error
     */
    static async addPhoneNumber(customer, phoneNumber, req = null) {
        if (!customer) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Customer tidak ditemukan",
                400
            );
        }

        // Audit log: Data access
        this.logDataAccess('CustomerService', 'addPhoneNumber', customer.id, null, true, req);

        // Validation
        this.validateField(phoneNumber, 'phoneNumber');

        // Normalize phone number
        const normalizedPhone = normalizePhone(phoneNumber);

        // Validate format
        if (!isValidPhoneFormat(normalizedPhone)) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Format nomor HP tidak valid. Gunakan format: 08xxxxxxxxx atau 628xxxxxxxxx",
                400
            );
        }

        // Get current phone numbers
        const currentPhones = customer.phone_number 
            ? customer.phone_number.split('|').map(p => p.trim()).filter(p => p)
            : [];

        // Check duplikasi dalam list sendiri
        if (currentPhones.some(p => normalizePhone(p) === normalizedPhone)) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Nomor HP ini sudah terdaftar di akun Anda.",
                409
            );
        }

        // Get access limit dari config
        let maxAllowed = 3; // Default
        const configAccessLimit = global.config?.accessLimit;
        const cronAccessLimit = global.cronConfig?.accessLimit;
        
        if (configAccessLimit !== undefined && configAccessLimit !== null) {
            maxAllowed = parseInt(configAccessLimit) || 3;
        } else if (cronAccessLimit !== undefined && cronAccessLimit !== null) {
            maxAllowed = parseInt(cronAccessLimit) || 3;
        }

        // Check access limit
        if (currentPhones.length >= maxAllowed) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                `Maksimal ${maxAllowed} nomor HP sesuai konfigurasi. Anda sudah memiliki ${currentPhones.length} nomor.`,
                400
            );
        }

        // Check duplikasi dengan user lain
        const validationResult = await validatePhoneNumbers(global.db, normalizedPhone, customer.id);
        if (!validationResult.valid) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                validationResult.message || "Nomor HP sudah terdaftar oleh pelanggan lain.",
                409
            );
        }

        // Add new phone number
        const newPhones = [...currentPhones, normalizedPhone];
        const updatedPhoneNumber = newPhones.join('|');

        // Update database
        const sql = `UPDATE users SET phone_number = ? WHERE id = ?`;
        await new Promise((resolve, reject) => {
            global.db.run(sql, [updatedPhoneNumber, customer.id], function(err) {
                if (err) {
                    CustomerService.logError('CustomerService', 'addPhoneNumber', err, {
                        userId: customer.id,
                        phoneNumber: normalizedPhone
                    });
                    return reject(new Error("Gagal menambahkan nomor HP."));
                }
                if (this.changes === 0) {
                    return reject(new Error("User tidak ditemukan di database saat update."));
                }
                resolve();
            });
        });

        // Update in-memory cache
        customer.phone_number = updatedPhoneNumber;

        return {
            message: "Nomor HP berhasil ditambahkan.",
            phone_numbers: newPhones,
            max_allowed: maxAllowed,
            current_count: newPhones.length
        };
    }

    /**
     * Hapus nomor HP dari customer
     * 
     * @param {Object} customer - Customer user object
     * @param {string} phoneNumber - Phone number yang akan dihapus
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Object>} Remove result
     * @throws {Error} Jika validasi gagal atau ada error
     */
    static async removePhoneNumber(customer, phoneNumber, req = null) {
        if (!customer) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Customer tidak ditemukan",
                400
            );
        }

        // Audit log: Data access
        this.logDataAccess('CustomerService', 'removePhoneNumber', customer.id, null, true, req);

        // Validation
        this.validateField(phoneNumber, 'phoneNumber');

        // Normalize phone number
        const normalizedPhone = normalizePhone(phoneNumber);

        // Get current phone numbers
        const currentPhones = customer.phone_number 
            ? customer.phone_number.split('|').map(p => p.trim()).filter(p => p)
            : [];

        // Check minimal 1 nomor HP
        if (currentPhones.length <= 1) {
            throw createError(
                ErrorTypes.VALIDATION_ERROR,
                "Tidak dapat menghapus nomor HP. Minimal harus ada 1 nomor HP di akun Anda.",
                400
            );
        }

        // Check if phone number exists in customer's list
        const phoneIndex = currentPhones.findIndex(p => normalizePhone(p) === normalizedPhone);
        if (phoneIndex === -1) {
            throw createError(
                ErrorTypes.NOT_FOUND_ERROR,
                "Nomor HP tidak ditemukan di akun Anda.",
                404
            );
        }

        // Remove phone number
        const newPhones = currentPhones.filter((p, index) => index !== phoneIndex);
        const updatedPhoneNumber = newPhones.join('|');

        // Update database
        const sql = `UPDATE users SET phone_number = ? WHERE id = ?`;
        await new Promise((resolve, reject) => {
            global.db.run(sql, [updatedPhoneNumber, customer.id], function(err) {
                if (err) {
                    CustomerService.logError('CustomerService', 'removePhoneNumber', err, {
                        userId: customer.id,
                        phoneNumber: normalizedPhone
                    });
                    return reject(new Error("Gagal menghapus nomor HP."));
                }
                if (this.changes === 0) {
                    return reject(new Error("User tidak ditemukan di database saat update."));
                }
                resolve();
            });
        });

        // Update in-memory cache
        customer.phone_number = updatedPhoneNumber;

        return {
            message: "Nomor HP berhasil dihapus.",
            phone_numbers: newPhones,
            current_count: newPhones.length
        };
    }

    /**
     * Get available packages untuk customer (paket dengan showInMonthly !== false)
     * 
     * Filter menggunakan logic: showInMonthly !== false
     * - Include paket dengan showInMonthly: true
     * - Include paket yang tidak punya field showInMonthly (undefined !== false = true)
     * - Exclude paket dengan showInMonthly: false
     * 
     * Logic ini konsisten dengan routes/packages.js dan message/wifi.js
     * 
     * @param {Object} customer - Customer user object (optional, untuk audit log)
     * @param {Object} req - Express request object (optional)
     * @returns {Promise<Array>} List of available packages (sorted by price ascending)
     */
    static async getAvailablePackages(customer = null, req = null) {
        // Audit log: Data access
        if (customer) {
            this.logDataAccess('CustomerService', 'getAvailablePackages', customer.id, null, true, req);
        }

        // Filter packages yang showInMonthly !== false (fleksibel: include yang tidak punya field atau true)
        // Logic ini konsisten dengan routes/packages.js dan message/wifi.js
        const availablePackages = (global.packages || [])
            .filter(pkg => pkg.showInMonthly !== false)
            .map(pkg => ({
                id: pkg.id,
                name: pkg.name,
                price: typeof pkg.price === 'string' ? parseInt(pkg.price) || 0 : (pkg.price || 0),
                profile: pkg.displayProfile || pkg.profile || '',
                description: pkg.description || ''
            }))
            .sort((a, b) => {
                // Sort by price ascending
                return a.price - b.price;
            });

        return availablePackages;
    }

    /**
     * Send notification to owners about package change request
     * @private
     * @param {Object} customer - Customer user object
     * @param {string} targetPackageName - Target package name
     */
    static async _sendPackageChangeNotification(customer, targetPackageName) {
        if (!hasAuthenticatedSession() || !global.config.ownerNumber || !Array.isArray(global.config.ownerNumber)) {
            return;
        }

        const notifMessage = renderResponseTemplate('customer_service_package_change_owner_request', {
            customerName: customer.name,
            currentPackage: customer.subscription,
            targetPackage: targetPackageName
        });

        await sendMessageToMany(global.config.ownerNumber, { text: notifMessage });
    }
}

module.exports = CustomerService;

