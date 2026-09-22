/**
 * Header Doc
 * Purpose: Sub-router SELF-SERVICE pelanggan — `/api/customer/*` (profil, traffic, paket,
 *          voucher QRIS panel, akun, nomor HP, WiFi, bukti bayar, riwayat) + endpoint
 *          lepas `/api/customer/speed-*` dan `/api/dashboard-status`.
 * Caller: `routes/public.js` (composer) → Express app.
 * Deps: express, express-rate-limit, multer, fs/path, `lib/database` (saveSpeedRequests),
 *       `lib/whatsapp-gateway`, `lib/whatsapp-delivery-service` (sendMessageToMany),
 *       `lib/middleware/validation`, `lib/error-handler`, `lib/response-helper`, services
 *       customer/report/speed/wifi/public/traffic, `lib/ipaymu` + `lib/voucher` +
 *       `lib/payment` (untuk `createCustomerVoucherService`), `./shared`.
 * MainFuncs: customerApiRouter + route lepas; handler bukti bayar `handleTagihanPaymentProof` /
 *            `handleSodPaymentProof` + penjaga `findSpeedRequestAwaitingProof` /
 *            `paymentProofRejectionStatus`; rate limiter wifi/payment-proof/voucher.
 * SideEffects: Menulis file bukti bayar ke uploads/, update global.speed_requests, kirim WA ke
 *              owner; charge iPaymu lewat voucher service.
 */
const logger = require('../../lib/logger').logger.child('CUSTOMER');
const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { saveSpeedRequests } = require('../../lib/database');
const { asyncHandler } = require('../../lib/error-handler');
const { sendSuccess, sendError } = require('../../lib/response-helper');
const { hasAuthenticatedSession } = require('../../lib/whatsapp-gateway');
const { sendMessageToMany } = require('../../lib/whatsapp-delivery-service');
const { cancelSpeedRequestValidation } = require('../../lib/middleware/validation');
const CustomerService = require('../../lib/services/customer-service');
const ReportService = require('../../lib/services/report-service');
const SpeedRequestService = require('../../lib/services/speed-request-service');
const PublicService = require('../../lib/services/public-service');
const WifiService = require('../../lib/services/wifi-service');
const CustomerTrafficUsageService = require('../../lib/customer-traffic-usage-service');
const { pay: ipaymuPay } = require('../../lib/ipaymu');
const { addPayment } = require('../../lib/payment');
const { checkhargavc } = require('../../lib/voucher');
const { cekHotspotUser } = require('../../lib/mikrotik');
const { withMikrotikKeyLock } = require('../../lib/mikrotik/core');
const { createCustomerVoucherService } = require('../../services/customer-voucher.service');
const { renderResponseTemplate, ensureCustomerAuthenticated, setSensitiveResponseHeaders } = require('./shared');

const router = express.Router();

// Beli voucher dari panel pelanggan (terautentikasi, tag `buynowpanel`). Dibuat sekali di
// module scope: service-nya stateless dan membaca `global.*` lewat getter, jadi aman.
const customerVoucherService = createCustomerVoucherService({
    getConfig: () => global.config || {},
    pay: ipaymuPay,
    addPayment,
    checkhargavc,
    getVoucherProfiles: () => global.voucher,
    getPayments: () => global.payment,
    // Custom creds (#b405): adapter + lock nyata di-inject; service lazy-require bila kosong.
    cekHotspotUser,
    withUsernameLock: withMikrotikKeyLock,
    logger: console
});
// --- Rate Limiters ---

// Rate limiter untuk WiFi endpoints (resource-intensive operations)
// CATATAN: Endpoint ini memerlukan customer authentication, jadi semua request sudah memiliki req.customer
const wifiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 30, // 30 requests per 15 menit per customer
    message: {
        status: 429,
        message: 'Terlalu banyak permintaan WiFi. Silakan coba lagi dalam 15 menit.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Gunakan customer ID sebagai key (semua request sudah authenticated via ensureCustomerAuthenticated)
    keyGenerator: (req) => {
        // Karena endpoint ini memerlukan authentication, req.customer selalu ada
        // Tidak perlu fallback ke IP, sehingga tidak perlu handle IPv6
        return `wifi_customer_${req.customer?.id || 'unknown'}`;
    },
    skip: (req) => {
        // Skip rate limiting untuk static files (tidak perlu)
        return req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i);
    }
});

// Stricter rate limiter untuk WiFi write operations (update name/password)
// CATATAN: Endpoint ini memerlukan customer authentication, jadi semua request sudah memiliki req.customer
const wifiWriteRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 10, // 10 requests per 15 menit per customer (lebih strict untuk write operations)
    message: {
        status: 429,
        message: 'Terlalu banyak perubahan WiFi. Silakan coba lagi dalam 15 menit.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Gunakan customer ID sebagai key (semua request sudah authenticated via ensureCustomerAuthenticated)
    keyGenerator: (req) => {
        // Karena endpoint ini memerlukan authentication, req.customer selalu ada
        // Tidak perlu fallback ke IP, sehingga tidak perlu handle IPv6
        return `wifi_write_customer_${req.customer?.id || 'unknown'}`;
    },
    skip: (req) => {
        // Skip rate limiting untuk static files (tidak perlu)
        return req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i);
    }
});

// Bukti bayar: lebih ketat dari WiFi write — tiap request menulis file DAN mengirim notifikasi WA ke
// admin, jadi penyalahgunaannya membebani orang, bukan cuma server. Key-nya berprefix sendiri supaya
// kuota bukti bayar tidak dihabiskan oleh operasi WiFi (dan sebaliknya).
const paymentProofRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 5, // 5 upload per 15 menit per customer
    message: {
        status: 429,
        message: 'Terlalu banyak upload bukti pembayaran. Silakan coba lagi dalam 15 menit.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `payment_proof_customer_${req.customer?.id || 'unknown'}`
});

// Beli voucher memanggil iPaymu (charge nyata) tiap request. Tanpa batas, satu akun bisa
// membanjiri gateway dengan transaksi pending. Baca-status/riwayat TIDAK dibatasi karena panel
// mem-polling status selama pelanggan menunggu QRIS dibayar.
const voucherPurchaseRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 10, // 10 transaksi baru per 15 menit per customer
    message: {
        status: 429,
        message: 'Terlalu banyak permintaan pembelian voucher. Silakan coba lagi dalam 15 menit.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `voucher_purchase_customer_${req.customer?.id || 'unknown'}`
});

// memoryStorage — BUKAN diskStorage seperti handleReportPhotoUpload. handleIncomingProof() menuntut
// Buffer (dipakai untuk fs.writeFileSync di repository sekaligus dikirim ulang sebagai media WA ke
// admin), dan alur tagihan bisa berakhir non-CAPTURE — kalau file terlanjur ditulis ke disk, setiap
// jalur tolak harus ingat unlink. Buffer membuat kelas bug itu tidak ada.
const paymentProofUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: function (req, file, cb) {
        // Alur tagihan menerima PDF (payment-proof.service memetakan documentMessage → .pdf), jadi
        // filter image-only milik upload laporan tidak bisa dipakai apa adanya di sini.
        const isImage = file.mimetype.startsWith('image/');
        const isPdf = file.mimetype === 'application/pdf';
        if (!isImage && !isPdf) {
            return cb(new Error('Hanya file gambar atau PDF yang diperbolehkan'), false);
        }
        return cb(null, true);
    }
});

function handlePaymentProofUpload(req, res, next) {
    paymentProofUpload.single('proof')(req, res, (error) => {
        if (!error) {
            return next();
        }
        // Ubah error Multer (termasuk LIMIT_FILE_SIZE) jadi 400 yang rapi alih-alih melemparnya ke
        // error handler global — pola yang sama dengan handleReportPhotoUpload.
        return sendError(res, error.message || 'File bukti tidak valid', 400);
    });
}
// --- Customer Authenticated Routes ---

// Petakan keputusan gerbang uang → status HTTP. "Nol tagihan" dan "tagihan tak terbaca" TIDAK boleh
// dilebur jadi satu kode: yang pertama jawaban pasti (409), yang kedua kita memang tidak tahu (503,
// fail-closed) — persis alasan intake-policy memisahkan keduanya di step 3 vs step 6.
function paymentProofRejectionStatus(reason) {
    switch (reason) {
        case 'tak-ada-tagihan':
            return 409;
        case 'tagihan-tak-diketahui':
        case 'sinyal-belum-siap':
            return 503;
        case 'caption-keluhan':
        case 'keluhan-baru':
            return 422;
        default:
            return 409;
    }
}

async function handleTagihanPaymentProof(req, res, customer, caption) {
    const { getPaymentProofService } = require('../../services/payment-proof.service');
    const { ACTION } = require('../../lib/payment-proof-intake-policy');
    const service = getPaymentProofService();

    // Upload lewat portal adalah pernyataan niat yang EKSPLISIT, jadi sinyal khas chat tidak berlaku:
    // adminActive/recentComplaint hanya bermakna untuk foto tak diminta yang masuk ke WhatsApp.
    // Yang tetap kita hormati adalah gerbang uangnya (step 6) — itu justru inti alur ini.
    const decision = await service.evaluateIntake({
        user: customer,
        caption,
        adminActive: false,
        signalReady: true,
        recentComplaint: false
    });

    if (decision.action !== ACTION.CAPTURE) {
        return sendError(
            res,
            decision.ackText || "Bukti pembayaran tidak dapat diproses saat ini.",
            paymentProofRejectionStatus(decision.reason)
        );
    }

    // handleIncomingProof memakai JID ini sebagai target notifikasi hasil konfirmasi. Harus lewat
    // getCustomerJids: phone_number bisa berisi banyak nomor dipisah '|', dan getCustomerJid() pada
    // string seperti itu menormalkan keseluruhannya jadi nomor sampah.
    const BaseService = require('../../lib/services/base-service');
    const [canonicalSender] = BaseService.getCustomerJids(customer.phone_number);
    if (!canonicalSender) {
        return sendError(res, "Nomor WhatsApp Anda belum terdaftar. Hubungi admin terlebih dahulu.", 422);
    }

    const { record, ackText } = await service.handleIncomingProof({
        user: customer,
        canonicalSender,
        pushname: customer.name,
        messageType: req.file.mimetype === 'application/pdf' ? 'documentMessage' : 'imageMessage',
        buffer: req.file.buffer,
        caption,
        billing: decision.billing, // pakai ulang snapshot: gerbang & record berdiri di angka yang sama
        intakeReason: decision.reason,
        advance: decision.advance
    });

    return sendSuccess(res, {
        id: record.id,
        status: record.status,
        type: 'tagihan'
    }, ackText, 201);
}

// Satu-satunya definisi "permintaan SOD yang menunggu bukti bayar". Dipakai bersama oleh endpoint
// baca dan endpoint upload — kalau keduanya punya filter sendiri, UI bisa menampilkan kotak upload
// untuk permintaan yang justru ditolak POST-nya (atau sebaliknya).
//
// KEPEMILIKAN: speed_requests.userId hidup di ruang id global.users — ruang yang SAMA dengan
// req.customer.id. JANGAN tiru routes/speed-requests.js:110 (`request.userId === req.user.id`):
// req.user berasal dari accounts.json (staf), sekuens id berbeda yang nilainya bisa bertabrakan.
// Bentuk di bawah mengikuti cek yang sudah dipakai speed-request-service.js:180.
function findSpeedRequestAwaitingProof(customerId) {
    return (global.speed_requests || []).find((item) =>
        String(item.userId) === String(customerId) &&
        item.status === 'pending' &&
        ['cash', 'transfer'].includes(item.paymentMethod) &&
        item.paymentStatus === 'unpaid'
    ) || null;
}

async function handleSodPaymentProof(req, res, customer, caption) {
    const { getUploadDir, getUploadPath, generateFilename } = require('../../lib/upload-helper');

    const pendingRequest = findSpeedRequestAwaitingProof(customer.id);

    if (!pendingRequest) {
        return sendError(res, "Tidak ada permintaan Speed On Demand yang menunggu bukti pembayaran.", 404);
    }

    const extension = req.file.mimetype === 'application/pdf' ? '.pdf' : '.jpg';
    // Nama file diturunkan dari requestId + timestamp, bukan dari req.file.originalname yang dikirim
    // klien. Konvensi path memakai getUploadDir/getUploadPath — pasangan yang konsisten. Handler
    // WhatsApp (speed-payment-handler.js:103) menulis ke static/uploads/ tapi menyimpan '/uploads/...',
    // sehingga URL tersimpannya 404; jangan ikut pola itu.
    const filename = generateFilename('payment', pendingRequest.id, `proof${extension}`);
    fs.writeFileSync(path.join(getUploadDir('speed-requests'), filename), req.file.buffer);

    const requestIndex = global.speed_requests.findIndex((item) => item.id === pendingRequest.id);
    const request = global.speed_requests[requestIndex];
    const now = new Date().toISOString();

    request.paymentProof = getUploadPath('speed-requests', filename);
    request.paymentStatus = 'pending'; // menunggu verifikasi admin; request.status tidak disentuh
    request.paymentNotes = caption || 'Upload via portal';
    request.paymentDate = now;
    request.updatedAt = now;
    saveSpeedRequests();

    // Notif admin best-effort — kegagalan kirim tidak boleh menggagalkan bukti yang sudah tercatat.
    if (hasAuthenticatedSession() && Array.isArray(global.config.ownerNumber)) {
        try {
            const notifMessage = renderResponseTemplate('routes_speed_payment_proof_owner_notification', {
                customerName: request.userName || customer.name,
                requestedPackage: request.requestedPackageName,
                duration: String(request.durationKey || '').replace('_', ' '),
                price: `Rp ${Number(request.price || 0).toLocaleString('id-ID')}`,
                paymentMethod: request.paymentMethod,
                paymentNotes: request.paymentNotes || '-'
            });
            const delivery = await sendMessageToMany(global.config.ownerNumber, { text: notifMessage });
            if (!delivery.sent) {
                logger.error('[PAYMENT_PROOF_SOD_NOTIF_ERROR]', delivery.errorCode || 'SEND_FAILED');
            }
        } catch (error) {
            logger.error('[PAYMENT_PROOF_SOD_NOTIF_ERROR]', error.message);
        }
    }

    return sendSuccess(res, {
        id: request.id,
        status: request.paymentStatus,
        type: 'sod'
    }, "Bukti pembayaran berhasil diupload. Menunggu verifikasi admin.", 201);
}
const customerApiRouter = express.Router();
customerApiRouter.use(ensureCustomerAuthenticated);

customerApiRouter.get('/profile', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const profileData = await CustomerService.getProfile(customer, req);
    return sendSuccess(res, profileData, "Profile berhasil diambil");
}));

customerApiRouter.get('/traffic-usage/status', asyncHandler(async (req, res) => {
    const status = CustomerTrafficUsageService.getFeatureStatus();
    return sendSuccess(
        res,
        status,
        status.enabled ? 'Traffic pelanggan tersedia' : 'Traffic pelanggan tidak tersedia'
    );
}));

customerApiRouter.get('/traffic-usage', asyncHandler(async (req, res) => {
    if (!CustomerTrafficUsageService.isFeatureEnabled()) {
        return res.status(503).json({
            status: 503,
            message: 'Traffic usage tidak tersedia saat ini.',
            data: {
                hasPppoe: false,
                pppoeUsername: null,
                today: { downloadBytes: 0, uploadBytes: 0, totalBytes: 0 },
                currentMonth: { downloadBytes: 0, uploadBytes: 0, totalBytes: 0 },
                dailyHistory: [],
                lastCollectedAt: null,
                stale: false
            }
        });
    }

    const usage = await CustomerTrafficUsageService.getCustomerUsage(req.customer);
    return sendSuccess(res, usage, 'Traffic usage berhasil diambil');
}));

customerApiRouter.get('/traffic-live', asyncHandler(async (req, res) => {
    const featureStatus = CustomerTrafficUsageService.getFeatureStatus();
    if (!featureStatus.liveEnabled) {
        return res.status(503).json({
            status: 503,
            message: 'Bandwidth live tidak tersedia saat ini.',
            data: {
                hasPppoe: false,
                pppoeUsername: null,
                online: false,
                downloadBps: 0,
                uploadBps: 0,
                downloadHuman: '0 bps',
                uploadHuman: '0 bps',
                interfaceName: null,
                lastSampleAt: null,
                sampleIntervalMs: null,
                stale: false,
                warmup: false
            }
        });
    }

    const liveTraffic = await CustomerTrafficUsageService.getCustomerLiveUsage(req.customer);
    return sendSuccess(res, liveTraffic, 'Bandwidth live berhasil diambil');
}));

customerApiRouter.get('/reports/history', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const reportHistory = await ReportService.getReportHistory(customer, req);
    return sendSuccess(res, reportHistory, "Riwayat laporan berhasil diambil");
}));

customerApiRouter.post('/request-package-change', asyncHandler(async (req, res) => {
    const { targetPackageName } = req.body;
    const customer = req.customer;
    
    const result = await CustomerService.requestPackageChange(customer, targetPackageName, req);
    
    return sendSuccess(res, null, result.message, 201);
}));

customerApiRouter.get('/package-change-requests/history', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const history = await CustomerService.getPackageChangeHistory(customer, req);
    return sendSuccess(res, history, "Riwayat permintaan perubahan paket berhasil diambil");
}));

customerApiRouter.get('/packages', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const packages = await CustomerService.getAvailablePackages(customer, req);
    return sendSuccess(res, packages, "Daftar paket bulanan berhasil diambil");
}));

// ===== Beli voucher hotspot dari panel pelanggan (QRIS iPaymu, tag `buynowpanel`) =====
// Nomor HP SELALU dari `req.customer`, tidak pernah dari body — kalau tidak, pelanggan bisa
// membebankan pembelian atas nama nomor lain. Fulfillment ada di POST /callback/payment.

customerApiRouter.get('/vouchers/status', asyncHandler(async (req, res) => {
    // Probe ketersediaan fitur untuk panel (menyembunyikan menu bila operator belum
    // mengaktifkan), sekaligus mengirim tarif biaya admin QRIS dan nomor tujuan kode —
    // keduanya dipakai layar konfirmasi SEBELUM transaksi dibuat.
    const status = customerVoucherService.getFeatureStatus({ customer: req.customer });
    return sendSuccess(
        res,
        status,
        status.enabled ? 'Pembelian voucher tersedia' : 'Pembelian voucher tidak tersedia'
    );
}));

customerApiRouter.get('/vouchers/packages', asyncHandler(async (req, res) => {
    if (!customerVoucherService.isEnabled()) {
        return sendError(res, 'Pembelian voucher belum tersedia saat ini.', 503);
    }
    return sendSuccess(res, customerVoucherService.listPackages(), 'Daftar paket voucher berhasil diambil');
}));

customerApiRouter.post('/vouchers/purchase', voucherPurchaseRateLimiter, asyncHandler(async (req, res) => {
    const result = await customerVoucherService.createPurchase({
        customer: req.customer,
        prof: req.body?.prof,
        qty: req.body?.qty,
        // Kredensial kustom (#b405) — opsional; gate + cek duplikat ada di service.
        customUser: req.body?.customUser,
        customPass: req.body?.customPass
    });
    if (!result.ok) {
        return sendError(res, result.message, result.status);
    }
    return sendSuccess(res, result.data, 'Transaksi berhasil dibuat. Selesaikan pembayaran QRIS.', 201);
}));

// Probe ketersediaan username kustom untuk UX form (#b405). Rate-limit beli ikut dipakai
// supaya tak jadi oracle enumerasi; validasi final tetap di POST /purchase dalam lock.
customerApiRouter.get('/vouchers/check-user', voucherPurchaseRateLimiter, asyncHandler(async (req, res) => {
    const result = await customerVoucherService.checkUsername({ name: req.query?.name });
    if (!result.ok) {
        return sendError(res, result.message, result.status);
    }
    return sendSuccess(res, result.data, 'Username tersedia');
}));

customerApiRouter.get('/vouchers/purchase/:reff', asyncHandler(async (req, res) => {
    const result = customerVoucherService.getPurchaseStatus({
        customer: req.customer,
        reff: req.params.reff
    });
    if (!result.ok) {
        return sendError(res, result.message, result.status);
    }
    return sendSuccess(res, result.data, 'Status transaksi berhasil diambil');
}));

customerApiRouter.get('/vouchers/history', asyncHandler(async (req, res) => {
    const result = customerVoucherService.listHistory({
        customer: req.customer,
        limit: req.query.limit
    });
    return sendSuccess(res, result.data, 'Riwayat pembelian voucher berhasil diambil');
}));

customerApiRouter.post('/account/update', asyncHandler(async (req, res) => {
    const { currentPassword, newUsername, newPassword } = req.body;
    const customer = req.customer;
    
    const result = await CustomerService.updateAccount(customer, {
        currentPassword,
        newUsername,
        newPassword
    }, req);
    
    return sendSuccess(res, null, result.message);
}));

// Phone Number Management Endpoints untuk Customer
customerApiRouter.get('/phone-numbers', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const phoneNumbers = await CustomerService.getPhoneNumbers(customer, req);
    return sendSuccess(res, phoneNumbers, "Daftar nomor HP berhasil diambil");
}));

customerApiRouter.post('/phone-numbers/add', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { phoneNumber } = req.body;
    
    // Validation
    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim() === '') {
        return sendError(res, "Nomor HP tidak boleh kosong.", 400);
    }
    
    const result = await CustomerService.addPhoneNumber(customer, phoneNumber, req);
    return sendSuccess(res, result, result.message);
}));

customerApiRouter.delete('/phone-numbers/:phoneNumber', asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { phoneNumber } = req.params;
    
    // Validation
    if (!phoneNumber || phoneNumber.trim() === '') {
        return sendError(res, "Nomor HP tidak boleh kosong.", 400);
    }
    
    // Decode URL-encoded phone number
    const decodedPhoneNumber = decodeURIComponent(phoneNumber);
    
    const result = await CustomerService.removePhoneNumber(customer, decodedPhoneNumber, req);
    return sendSuccess(res, result, result.message);
}));

// WiFi Management Endpoints untuk Customer
customerApiRouter.get('/wifi/info', wifiRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const skipRefresh = req.query.skipRefresh === 'true'; // Optional: skip refresh untuk performa
    
    const wifiInfo = await WifiService.getCustomerWifiInfo(customer, req, skipRefresh);
    return sendSuccess(res, wifiInfo, "Info WiFi berhasil diambil");
}));

customerApiRouter.get('/wifi/connected-devices', wifiRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const skipRefresh = req.query.skipRefresh === 'true'; // Optional: skip refresh untuk performa
    
    const connectedDevices = await WifiService.getConnectedDevices(customer, req, skipRefresh);
    return sendSuccess(res, connectedDevices, "Data device terkoneksi berhasil diambil");
}));

customerApiRouter.post('/wifi/update-name', wifiWriteRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { ssidIndex = 1, newName } = req.body;
    
    // Validation
    if (!newName || typeof newName !== 'string' || newName.trim() === '') {
        return sendError(res, "Nama WiFi tidak boleh kosong.", 400);
    }
    
    if (newName.length < 3 || newName.length > 32) {
        return sendError(res, "Nama WiFi harus antara 3-32 karakter.", 400);
    }
    
    // Validasi SSID index (1-8 untuk dual band)
    const parsedIndex = parseInt(ssidIndex);
    if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
        return sendError(res, "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).", 400);
    }
    
    const result = await WifiService.updateCustomerWifiName(customer, ssidIndex, newName, req);
    // #b323: applied:false = perubahan BELUM terkonfirmasi di perangkat (task diantre 202 / readback
    // timeout). Jangan bilang "berhasil" (pelanggan cari SSID baru, tak ketemu, telepon CS). Pesan jujur.
    const msgName = (result && result.pending)
        ? "Perubahan nama WiFi sedang diproses — belum terkonfirmasi di perangkat. Nama baru akan aktif beberapa saat lagi; kalau belum muncul, coba ulangi."
        : "Nama WiFi berhasil diubah";
    return sendSuccess(res, result, msgName);
}));

customerApiRouter.post('/wifi/update-password', wifiWriteRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { ssidIndex = 1, newPassword } = req.body;
    
    // Validation
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim() === '') {
        return sendError(res, "Password WiFi harus diisi.", 400);
    }
    
    if (newPassword.length < 8 || newPassword.length > 63) {
        return sendError(res, "Password WiFi harus antara 8-63 karakter.", 400);
    }
    
    // Validasi SSID index (1-8 untuk dual band)
    const parsedIndex = parseInt(ssidIndex);
    if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
        return sendError(res, "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).", 400);
    }
    
    const result = await WifiService.updateCustomerWifiPassword(customer, ssidIndex, newPassword, req);
    return sendSuccess(res, result, "Password WiFi berhasil diubah");
}));

customerApiRouter.put('/wifi/update', wifiWriteRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { ssidIndex = 1, newName, newPassword } = req.body;
    
    // Validation
    if (!newName && !newPassword) {
        return sendError(res, "Minimal harus ada nama WiFi atau password yang diubah.", 400);
    }
    
    if (newName && (newName.length < 3 || newName.length > 32)) {
        return sendError(res, "Nama WiFi harus antara 3-32 karakter.", 400);
    }
    
    if (newPassword && (newPassword.length < 8 || newPassword.length > 63)) {
        return sendError(res, "Password WiFi harus antara 8-63 karakter.", 400);
    }
    
    // Validasi SSID index (1-8 untuk dual band)
    const parsedIndex = parseInt(ssidIndex);
    if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > 8) {
        return sendError(res, "SSID index harus antara 1-8 (4 untuk 2.4GHz dan 4 untuk 5GHz).", 400);
    }
    
    const result = await WifiService.updateCustomerWifi(customer, ssidIndex, { newName, newPassword }, req);
    // #b323: sama seperti ganti nama — applied:false = belum terverifikasi, jangan klaim sukses polos.
    const msgWifi = (result && result.pending)
        ? "Perubahan WiFi sedang diproses — belum terkonfirmasi di perangkat. Akan aktif beberapa saat lagi; kalau belum, coba ulangi."
        : "WiFi berhasil diupdate";
    return sendSuccess(res, result, msgWifi);
}));

customerApiRouter.post('/wifi/reboot', wifiWriteRateLimiter, asyncHandler(async (req, res) => {
    const customer = req.customer;

    const result = await WifiService.rebootCustomerRouter(customer, req);
    return sendSuccess(res, result, result.message || "Perintah reboot berhasil dikirim");
}));

// Permintaan SOD yang menunggu bukti bayar. formatSpeedRequest() tidak membawa paymentStatus/
// paymentMethod, jadi /speed-requests/history tidak bisa menjawab ini — dan /active hanya melihat
// status 'active'. Portal butuh tahu ini supaya pelanggan yang menutup tab masih punya jalan kembali
// untuk mengunggah bukti.
customerApiRouter.get('/speed-requests/awaiting-proof', asyncHandler(async (req, res) => {
    const pending = findSpeedRequestAwaitingProof(req.customer.id);

    if (!pending) {
        return sendSuccess(res, null, "Tidak ada permintaan yang menunggu bukti pembayaran.");
    }

    return sendSuccess(res, {
        id: pending.id,
        requestedPackageName: pending.requestedPackageName,
        durationKey: pending.durationKey,
        price: pending.price,
        paymentMethod: pending.paymentMethod,
        createdAt: pending.createdAt
    }, "Permintaan menunggu bukti pembayaran.");
}));

// --- BUKTI BAYAR PELANGGAN (portal) ---
// Sebelum ini pelanggan HANYA bisa mengirim bukti lewat chat WhatsApp; portal tidak punya jalur sama
// sekali, padahal /api/request-speed sudah menjanjikan "silakan upload bukti pembayaran". Satu endpoint
// melayani dua alur lewat `type` — keduanya mendelegasikan ke mesin yang sudah ada, BUKAN menyalin
// aturannya (khususnya gerbang uang di payment-proof-intake-policy).
customerApiRouter.post('/payment-proof', paymentProofRateLimiter, handlePaymentProofUpload, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const type = String(req.body.type || '').trim().toLowerCase();

    if (!['tagihan', 'sod'].includes(type)) {
        return sendError(res, "Jenis bukti tidak valid. Gunakan 'tagihan' atau 'sod'.", 400);
    }
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
        return sendError(res, "File bukti harus diupload.", 400);
    }

    // Caption diteruskan APA ADANYA. Jangan pernah mengarang caption bernuansa "bayar" di sini:
    // gerbang uang (intake-policy step 6) sengaja mensyaratkan niat bayar-di-muka DIKATAKAN pelanggan,
    // bukan diterka sistem. Caption sintetis akan membuat setiap pelanggan nol-tagihan lolos jadi
    // "pembayaran di muka" — persis lubang yang gerbang itu tutup.
    const caption = String(req.body.caption || '').trim();

    if (type === 'sod') {
        return handleSodPaymentProof(req, res, customer, caption);
    }
    return handleTagihanPaymentProof(req, res, customer, caption);
}));

// --- RIWAYAT untuk portal pelanggan (NextJS) ---
// Read-only. Keduanya memakai req.customer (dari ensureCustomerAuthenticated),
// jadi pelanggan hanya bisa melihat riwayatnya sendiri.
function runCustomerReadQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!global.db || typeof global.db.all !== 'function') {
            reject(new Error('Database belum siap'));
            return;
        }
        global.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

// Riwayat tagihan/pembayaran pelanggan (dari payment_history).
customerApiRouter.get('/billing-history', asyncHandler(async (req, res) => {
    const rows = await runCustomerReadQuery(
        `SELECT id, amount_due, amount_paid, amount_remaining, payment_method,
                is_partial, period_month, period_year, notes, created_at
           FROM payment_history
          WHERE user_id = ?
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT 100`,
        [req.customer.id]
    );

    const data = rows.map((row) => ({
        id: row.id,
        periodMonth: row.period_month,
        periodYear: row.period_year,
        amountDue: row.amount_due,
        amountPaid: row.amount_paid,
        amountRemaining: row.amount_remaining,
        paymentMethod: row.payment_method || null,
        isPartial: !!row.is_partial,
        status: row.amount_remaining && row.amount_remaining > 0 ? 'partial' : 'paid',
        notes: row.notes || null,
        createdAt: row.created_at
    }));

    return sendSuccess(res, data, "Riwayat tagihan berhasil diambil");
}));

// Riwayat perubahan WiFi (nama & sandi).
// SECURITY: nilai password WiFi TIDAK PERNAH dikembalikan ke klien — hanya fakta
// bahwa sandi diubah. Nama SSID lama/baru boleh ditampilkan (bukan rahasia).
customerApiRouter.get('/wifi/change-history', asyncHandler(async (req, res) => {
    const { getWifiChangeLogs } = require('../../lib/wifi-logger');
    const result = await getWifiChangeLogs({ userId: req.customer.id, limit: 100 });
    const logs = Array.isArray(result && result.logs) ? result.logs : [];

    const SOURCE_LABEL = {
        web_admin: 'Admin', web_technician: 'Teknisi', web_customer: 'Portal Pelanggan',
        wa_bot: 'WhatsApp', api: 'Sistem'
    };
    const TYPE_LABEL = {
        ssid_name: 'Nama WiFi', password: 'Kata Sandi WiFi',
        both: 'Nama & Sandi WiFi', transmit_power: 'Daya Pancar'
    };

    const data = logs.map((log) => {
        const type = log.changeType;
        const firstSsid = log.changes && Array.isArray(log.changes.ssidEntries)
            ? log.changes.ssidEntries[0]
            : null;
        let description;
        if (type === 'ssid_name') {
            description = firstSsid ? `Nama WiFi diubah menjadi "${firstSsid.newValue}"` : 'Nama WiFi diperbarui';
        } else if (type === 'password') {
            description = 'Kata sandi WiFi diperbarui';
        } else if (type === 'both') {
            description = firstSsid ? `Nama WiFi menjadi "${firstSsid.newValue}" & kata sandi diperbarui` : 'Nama & kata sandi WiFi diperbarui';
        } else if (type === 'transmit_power') {
            description = `Daya pancar diubah ke ${(log.changes && log.changes.newTransmitPower) || '-'}`;
        } else {
            description = 'Perubahan WiFi';
        }
        return {
            id: log.id,
            timestamp: log.timestamp,
            type,
            typeLabel: TYPE_LABEL[type] || 'Perubahan WiFi',
            description,
            source: log.changeSource,
            sourceLabel: SOURCE_LABEL[log.changeSource] || log.changeSource
        };
    });

    return sendSuccess(res, data, "Riwayat perubahan WiFi berhasil diambil");
}));

router.use('/api/customer', customerApiRouter);

// Additional customer endpoints for NextJS frontend
router.get('/api/customer/speed-requests/active', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const customer = req.customer;
    
    const activeRequest = await SpeedRequestService.getActiveRequest(customer, req);
    
    if (!activeRequest) {
        return sendSuccess(res, null, "Tidak ada speed boost yang aktif.");
    }
    
    return sendSuccess(res, activeRequest, "Speed boost aktif berhasil diambil");
}));

router.get('/api/customer/speed-requests/history', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const requestHistory = await SpeedRequestService.getRequestHistory(customer, req);
    return sendSuccess(res, requestHistory, "Riwayat speed boost berhasil diambil");
}));

router.post('/api/customer/speed-requests/cancel', ensureCustomerAuthenticated, cancelSpeedRequestValidation, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const { requestId } = req.body;
    
    const result = await SpeedRequestService.cancelRequest(customer, requestId, req);
    return sendSuccess(res, null, result.message);
}));

// GET /api/customer/speed-boost/status - Check if Speed On Demand is enabled
router.get('/api/customer/speed-boost/status', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const isEnabled = SpeedRequestService.isFeatureEnabled();
    return sendSuccess(res, { enabled: isEnabled }, isEnabled ? "Speed On Demand tersedia" : "Speed On Demand tidak tersedia");
}));

router.get('/api/customer/speed-boost/available', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const availablePackages = await SpeedRequestService.getAvailableSpeedBoosts(customer);
    
    if (availablePackages.length === 0) {
        // Check if feature is disabled
        if (!SpeedRequestService.isFeatureEnabled()) {
            return sendSuccess(res, [], "Speed Boost sedang tidak tersedia saat ini");
        }
        return sendSuccess(res, [], "Tidak ada paket speed boost yang tersedia untuk paket Anda saat ini");
    }
    
    return sendSuccess(res, availablePackages, "Daftar paket speed boost berhasil diambil");
}));

router.get('/api/dashboard-status', ensureCustomerAuthenticated, asyncHandler(async (req, res) => {
    const customer = req.customer;
    const dashboardData = await PublicService.getDashboardStatus(customer);
    setSensitiveResponseHeaders(res);
    return sendSuccess(res, dashboardData, "Status dashboard berhasil diambil");
}));

module.exports = router;
