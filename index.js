process.env.TZ = 'Asia/Jakarta';

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const phpExpress = require('php-express')({
    binPath: 'php'
});
const qrcode = require('qrcode');
const P = require('pino');
const Boom = require('@hapi/boom');
// HTTPS enforcement removed - Cloudflare Tunnel handles HTTPS

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise);
    console.error('   Reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('   Stack:', error.stack);
    console.log('🔄 Restarting process due to uncaught exception...');
    process.exit(1);
});

process.on('SIGTERM', async () => {
    console.log('📴 SIGTERM received, shutting down gracefully...');
    
    try {
        // Stop OLT Log Scraper
        try {
            const oltLogScraper = require('./lib/olt-log-scraper');
            oltLogScraper.stopScraper();
            console.log('   Stopping OLT log scraper...');
        } catch (err) {
            // Ignore if not loaded
        }
        
        if (global.sock && typeof global.sock.logout === 'function') {
            console.log('   Closing WhatsApp connection...');
            await global.sock.logout();
        }
        
        if (global.db && typeof global.db.close === 'function') {
            console.log('   Closing database connection...');
            await global.db.close();
        }
        
        const { closeLogsDatabase } = require('./lib/activity-logger');
        try {
            await closeLogsDatabase();
            console.log('   Closing logs database connection...');
        } catch (err) {
            console.error('   Error closing logs database:', err);
        }
        
        console.log('✅ Graceful shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGINT', async () => {
    console.log('\n📴 SIGINT received (Ctrl+C), shutting down...');
    
    try {
        if (global.sock && typeof global.sock.logout === 'function') {
            await global.sock.logout();
        }
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
});

global.conn = null;
global.whatsappConnectionState = 'close';
global.users = [];
global.packages = [];
global.reports = [];
global.compensations = [];
global.speed_requests = [];
global.packageChangeRequests = [];
global.accounts = [];
global.payment = [];
global.paymentMethod = [];
global.statik = [];
global.voucher = [];
global.atm = [];
global.networkAssets = [];
global.cronConfig = {};

try {
    const { loadConfig, validateEnvironment } = require('./lib/env-config');
    global.config = loadConfig();
    
    try {
        const validationResult = validateEnvironment();
        if (validationResult.warnings && validationResult.warnings.length > 0) {
            console.log(`[ENV_INFO] Environment validation passed with ${validationResult.warnings.length} warning(s) - auto-migration will handle database relocation`);
        }
    } catch (e) {
        const isCriticalError = !e.message.includes('old location') && !e.message.includes('auto-migrated');
        if (isCriticalError && process.env.NODE_ENV === 'production') {
            console.error(`[ENV_ERROR] Critical environment validation failed: ${e.message}`);
            process.exit(1);
        } else {
            console.warn(`[ENV_WARN] Environment validation warning: ${e.message} (will attempt auto-migration)`);
        }
    }
} catch (e) {
    console.warn(`[CONFIG_FALLBACK] Using legacy config loading: ${e.message}`);
    global.config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
}
const { initializeDatabase, loadJSON, saveJSON } = require('./lib/database');
const { authCache } = require('./lib/auth-cache');
const { initializeAllCronTasks } = require('./lib/cron');
const { initializeUploadDirs } = require('./lib/upload-helper');
const msgHandler = require('./message/raf');

const ErrorRecovery = require('./lib/error-recovery');
const MonitoringService = require('./lib/monitoring-service');
const AlertSystem = require('./lib/alert-system');
const oltLogScraper = require('./lib/olt-log-scraper');

global.errorRecovery = new ErrorRecovery();
global.monitoring = new MonitoringService();
global.alertSystem = new AlertSystem();
global.db = null;
global.io = null;

const app = express();
const PORT = process.env.PORT || 3100;
const config = global.config;

// ============================================
// SECURITY MIDDLEWARE (CRITICAL)
// ============================================

// 1. HTTPS Enforcement - REMOVED
// Cloudflare Tunnel akan menangani HTTPS di level reverse proxy
// Aplikasi hanya berjalan di HTTP, tidak ada HTTPS enforcement

// 2. Security Headers (Helmet.js)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, etc.)
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", "https://unpkg.com"], // Allow source map requests
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: null, // Disabled - Cloudflare Tunnel handles HTTPS
        },
    },
    hsts: false, // Disabled - Cloudflare Tunnel handles HTTPS
    crossOriginEmbedderPolicy: false, // Allow embedding if needed
    crossOriginResourcePolicy: { policy: "cross-origin" } // Allow resources from other origins
}));

// 3. Global Rate Limiting
// PENTING: Skip rate limiting untuk authenticated users (admin/staff/customer)
// Authenticated users perlu lebih banyak request untuk dashboard dan halaman admin
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // PENTING: Tingkatkan limit menjadi 300 untuk mengakomodasi dashboard monitoring
    // Dashboard monitoring melakukan banyak request (monitoring setiap 5-10 detik)
    // 300 requests per 15 menit = ~20 requests per menit (cukup untuk dashboard yang aktif)
    message: {
        status: 429,
        message: 'Terlalu banyak permintaan dari IP ini, silakan coba lagi nanti.'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skip: (req) => {
        // Skip rate limiting for static files
        if (req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i)) {
            return true;
        }
        // PENTING: Skip rate limiting untuk monitoring endpoints
        // Monitoring endpoints melakukan banyak request untuk real-time updates
        // dan tidak perlu rate limiting karena sudah public atau authenticated
        const monitoringPaths = [
            '/api/monitoring/live',
            '/api/monitoring/live-data',
            '/api/monitoring/traffic-history',
            '/api/monitoring/health',
            '/api/monitoring/traffic',
            '/api/monitoring/users',
            '/api/monitoring/history',
            '/api/stats'
        ];
        if (monitoringPaths.some(path => req.path.startsWith(path))) {
            return true;
        }
        // Skip rate limiting untuk authenticated users (admin/staff/customer)
        // Authenticated users perlu lebih banyak request untuk dashboard dan halaman admin
        if (req.user || req.customer) {
            return true;
        }
        return false;
    }
});

// Stricter rate limiter untuk authentication endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: {
        status: 429,
        message: 'Terlalu banyak percobaan login, silakan coba lagi dalam 15 menit.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful requests
});

// ============================================
// STANDARD MIDDLEWARE
// ============================================

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser('rweutkhdrt'));

app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/vendor', express.static(path.join(__dirname, 'static/vendor')));
app.use('/css', express.static(path.join(__dirname, 'static/css')));
app.use('/js', express.static(path.join(__dirname, 'static/js')));
app.use('/img', express.static(path.join(__dirname, 'static/img')));
app.use('/temp', express.static(path.join(__dirname, 'temp')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(async (req, res, next) => {
    if(req.path.match(/\.(jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$/i)) {
        return next();
    }
    
    if(req.url.match(/.+\.php/)) {
        return next();
    }
    
    const publicPaths = [
        '/login',
        '/api/login',
        '/api/otp',
        '/api/otpverify',
        '/api/customer/login',
        '/api/auth/login',
        '/api/auth/otp/request',
        '/api/auth/otp/verify',
        '/app/',
        '/callback/payment',
        '/api/wifi-name',
        '/api/packages',
        '/api/speed-boost/packages',
        '/api/monitoring/live-data',
        '/api/monitoring/traffic-history',
        '/api/monitoring/live',
        '/api/monitoring/health',
        '/api/monitoring/traffic',
        '/api/monitoring/users',
        '/api/monitoring/history',
        '/.well-known/'
    ];
    
    // Special handling untuk announcements dan news: hanya GET yang public
    const isPublicAnnouncementsOrNews = (req.method === 'GET' && (
        req.path === '/api/announcements' || 
        req.path === '/api/news' ||
        req.path.startsWith('/api/announcements/recent') ||
        req.path.startsWith('/api/news/recent')
    ));
    
    const isPublicPath = isPublicAnnouncementsOrNews || publicPaths.some(p => {
        if (req.path === p) return true;
        if (p.endsWith('/')) {
            return req.path.startsWith(p);
        }
        return req.path.startsWith(p + '/');
    });
    
    if (isPublicPath) {
        return next();
    }
    
    let token = null;
    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    } else if (req.headers && req.headers.authorization) {
        token = req.headers.authorization.replace('Bearer ', '').trim();
    }
    
    if (!global.authLogCache) {
        global.authLogCache = new Set();
        setInterval(() => {
            global.authLogCache.clear();
        }, 3600000);
    }
    
    if (token) {
        try {
            // Gunakan cache untuk JWT verification
            const decoded = authCache.getJWTVerification(token, () => {
                return jwt.verify(token, config.jwt);
            });
            
            if (!decoded) {
                throw new Error('Token verification failed');
            }
            
            if (decoded.role) {
                // Reload accounts dengan debounce jika kosong
                if (!global.accounts || !Array.isArray(global.accounts) || global.accounts.length === 0) {
                    console.log(`[AUTH_ERROR] global.accounts not initialized or empty. Attempting reload. Path: ${req.path}`);
                    try {
                        const reloadedAccounts = await authCache.reloadAccounts();
                        if (reloadedAccounts && Array.isArray(reloadedAccounts)) {
                            global.accounts = reloadedAccounts;
                            console.log(`[AUTH_FIX] Reloaded global.accounts. New length: ${global.accounts ? global.accounts.length : 0}`);
                        }
                    } catch (reloadErr) {
                        console.error(`[AUTH_CRITICAL] Failed to reload accounts.json:`, reloadErr);
                    }
                }
                
                // Gunakan cache untuk account lookup
                let account = authCache.getAccountById(decoded.id, () => {
                    if (global.accounts && Array.isArray(global.accounts) && global.accounts.length > 0) {
                        return global.accounts.find(acc => String(acc.id) === String(decoded.id));
                    }
                    return null;
                });
                
                // Jika tidak ditemukan, coba reload sekali lagi (tanpa debounce untuk retry)
                if (!account) {
                    try {
                        const reloadedAccounts = loadJSON("accounts.json");
                        if (reloadedAccounts && Array.isArray(reloadedAccounts)) {
                            global.accounts = reloadedAccounts;
                            // Clear cache untuk id ini dan cari lagi
                            authCache.invalidateAccount(decoded.id);
                            account = authCache.getAccountById(decoded.id, () => {
                                return global.accounts.find(acc => String(acc.id) === String(decoded.id));
                            });
                        }
                    } catch (retryErr) {
                        console.error(`[AUTH_RETRY_ERROR] Failed to reload accounts during retry:`, retryErr);
                    }
                }
                
                if (account) {
                    req.user = {
                        id: account.id,
                        username: account.username,
                        name: account.name || account.username,
                        role: account.role,
                        photo: account.photo || null
                    };
                    const cacheKey = `admin_${account.id}`;
                    if (!global.authLogCache.has(cacheKey)) {
                        console.log(`[AUTH] Admin ${account.username} (${account.role}) authenticated. Path: ${req.path}`);
                        global.authLogCache.add(cacheKey);
                    }
                } else {
                    console.log(`[AUTH_FAIL] Account not found for ID ${decoded.id}. Path: ${req.path}. Available accounts: ${global.accounts ? global.accounts.length : 0}`);
                }
            } else if (decoded.name) {
                // Gunakan cache untuk user lookup
                const customer = authCache.getUserById(decoded.id, () => {
                    return global.users.find(u => String(u.id) === String(decoded.id));
                });
                
                if (customer) {
                    req.customer = customer;
                    const cacheKey = `customer_${customer.id}`;
                    if (!global.authLogCache.has(cacheKey)) {
                        console.log(`[AUTH] Customer ${customer.name} authenticated`);
                        global.authLogCache.add(cacheKey);
                    }
                } else {
                    console.log(`[AUTH_FAIL] Customer not found for ID ${decoded.id}. Path: ${req.path}`);
                }
            } else {
                console.log(`[AUTH_ERROR] Token decoded but missing required fields (role/name). Path: ${req.path}`);
                res.cookie("token", "", { httpOnly: true, maxAge: 0, path: "/" });
            }
        } catch (err) {
            console.log(`[AUTH_ERROR] Invalid token. Error: ${err.message}. Path: ${req.path}`);
            if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
                res.cookie("token", "", { httpOnly: true, maxAge: 0, path: "/" });
            }
        }
    }
    
    if (req.user || req.customer) {
        return next();
    }
    
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ status: 401, message: "Unauthorized" });
    }
    
    if (req.path === '/login') {
        return next();
    }
    
    if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(401).json({ status: 401, message: "Unauthorized" });
    }
    
    console.log(`[AUTH_REDIRECT_GUEST] No token and not a public path. Path: ${req.path}. Redirecting to /login.`);
    return res.redirect("/login");
}); 

// ============================================
// RATE LIMITING (SETELAH AUTHENTICATION)
// ============================================
// PENTING: Rate limiting harus SETELAH authentication middleware
// agar req.user dan req.customer sudah di-set sebelum rate limiter dijalankan

// Apply global rate limiting to all API routes
// Skip untuk authenticated users (req.user atau req.customer sudah di-set oleh auth middleware)
app.use('/api/', globalLimiter);

// Apply stricter rate limiting to authentication endpoints
app.use('/api/login', authLimiter);
app.use('/api/customer/login', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/otp/request', authLimiter);

// 6. Routers - Import all route modules
const publicApiRouter = require('./routes/public');
const adminApiRouter = require('./routes/admin');
const apiRouter = require('./routes/api');
const ticketsRouter = require('./routes/tickets');
const invoiceRouter = require('./routes/invoice');
const paymentStatusRouter = require('./routes/payment-status');
const requestsRouter = require('./routes/requests');
const compensationRouter = require('./routes/compensation');
const speedRequestsRouter = require('./routes/speed-requests');
const statsRouter = require('./routes/stats');
const usersRouter = require('./routes/users');
const accountsRouter = require('./routes/accounts');
const packagesRouter = require('./routes/packages');
const saldoRouter = require('./routes/saldo');
const agentsRouter = require('./routes/agents');
const pagesRouter = require('./routes/pages');
const monitoringRouter = require('./routes/monitoring-dashboard');
const monitoringDummyRouter = require('./routes/monitoring-dummy');
const monitoringApiRouter = require('./routes/monitoring-api');
// New feature routes
const kasbonRouter = require('./routes/kasbon');
const partialPaymentRouter = require('./routes/partial-payment');
const discountRouter = require('./routes/discount');
const changePackageRouter = require('./routes/change-package');
const messageTemplatesRouter = require('./routes/message-templates');
const rekapKeuanganRouter = require('./routes/rekap-keuangan');
const gajiRouter = require('./routes/gaji');
const oltRouter = require('./routes/olt'); // OLT HIOSO monitoring

// Mount routers - ORDER MATTERS!
// More specific routes should come before general ones
app.use('/', publicApiRouter);
app.use('/', adminApiRouter);
app.use('/api/payment-status', paymentStatusRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/users', usersRouter); // Mount this BEFORE general /api to avoid conflicts
app.use('/api/saldo', saldoRouter); // Mount BEFORE general /api routes
app.use('/api/agents', agentsRouter); // Agent management routes
// New feature routes
app.use('/api/kasbon', kasbonRouter); // Kasbon teknisi
app.use('/api/gaji', gajiRouter); // Gaji teknisi
app.use('/api/partial-payment', partialPaymentRouter); // Partial payment
app.use('/api/discount', discountRouter); // Discount pelanggan
app.use('/api/change-package', changePackageRouter); // Ganti paket pelanggan
app.use('/api/message-templates', messageTemplatesRouter); // Message templates management
app.use('/api/rekap-keuangan', rekapKeuanganRouter); // Rekap keuangan / laporan pembayaran
app.use('/api/olt', oltRouter); // OLT HIOSO monitoring
// Monitoring routes - use API router for PHP endpoints
app.use('/api/monitoring', monitoringApiRouter); // PHP monitoring endpoints
// app.use('/api/monitoring', monitoringRouter); // Node.js monitoring routes (disabled)
// app.use('/api/monitoring', monitoringDummyRouter); // Dummy data (disabled)
app.use('/', packagesRouter); // Packages management routes
app.use('/api', accountsRouter); // Accounts management routes
app.use('/api', apiRouter); // This has /users routes, so must come AFTER /api/users
app.use('/api', ticketsRouter);
app.use('/api', invoiceRouter);
app.use('/api', compensationRouter);
app.use('/api', speedRequestsRouter);
app.use('/api', statsRouter); // This has catch-all /:type/:id route, must be LAST
app.use('/', pagesRouter);


// --- VIEW ENGINE AND PHP SETUP ---
app.set('views', 'views');
app.engine('php', phpExpress.engine);
app.set('view engine', 'php');

// PHP file handler
app.all(/.+\.php$/, phpExpress.router);

// Socket.IO setup
const server = createServer(app);
const io = new Server(server);
global.io = io;

function cleanupOldPendingRequests() {
    try {
        const allRequests = loadJSON('database/requests.json');
        const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
        let cleanedCount = 0;
        
        allRequests.forEach(request => {
            if (request.status === 'pending') {
                const requestAge = Date.now() - new Date(request.created_at).getTime();
                
                // Auto-cancel jika lebih dari 7 hari
                if (requestAge > sevenDaysInMs) {
                    request.status = 'cancelled_by_system';
                    request.updated_at = new Date().toISOString();
                    request.updated_by = 'system';
                    request.cancel_reason = 'Request expired (>7 hari)';
                    cleanedCount++;
                    console.log(`[CLEANUP] Auto-cancelled expired request ID ${request.id} (created: ${request.created_at})`);
                } else {
                    // Cek apakah status user sudah sesuai dengan pengajuan
                    const user = global.users.find(u => String(u.id) === String(request.userId));
                    if (user && user.paid === request.newStatus) {
                        request.status = 'cancelled_by_system';
                        request.updated_at = new Date().toISOString();
                        request.updated_by = 'system';
                        request.cancel_reason = 'Status pelanggan sudah sesuai dengan pengajuan';
                        cleanedCount++;
                        console.log(`[CLEANUP] Auto-cancelled request ID ${request.id} - status sudah sesuai`);
                    }
                }
            }
        });
        
        if (cleanedCount > 0) {
            saveJSON('database/requests.json', allRequests);
            console.log(`[CLEANUP] Total ${cleanedCount} pending requests dibersihkan.`);
        } else {
            console.log(`[CLEANUP] Tidak ada pending requests yang perlu dibersihkan.`);
        }
    } catch (error) {
        console.error('[CLEANUP_ERROR] Error cleaning up old requests:', error);
    }
}

function startHttpServer() {
    server.listen(PORT, async () => {
        console.log(`[SERVER] Listening on port ${PORT}`);
        
        // Use absolute path for better cross-platform compatibility
        const sessionPath = path.resolve(process.cwd(), 'sessions', config.sessionName);
        
        if(fs.existsSync(sessionPath)) {
            connect();
        } else {
            console.log("[WA] No session found - scan QR code to connect");
        }
    });
}

async function startApp() {
    // Load ESM modules first
    const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, delay, fetchLatestWaWebVersion } = await import('@whiskeysockets/baileys');

    // Initialize databases and cron tasks
    initializeDatabase().then(() => {
        // Database initialized (silent)
        
        // Auto-migrate databases on startup (safe, non-blocking)
        const { runAutoMigration } = require('./scripts/auto-migrate-on-startup');
        runAutoMigration().catch(err => {
            console.error('[STARTUP] Auto-migration failed:', err.message);
            // Continue startup even if migration fails (for manual fix)
        });
        
        initializeAllCronTasks();
        
        // Initialize upload directories
        initializeUploadDirs();
        
        // Initialize temp folder cleanup
        require('./lib/temp-cleanup');
        
        // Initialize topup expiry checker
        const { initTopupExpiryChecker } = require('./lib/topup-expiry');
        initTopupExpiryChecker();
        
        // Start OLT Log Scraper untuk deteksi LOS/Dying Gasp
        try {
            oltLogScraper.startScraper();
        } catch (err) {
            console.error('[OLT-Scraper] Failed to start:', err.message);
        }
    }).catch(err => {
        console.error('[DATABASE] Failed to initialize database:', err);
    });    
    // Clean up expired speed boost requests
    const { scheduleSpeedBoostCleanup } = require('./lib/speed-boost-cleanup');
    scheduleSpeedBoostCleanup();

    // Start the HTTP server
    startHttpServer();

    // Define the connect function inside startApp to have access to Baileys modules
    async function connect() {
        let { version, isLatest } = await fetchLatestWaWebVersion();
        console.log(`Using: ${version}, newer: ${isLatest}`);
        const { state, saveCreds: saveState } = await useMultiFileAuthState(`sessions/${config.sessionName}`)
        const raf = makeWASocket({
            version,
            logger: P({ level: 'fatal' }),
            browser: ["RAF BOT MD BETA", "safari", "1.0.0"],
            auth: state,
            // Keep-alive configuration untuk mencegah stream timeout (error 515)
            keepAliveIntervalMs: 30000,        // Kirim heartbeat setiap 30 detik
            connectTimeoutMs: 60000,           // Timeout koneksi 60 detik
            retryRequestDelayMs: 2000,         // Delay retry request 2 detik
            defaultQueryTimeoutMs: 60000,      // Timeout query default 60 detik
            markOnlineOnConnect: true,         // Mark online saat connect
            syncFullHistory: false,            // Tidak perlu sync full history
            generateHighQualityLinkPreview: false, // Hemat resource
        });
        raf.multi = true
        raf.nopref = false
        raf.prefa = 'anjing'
        raf.mode = 'public'

        // Assign delay to global scope if needed elsewhere
        global.delay = delay;

        // Listen for LID mapping updates
        raf.ev.on('lid-mapping.update', async (update) => {
            console.log('[LID_MAPPING_UPDATE] Received new LID<->PN mapping:', update);
            // Mapping is automatically handled by signalRepository
        });
        
        // Message deduplication tracker
        const processedMessages = new Set();
        const MESSAGE_CACHE_DURATION = 60000; // 1 minute
        
        // Clear old messages periodically
        setInterval(() => {
            processedMessages.clear();
        }, MESSAGE_CACHE_DURATION);
        
        raf.ev.on('messages.upsert', async m => {
            if (!m.messages || !m.messages[0]?.message) return;
            
            const msg = m.messages[0];
            const messageId = msg.key?.id;
            
            if (messageId && processedMessages.has(messageId)) {
                console.log('[MESSAGE_SKIP] Message already processed:', messageId);
                return;
            }
            
            if (messageId) {
                processedMessages.add(messageId);
            }
            
            try {
                global.monitoring.incrementMetric('messages.received');
                await msgHandler(raf, msg, m);
                global.monitoring.incrementMetric('messages.sent');
                
            } catch (error) {
                console.error('[MESSAGE_ERROR] Error processing message:', error);
                global.monitoring.incrementMetric('messages.failed');
                global.monitoring.logError(error, { context: 'message_processing' });
                
                if (!error.message?.includes('Bad MAC') && !error.message?.includes('decrypt')) {
                    const recovery = await global.errorRecovery.handleError(error, { 
                        context: 'message_processing',
                        retryable: true,
                        identifier: `msg_${messageId || 'unknown'}`
                    });
                    
                    if (recovery.retry && recovery.delay) {
                        setTimeout(async () => {
                            try {
                                if (messageId) processedMessages.delete(messageId);
                                await msgHandler(raf, msg, m);
                            } catch (retryError) {
                                console.error('[MESSAGE_RETRY_ERROR] Retry failed:', retryError);
                            }
                        }, recovery.delay);
                    }
                } else {
                    console.log('[MESSAGE_SKIP] Skipping retry for decryption error');
                }
            }
        });

        raf.ev.on('connection.update', async update => {
            const { connection, lastDisconnect, qr } = update
            
            global.monitoring.updateConnectionStatus('whatsapp', connection);
            
            if (connection === 'open') {
                global.conn = raf;
                global.raf = raf;
                global.whatsappConnectionState = 'open';
                console.log("✅ WhatsApp connection is open.");
                
                const { initializeWrapper } = require('./lib/whatsapp-notification-wrapper');
                if (initializeWrapper(raf)) {
                    console.log("✅ Notification duplicate prevention activated.");
                } else {
                    console.log("⚠️ Failed to initialize notification wrapper.");
                }
                
                io.emit('message', 'connected');
                
                if (global.wasDisconnected) {
                    await global.alertSystem.sendAlert('info', 'SERVICE_RECOVERED', {
                        service: 'WhatsApp'
                    });
                    global.wasDisconnected = false;
                }
                
            } else if (connection === 'connecting') {
                global.whatsappConnectionState = 'connecting';
                console.log("🔄 WhatsApp is connecting...");
            } else if (connection === 'close') {
                global.whatsappConnectionState = 'close';
                global.wasDisconnected = true;
                console.log("❌ WhatsApp connection is closed.");
                
                let reason = lastDisconnect?.error?.output?.statusCode;
                const error = lastDisconnect?.error || new Error('Connection closed');
                error.code = reason || 'CONNECTION_CLOSED';
                
                global.monitoring.logError(error, { 
                    context: 'whatsapp_connection',
                    reason: reason 
                });
                
                if (reason === DisconnectReason.connectionReplaced) {
                    console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
                    raf.logout();
                } else if (reason === DisconnectReason.loggedOut) {
                    console.log(`Device Logged Out, Please Scan Again`);
                    global.conn = null;
                    global.raf = null;
                    io.emit('message', 'disconnected');
                } else {
                    console.log("Connection lost, initiating recovery...");
                    
                    // Reset retry counter untuk whatsapp_connection agar bisa retry terus
                    global.errorRecovery.resetRetryCount('whatsapp_connection');
                    
                    // Langsung reconnect dengan delay, tanpa melalui error recovery yang punya max retries
                    // Karena untuk WhatsApp, kita ingin terus mencoba reconnect selama session valid
                    const reconnectDelay = 5000; // 5 detik
                    console.log(`⏱️ Will retry connection in ${reconnectDelay}ms`);
                    
                    setTimeout(() => {
                        console.log("🔄 Attempting to reconnect WhatsApp...");
                        connect();
                    }, reconnectDelay);
                }
            } else if (update.qr) {
                console.log("Please scan QR code");
                qrcode.toString(update.qr, { type: 'terminal', small: true }, (err, qrString) => {
                    if (err) throw err;
                    console.log(qrString);
                });
                qrcode.toDataURL(update.qr, (err, url) => {
                    io.emit('qr', url);
                });
            }
        });

        raf.ev.on('creds.update', saveState);
        return raf;
    }

    // Make connect function global so it can be called from API routes and recovery
    global.connect = connect;
    global.startBot = connect;  // Alias for error recovery system
    global.rafect = connect;    // Alias for API compatibility
}

startApp().catch(err => {
    console.error("[FATAL_STARTUP_ERROR] Failed to start the application.", err);
    process.exit(1);
});
